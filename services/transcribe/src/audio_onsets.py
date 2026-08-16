#!/usr/bin/env python3
"""Print JSON array of note-onset times (seconds) for an audio file.
Used by the worker to filter Basic Pitch output against real audio onsets,
which removes fabricated notes while keeping every real one."""
import json
import sys

import librosa

# Keep these values mirrored by AUDIO_ONSET_DETECTOR_CONFIG in
# packages/catalog/src/transcribe.ts so provenance describes the detector that
# actually ran, not only the note-to-onset matching tolerance.
SAMPLE_RATE = 22050
HOP_LENGTH = 512
BACKTRACK = True
DELTA = 0.07


def main() -> None:
    path = sys.argv[1]
    y, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    frames = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=HOP_LENGTH, backtrack=BACKTRACK, delta=DELTA
    )
    times = librosa.frames_to_time(frames, sr=sr, hop_length=HOP_LENGTH)
    print(json.dumps([round(float(t), 3) for t in times]))


if __name__ == "__main__":
    main()
