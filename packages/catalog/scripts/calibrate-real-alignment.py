#!/usr/bin/env python3
"""Bounded, deterministic real score-to-recording alignment.

The ``--production`` mode is the single Keyspilli score-alignment candidate;
the default mode remains a local calibration harness for fixed timing
corruptions.  Neither mode downloads, renders, publishes, or alters MIDI.
NumPy, SciPy, and librosa are the existing worker-side Python dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import struct
import sys
import time
from typing import Callable

import librosa
import numpy as np
from scipy.spatial.distance import cdist

SCHEMA_VERSION = 1
SAMPLE_RATE = 22_050
HOP_LENGTH = 512
N_FFT = 4096
FRAME_SECONDS = HOP_LENGTH / SAMPLE_RATE
MAX_FRAMES = 5000
DTW_ANCHOR_COUNT = 32
MAX_DTW_CELLS = 32_000_000
DENSE_CELL_BYTES = 17

# V2 keeps the feature representation but bounds the expensive search in two
# explicit stages: a small dense coarse pass followed by a rolling-memory
# corridor pass.  The values are frozen as part of the candidate fingerprint.
V2_COARSE_FACTOR = 8
V2_COARSE_MAX_CELLS = 4_000_000
V2_COARSE_SMOOTHING = 3
V2_FINE_CORRIDOR_HALF_WIDTH = 96
V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH = 192
V2_MAX_FINE_FRAMES = 40_000
V2_MAX_FINE_EVALUATED_CELLS = 20_000_000
V2_EDGE_PRESSURE_TRIGGER = 0.25
V2_WEAK_COST_THRESHOLD = 0.70

# Production candidate V2.  The representation and map remain compatible with
# V1, while the search is coarse-to-fine and the fine stage never materializes
# a rows-by-columns cost/backtrace matrix.
PRODUCTION_CANDIDATE_ID = "PRODUCTION_SCORE_ALIGNMENT_CANDIDATE_V2"
PRODUCTION_CANDIDATE_CONFIG = {
    "sampleRate": SAMPLE_RATE,
    "hopLength": HOP_LENGTH,
    "nFft": N_FFT,
    "features": "12-bin-stft-chroma-plus-normalized-onset",
    "onsetWeight": 0.5,
    "search": "coarse-to-fine-corridor-dtw",
    "maxFrames": V2_MAX_FINE_FRAMES,
    "coarseFactor": V2_COARSE_FACTOR,
    "coarseSmoothing": V2_COARSE_SMOOTHING,
    "coarseMaxDtwCells": V2_COARSE_MAX_CELLS,
    "fineCorridorHalfWidth": V2_FINE_CORRIDOR_HALF_WIDTH,
    "fineExpandedCorridorHalfWidth": V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH,
    "maxFineEvaluatedCells": V2_MAX_FINE_EVALUATED_CELLS,
    "edgePressureTrigger": V2_EDGE_PRESSURE_TRIGGER,
    "weakCostThreshold": V2_WEAK_COST_THRESHOLD,
    "map": "adaptive-piecewise-linear",
    "mapApproximationBoundSeconds": 0.125,
    "maxMapAnchors": 129,
    "confidence": "coverage+dtw-cost+map-approximation+corridor-health",
}
PRODUCTION_CANDIDATE_FINGERPRINT = hashlib.sha256(
    json.dumps(PRODUCTION_CANDIDATE_CONFIG, sort_keys=True, separators=(",", ":")).encode()
).hexdigest()

# Frozen before calibration output is read.  The score-like case is deliberately
# not used to change these values.
CHALLENGES = (
    ("native", "native"),
    ("offset-plus-0.50s", "offset-plus"),
    ("offset-minus-0.75s", "offset-minus"),
    ("scale-plus-4pct", "scale-plus"),
    ("scale-minus-4pct", "scale-minus"),
    ("piecewise-4pct-to-minus-4pct", "piecewise"),
    ("combined-plus-0.35s-plus-4pct", "combined"),
    ("score-like-quarter-eighth-grid", "score-like"),
)

PREREGISTERED_GATES = {
    "matchedPerformanceMedianSeconds": 0.100,
    "matchedPerformanceP95Seconds": 0.250,
    "matchedPerformanceCoverage": 0.95,
    "maxMonotonicViolations": 0,
    "maxSegments": DTW_ANCHOR_COUNT,
    "requiredMaterialImprovementRatio": 0.50,
    "scoreLikeP95Seconds": 0.250,
    "scoreLikeMaterialImprovementRatio": 0.90,
}


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_varint(data: bytes, pos: int, end: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if pos >= end:
            raise ValueError("truncated MIDI varint")
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if byte < 0x80:
            return value, pos
    raise ValueError("invalid MIDI varint")


def parse_midi(path: pathlib.Path) -> dict[str, object]:
    data = path.read_bytes()
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError("not a Standard MIDI File")
    header_length = struct.unpack(">I", data[4:8])[0]
    if header_length != 6:
        raise ValueError("unsupported MIDI header length")
    fmt, tracks, division = struct.unpack(">HHH", data[8:14])
    if division == 0 or division & 0x8000:
        raise ValueError("only positive PPQ MIDI division is supported")
    position = 14
    notes: list[dict[str, float | int]] = []
    tempos: list[tuple[int, int]] = []
    eot_ticks: list[int] = []
    for track_index in range(tracks):
        if position + 8 > len(data) or data[position : position + 4] != b"MTrk":
            raise ValueError("invalid MIDI track header")
        length = struct.unpack(">I", data[position + 4 : position + 8])[0]
        position += 8
        end = position + length
        if end > len(data):
            raise ValueError("truncated MIDI track")
        tick = 0
        running: int | None = None
        active: dict[tuple[int, int], list[tuple[int, int, int]]] = {}
        track_end = 0
        while position < end:
            delta, position = read_varint(data, position, end)
            tick += delta
            track_end = max(track_end, tick)
            if position >= end:
                raise ValueError("truncated MIDI event")
            status = data[position]
            position += 1
            if status < 0x80:
                if running is None:
                    raise ValueError("running status without a channel status")
                position -= 1
                status = running
            elif status < 0xF0:
                running = status
            kind = status & 0xF0
            channel = status & 0x0F
            if status == 0xFF:
                if position >= end:
                    raise ValueError("truncated MIDI meta event")
                event_type = data[position]
                position += 1
                size, position = read_varint(data, position, end)
                if position + size > end:
                    raise ValueError("truncated MIDI meta payload")
                if event_type == 0x51 and size == 3:
                    tempos.append((tick, int.from_bytes(data[position : position + 3], "big")))
                if event_type == 0x2F:
                    track_end = max(track_end, tick)
                position += size
                continue
            if status in (0xF0, 0xF7):
                size, position = read_varint(data, position, end)
                if position + size > end:
                    raise ValueError("truncated MIDI sysex payload")
                position += size
                continue
            if status in (0xF1, 0xF3):
                if position + 1 > end:
                    raise ValueError("truncated MIDI system-common message")
                position += 1
                continue
            if status == 0xF2:
                if position + 2 > end:
                    raise ValueError("truncated MIDI system-common message")
                position += 2
                continue
            if status == 0xF6 or status >= 0xF8:
                continue
            size = 1 if kind in (0xC0, 0xD0) else 2
            if position + size > end:
                raise ValueError("truncated MIDI channel message")
            if kind in (0x80, 0x90):
                midi = data[position]
                velocity = data[position + 1]
                key = (channel, midi)
                if channel != 9 and (kind == 0x90 and velocity > 0):
                    active.setdefault(key, []).append((tick, velocity, midi))
                elif channel != 9 and active.get(key):
                    start, start_velocity, started_midi = active[key].pop(0)
                    notes.append({"start_tick": start, "end_tick": max(start + 1, tick), "midi": started_midi, "velocity": start_velocity})
                    if not active[key]:
                        del active[key]
            position += size
        for started in active.values():
            for start, velocity, midi in started:
                notes.append({"start_tick": start, "end_tick": max(start + 1, track_end), "midi": midi, "velocity": velocity})
        eot_ticks.append(track_end)
        position = end
    actual_tempos = sorted((tick, us) for tick, us in tempos if us > 0)
    ordered_tempos = actual_tempos[:]
    if not ordered_tempos or ordered_tempos[0][0] > 0:
        ordered_tempos.insert(0, (0, 500_000))

    def tick_seconds(tick: int) -> float:
        seconds = 0.0
        previous = 0
        current_us = ordered_tempos[0][1]
        for tempo_tick, tempo_us in ordered_tempos:
            if tempo_tick > tick:
                break
            seconds += (tempo_tick - previous) / division * current_us / 1_000_000
            previous = tempo_tick
            current_us = tempo_us
        return seconds + (tick - previous) / division * current_us / 1_000_000

    normalized: list[dict[str, float | int]] = []
    for note in notes:
        start_tick = int(note["start_tick"])
        end_tick = int(note["end_tick"])
        normalized.append({
            "midi": int(note["midi"]),
            "velocity": int(note["velocity"]),
            "beat": start_tick / division,
            "native_seconds": tick_seconds(start_tick),
            "duration_beats": max(1 / division, (end_tick - start_tick) / division),
            "duration_seconds": max(1e-6, tick_seconds(end_tick) - tick_seconds(start_tick)),
        })
    normalized.sort(key=lambda note: (float(note["native_seconds"]), int(note["midi"]), int(note["velocity"])))
    return {
        "format": fmt,
        "track_count": tracks,
        "division": division,
        "tempo_events": [{"tick": tick, "microseconds_per_quarter": us, "bpm": 60_000_000 / us} for tick, us in actual_tempos],
        "notes": normalized,
        "duration_seconds": tick_seconds(max(eot_ticks + [max((int(n["end_tick"]) for n in notes), default=0)])),
        "duration_beats": max((float(n["beat"]) + float(n["duration_beats"]) for n in normalized), default=0.0),
    }


def normalized(value: float) -> float:
    return float(round(value, 6))


def quantiles(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"median": None, "p90": None, "p95": None, "p99": None, "max": None}
    array = np.asarray(values, dtype=float)
    return {key: normalized(float(np.quantile(array, probability))) for key, probability in (("median", 0.5), ("p90", 0.9), ("p95", 0.95), ("p99", 0.99))} | {"max": normalized(float(np.max(array)))}


def load_features(path: pathlib.Path) -> tuple[np.ndarray, np.ndarray, float]:
    audio, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    duration = len(audio) / SAMPLE_RATE
    stft = np.abs(librosa.stft(audio, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=N_FFT))
    chroma = librosa.feature.chroma_stft(S=stft, sr=SAMPLE_RATE, n_chroma=12)
    chroma = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-8)
    onset = librosa.onset.onset_strength(y=audio, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    onset = np.maximum(0, (onset - onset.mean()) / (onset.std() + 1e-8))
    onset = onset / (np.max(onset) + 1e-8)
    features = np.vstack((chroma, onset[None, :] * 0.5))
    return features.astype(np.float32), chroma.astype(np.float32), duration


def symbolic_features(notes: list[dict[str, float | int]], times: list[float], audio_duration: float) -> np.ndarray:
    max_time = max(audio_duration, max((time + float(note["duration_seconds"]) for note, time in zip(notes, times)), default=0.0)) + 0.5
    count = int(math.ceil(max_time / FRAME_SECONDS)) + 1
    if count > MAX_FRAMES:
        raise ValueError("feature matrix exceeds bounded calibration frame limit")
    output = np.zeros((13, count), dtype=np.float32)
    for note, time in zip(notes, times):
        start = max(0, int(time / FRAME_SECONDS))
        end = min(count, max(start + 1, int(math.ceil((time + float(note["duration_seconds"])) / FRAME_SECONDS))))
        weight = 0.3 + int(note["velocity"]) / 127
        output[int(note["midi"]) % 12, start:end] += weight
        output[12, start] += weight * 2
    output[:12] /= np.linalg.norm(output[:12], axis=0, keepdims=True) + 1e-8
    output[12] /= np.max(output[12]) + 1e-8
    return output


def _dense_dtw_with_metrics(
    path_features: np.ndarray,
    audio_features: np.ndarray,
    max_cells: int = MAX_DTW_CELLS,
) -> tuple[np.ndarray, float, dict[str, int | float]]:
    rows, columns = path_features.shape[1], audio_features.shape[1]
    if rows == 0 or columns == 0:
        raise ValueError("DTW requires non-empty feature matrices")
    if rows > MAX_FRAMES or columns > MAX_FRAMES:
        raise ValueError("DTW matrix exceeds bounded calibration frame limit")
    dense_cells = rows * columns
    if dense_cells > max_cells:
        raise ValueError("DTW matrix exceeds bounded calibration cell limit")
    distance = np.nan_to_num(cdist(path_features.T, audio_features.T, metric="cosine"), nan=1.0, posinf=1.0, neginf=1.0)
    cost = np.full((rows, columns), np.inf, dtype=np.float64)
    back = np.zeros((rows, columns), dtype=np.int8)
    cost[0, 0] = distance[0, 0]
    for row in range(rows):
        for column in range(columns):
            if row == 0 and column == 0:
                continue
            choices: list[tuple[float, int]] = []
            if row and column:
                choices.append((cost[row - 1, column - 1], 0))
            if row:
                choices.append((cost[row - 1, column], 1))
            if column:
                choices.append((cost[row, column - 1], 2))
            previous, step = min(choices, key=lambda choice: (choice[0], choice[1]))
            cost[row, column] = distance[row, column] + previous
            back[row, column] = step
    row, column = rows - 1, columns - 1
    result: list[tuple[int, int]] = []
    while True:
        result.append((row, column))
        if row == 0 and column == 0:
            break
        step = int(back[row, column])
        if step == 0:
            row -= 1
            column -= 1
        elif step == 1:
            row -= 1
        else:
            column -= 1
    result.reverse()
    output_path = np.asarray(result, dtype=np.int32)
    return output_path, normalized(float(cost[-1, -1] / len(result))), {
        "evaluatedCells": dense_cells,
        "denseEquivalentCells": dense_cells,
        "peakActiveCells": dense_cells,
        "estimatedDenseBytes": dense_cells * DENSE_CELL_BYTES,
        "reductionRatio": 1.0,
    }


def dtw(path_features: np.ndarray, audio_features: np.ndarray) -> tuple[np.ndarray, float]:
    """Compatibility wrapper for the existing diagnostic challenge harness."""
    path, cost, _ = _dense_dtw_with_metrics(path_features, audio_features)
    return path, cost


def _pool_features(features: np.ndarray, factor: int, smoothing: int) -> np.ndarray:
    if features.ndim != 2 or features.shape[1] == 0:
        raise ValueError("feature pooling requires a non-empty two-dimensional matrix")
    if factor < 1:
        raise ValueError("feature pooling factor must be positive")
    rows, columns = features.shape
    pooled_columns = int(math.ceil(columns / factor))
    padded_columns = pooled_columns * factor
    pad = padded_columns - columns
    source = np.pad(features.astype(np.float32), ((0, 0), (0, pad)), mode="edge") if pad else features.astype(np.float32)
    pooled = source.reshape(rows, pooled_columns, factor).mean(axis=2)
    width = min(max(1, int(smoothing)), pooled_columns)
    if width > 1:
        if width % 2 == 0:
            width -= 1
        if width > 1:
            kernel = np.full(width, 1.0 / width, dtype=np.float32)
            pooled = np.vstack([np.convolve(row, kernel, mode="same") for row in pooled])
    chroma_norm = np.linalg.norm(pooled[:12], axis=0, keepdims=True)
    pooled[:12] /= chroma_norm + 1e-8
    pooled[12:] = np.nan_to_num(pooled[12:], nan=0.0, posinf=0.0, neginf=0.0)
    return pooled.astype(np.float32)


def _corridor_bounds(
    coarse_path: np.ndarray,
    fine_rows: int,
    fine_columns: int,
    factor: int,
    half_width: int,
) -> list[tuple[int, int]]:
    if coarse_path.ndim != 2 or coarse_path.shape[1] != 2 or coarse_path.size == 0:
        raise ValueError("coarse DTW path is invalid")
    if fine_rows <= 0 or fine_columns <= 0 or half_width < 0:
        raise ValueError("fine corridor dimensions are invalid")
    coarse_score = coarse_path[:, 0].astype(float) * factor
    coarse_audio = coarse_path[:, 1].astype(float) * factor
    score_points, unique_indices = np.unique(coarse_score, return_index=True)
    audio_points = coarse_audio[unique_indices]
    if len(score_points) == 1:
        centers = np.full(fine_rows, audio_points[0], dtype=float)
    else:
        centers = np.interp(np.arange(fine_rows, dtype=float), score_points, audio_points)
    bounds: list[tuple[int, int]] = []
    for center in centers:
        lo = max(0, int(math.floor(float(center) - half_width)))
        hi = min(fine_columns - 1, int(math.ceil(float(center) + half_width)))
        bounds.append((lo, max(lo, hi)))
    # Endpoint coverage is required for a complete monotonic alignment.
    first_lo, first_hi = bounds[0]
    bounds[0] = (0, max(0, first_hi))
    last_lo, last_hi = bounds[-1]
    bounds[-1] = (min(last_lo, fine_columns - 1), fine_columns - 1)
    return bounds


def corridor_dtw(
    path_features: np.ndarray,
    audio_features: np.ndarray,
    bounds: list[tuple[int, int]],
    max_evaluated_cells: int = V2_MAX_FINE_EVALUATED_CELLS,
) -> tuple[np.ndarray, float, dict[str, int | float]]:
    """Run three-step DTW in a variable-width corridor with rolling memory."""
    rows, columns = path_features.shape[1], audio_features.shape[1]
    if rows == 0 or columns == 0 or len(bounds) != rows:
        raise ValueError("corridor DTW dimensions are invalid")
    widths: list[int] = []
    for lo, hi in bounds:
        if not (isinstance(lo, (int, np.integer)) and isinstance(hi, (int, np.integer))):
            raise ValueError("corridor bounds must be integer pairs")
        if lo < 0 or hi < lo or hi >= columns:
            raise ValueError("corridor bound is outside the audio feature matrix")
        widths.append(int(hi - lo + 1))
    if bounds[0][0] > 0 or bounds[0][1] < 0 or bounds[-1][0] > columns - 1 or bounds[-1][1] < columns - 1:
        raise ValueError("corridor must include both DTW endpoints")
    evaluated = int(sum(widths))
    if evaluated > max_evaluated_cells:
        raise ValueError("corridor DTW exceeds bounded evaluated-cell limit")

    previous = np.full(widths[0], np.inf, dtype=np.float64)
    previous_lo = int(bounds[0][0])
    back_rows = np.full((rows, max(widths)), -1, dtype=np.int8)
    for row in range(rows):
        lo, hi = (int(bounds[row][0]), int(bounds[row][1]))
        width = hi - lo + 1
        current = np.full(width, np.inf, dtype=np.float64)
        vector = np.nan_to_num(cdist(path_features[:, row : row + 1].T, audio_features[:, lo : hi + 1].T, metric="cosine")[0], nan=1.0, posinf=1.0, neginf=1.0)
        for local, column in enumerate(range(lo, hi + 1)):
            if row == 0:
                if column == 0:
                    current[local] = vector[local]
                    continue
                if local > 0 and math.isfinite(float(current[local - 1])):
                    current[local] = vector[local] + current[local - 1]
                    back_rows[row, local] = 2
                continue
            choices: list[tuple[float, int]] = []
            if previous_lo <= column - 1 < previous_lo + len(previous):
                choices.append((float(previous[column - 1 - previous_lo]), 0))
            if previous_lo <= column < previous_lo + len(previous):
                choices.append((float(previous[column - previous_lo]), 1))
            if local > 0:
                choices.append((float(current[local - 1]), 2))
            if choices:
                best, step = min(choices, key=lambda choice: (choice[0], choice[1]))
                if math.isfinite(best):
                    current[local] = vector[local] + best
                    back_rows[row, local] = step
        previous = current
        previous_lo = lo

    end_lo, end_hi = int(bounds[-1][0]), int(bounds[-1][1])
    end_local = columns - 1 - end_lo
    if end_local < 0 or end_local >= len(previous) or not math.isfinite(float(previous[end_local])):
        raise ValueError("corridor DTW has no monotonic path")
    row, column = rows - 1, columns - 1
    result: list[tuple[int, int]] = []
    while True:
        result.append((row, column))
        if row == 0 and column == 0:
            break
        lo = int(bounds[row][0])
        local = column - lo
        if local < 0 or local >= back_rows.shape[1]:
            raise ValueError("corridor DTW backtrace escaped bounds")
        step = int(back_rows[row, local])
        if step == 0:
            row -= 1
            column -= 1
        elif step == 1:
            row -= 1
        elif step == 2:
            column -= 1
        else:
            raise ValueError("corridor DTW backtrace is incomplete")
    result.reverse()
    output_path = np.asarray(result, dtype=np.int32)
    edge_cells = sum(1 for score, audio in result if audio in (bounds[score][0], bounds[score][1]))
    dense_cells = rows * columns
    return output_path, normalized(float(previous[end_local] / len(output_path))), {
        "evaluatedCells": evaluated,
        "denseEquivalentCells": dense_cells,
        "peakActiveCells": max(widths) * 2,
        "estimatedDenseBytes": dense_cells * DENSE_CELL_BYTES,
        "reductionRatio": normalized(evaluated / dense_cells) if dense_cells else 1.0,
        "edgePressure": normalized(edge_cells / len(output_path)) if output_path.size else 0.0,
        "maxCorridorWidth": max(widths),
    }


def _path_costs(path: np.ndarray, path_features: np.ndarray, audio_features: np.ndarray) -> list[float]:
    values: list[float] = []
    for score_index, audio_index in path:
        left = path_features[:, int(score_index)].astype(float)
        right = audio_features[:, int(audio_index)].astype(float)
        denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
        values.append(1.0 - float(np.dot(left, right) / denominator) if denominator > 1e-12 else 1.0)
    return values


def _weak_regions(values: list[float], threshold: float) -> int:
    return sum(value > threshold and (index == 0 or values[index - 1] <= threshold) for index, value in enumerate(values))


def production_alignment_features(
    notes: list[dict[str, float | int]],
    audio_features: np.ndarray,
    audio_duration: float,
) -> tuple[np.ndarray, float, dict[str, object]]:
    """Return one bounded V2 path and its resource/health diagnostics."""
    global MAX_FRAMES
    MAX_FRAMES = max(MAX_FRAMES, V2_MAX_FINE_FRAMES)
    if not notes:
        raise ValueError("score MIDI contains no timed notes")
    if audio_features.ndim != 2 or audio_features.shape[1] == 0:
        raise ValueError("audio feature matrix is empty")
    note_times = [float(note["native_seconds"]) for note in notes]
    symbolic = symbolic_features(notes, note_times, audio_duration)
    if audio_features.shape[0] != symbolic.shape[0]:
        # Keep the pure mechanism helper useful with reduced synthetic feature
        # channels; production audio uses the native 13-channel representation.
        if audio_features.shape[0] < symbolic.shape[0]:
            symbolic = symbolic[: audio_features.shape[0]]
        else:
            symbolic = np.pad(symbolic, ((0, audio_features.shape[0] - symbolic.shape[0]), (0, 0)))
    coarse_symbolic = _pool_features(symbolic, V2_COARSE_FACTOR, V2_COARSE_SMOOTHING)
    coarse_audio = _pool_features(audio_features, V2_COARSE_FACTOR, V2_COARSE_SMOOTHING)
    coarse_path, coarse_cost, coarse_metrics = _dense_dtw_with_metrics(
        coarse_symbolic,
        coarse_audio,
        max_cells=V2_COARSE_MAX_CELLS,
    )
    fine_rows, fine_columns = symbolic.shape[1], audio_features.shape[1]
    try:
        bounds = _corridor_bounds(coarse_path, fine_rows, fine_columns, V2_COARSE_FACTOR, V2_FINE_CORRIDOR_HALF_WIDTH)
        fine_path, fine_cost, fine_metrics = corridor_dtw(symbolic, audio_features, bounds)
        expansion_passes = 0
        selected_half_width = V2_FINE_CORRIDOR_HALF_WIDTH
    except ValueError:
        bounds = _corridor_bounds(coarse_path, fine_rows, fine_columns, V2_COARSE_FACTOR, V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH)
        fine_path, fine_cost, fine_metrics = corridor_dtw(symbolic, audio_features, bounds)
        expansion_passes = 1
        selected_half_width = V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH
    local_costs = _path_costs(fine_path, symbolic, audio_features)
    weak_regions = _weak_regions(local_costs, V2_WEAK_COST_THRESHOLD)
    if expansion_passes == 0 and (float(fine_metrics["edgePressure"]) > V2_EDGE_PRESSURE_TRIGGER or weak_regions > 0):
        expanded_bounds = _corridor_bounds(coarse_path, fine_rows, fine_columns, V2_COARSE_FACTOR, V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH)
        expanded_path, expanded_cost, expanded_metrics = corridor_dtw(symbolic, audio_features, expanded_bounds)
        if expanded_cost <= fine_cost + 1e-12:
            fine_path, fine_cost, fine_metrics = expanded_path, expanded_cost, expanded_metrics
            local_costs = _path_costs(fine_path, symbolic, audio_features)
            weak_regions = _weak_regions(local_costs, V2_WEAK_COST_THRESHOLD)
            selected_half_width = V2_FINE_CORRIDOR_EXPANDED_HALF_WIDTH
        expansion_passes = 1
    fine_metrics = dict(fine_metrics)
    fine_metrics.update({"corridorHalfWidth": selected_half_width, "expansionPasses": expansion_passes})
    edge_pressure = float(fine_metrics.get("edgePressure", 0.0))
    confidence = _production_confidence(notes, fine_cost, 0.0, DTW_ANCHOR_COUNT, edge_pressure, weak_regions)
    diagnostics: dict[str, object] = {
        "method": "coarse-to-fine-corridor-dtw",
        "coarse": dict(coarse_metrics) | {"frames": [int(coarse_symbolic.shape[1]), int(coarse_audio.shape[1])], "dtwCost": coarse_cost},
        "fine": dict(fine_metrics) | {"frames": [int(fine_rows), int(fine_columns)], "dtwCost": fine_cost, "weakRegionCount": weak_regions, "maxLocalCost": normalized(max(local_costs, default=0.0))},
        "memory": {"peakActiveCells": int(fine_metrics["peakActiveCells"]), "estimatedDenseBytes": int(fine_metrics["estimatedDenseBytes"])},
        "confidence": confidence,
    }
    return fine_path, fine_cost, diagnostics


def path_mapper(path: np.ndarray, candidate_start: float, candidate_end: float) -> tuple[Callable[[float], float], int]:
    candidate_frames = path[:, 0].astype(float) * FRAME_SECONDS
    audio_frames = path[:, 1].astype(float) * FRAME_SECONDS

    def raw(time_value: float) -> float:
        frame = int(round(time_value / FRAME_SECONDS))
        nearby = np.abs(path[:, 0] - frame) <= 1
        if nearby.any():
            return float(np.median(audio_frames[nearby]))
        return float(np.interp(time_value, candidate_frames, audio_frames, left=audio_frames[0], right=audio_frames[-1]))

    anchors = np.linspace(candidate_start, candidate_end, DTW_ANCHOR_COUNT + 1)
    values = np.maximum.accumulate(np.asarray([raw(float(anchor)) for anchor in anchors], dtype=float))

    def mapped(time_value: float) -> float:
        return float(np.interp(time_value, anchors, values, left=values[0], right=values[-1]))

    return mapped, DTW_ANCHOR_COUNT


def _path_samples(path: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Collapse repeated DTW rows to a monotonic score-frame sample map."""
    if path.size == 0:
        raise ValueError("DTW path is empty")
    score_frames = path[:, 0].astype(np.int64)
    audio_frames = path[:, 1].astype(float) * FRAME_SECONDS
    unique: list[int] = []
    values: list[float] = []
    index = 0
    while index < len(score_frames):
        frame = int(score_frames[index])
        end = index + 1
        while end < len(score_frames) and int(score_frames[end]) == frame:
            end += 1
        unique.append(frame)
        values.append(float(np.median(audio_frames[index:end])))
        index = end
    return np.asarray(unique, dtype=float) * FRAME_SECONDS, np.maximum.accumulate(np.asarray(values, dtype=float))


