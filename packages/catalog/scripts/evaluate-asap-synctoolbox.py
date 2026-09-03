#!/usr/bin/env python3
"""Run the one preregistered SyncToolbox reference alignment.

This is an evaluation-only script.  It uses the official score/audio notebook
pipeline from SyncToolbox 1.4.2 (feature rate 50 Hz, CENS, DLNCO, MrMsDTW),
with ASAP beat annotations as timing ground truth.  It never writes MIDI,
changes Keyspilli configuration, or treats the reference result as a
generation/tuning input.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import pathlib
import resource
import time
from typing import Any

import librosa
import numpy as np
import pandas as pd

from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw
from synctoolbox.dtw.utils import compute_optimal_chroma_shift, make_path_strictly_monotonic, shift_chroma_vectors
from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma, quantized_chroma_to_CENS
from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features
from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
from synctoolbox.feature.utils import estimate_tuning


CALIBRATOR_PATH = pathlib.Path(__file__).with_name("calibrate-real-alignment.py")
SPEC = importlib.util.spec_from_file_location("keyspilli_alignment_calibrator", CALIBRATOR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load Keyspilli MIDI parser")
CAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAL)

SCHEMA_VERSION = 1
SAMPLE_RATE = 22_050
FEATURE_RATE = 50
STEP_WEIGHTS = np.asarray([1.5, 1.5, 2.0])
THRESHOLD_REC = 10**6
SYNCTOOLBOX_VERSION = "1.4.2"
SYNCTOOLBOX_COMMIT = "49b1f128c719883e0b007f5948efde985445199f"
SYNCTOOLBOX_LICENSE = "MIT"
ASAP_REVISION = "4097b45757bed854818cf87e77b92323ebf90615"
ASAP_RELEASE = "v2.1.1"
ASAP_LICENSE = "CC BY-NC-SA 4.0"
GATES = {
    "coverage": 0.95,
    "medianAbsoluteErrorSeconds": 0.100,
    "p95AbsoluteErrorSeconds": 0.250,
    "maxFixtureP95Seconds": 0.500,
    "maxMonotonicViolations": 0,
}

FIXTURES = (
    ("asap:dev:bach-fugue-bwv854-lua01m", "DEV", "dev", "Bach/Fugue/bwv_854/LuA01M.mid", 91.77916666666668, 0.5),
    ("asap:holdout-1:chopin-etude-op10-1-chenw03m", "HOLDOUT", "holdout-1", "Chopin/Etudes_op_10/1/ChenW03M.mid", None, 0.0),
    ("asap:holdout-2:liszt-transcendental-etude-1-luoj05m", "HOLDOUT", "holdout-2", "Liszt/Transcendental_Etudes/1/LuoJ05M.mid", None, 0.0),
)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    result = round(float(value), digits)
    return 0.0 if result == 0 else result


def quantiles(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {key: None for key in ("median", "p75", "p90", "p95", "p99", "max")}
    array = np.asarray(values, dtype=float)
    return {
        "median": rounded(float(np.quantile(array, 0.50))),
        "p75": rounded(float(np.quantile(array, 0.75))),
        "p90": rounded(float(np.quantile(array, 0.90))),
        "p95": rounded(float(np.quantile(array, 0.95))),
        "p99": rounded(float(np.quantile(array, 0.99))),
        "max": rounded(float(np.max(array))),
    }


def peak_rss_mib() -> float:
    value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return rounded(value / (1024 * 1024) if value > 1024 * 1024 * 8 else value / 1024) or 0.0


def annotation_type(mapping: dict[str, Any], value: float) -> str | None:
    exact = mapping.get(str(value))
    if isinstance(exact, str):
        return exact
    for raw, kind in mapping.items():
        try:
            if isinstance(kind, str) and abs(float(raw) - value) <= 1e-5:
                return kind
        except (TypeError, ValueError):
            continue
    return None


def usable_pairs(annotation: dict[str, Any]) -> tuple[list[dict[str, float | int | str]], dict[str, int]]:
    score = annotation.get("midi_score_beats")
    performance = annotation.get("performance_beats")
    score_types = annotation.get("midi_score_beats_type")
    performance_types = annotation.get("performance_beats_type")
    if not isinstance(score, list) or not isinstance(performance, list) or len(score) != len(performance):
        raise ValueError("ASAP score/performance beat arrays are not equal length")
    if annotation.get("score_and_performance_aligned") is not True:
        raise ValueError("ASAP fixture is not marked score_and_performance_aligned")
    if not isinstance(score_types, dict) or not isinstance(performance_types, dict):
        raise ValueError("ASAP beat-type annotations are missing")
    pairs: list[dict[str, float | int | str]] = []
    excluded = 0
    for index, (score_time, performance_time) in enumerate(zip(score, performance)):
        if not isinstance(score_time, (int, float)) or not isinstance(performance_time, (int, float)):
            raise ValueError("ASAP beat annotation contains a non-number")
        score_kind = annotation_type(score_types, float(score_time))
        performance_kind = annotation_type(performance_types, float(performance_time))
        if score_kind is None or performance_kind is None:
            raise ValueError("ASAP beat annotation is missing a beat type")
        if score_kind == "bR" or performance_kind == "bR":
            excluded += 1
            continue
        pairs.append({
            "index": index,
            "scoreSeconds": float(score_time),
            "performanceSeconds": float(performance_time),
            "scoreKind": score_kind,
            "performanceKind": performance_kind,
        })
    if len(pairs) < 2:
        raise ValueError("ASAP annotations have fewer than two usable beats")
    return pairs, {"total": len(score), "usable": len(pairs), "excludedBR": excluded}


def score_dataframe(notes: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame([
        {
            "start": float(note["native_seconds"]),
            "duration": float(note["duration_seconds"]),
            "pitch": int(note["midi"]),
            "velocity": float(note["velocity"]),
            "instrument": "acoustic piano",
        }
        for note in notes
    ])


def official_features(audio: np.ndarray, notes: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]:
    """The feature sequence in sync_audio_score_full.ipynb, without plots."""
    tuning = int(estimate_tuning(audio, SAMPLE_RATE))
    with contextlib.redirect_stdout(io.StringIO()):
        audio_pitch = audio_to_pitch_features(audio, Fs=SAMPLE_RATE, feature_rate=FEATURE_RATE, tuning_offset=tuning, verbose=False)
        audio_chroma = quantize_chroma(pitch_to_chroma(audio_pitch))
        audio_peaks = audio_to_pitch_onset_features(audio, Fs=SAMPLE_RATE, tuning_offset=tuning, verbose=False)
        audio_dlnco = pitch_onset_features_to_DLNCO(audio_peaks, feature_rate=FEATURE_RATE, feature_sequence_length=audio_chroma.shape[1])
        frame = score_dataframe(notes)
        score_pitch = df_to_pitch_features(frame, feature_rate=FEATURE_RATE)
        score_chroma = quantize_chroma(pitch_to_chroma(score_pitch))
        score_peaks = df_to_pitch_onset_features(frame)
        score_dlnco = pitch_onset_features_to_DLNCO(score_peaks, feature_rate=FEATURE_RATE, feature_sequence_length=score_chroma.shape[1])
        audio_cens = quantized_chroma_to_CENS(audio_chroma, 201, 50, FEATURE_RATE)[0]
        score_cens = quantized_chroma_to_CENS(score_chroma, 201, 50, FEATURE_RATE)[0]
    shift = int(compute_optimal_chroma_shift(audio_cens, score_cens))
    return audio_chroma, audio_dlnco, shift_chroma_vectors(score_chroma, shift), shift_chroma_vectors(score_dlnco, shift), shift


def metric_block(pairs: list[dict[str, float | int | str]], predictions: np.ndarray, runtime: float, path: np.ndarray, shift: int, feature_shapes: tuple[tuple[int, int], tuple[int, int]]) -> dict[str, Any]:
    truth = np.asarray([float(pair["performanceSeconds"]) for pair in pairs])
    errors = np.abs(predictions - truth).tolist()
    downbeat_errors = [error for error, pair in zip(errors, pairs) if pair["scoreKind"] == "db" and pair["performanceKind"] == "db"]
    violations = int(np.sum(predictions[1:] + 1e-7 < predictions[:-1]))
    return {
        "coverage": rounded(len(predictions) / len(pairs) if pairs else 0.0),
        "matchedBeats": len(predictions),
        "usableBeats": len(pairs),
        "absoluteErrorSeconds": quantiles(errors),
        "downbeatAbsoluteErrorSeconds": quantiles(downbeat_errors),
        "monotonicViolations": violations,
        "warpPathFrames": int(path.shape[1]),
        "featureRate": FEATURE_RATE,
        "chromaShiftBins": shift,
        "audioFeatureShape": list(feature_shapes[0]),
        "scoreFeatureShape": list(feature_shapes[1]),
        "runtimeSeconds": rounded(runtime),
        "peakRssMiB": peak_rss_mib(),
    }


def naive_predictions(pairs: list[dict[str, float | int | str]]) -> np.ndarray:
    phase = float(pairs[0]["performanceSeconds"]) - float(pairs[0]["scoreSeconds"])
    return np.asarray([float(pair["scoreSeconds"]) + phase for pair in pairs], dtype=float)


def load_analysis_audio(path: pathlib.Path, start_seconds: float | None, padding_seconds: float = 0.0) -> tuple[np.ndarray, float]:
    """Load the real carrier with the dataset's prescribed crop/padding."""
    audio, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    source_duration = len(audio) / SAMPLE_RATE
    if start_seconds is not None:
        start = max(0, int(round(float(start_seconds) * SAMPLE_RATE)))
        audio = audio[start:]
    if padding_seconds > 0:
        audio = np.pad(audio, (int(round(padding_seconds * SAMPLE_RATE)), 0))
    return audio, source_duration


