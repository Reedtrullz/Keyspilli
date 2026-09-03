#!/usr/bin/env python3
"""Evaluate score-to-recording timing on three frozen ASAP pairs.

Research-only, bounded and deterministic.  The score MIDI is the only
symbolic alignment input.  ASAP's supplied score/performance beat annotations
are ground truth; performance MIDI is parsed for provenance and sanity only.
No audio onset detector is used as truth and no media is written to the repo.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import resource
import sys
import time
import xml.etree.ElementTree as ET
from typing import Any

import librosa
import numpy as np


ROOT = pathlib.Path(__file__).resolve().parents[3]
CALIBRATOR_PATH = pathlib.Path(__file__).with_name("calibrate-real-alignment.py")
SPEC = importlib.util.spec_from_file_location("keyspilli_alignment_calibrator", CALIBRATOR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load the existing Keyspilli alignment feature path")
CAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAL)

# The existing feature representation and full three-step DTW are retained.
# Raise only the safety ceiling for the frozen 117-second fixture; this is not
# a feature or parameter change.
CAL.MAX_FRAMES = 9_000

SCHEMA_VERSION = 1
ASAP_REVISION = "4097b45757bed854818cf87e77b92323ebf90615"
ASAP_RELEASE = "v2.1.1"
ASAP_LICENSE = "CC BY-NC-SA 4.0"
MAESTRO_RELEASE = "v2.0.0"
FEATURE_CONFIG = {
    "sampleRate": CAL.SAMPLE_RATE,
    "hopLength": CAL.HOP_LENGTH,
    "nFft": CAL.N_FFT,
    "onsetWeight": 0.5,
    "chroma": "stft-12-bin-cosine",
    "dtw": "monotonic-full-matrix-three-step",
    "mapAnchors": CAL.DTW_ANCHOR_COUNT,
}
PRODUCTION_FEATURE_CONFIG = dict(CAL.PRODUCTION_CANDIDATE_CONFIG) | {"fingerprint": CAL.PRODUCTION_CANDIDATE_FINGERPRINT}
GATES = {
    "coverage": 0.95,
    "medianAbsoluteErrorSeconds": 0.100,
    "p95AbsoluteErrorSeconds": 0.250,
    "maxFixtureP95Seconds": 0.500,
    "maxMonotonicViolations": 0,
    "referenceMaterialImprovementP95Seconds": 0.200,
    "referenceMaxRegressedP95Seconds": 0.050,
}

FIXTURES = (
    {
        "id": "asap:dev:bach-fugue-bwv854-lua01m",
        "role": "DEV",
        "folder": "dev",
        "annotationKey": "Bach/Fugue/bwv_854/LuA01M.mid",
        "composer": "Bach",
        "title": "Fugue_bwv_854",
        "metadataStartSeconds": 91.77916666666668,
        "analysisPaddingSeconds": 0.5,
    },
    {
        "id": "asap:holdout-1:chopin-etude-op10-1-chenw03m",
        "role": "HOLDOUT",
        "folder": "holdout-1",
        "annotationKey": "Chopin/Etudes_op_10/1/ChenW03M.mid",
        "composer": "Chopin",
        "title": "Etudes_op_10_1",
        "metadataStartSeconds": None,
        "analysisPaddingSeconds": 0.0,
    },
    {
        "id": "asap:holdout-2:liszt-transcendental-etude-1-luoj05m",
        "role": "HOLDOUT",
        "folder": "holdout-2",
        "annotationKey": "Liszt/Transcendental_Etudes/1/LuoJ05M.mid",
        "composer": "Liszt",
        "title": "Transcendental_Etudes_1",
        "metadataStartSeconds": None,
        "analysisPaddingSeconds": 0.0,
    },
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


def rss_mib() -> float:
    value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    # macOS reports bytes; Linux reports KiB.
    return rounded(value / (1024 * 1024) if value > 1024 * 1024 * 8 else value / 1024) or 0.0


def annotation_type(mapping: dict[str, Any], value: float) -> str | None:
    exact = mapping.get(str(value))
    if isinstance(exact, str):
        return exact
    best: tuple[float, str] | None = None
    for raw, kind in mapping.items():
        try:
            distance = abs(float(raw) - value)
        except (TypeError, ValueError):
            continue
        if isinstance(kind, str) and distance <= 1e-5 and (best is None or distance < best[0]):
            best = (distance, kind)
    return best[1] if best else None


def paired_annotations(annotation: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int]]:
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
    all_pairs: list[dict[str, Any]] = []
    usable: list[dict[str, Any]] = []
    excluded_br = 0
    for index, (score_time, performance_time) in enumerate(zip(score, performance)):
        if not isinstance(score_time, (int, float)) or not isinstance(performance_time, (int, float)):
            raise ValueError("ASAP beat annotation contains a non-number")
        if not math.isfinite(float(score_time)) or not math.isfinite(float(performance_time)):
            raise ValueError("ASAP beat annotation contains a non-finite value")
        score_kind = annotation_type(score_types, float(score_time))
        performance_kind = annotation_type(performance_types, float(performance_time))
        if score_kind is None or performance_kind is None:
            raise ValueError("ASAP beat annotation is missing a beat type")
        pair = {
            "index": index,
            "scoreSeconds": float(score_time),
            "performanceSeconds": float(performance_time),
            "scoreKind": score_kind,
            "performanceKind": performance_kind,
        }
        all_pairs.append(pair)
        if score_kind == "bR" or performance_kind == "bR":
            excluded_br += 1
        else:
            usable.append(pair)
    if any(after["scoreSeconds"] + 1e-8 < before["scoreSeconds"] or after["performanceSeconds"] + 1e-8 < before["performanceSeconds"] for before, after in zip(all_pairs, all_pairs[1:])):
        raise ValueError("ASAP beat annotations are not monotonic")
    if len(usable) < 2:
        raise ValueError("ASAP annotations have fewer than two usable beats")
    return usable, {"total": len(all_pairs), "usable": len(usable), "excludedBR": excluded_br, "downbeats": sum(pair["scoreKind"] == "db" and pair["performanceKind"] == "db" for pair in usable)}


def musicxml_note_count(path: pathlib.Path) -> int:
    root = ET.parse(path).getroot()
    return sum(1 for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "note")


def source_summary(path: pathlib.Path, parsed: dict[str, Any], xml_count: int | None = None) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "format": parsed.get("format"),
        "division": parsed.get("division"),
        "trackCount": parsed.get("track_count"),
        "noteCount": len(parsed.get("notes", [])),
        "durationBeats": rounded(float(parsed.get("duration_beats", 0.0))),
        "durationSeconds": rounded(float(parsed.get("duration_seconds", 0.0))),
        "tempoEvents": [
            {"tick": int(event["tick"]), "microsecondsPerQuarter": int(event["microseconds_per_quarter"]), "bpm": rounded(float(event["bpm"]))}
            for event in parsed.get("tempo_events", [])
        ],
    }
    if xml_count is not None:
        summary["musicXmlNoteCount"] = xml_count
    return summary


def feature_from_audio(audio: np.ndarray) -> tuple[np.ndarray, float]:
    stft = np.abs(librosa.stft(audio, n_fft=CAL.N_FFT, hop_length=CAL.HOP_LENGTH, win_length=CAL.N_FFT))
    chroma = librosa.feature.chroma_stft(S=stft, sr=CAL.SAMPLE_RATE, n_chroma=12)
    chroma = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-8)
    onset = librosa.onset.onset_strength(y=audio, sr=CAL.SAMPLE_RATE, hop_length=CAL.HOP_LENGTH)
    onset = np.maximum(0, (onset - onset.mean()) / (onset.std() + 1e-8))
    onset = onset / (np.max(onset) + 1e-8)
    features = np.vstack((chroma, onset[None, :] * 0.5)).astype(np.float32)
    return features, len(audio) / CAL.SAMPLE_RATE


def load_analysis_audio(path: pathlib.Path, start_seconds: float | None, padding_seconds: float = 0.0) -> tuple[np.ndarray, float]:
    """Load the real carrier with the dataset's prescribed crop/padding."""
    audio, _ = librosa.load(path, sr=CAL.SAMPLE_RATE, mono=True)
    source_duration = len(audio) / CAL.SAMPLE_RATE
    if start_seconds is not None:
        start = max(0, int(round(float(start_seconds) * CAL.SAMPLE_RATE)))
        audio = audio[start:]
    if padding_seconds > 0:
        audio = np.pad(audio, (int(round(padding_seconds * CAL.SAMPLE_RATE)), 0))
    return audio, source_duration