def adaptive_path_mapper(
    path: np.ndarray,
    candidate_start: float,
    candidate_end: float,
    approximation_bound_seconds: float = 0.125,
    max_anchors: int = 129,
) -> tuple[Callable[[float], float], list[tuple[float, float]], float]:
    """Build a compact map with a measured error bound against the raw path.

    The deterministic split only inserts a raw score-frame sample when its
    deviation from the current line exceeds the frozen bound. ``max_anchors``
    is a safety ceiling, not a target shape.
    """
    if not math.isfinite(approximation_bound_seconds) or approximation_bound_seconds <= 0:
        raise ValueError("approximation bound must be positive and finite")
    if max_anchors < 2:
        raise ValueError("adaptive map requires at least two anchors")
    if candidate_end <= candidate_start:
        raise ValueError("adaptive map candidate bounds must be increasing")
    sample_x, sample_y = _path_samples(path)

    def raw(time_value: float) -> float:
        return float(np.interp(time_value, sample_x, sample_y, left=sample_y[0], right=sample_y[-1]))

    anchors: list[tuple[float, float]] = [
        (float(candidate_start), raw(float(candidate_start))),
        (float(candidate_end), raw(float(candidate_end))),
    ]
    samples = [(float(x), float(y)) for x, y in zip(sample_x, sample_y) if candidate_start < x < candidate_end]

    while len(anchors) < max_anchors and samples:
        anchors.sort(key=lambda pair: pair[0])
        best_error = approximation_bound_seconds
        best_sample: tuple[int, int, float, float] | None = None
        for segment_index, ((left_x, left_y), (right_x, right_y)) in enumerate(zip(anchors, anchors[1:])):
            segment_samples = [(i, x, y) for i, (x, y) in enumerate(samples) if left_x < x < right_x]
            if not segment_samples:
                continue
            span = right_x - left_x
            for sample_index, x, y in segment_samples:
                expected = left_y + (right_y - left_y) * ((x - left_x) / span)
                error = abs(y - expected)
                if error > best_error + 1e-12:
                    best_error = error
                    best_sample = (segment_index, sample_index, x, y)
        if best_sample is None:
            break
        _, sample_index, x, y = best_sample
        anchors.append((x, y))
        samples.pop(sample_index)

    anchors.sort(key=lambda pair: pair[0])
    anchor_times = np.asarray([pair[0] for pair in anchors], dtype=float)
    anchor_values = np.maximum.accumulate(np.asarray([pair[1] for pair in anchors], dtype=float))
    errors = [abs(float(y) - float(np.interp(x, anchor_times, anchor_values))) for x, y in zip(sample_x, sample_y)]
    max_error = float(max(errors, default=0.0))

    def mapped(time_value: float) -> float:
        return float(np.interp(time_value, anchor_times, anchor_values, left=anchor_values[0], right=anchor_values[-1]))

    return mapped, list(zip(anchor_times.tolist(), anchor_values.tolist())), max_error


