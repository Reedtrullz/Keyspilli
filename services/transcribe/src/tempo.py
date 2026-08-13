#!/usr/bin/env python3
"""Print an estimated tempo (BPM) for an audio file.
Used by the worker to set the MIDI tempo so transcribed songs play back at
the right speed. KEYSPILLI_TEMPO_OVERRIDE forces a value (useful when the
beat tracker picks the wrong octave, e.g. exactly 120 vs 60)."""
import os
import sys

import librosa


def main() -> None:
    override = os.environ.get("KEYSPILLI_TEMPO_OVERRIDE")
    if override:
        print(override)
        return
    path = sys.argv[1]
    y, sr = librosa.load(path, sr=22050, mono=True)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    bpm = float(tempo.item() if hasattr(tempo, "item") else tempo)
    print(round(min(220, max(40, bpm)), 1))


if __name__ == "__main__":
    main()