def map_score_to_audio(notes: list[dict[str, Any]], score_features: np.ndarray, audio_features: np.ndarray, audio_duration: float, score_times: list[float]) -> tuple[list[float], dict[str, Any]]:
    note_times = [float(note["native_seconds"]) for note in notes]
    symbolic = CAL.symbolic_features(notes, note_times, audio_duration)
    path, cost = CAL.dtw(symbolic, audio_features)
    score_end = max((float(note["native_seconds"]) + float(note["duration_seconds"]) for note in notes), default=max(score_times, default=0.0)) + 0.5
    mapper, segments = CAL.path_mapper(path, 0.0, score_end)
    return [mapper(value) for value in score_times], {
        "segmentCount": segments,
        "dtwCost": rounded(float(cost)),
        "symbolicFrameCount": int(symbolic.shape[1]),
        "audioFrameCount": int(audio_features.shape[1]),
    }


def map_score_to_audio_production(notes: list[dict[str, Any]], audio_features: np.ndarray, audio_duration: float, score_times: list[float]) -> tuple[list[float], dict[str, Any]]:
    note_times = [float(note["native_seconds"]) for note in notes]
    symbolic = CAL.symbolic_features(notes, note_times, audio_duration)
    path, cost = CAL.dtw(symbolic, audio_features)
    score_end = max((float(note["native_seconds"]) + float(note["duration_seconds"]) for note in notes), default=0.0) + 0.5
    mapper, anchors, approximation_error = CAL.adaptive_path_mapper(
        path,
        0.0,
        score_end,
        approximation_bound_seconds=float(CAL.PRODUCTION_CANDIDATE_CONFIG["mapApproximationBoundSeconds"]),
        max_anchors=int(CAL.PRODUCTION_CANDIDATE_CONFIG["maxMapAnchors"]),
    )
    return [mapper(value) for value in score_times], {
        "segmentCount": max(0, len(anchors) - 1),
        "anchorCount": len(anchors),
        "compactApproximationErrorSeconds": rounded(float(approximation_error)),
        "dtwCost": rounded(float(cost)),
        "symbolicFrameCount": int(symbolic.shape[1]),
        "audioFrameCount": int(audio_features.shape[1]),
    }