def _beat_samples(notes: list[dict[str, float | int]]) -> tuple[np.ndarray, np.ndarray]:
    """Return a stable native-second to symbolic-beat interpolation table."""
    pairs = sorted((float(note["native_seconds"]), float(note["beat"])) for note in notes)
    unique: list[float] = []
    beats: list[float] = []
    for seconds, beat in pairs:
        if unique and abs(seconds - unique[-1]) <= 1e-9:
            beats[-1] = max(beats[-1], beat)
        else:
            unique.append(seconds)
            beats.append(beat)
    if not unique:
        raise ValueError("score MIDI contains no timed notes")
    return np.asarray(unique, dtype=float), np.asarray(beats, dtype=float)


def _production_confidence(
    notes: list[dict[str, float | int]],
    dtw_cost: float,
    map_error_seconds: float,
    anchor_count: int,
    edge_pressure: float = 0.0,
    weak_regions: int = 0,
) -> dict[str, float | str | list[str]]:
    """Compute transparent, non-learned confidence from structural signals."""
    coverage = 1.0 if notes else 0.0
    cost_quality = max(0.0, 1.0 - min(float(dtw_cost), 1.0))
    map_quality = max(0.0, 1.0 - min(float(map_error_seconds) / 0.125, 1.0))
    complexity_quality = max(0.0, 1.0 - max(0, anchor_count - 33) / 96)
    edge_quality = max(0.0, 1.0 - min(float(edge_pressure), 1.0))
    weak_quality = max(0.0, 1.0 - min(int(weak_regions) / 8, 1.0))
    score = 0.40 * coverage + 0.30 * cost_quality + 0.15 * map_quality + 0.05 * complexity_quality + 0.05 * edge_quality + 0.05 * weak_quality
    signals: list[str] = []
    if not notes:
        signals.append("score has no timed notes")
    if map_error_seconds > 0.125:
        signals.append("compact map exceeds approximation bound")
    if dtw_cost > 0.75:
        signals.append("DTW feature agreement is weak")
    if anchor_count >= 129:
        signals.append("compact map reached anchor safety ceiling")
    if edge_pressure > V2_EDGE_PRESSURE_TRIGGER:
        signals.append("fine corridor path is near an edge")
    if weak_regions > 0:
        signals.append("fine path contains weak correspondence regions")
    state = "ALIGNED_HIGH_CONFIDENCE" if score >= 0.75 and not signals else "ALIGNED_PARTIAL" if score >= 0.40 else "ALIGNMENT_REJECTED"
    return {"state": state, "score": normalized(score), "coverage": normalized(coverage), "signals": signals}