def run_fixture(root: pathlib.Path, annotations: dict[str, Any], fixture: tuple[str, str, str, str, float | None, float]) -> dict[str, Any]:
    fixture_id, role, folder_name, annotation_key, metadata_start_seconds, analysis_padding_seconds = fixture
    folder = root / folder_name
    score_path = folder / "score.mid"
    performance_path = folder / "performance.mid"
    audio_path = folder / "audio.wav"
    if not all(path.is_file() and path.stat().st_size > 0 for path in (score_path, performance_path, audio_path)):
        raise FileNotFoundError(f"missing frozen fixture input in {folder_name}")
    annotation = annotations.get(annotation_key)
    if not isinstance(annotation, dict):
        raise ValueError(f"missing ASAP annotation key: {annotation_key}")
    pairs, annotation_summary = usable_pairs(annotation)
    score = CAL.parse_midi(score_path)
    performance = CAL.parse_midi(performance_path)
    audio, source_audio_duration = load_analysis_audio(audio_path, metadata_start_seconds, analysis_padding_seconds)
    started = time.perf_counter()
    audio_chroma, audio_dlnco, score_chroma, score_dlnco, shift = official_features(audio, score["notes"])
    with contextlib.redirect_stdout(io.StringIO()):
        path = sync_via_mrmsdtw(
            f_chroma1=audio_chroma,
            f_onset1=audio_dlnco,
            f_chroma2=score_chroma,
            f_onset2=score_dlnco,
            input_feature_rate=FEATURE_RATE,
            step_weights=STEP_WEIGHTS,
            threshold_rec=THRESHOLD_REC,
            verbose=False,
        )
    path = make_path_strictly_monotonic(path)
    score_frames = path[1] / FEATURE_RATE
    audio_frames = path[0] / FEATURE_RATE
    score_times = np.asarray([float(pair["scoreSeconds"]) for pair in pairs])
    predictions = np.interp(score_times, score_frames, audio_frames, left=audio_frames[0], right=audio_frames[-1])
    method = metric_block(pairs, predictions, time.perf_counter() - started, path, shift, (audio_chroma.shape, score_chroma.shape))
    naive_started = time.perf_counter()
    naive = metric_block(pairs, naive_predictions(pairs), time.perf_counter() - naive_started, np.zeros((2, 0), dtype=np.int32), 0, ((0, 0), (0, 0)))
    return {
        "id": fixture_id,
        "role": role,
        "annotationKey": annotation_key,
        "annotation": annotation_summary,
        "score": {
            "bytes": score_path.stat().st_size,
            "sha256": sha256(score_path),
            "noteCount": len(score["notes"]),
            "durationSeconds": rounded(float(score["duration_seconds"])),
            "durationBeats": rounded(float(score["duration_beats"])),
            "trackCount": int(score["track_count"]),
        },
        "performanceMidi": {
            "bytes": performance_path.stat().st_size,
            "sha256": sha256(performance_path),
            "noteCount": len(performance["notes"]),
            "durationSeconds": rounded(float(performance["duration_seconds"])),
        },
        "audio": {
            "bytes": audio_path.stat().st_size,
            "sha256": sha256(audio_path),
            "sourceDurationSeconds": rounded(source_audio_duration),
            "analysisStartSeconds": rounded(metadata_start_seconds),
            "analysisPaddingSeconds": rounded(analysis_padding_seconds),
            "analysisDurationSeconds": rounded(len(audio) / SAMPLE_RATE),
            "sampleRate": SAMPLE_RATE,
        },
        "methods": {"synctoolbox-official-mrmsdtw": method, "naive-global-tempo": naive},
    }