def metric_block(pairs: list[dict[str, Any]], predicted: list[float], total_count: int, map_meta: dict[str, Any], runtime: float, rss: float) -> dict[str, Any]:
    errors = [abs(float(prediction) - float(pair["performanceSeconds"])) for prediction, pair in zip(predicted, pairs)]
    downbeat_errors = [error for error, pair in zip(errors, pairs) if pair["scoreKind"] == "db" and pair["performanceKind"] == "db"]
    start_end = max(1, len(errors) - 1)
    buckets = {
        "startQuarter": [error for index, error in enumerate(errors) if index <= start_end * 0.25],
        "middleHalf": [error for index, error in enumerate(errors) if start_end * 0.25 < index < start_end * 0.75],
        "endQuarter": [error for index, error in enumerate(errors) if index >= start_end * 0.75],
    }
    violations = sum(after + 1e-7 < before for before, after in zip(predicted, predicted[1:]))
    return {
        "coverage": rounded(len(predicted) / total_count if total_count else 0.0),
        "matchedBeats": len(predicted),
        "usableBeats": total_count,
        "absoluteErrorSeconds": quantiles(errors),
        "downbeatAbsoluteErrorSeconds": quantiles(downbeat_errors),
        "positionAbsoluteErrorSeconds": {name: quantiles(values) for name, values in buckets.items()},
        "monotonicViolations": int(violations),
        "segmentCount": map_meta.get("segmentCount"),
        "anchorCount": map_meta.get("segmentCount"),
        "dtwCost": map_meta.get("dtwCost"),
        "runtimeSeconds": rounded(runtime),
        "peakRssMiB": rounded(rss),
        "featureFrameCount": map_meta.get("audioFrameCount"),
        "symbolicFrameCount": map_meta.get("symbolicFrameCount"),
    }