def production_alignment_report(score_path: pathlib.Path, audio_path: pathlib.Path) -> dict[str, object]:
    """Run the single bounded score-to-recording production candidate."""
    global MAX_FRAMES
    MAX_FRAMES = max(MAX_FRAMES, int(PRODUCTION_CANDIDATE_CONFIG["maxFrames"]))
    if not score_path.is_file() or score_path.stat().st_size == 0:
        raise ValueError("score MIDI path must be a non-empty regular file")
    if not audio_path.is_file() or audio_path.stat().st_size == 0:
        raise ValueError("audio path must be a non-empty regular file")
    started = time.perf_counter()
    score = parse_midi(score_path)
    notes = score["notes"]
    if not isinstance(notes, list) or not notes:
        raise ValueError("score MIDI contains no notes")
    audio_features, _, audio_duration = load_features(audio_path)
    path, cost, search_diagnostics = production_alignment_features(notes, audio_features, audio_duration)
    score_end_seconds = max(
        (float(note["native_seconds"]) + float(note["duration_seconds"]) for note in notes),
        default=float(score["duration_seconds"]),
    ) + 0.5
    mapper, anchors_seconds, approximation_error = adaptive_path_mapper(
        path,
        0.0,
        score_end_seconds,
        approximation_bound_seconds=float(PRODUCTION_CANDIDATE_CONFIG["mapApproximationBoundSeconds"]),
        max_anchors=int(PRODUCTION_CANDIDATE_CONFIG["maxMapAnchors"]),
    )
    beat_seconds, beat_values = _beat_samples(notes)
    score_duration_beats = max((float(note["beat"]) + float(note["duration_beats"]) for note in notes), default=0.0)
    anchors = [
        {
            "beat": normalized(float(np.interp(seconds, beat_seconds, beat_values, left=0.0, right=score_duration_beats))),
            "audioSeconds": normalized(float(value)),
        }
        for seconds, value in anchors_seconds
    ]
    fine_diagnostics = search_diagnostics.get("fine", {})
    edge_pressure = float(fine_diagnostics.get("edgePressure", 0.0)) if isinstance(fine_diagnostics, dict) else 0.0
    weak_regions = int(fine_diagnostics.get("weakRegionCount", 0)) if isinstance(fine_diagnostics, dict) else 0
    confidence = _production_confidence(notes, float(cost), approximation_error, len(anchors), edge_pressure, weak_regions)
    mapping_diagnostics = {
        "method": "coarse-to-fine-corridor-dtw",
        "anchors": anchors,
        "segmentCount": max(0, len(anchors) - 1),
        "rawPathFrames": int(len(path)),
        "rawScoreFrames": int(len(np.unique(path[:, 0]))),
        "compactApproximationErrorSeconds": normalized(approximation_error),
        "dtwCost": normalized(float(cost)),
        "coarseEvaluatedCells": int(search_diagnostics["coarse"]["evaluatedCells"]),
        "coarseDenseEquivalentCells": int(search_diagnostics["coarse"]["denseEquivalentCells"]),
        "fineEvaluatedCells": int(search_diagnostics["fine"]["evaluatedCells"]),
        "fineDenseEquivalentCells": int(search_diagnostics["fine"]["denseEquivalentCells"]),
        "fineReductionRatio": float(search_diagnostics["fine"]["reductionRatio"]),
        "corridorHalfWidth": int(search_diagnostics["fine"]["corridorHalfWidth"]),
        "expansionPasses": int(search_diagnostics["fine"]["expansionPasses"]),
        "corridorEdgePressure": float(search_diagnostics["fine"].get("edgePressure", 0.0)),
        "regionalWeakZoneCount": int(search_diagnostics["fine"].get("weakRegionCount", 0)),
        "peakActiveCells": int(search_diagnostics["memory"]["peakActiveCells"]),
        "estimatedDenseBytes": int(search_diagnostics["memory"]["estimatedDenseBytes"]),
    }
    canonical = {
        "schemaVersion": SCHEMA_VERSION,
        "candidate": {"id": PRODUCTION_CANDIDATE_ID, "fingerprint": PRODUCTION_CANDIDATE_FINGERPRINT, "config": PRODUCTION_CANDIDATE_CONFIG},
        "score": {"sha256": sha256(score_path), "bytes": score_path.stat().st_size, "format": score["format"], "division": score["division"], "trackCount": score["track_count"], "noteCount": len(notes), "durationBeats": normalized(float(score["duration_beats"])), "durationSeconds": normalized(float(score["duration_seconds"]))},
        "audio": {"sha256": sha256(audio_path), "bytes": audio_path.stat().st_size, "sampleRate": SAMPLE_RATE, "frameCount": int(audio_features.shape[1]), "durationSeconds": normalized(audio_duration)},
        "mapping": mapping_diagnostics,
        "confidence": confidence,
    }
    report = dict(canonical)
    report["runtimeSeconds"] = normalized(time.perf_counter() - started)
    report["determinismSha256"] = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return report


