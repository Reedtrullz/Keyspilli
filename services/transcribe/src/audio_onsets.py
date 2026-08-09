#!/usr/bin/env python3
"""Print JSON array of note-onset times (seconds) for an audio file.
Used by the worker to filter Basic Pitch output against real audio onsets,
which removes fabricated notes while keeping every real one."""
import json
import sys

import librosa


def main() -> None:
    path = sys.argv[1]
    y, sr = librosa.load(path, sr=22050, mono=True)
    frames = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=512, backtrack=True, delta=0.07
    )
    times = librosa.frames_to_time(frames, sr=sr, hop_length=512)
    print(json.dumps([round(float(t), 3) for t in times]))


if __name__ == "__main__":
    main()