def naive_predictions(pairs: list[dict[str, Any]]) -> list[float]:
    # Phase-lock only; no duration fitting or ground-truth warp is used.
    phase = float(pairs[0]["performanceSeconds"]) - float(pairs[0]["scoreSeconds"])
    return [float(pair["scoreSeconds"]) + phase for pair in pairs]


def evaluate_current(notes: list[dict[str, Any]], audio_features: np.ndarray, audio_duration: float, pairs: list[dict[str, Any]], started: float | None = None) -> dict[str, Any]:
    score_times = [float(pair["scoreSeconds"]) for pair in pairs]
    begin = time.perf_counter() if started is None else started
    predictions, metadata = map_score_to_audio(notes, np.zeros((13, 1), dtype=np.float32), audio_features, audio_duration, score_times)
    return metric_block(pairs, predictions, len(pairs), metadata, time.perf_counter() - begin, rss_mib())


def evaluate_production(notes: list[dict[str, Any]], audio_features: np.ndarray, audio_duration: float, pairs: list[dict[str, Any]]) -> dict[str, Any]:
    begin = time.perf_counter()
    predictions, metadata = map_score_to_audio_production(notes, audio_features, audio_duration, [float(pair["scoreSeconds"]) for pair in pairs])
    return metric_block(pairs, predictions, len(pairs), metadata, time.perf_counter() - begin, rss_mib())


