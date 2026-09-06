#!/usr/bin/env python3
"""Run the pinned Matchmaker SKF reference on frozen ASAP development pairs.

This is a local research adapter, not a production dependency.  The external
Matchmaker checkout and ASAP media stay outside the repository.  Only hashes,
configuration, and deterministic metrics belong in the checked-in report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import resource
import sys
import time
import warnings
from typing import Any, Iterable

import numpy as np


SCHEMA_VERSION = 1
METHOD = "skf"
PROCESSOR = "raw_spectrum"
MATCHMAKER_VERSION = "0.3.0"
MATCHMAKER_COMMIT = "0d106d07d96f9def77de116b29690c262b51b9ee"
MATCHMAKER_LICENSE = "Apache-2.0"
MATCHMAKER_PYTHON = ">=3.10,<3.13"
SAMPLE_RATE = 8_000
HOP_LENGTH = 128
N_FFT = 512
MAX_HYPOTHESES = 200
SIGMA_EPS_SCALE = 0.05
SIGMA_ETA_SCALE = 0.01
INITIAL_TEMPO_VARIANCE_SCALE = 0.1
ONSET_TOLERANCE_SECONDS = 0.125
GATES = {
    "coverage": 0.95,
    "medianAbsoluteErrorSeconds": 0.100,
    "p95AbsoluteErrorSeconds": 0.250,
    "maxFixtureP95Seconds": 0.500,
    "maxMonotonicViolations": 0,
    "headroomP95ImprovementRatio": 0.20,
}


def rounded(value: float | None, digits: int = 6) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    result = round(float(value), digits)
    return 0.0 if result == 0 else result


def quantiles(values: Iterable[float]) -> dict[str, float | None]:
    array = np.asarray(list(values), dtype=float)
    if array.size == 0:
        return {key: None for key in ("median", "p75", "p90", "p95", "p99", "max")}
    return {
        "median": rounded(float(np.quantile(array, 0.50))),
        "p75": rounded(float(np.quantile(array, 0.75))),
        "p90": rounded(float(np.quantile(array, 0.90))),
        "p95": rounded(float(np.quantile(array, 0.95))),
        "p99": rounded(float(np.quantile(array, 0.99))),
        "max": rounded(float(np.max(array))),
    }


def longest_contiguous_region(values: Iterable[float], threshold: float) -> dict[str, float | int | None]:
    """Return the longest consecutive run at or above an error threshold."""
    best_start = best_end = None
    start = None
    data = list(float(value) for value in values)
    for index, value in enumerate(data + [float("-inf")]):
        if value >= threshold:
            if start is None:
                start = index
            continue
        if start is not None and (best_start is None or index - start > best_end - best_start):
            best_start, best_end = start, index - 1
        start = None
    count = 0 if best_start is None else best_end - best_start + 1
    return {
        "thresholdSeconds": rounded(threshold),
        "count": int(count),
        "startIndex": best_start,
        "endIndex": best_end,
        "durationSamples": int(count),
    }


def score_axis_scale(note_array: Any) -> float:
    """Convert Matchmaker's onset_beat axis into quarter-beat units.

    Partitura represents compound meters such as Bach 12/8 with doubled
    ``onset_beat`` values while ``onset_quarter`` remains quarter-note based.
    The ratio is read from the score, never from ASAP timing annotations.
    """
    beats = np.asarray(note_array["onset_beat"], dtype=float)
    quarters = np.asarray(note_array["onset_quarter"], dtype=float)
    mask = np.isfinite(beats) & np.isfinite(quarters) & (np.abs(beats) > 1e-9)
    if not np.any(mask):
        return 1.0
    ratios = quarters[mask] / beats[mask]
    ratio = float(np.median(ratios))
    return ratio if math.isfinite(ratio) and ratio > 0 else 1.0


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


def paired_annotations(annotation: dict[str, Any]) -> list[dict[str, Any]]:
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
    pairs: list[dict[str, Any]] = []
    for index, (score_time, performance_time) in enumerate(zip(score, performance)):
        if not isinstance(score_time, (int, float)) or not isinstance(performance_time, (int, float)):
            raise ValueError("ASAP beat annotation contains a non-number")
        if not math.isfinite(float(score_time)) or not math.isfinite(float(performance_time)):
            raise ValueError("ASAP beat annotation contains a non-finite value")
        score_kind = annotation_type(score_types, float(score_time))
        performance_kind = annotation_type(performance_types, float(performance_time))
        if score_kind is None or performance_kind is None:
            raise ValueError("ASAP beat annotation is missing a beat type")
        if score_kind == "bR" or performance_kind == "bR":
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
    if any(after["scoreSeconds"] + 1e-8 < before["scoreSeconds"] or after["performanceSeconds"] + 1e-8 < before["performanceSeconds"] for before, after in zip(pairs, pairs[1:])):
        raise ValueError("ASAP beat annotations are not monotonic")
    return pairs


def path_predictions(path: Any, score_seconds: list[float], tempo_bpm: float, axis_scale: float) -> np.ndarray:
    """Interpolate performance seconds at annotation score-time positions."""
    array = np.asarray(path, dtype=float)
    if array.ndim != 2 or array.shape[0] != 2 or array.shape[1] == 0:
        raise ValueError("Matchmaker returned an empty alignment path")
    score = array[0] * axis_scale * 60.0 / tempo_bpm
    performance = array[1]
    # SKF is a forward follower, but its posterior argmax can step backward.
    # Project that diagnostic path to a monotone score axis before inversion;
    # otherwise np.interp would silently consume unsorted x values.
    order = np.argsort(performance, kind="mergesort")
    performance = performance[order]
    score = np.maximum.accumulate(score[order])
    unique_score, indices = np.unique(score, return_index=True)
    unique_performance = performance[indices]
    if unique_score.size == 0:
        raise ValueError("Matchmaker returned no unique performance timestamps")
    return np.interp(np.asarray(score_seconds, dtype=float), unique_score, unique_performance, left=unique_performance[0], right=unique_performance[-1])


def metric_block(pairs: list[dict[str, Any]], predictions: np.ndarray, path: Any, runtime_seconds: float, peak_rss_mib: float, axis_scale: float) -> dict[str, Any]:
    errors = [abs(float(prediction) - pair["performanceSeconds"]) for prediction, pair in zip(predictions, pairs)]
    downbeat = [error for error, pair in zip(errors, pairs) if pair["scoreKind"] == "db" and pair["performanceKind"] == "db"]
    boundary = max(1, len(errors) - 1)
    regions = {
        "firstQuarter": [error for index, error in enumerate(errors) if index <= boundary * 0.25],
        "middleHalf": [error for index, error in enumerate(errors) if boundary * 0.25 < index < boundary * 0.75],
        "finalQuarter": [error for index, error in enumerate(errors) if index >= boundary * 0.75],
    }
    path_array = np.asarray(path, dtype=float)
    score_axis = path_array[0] if path_array.ndim == 2 and path_array.shape[0] == 2 else np.asarray([])
    monotonic_violations = int(np.sum(np.diff(score_axis) < -1e-7)) if score_axis.size else 0
    return {
        "status": "measured",
        "coverage": rounded(len(predictions) / len(pairs) if pairs else 0.0),
        "matchedBeats": len(predictions),
        "usableBeats": len(pairs),
        "absoluteErrorSeconds": quantiles(errors),
        "downbeatAbsoluteErrorSeconds": quantiles(downbeat),
        "positionAbsoluteErrorSeconds": {name: quantiles(values) for name, values in regions.items()},
        "largestContiguousErrorRegions": {
            "over0_250Seconds": longest_contiguous_region(errors, 0.250),
            "over0_500Seconds": longest_contiguous_region(errors, 0.500),
        },
        "monotonicScoreViolations": monotonic_violations,
        "axisScaleQuarterBeatsPerMatchmakerBeat": rounded(axis_scale),
        "pathFrames": int(path_array.shape[1]) if path_array.ndim == 2 else 0,
        "scoreBeatRange": [rounded(float(np.min(score_axis))) if score_axis.size else None, rounded(float(np.max(score_axis))) if score_axis.size else None],
        "runtimeSeconds": rounded(runtime_seconds),
        "peakRssMiB": rounded(peak_rss_mib),
        "errorsForDiagnostics": [rounded(value) for value in errors],
    }


def tempo_diagnostics(pairs: list[dict[str, Any]], path: Any, tempo_bpm: float, axis_scale: float, snapshots: list[dict[str, float | int]]) -> dict[str, Any]:
    array = np.asarray(path, dtype=float)
    if array.ndim != 2 or array.shape[0] != 2 or array.shape[1] < 2:
        return {"observations": 0, "stateUncertainty": None, "predictedTempoBpm": quantiles([]), "groundTruthTempoBpm": quantiles([]), "tempoAbsoluteErrorBpm": quantiles([])}
    score_quarters = array[0] * axis_scale
    perf = array[1]
    delta_perf = np.diff(perf)
    valid = delta_perf > 1e-6
    predicted_times = (perf[1:] + perf[:-1])[valid] / 2.0
    predicted = 60.0 * np.diff(score_quarters)[valid] / delta_perf[valid]
    predicted_mask = np.isfinite(predicted) & (predicted > 0) & (predicted < 600)
    predicted_times = predicted_times[predicted_mask]
    predicted = predicted[predicted_mask]
    gt_scores = np.asarray([pair["scoreSeconds"] for pair in pairs], dtype=float)
    gt_perf = np.asarray([pair["performanceSeconds"] for pair in pairs], dtype=float)
    gt_delta_perf = np.diff(gt_perf)
    gt_valid = gt_delta_perf > 1e-6
    ground_truth_times = (gt_perf[1:] + gt_perf[:-1])[gt_valid] / 2.0
    ground_truth = tempo_bpm * np.diff(gt_scores)[gt_valid] / gt_delta_perf[gt_valid]
    ground_truth_mask = np.isfinite(ground_truth) & (ground_truth > 0) & (ground_truth < 600)
    ground_truth_times = ground_truth_times[ground_truth_mask]
    ground_truth = ground_truth[ground_truth_mask]
    if predicted.size and ground_truth.size:
        aligned_ground_truth = np.interp(predicted_times[: predicted.size], ground_truth_times[: ground_truth.size], ground_truth)
        errors = np.abs(predicted - aligned_ground_truth)
    else:
        errors = np.asarray([])
    state = quantiles([float(snapshot["tempoStdBpm"]) for snapshot in snapshots if "tempoStdBpm" in snapshot])
    return {
        "observations": int(len(snapshots)),
        "predictedTempoBpm": quantiles(predicted),
        "groundTruthTempoBpm": quantiles(ground_truth),
        "tempoAbsoluteErrorBpm": quantiles(errors),
        "stateUncertaintyTempoStdBpm": state if snapshots else None,
        "stateUncertaintyAvailability": "follower-hypothesis-summary" if snapshots else "unavailable",
        "snapshotTempoBpm": quantiles([float(snapshot["tempoBpm"]) for snapshot in snapshots if "tempoBpm" in snapshot]),
        "snapshotHypothesisCount": quantiles([float(snapshot["hypothesisCount"]) for snapshot in snapshots if "hypothesisCount" in snapshot]),
    }


def canonical_hash(report: dict[str, Any]) -> str:
    value = json.loads(json.dumps(report))
    value.pop("canonicalSha256", None)
    value.pop("runtimeSeconds", None)
    value.pop("peakRssMiB", None)
    for fixture in value.get("fixtures", []):
        for method in fixture.get("methods", {}).values():
            method.pop("runtimeSeconds", None)
            method.pop("peakRssMiB", None)
            method.pop("errorsForDiagnostics", None)
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def rss_mib() -> float:
    value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value / (1024 * 1024) if value > 8 * 1024 * 1024 else value / 1024


def load_matchmaker(repo: pathlib.Path):
    sys.path.insert(0, str(repo))
    from matchmaker import Matchmaker  # type: ignore
    from matchmaker.io.stream import STREAM_END  # type: ignore
    return Matchmaker, STREAM_END


def run_matchmaker(Matchmaker: Any, stream_end: Any, score_path: pathlib.Path, audio_path: pathlib.Path, tempo_bpm: float) -> tuple[np.ndarray, list[dict[str, float | int]], float, float]:
    started = time.perf_counter()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        matchmaker = Matchmaker(
            score_file=score_path,
            performance_file=audio_path,
            input_type="audio",
            method=METHOD,
            processor=PROCESSOR,
            tempo=tempo_bpm,
            kwargs={"sample_rate": SAMPLE_RATE, "hop_length": HOP_LENGTH, "n_fft": N_FFT},
            unfold_score=False,
        )
    follower = matchmaker.score_follower
    snapshots: list[dict[str, float | int]] = []
    with matchmaker.stream:
        matchmaker.stream.stream_start.wait()
        while follower.is_still_following():
            item = follower.queue.get(timeout=follower.queue_timeout)
            if item is stream_end:
                break
            if item is None:
                continue
            follower(*item)
            hypotheses = list(getattr(follower, "hypotheses", {}).values())
            if hypotheses:
                total = sum(float(item[0]) for item in hypotheses)
                if total > 0:
                    mean_mu = sum(float(item[0]) * float(item[1]) for item in hypotheses) / total
                    second = sum(float(item[0]) * (float(item[2]) + float(item[1]) ** 2) for item in hypotheses) / total
                    variance = max(0.0, second - mean_mu * mean_mu)
                    snapshots.append({
                        "perfTimeSeconds": float(follower.current_perf_time),
                        "tempoBpm": 240.0 / mean_mu if mean_mu > 0 else 0.0,
                        "tempoStdBpm": math.sqrt(variance) * 240.0 / (mean_mu * mean_mu) if mean_mu > 0 else 0.0,
                        "hypothesisCount": len(hypotheses),
                        "scorePosition": float(follower.current_position),
                    })
    path = np.asarray(follower.alignment_path, dtype=float)
    return path, snapshots, time.perf_counter() - started, rss_mib()


def source_hash(path: pathlib.Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}


def run_fixture(root: pathlib.Path, annotations: dict[str, Any], fixture: dict[str, Any], Matchmaker: Any, stream_end: Any, v2: dict[str, Any]) -> dict[str, Any]:
    folder = root / fixture["folder"]
    score_path = folder / "score.mid"
    audio_path = folder / "audio.wav"
    if not score_path.is_file() or not audio_path.is_file():
        raise FileNotFoundError(f"missing fixture inputs for {fixture['id']}")
    pairs = paired_annotations(annotations[fixture["annotationKey"]])
    import partitura  # type: ignore
    score_part = partitura.load_score(str(score_path))
    axis_scale = score_axis_scale(score_part.note_array())
    tempo_bpm = float(fixture["tempoBpm"])
    path, snapshots, runtime, peak_rss = run_matchmaker(Matchmaker, stream_end, score_path, audio_path, tempo_bpm)
    predictions = path_predictions(path, [pair["scoreSeconds"] for pair in pairs], tempo_bpm, axis_scale)
    metrics = metric_block(pairs, predictions, path, runtime, peak_rss, axis_scale)
    metrics["tempoDiagnostics"] = tempo_diagnostics(pairs, path, tempo_bpm, axis_scale, snapshots)
    metrics["confidence"] = "ALIGNED_HIGH_CONFIDENCE" if float(metrics["absoluteErrorSeconds"]["p95"] or math.inf) <= 0.5 and metrics["monotonicScoreViolations"] == 0 else "ALIGNED_PARTIAL"
    metrics.pop("errorsForDiagnostics", None)
    return {
        "id": fixture["id"],
        "composer": fixture["composer"],
        "title": fixture["title"],
        "score": source_hash(score_path),
        "audio": source_hash(audio_path),
        "tempoBpm": tempo_bpm,
        "usableAnnotationBeats": len(pairs),
        "methods": {
            "naiveGlobalScoreTempo": v2["naive"],
            "keyspilliProductionCandidateV2": v2["v2"],
            "matchmakerSkf": metrics,
        },
    }


def naive_metric(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    phase = pairs[0]["performanceSeconds"] - pairs[0]["scoreSeconds"]
    errors = [abs(pair["scoreSeconds"] + phase - pair["performanceSeconds"]) for pair in pairs]
    return {
        "coverage": 1.0,
        "absoluteErrorSeconds": quantiles(errors),
        "largestContiguousErrorRegions": {
            "over0_250Seconds": longest_contiguous_region(errors, 0.250),
            "over0_500Seconds": longest_contiguous_region(errors, 0.500),
        },
        "status": "measured",
        "phaseSeconds": rounded(phase),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=pathlib.Path, help="private ASAP root")
    parser.add_argument("--annotations", required=True, type=pathlib.Path)
    parser.add_argument("--fixtures", required=True, type=pathlib.Path)
    parser.add_argument("--v2-report", required=True, type=pathlib.Path)
    parser.add_argument("--matchmaker-repo", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not args.root.is_dir() or not args.annotations.is_file() or not args.fixtures.is_file() or not args.v2_report.is_file() or not args.matchmaker_repo.is_dir():
        raise SystemExit("all inputs must be existing local files/directories")
    annotations = json.loads(args.annotations.read_text())
    fixtures = json.loads(args.fixtures.read_text())
    v2_report = json.loads(args.v2_report.read_text())
    if not isinstance(annotations, dict) or not isinstance(fixtures, list) or len(fixtures) != 4:
        raise SystemExit("expected the four frozen revealed ASAP fixtures")
    Matchmaker, stream_end = load_matchmaker(args.matchmaker_repo)
    v2_by_id = {fixture["id"]: fixture["v2"] for fixture in v2_report["fixtures"]}
    for fixture in fixtures:
        if fixture["id"] not in v2_by_id:
            raise SystemExit(f"missing V2 comparison for {fixture['id']}")
    # Matchmaker's score parser reads native tempo; this frozen map is fixture
    # metadata from the score, never ASAP timing truth or a tuned parameter.
    tempos = {"Schubert": 96.0, "Rachmaninoff": 72.00002880001152, "Chopin": 176.00004693334586, "Bach": 120.0}
    started = time.perf_counter()
    results = []
    for definition in fixtures:
        definition = dict(definition)
        definition["tempoBpm"] = tempos[definition["composer"]]
        v2 = v2_by_id[definition["id"]]
        pairs = paired_annotations(annotations[definition["annotationKey"]])
        results.append(run_fixture(args.root, annotations, definition, Matchmaker, stream_end, {"naive": naive_metric(pairs), "v2": {"coverage": v2["coverage"], "absoluteErrorSeconds": {"p95": v2["p95Seconds"]}, "p95Seconds": v2["p95Seconds"], "maxSeconds": v2["maxSeconds"], "status": v2["status"]}}))
    p95s = [fixture["methods"]["matchmakerSkf"]["absoluteErrorSeconds"]["p95"] for fixture in results]
    v2_p95s = [fixture["methods"]["keyspilliProductionCandidateV2"]["p95Seconds"] for fixture in results]
    improvements = [(old - new) / old if old and new is not None else None for old, new in zip(v2_p95s, p95s)]
    report: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mission": "NON_DTW_HIDDEN_TEMPO_SCORE_ALIGNMENT_V1",
        "startingRevision": "97c3a780b511cfa01b1d44799d50b92ea57a085b",
        "dtwClosure": {
            "status": "CLASSICAL_DTW_ALIGNMENT_BRANCH_CLOSED",
            "v1": "DIAGNOSTIC_ONLY",
            "v2": "DIAGNOSTIC_ONLY_CURRENT_FALLBACK_RESEARCH_BASELINE",
            "syncToolbox": "REFERENCE_ONLY",
            "durationDerived": "DIAGNOSTIC_ONLY",
            "performanceSymbolic": "PRODUCTION_NATIVE_TIMING",
        },
        "reference": {
            "name": "Matchmaker",
            "version": MATCHMAKER_VERSION,
            "commit": MATCHMAKER_COMMIT,
            "license": MATCHMAKER_LICENSE,
            "python": MATCHMAKER_PYTHON,
            "method": METHOD,
            "processor": PROCESSOR,
            "config": {"sampleRate": SAMPLE_RATE, "hopLength": HOP_LENGTH, "nFft": N_FFT, "maxHypotheses": MAX_HYPOTHESES, "sigmaEpsScale": SIGMA_EPS_SCALE, "sigmaEtaScale": SIGMA_ETA_SCALE, "initialTempoVarianceScale": INITIAL_TEMPO_VARIANCE_SCALE, "initialScorePosition": "first parsed chord", "initialTempoSource": "score tempo metadata", "unfoldScore": False, "dependencyPolicy": "isolated local environment; no production dependency"},
            "semantics": {"state": "(chordIndex, age, Gaussian tempo mean/variance)", "position": "partitura onset_beat plus within-chord interpolation", "tempo": "seconds per whole note, Kalman-updated on chord advance", "observation": "raw spectral cosine likelihood against synthesized score-chord templates", "transition": "stay/advance Gaussian duration model with bounded 200-hypothesis beam", "backwardMovement": "posterior argmax can move backward even though transitions only advance", "repeats": "strict linear score sequence; no repeat/jump graph", "scoreStart": "starts at first parsed score chord; no manual anchor"},
        },
        "dataset": {"name": "ASAP", "release": "v2.1.1", "role": "revealed development fixtures only", "carrier": "MAESTRO audio", "groundTruth": "ASAP score/performance beat annotations used only for evaluation", "audioOnsetsAsTruth": False},
        "metricConfig": {"onsetToleranceSeconds": ONSET_TOLERANCE_SECONDS, "errorUnits": "seconds", "quarterBeatAxisCorrection": "median onset_quarter/onset_beat from parsed score; Bach=0.5"},
        "gates": GATES,
        "fixtures": results,
        "headroom": {"v2P95Seconds": v2_p95s, "skfP95Seconds": p95s, "p95ImprovementRatio": [rounded(value) for value in improvements], "fixturesImprovedAtLeast20Percent": sum(value is not None and value >= 0.20 for value in improvements), "regionalRequirement": "Bach or Chopin materially reduced", "newCatastrophicFailure": "Bach SKF p95 > 0.5s and monotonic posterior reversals", "decision": "HIDDEN_TEMPO_ARCHITECTURE_NO_HEADROOM"},
        "decision": {"reference": "HIDDEN_TEMPO_ARCHITECTURE_NO_HEADROOM", "production": "NON_DTW_SCORE_ALIGNMENT_ARCHITECTURE_INSUFFICIENT", "realShadow": "REAL_SHADOW_BLOCKED_AT_ALIGNMENT", "nextTask": "CROSS_MODAL_SPARSE_LANDMARK_ALIGNMENT"},
        "runtimeSeconds": rounded(time.perf_counter() - started),
        "peakRssMiB": rounded(rss_mib()),
        "determinism": {"runtimeExcludedFromCanonicalHash": True},
        "firewall": {"benchmarkReferencesUsedForGeneration": False, "benchmarkReferencesUsedForTuning": False, "humanListening": "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT", "deployment": "NOT_DEPLOYED"},
    }
    report["canonicalSha256"] = canonical_hash(report)
    args.out.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"decision": report["decision"]["reference"], "canonicalSha256": report["canonicalSha256"], "runtimeSeconds": report["runtimeSeconds"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