def challenge_time(kind: str, value: float, duration: float) -> float:
    if kind == "native":
        return value
    if kind == "offset-plus":
        return value + 0.50
    if kind == "offset-minus":
        return value - 0.75
    if kind == "scale-plus":
        return value * 1.04
    if kind == "scale-minus":
        return value * 0.96
    if kind == "piecewise":
        split = duration / 2
        return value * 1.04 if value <= split else split * 1.04 + (value - split) * 0.96
    if kind == "combined":
        return 0.35 + value * 1.04
    if kind == "score-like":
        return math.floor(value / 0.125 + 0.5) * 0.125
    raise ValueError(f"unknown challenge {kind}")


def evaluate_challenge(kind: str, notes: list[dict[str, float | int]], audio_features: np.ndarray, audio_duration: float, duration: float) -> dict[str, object]:
    truth = [float(note["native_seconds"]) for note in notes]
    challenged = [challenge_time(kind, value, duration) for value in truth]
    symbols = symbolic_features(notes, challenged, audio_duration)
    path, cost = dtw(symbols, audio_features)
    mapper, segments = path_mapper(path, min(challenged), max(challenged) + 0.5)
    predicted = [mapper(value) for value in challenged]
    candidate_errors = [abs(predicted_value - truth_value) for predicted_value, truth_value in zip(predicted, truth)]
    baseline_errors = [abs(challenged_value - truth_value) for challenged_value, truth_value in zip(challenged, truth)]
    monotonic = sum(1 for before, after in zip(predicted, predicted[1:]) if after + 1e-6 < before)
    return {
        "noteCount": len(notes),
        "mappedNoteCount": len(predicted),
        "coverage": normalized(len(predicted) / len(notes)) if notes else 0,
        "timingErrorSeconds": quantiles(candidate_errors),
        "baselineTimingErrorSeconds": quantiles(baseline_errors),
        "baselineMedianSeconds": normalized(float(np.median(baseline_errors))) if baseline_errors else None,
        "baselineP95Seconds": normalized(float(np.quantile(np.asarray(baseline_errors), 0.95))) if baseline_errors else None,
        "monotonicViolations": monotonic,
        "segments": segments,
        "dtwCost": cost,
        "errorByPosition": {label: normalized(candidate_errors[index]) for label, index in (("start", 0), ("25pct", len(candidate_errors) // 4), ("50pct", len(candidate_errors) // 2), ("75pct", (3 * len(candidate_errors)) // 4), ("end", len(candidate_errors) - 1))} if candidate_errors else {},
    }


def decide(results: dict[str, dict[str, object]]) -> str:
    matched_ids = [name for name, _ in CHALLENGES if name not in ("native", "score-like-quarter-eighth-grid")]
    matched = all(
        float(results[name]["coverage"]) >= PREREGISTERED_GATES["matchedPerformanceCoverage"]
        and int(results[name]["monotonicViolations"]) <= PREREGISTERED_GATES["maxMonotonicViolations"]
        and float(results[name]["timingErrorSeconds"]["median"]) <= PREREGISTERED_GATES["matchedPerformanceMedianSeconds"]
        and float(results[name]["timingErrorSeconds"]["p95"]) <= PREREGISTERED_GATES["matchedPerformanceP95Seconds"]
        and int(results[name]["segments"]) <= PREREGISTERED_GATES["maxSegments"]
        and float(results[name]["timingErrorSeconds"]["p95"]) <= float(results[name]["baselineP95Seconds"]) * PREREGISTERED_GATES["requiredMaterialImprovementRatio"]
        for name in matched_ids
    )
    score = results["score-like-quarter-eighth-grid"]
    score_ok = (
        float(score["timingErrorSeconds"]["p95"]) <= PREREGISTERED_GATES["scoreLikeP95Seconds"]
        and float(score["timingErrorSeconds"]["p95"]) <= float(score["baselineP95Seconds"]) * PREREGISTERED_GATES["scoreLikeMaterialImprovementRatio"]
    )
    if matched and score_ok:
        return "REAL_SYMBOLIC_TIMING_ALIGNMENT_READY"
    if matched:
        return "REAL_ALIGNMENT_MATCHED_ONLY"
    return "REAL_ALIGNMENT_FEATURE_METHOD_INSUFFICIENT"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--midi", required=True, type=pathlib.Path)
    parser.add_argument("--audio", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=False, type=pathlib.Path)
    parser.add_argument("--production", action="store_true", help="run the frozen production score-to-recording candidate")
    args = parser.parse_args()
    if args.production:
        report = production_alignment_report(args.midi, args.audio)
        if args.out:
            args.out.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
        return 0
    if args.out is None:
        parser.error("--out is required unless --production is used")
    started = time.perf_counter()
    midi = parse_midi(args.midi)
    audio_features, _, audio_duration = load_features(args.audio)
    notes = midi["notes"]
    assert isinstance(notes, list)
    results: dict[str, dict[str, object]] = {}
    for challenge_id, kind in CHALLENGES:
        results[challenge_id] = evaluate_challenge(kind, notes, audio_features, audio_duration, float(midi["duration_seconds"]))
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "fixture": {"id": "maestro:v3:2015-prelude-3", "dataset": "MAESTRO", "license": "CC BY-NC-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/"},
        "sources": {
            "symbolic": {"sha256": sha256(args.midi), "bytes": args.midi.stat().st_size, "format": midi["format"], "division": midi["division"], "durationBeats": normalized(float(midi["duration_beats"])), "durationSeconds": normalized(float(midi["duration_seconds"])), "noteCount": len(notes), "nativeTempoEvents": midi["tempo_events"]},
            "audio": {"sha256": sha256(args.audio), "bytes": args.audio.stat().st_size, "durationSeconds": normalized(audio_duration), "sampleRate": SAMPLE_RATE, "featureFrameCount": int(audio_features.shape[1])},
        },
        "groundTruth": "native MIDI tick/tempo-map seconds from the synchronized MAESTRO performance; no duration-derived scaling",
        "featureConfig": {"sampleRate": SAMPLE_RATE, "hopLength": HOP_LENGTH, "nFft": N_FFT, "chroma": "stft-12-bin-cosine", "onsetWeight": 0.5, "dtw": "monotonic-full-matrix-three-step", "mapAnchors": DTW_ANCHOR_COUNT},
        "challenges": [{"id": name, "kind": kind, "definition": {
            "native": "native MIDI timing",
            "offset-plus": "+0.50 seconds",
            "offset-minus": "-0.75 seconds",
            "scale-plus": "native seconds * 1.04",
            "scale-minus": "native seconds * 0.96",
            "piecewise": "1.04x through half duration, then 0.96x",
            "combined": "0.35 + native seconds * 1.04",
            "score-like": "nearest 0.125-second grid",
        }[kind]} for name, kind in CHALLENGES],
        "gates": PREREGISTERED_GATES,
        "results": results,
        "decision": decide(results),
        "runtimeSeconds": normalized(time.perf_counter() - started),
    }
    canonical = dict(report)
    canonical.pop("runtimeSeconds", None)
    report["determinismSha256"] = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    args.out.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"decision": report["decision"], "determinismSha256": report["determinismSha256"], "runtimeSeconds": report["runtimeSeconds"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