def evaluate_naive(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    begin = time.perf_counter()
    predictions = naive_predictions(pairs)
    return metric_block(pairs, predictions, len(pairs), {"segmentCount": 1, "dtwCost": None, "audioFrameCount": None, "symbolicFrameCount": None}, time.perf_counter() - begin, rss_mib())


def remove_inner_score_notes(notes: list[dict[str, Any]], pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    anchors = [float(pair["scoreSeconds"]) for pair in pairs]
    result: list[dict[str, Any]] = []
    for index, note in enumerate(notes):
        onset = float(note["native_seconds"])
        protected = index < 8 or index >= len(notes) - 8 or any(abs(onset - anchor) <= 0.02 for anchor in anchors)
        if protected or index % 10 != 0:
            result.append(note)
    return result


def run_fixture(root: pathlib.Path, annotation_data: dict[str, Any], definition: dict[str, Any]) -> dict[str, Any]:
    folder = root / definition["folder"]
    score_path = folder / "score.mid"
    xml_path = folder / "score.musicxml"
    performance_path = folder / "performance.mid"
    audio_path = folder / "audio.wav"
    for path in (score_path, xml_path, performance_path, audio_path):
        if not path.is_file() or path.stat().st_size == 0:
            raise FileNotFoundError(f"missing frozen ASAP fixture file: {path.name}")
    annotation = annotation_data.get(definition["annotationKey"])
    if not isinstance(annotation, dict):
        raise ValueError(f"missing ASAP annotation key: {definition['annotationKey']}")
    pairs, annotation_summary = paired_annotations(annotation)
    score = CAL.parse_midi(score_path)
    performance = CAL.parse_midi(performance_path)
    xml_count = musicxml_note_count(xml_path)
    audio, source_audio_duration = load_analysis_audio(audio_path, definition["metadataStartSeconds"], definition["analysisPaddingSeconds"])
    audio_features, audio_duration = feature_from_audio(audio)
    notes = score["notes"]
    if not isinstance(notes, list) or not notes:
        raise ValueError("score MIDI contains no notes")
    begin = time.perf_counter()
    current = evaluate_current(notes, audio_features, audio_duration, pairs, begin)
    production = evaluate_production(notes, audio_features, audio_duration, pairs)
    naive = evaluate_naive(pairs)
    mismatch_notes = remove_inner_score_notes(notes, pairs)
    mismatch_begin = time.perf_counter()
    mismatch_predictions, mismatch_meta = map_score_to_audio(mismatch_notes, np.zeros((13, 1), dtype=np.float32), audio_features, audio_duration, [float(pair["scoreSeconds"]) for pair in pairs])
    mismatch = metric_block(pairs, mismatch_predictions, len(pairs), mismatch_meta, time.perf_counter() - mismatch_begin, rss_mib())

    # One controlled audio-only intro diagnostic; primary metrics remain untouched.
    intro_seconds = 3.0
    intro_audio = np.pad(audio, (int(intro_seconds * CAL.SAMPLE_RATE), 0))
    intro_features, intro_duration = feature_from_audio(intro_audio)
    intro_pairs = [dict(pair, performanceSeconds=float(pair["performanceSeconds"]) + intro_seconds) for pair in pairs]
    intro_begin = time.perf_counter()
    intro_predictions, intro_meta = map_score_to_audio(notes, np.zeros((13, 1), dtype=np.float32), intro_features, intro_duration, [float(pair["scoreSeconds"]) for pair in intro_pairs])
    intro = metric_block(intro_pairs, intro_predictions, len(intro_pairs), intro_meta, time.perf_counter() - intro_begin, rss_mib())

    all_score_times = [float(pair["scoreSeconds"]) for pair in pairs]
    repeated_score_groups = sum(abs(after - before) <= 1e-7 for before, after in zip(all_score_times, all_score_times[1:]))
    return {
        "id": definition["id"],
        "role": definition["role"],
        "composer": definition["composer"],
        "title": definition["title"],
        "scoreAndPerformanceAligned": annotation.get("score_and_performance_aligned") is True,
        "metadataStartSeconds": definition["metadataStartSeconds"],
        "annotation": annotation_summary | {"repeatedScoreBeatPairs": repeated_score_groups},
        "score": source_summary(score_path, score, xml_count),
        "performanceMidi": source_summary(performance_path, performance),
        "audio": {"bytes": audio_path.stat().st_size, "sha256": sha256(audio_path), "sourceDurationSeconds": rounded(source_audio_duration), "analysisStartSeconds": rounded(definition["metadataStartSeconds"]), "analysisPaddingSeconds": rounded(definition["analysisPaddingSeconds"]), "analysisDurationSeconds": rounded(audio_duration), "sampleRate": CAL.SAMPLE_RATE, "featureFrameCount": int(audio_features.shape[1])},
        "methods": {"naive-global-tempo": naive, "keyspilli-current-monotonic-dtw": current, "keyspilli-production-candidate-v1": production},
        "diagnostics": {
            "scoreInnerNotesRemoved": len(notes) - len(mismatch_notes),
            "scoreInnerNoteMismatch10pct": {"method": "keyspilli-current-monotonic-dtw", "metrics": mismatch},
            "audioIntroOffset3s": {"method": "keyspilli-current-monotonic-dtw", "metrics": intro},
        },
    }


def gate_fixture(metrics: dict[str, Any]) -> bool:
    error = metrics["absoluteErrorSeconds"]
    return bool(
        float(metrics["coverage"]) >= GATES["coverage"]
        and float(error["median"] or math.inf) <= GATES["medianAbsoluteErrorSeconds"]
        and float(error["p95"] or math.inf) <= GATES["p95AbsoluteErrorSeconds"]
        and float(error["p95"] or math.inf) <= GATES["maxFixtureP95Seconds"]
        and int(metrics["monotonicViolations"]) <= GATES["maxMonotonicViolations"]
    )


def canonical_hash(report: dict[str, Any]) -> str:
    canonical = json.loads(json.dumps(report))
    for fixture in canonical.get("fixtures", []):
        for method in fixture.get("methods", {}).values():
            method.pop("runtimeSeconds", None)
            method.pop("peakRssMiB", None)
        for entry in fixture.get("diagnostics", {}).values():
            if isinstance(entry, dict) and isinstance(entry.get("metrics"), dict):
                entry["metrics"].pop("runtimeSeconds", None)
                entry["metrics"].pop("peakRssMiB", None)
    canonical.pop("runtimeSeconds", None)
    canonical.pop("peakRssMiB", None)
    canonical.pop("canonicalSha256", None)
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=pathlib.Path, help="private directory containing dev/, holdout-1/, holdout-2/")
    parser.add_argument("--annotations", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not args.root.is_dir() or not args.annotations.is_file():
        raise SystemExit("--root and --annotations must point to existing local inputs")
    annotation_data = json.loads(args.annotations.read_text())
    if not isinstance(annotation_data, dict):
        raise SystemExit("ASAP annotation JSON must be an object")
    started = time.perf_counter()
    fixtures = [run_fixture(args.root, annotation_data, definition) for definition in FIXTURES]
    current_pass = all(gate_fixture(fixture["methods"]["keyspilli-current-monotonic-dtw"]) for fixture in fixtures)
    production_pass = all(gate_fixture(fixture["methods"]["keyspilli-production-candidate-v1"]) for fixture in fixtures)
    report: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mission": "SCORE_TO_RECORDING_ALIGNMENT_HARDENING",
        "dataset": {"name": "ASAP", "release": ASAP_RELEASE, "revision": ASAP_REVISION, "license": ASAP_LICENSE, "audioCarrier": "MAESTRO " + MAESTRO_RELEASE},
        "groundTruth": {"source": "ASAP supplied midi_score_beats/performance_beats annotations", "timingDomain": "score annotation seconds to performance recording seconds", "bRPolicy": "exclude a pair when either annotation is bR; retain counts", "audioOnsetsAsTruth": False},
        "scoreInput": "score.mid only; performance.mid is provenance/support and never alignment input",
        "featureConfig": FEATURE_CONFIG,
        "productionCandidate": {"id": CAL.PRODUCTION_CANDIDATE_ID, "config": PRODUCTION_FEATURE_CONFIG},
        "gates": GATES,
        "fixturesFrozenBeforeScoring": True,
        "fixtures": fixtures,
        "decision": "SCORE_TO_RECORDING_ALIGNMENT_READY_CURRENT" if current_pass else "SCORE_ALIGNMENT_PARTIAL",
        "productionCandidateGate": production_pass,
        "productionMethodStatus": {"currentKeyspilli": "DIAGNOSTIC_BASELINE", "productionCandidateV1": "PRODUCTION_CANDIDATE", "naiveGlobalTempo": "DIAGNOSTIC_ONLY", "durationDerivedMapping": "DIAGNOSTIC_ONLY", "synctoolbox": "NOT_YET_EVALUATED"},
        "runtimeSeconds": rounded(time.perf_counter() - started),
        "peakRssMiB": rss_mib(),
    }
    report["canonicalSha256"] = canonical_hash(report)
    args.out.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"decision": report["decision"], "canonicalSha256": report["canonicalSha256"], "runtimeSeconds": report["runtimeSeconds"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