def canonical_hash(report: dict[str, Any]) -> str:
    canonical = json.loads(json.dumps(report))
    for fixture in canonical.get("fixtures", []):
        for method in fixture.get("methods", {}).values():
            method.pop("runtimeSeconds", None)
            method.pop("peakRssMiB", None)
    canonical.pop("runtimeSeconds", None)
    canonical.pop("peakRssMiB", None)
    canonical.pop("canonicalSha256", None)
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def passes_broad(metrics: dict[str, Any]) -> bool:
    errors = metrics["absoluteErrorSeconds"]
    return bool(
        float(metrics["coverage"]) >= GATES["coverage"]
        and float(errors["median"] or math.inf) <= GATES["medianAbsoluteErrorSeconds"]
        and float(errors["p95"] or math.inf) <= GATES["maxFixtureP95Seconds"]
        and int(metrics["monotonicViolations"]) <= GATES["maxMonotonicViolations"]
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=pathlib.Path)
    parser.add_argument("--annotations", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not args.root.is_dir() or not args.annotations.is_file():
        raise SystemExit("--root and --annotations must point to existing local inputs")
    annotations = json.loads(args.annotations.read_text())
    if not isinstance(annotations, dict):
        raise SystemExit("ASAP annotations must be an object")
    started = time.perf_counter()
    fixtures = [run_fixture(args.root, annotations, fixture) for fixture in FIXTURES]
    strict = all(
        float(fixture["methods"]["synctoolbox-official-mrmsdtw"]["absoluteErrorSeconds"]["p95"] or math.inf) <= GATES["p95AbsoluteErrorSeconds"]
        for fixture in fixtures
    )
    broad = all(passes_broad(fixture["methods"]["synctoolbox-official-mrmsdtw"]) for fixture in fixtures)
    report: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mission": "SCORE_TO_RECORDING_ALIGNMENT_HARDENING",
        "reference": {
            "tool": "SyncToolbox",
            "version": SYNCTOOLBOX_VERSION,
            "commit": SYNCTOOLBOX_COMMIT,
            "license": SYNCTOOLBOX_LICENSE,
            "pipeline": "sync_audio_score_full.ipynb official/default MrMsDTW path",
        },
        "dataset": {"name": "ASAP", "release": ASAP_RELEASE, "revision": ASAP_REVISION, "license": ASAP_LICENSE, "audioCarrier": "MAESTRO v2.0.0"},
        "groundTruth": {"source": "ASAP midi_score_beats/performance_beats", "bRPolicy": "exclude a pair when either side is bR", "audioOnsetsAsTruth": False},
        "config": {"sampleRate": SAMPLE_RATE, "featureRate": FEATURE_RATE, "censWindow": 201, "censDownsample": 50, "stepWeights": STEP_WEIGHTS.tolist(), "thresholdRec": THRESHOLD_REC, "tuning": "SyncToolbox estimate_tuning"},
        "gates": GATES,
        "fixturesFrozenBeforeScoring": True,
        "fixtures": fixtures,
        "strictAllFixturesPass": strict,
        "broadAllFixturesPass": broad,
        "decision": "SCORE_ALIGNMENT_REFERENCE_PROVES_HEADROOM" if broad else "SCORE_ALIGNMENT_PARTIAL",
        "productionMethodStatus": {"keyspilliCurrent": "PRODUCTION_CANDIDATE_BENCHMARKED_SEPARATELY", "synctoolbox": "REFERENCE_ONLY_DIAGNOSTIC_ONLY", "naiveGlobalTempo": "DIAGNOSTIC_ONLY"},
        "runtimeSeconds": rounded(time.perf_counter() - started),
        "peakRssMiB": peak_rss_mib(),
    }
    report["canonicalSha256"] = canonical_hash(report)
    args.out.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"decision": report["decision"], "canonicalSha256": report["canonicalSha256"], "runtimeSeconds": report["runtimeSeconds"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
