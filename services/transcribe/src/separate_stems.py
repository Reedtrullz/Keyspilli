#!/usr/bin/env python3
"""Run a bounded Demucs separation and report exact output paths."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--device", choices=("cpu", "cuda", "mps"), default="cpu")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve(strict=True)
    output_path = Path(args.output).resolve()
    output_path.mkdir(parents=True, exist_ok=True)

    # Calling Demucs in-process lets the Node worker's timeout kill the model
    # process itself. Spawning `python -m demucs` here would leave an orphaned
    # child continuing to consume CPU and disk after its wrapper timed out.
    from demucs.separate import main as demucs_main

    demucs_main([
        "--name", args.model,
        "--device", args.device,
        "--out", str(output_path),
        "--jobs", "0",
        "--shifts", "1",
        "--overlap", "0.25",
        str(input_path),
    ])

    track_dirs = sorted(path for path in (output_path / args.model).glob("*") if path.is_dir())
    if len(track_dirs) != 1:
        raise RuntimeError(f"expected one Demucs track directory, found {len(track_dirs)}")
    track_dir = track_dirs[0]
    stem_paths: dict[str, str] = {}
    for stem in ("vocals", "bass", "drums", "other"):
        candidate = track_dir / f"{stem}.wav"
        if not candidate.is_file() or candidate.stat().st_size == 0:
            raise RuntimeError(f"missing or empty Demucs stem: {candidate}")
        stem_paths[stem] = str(candidate)
    # htdemucs_6s and compatible models can expose a dedicated guitar lane.
    # Keep it when available; the Node pipeline falls back to `other` for the
    # established four-stem model.
    guitar = track_dir / "guitar.wav"
    if guitar.is_file() and guitar.stat().st_size > 0:
        stem_paths["guitar"] = str(guitar)

    print("KEYSPILLI_STEMS_JSON:" + json.dumps({
        "version": importlib.metadata.version("demucs"),
        "model": args.model,
        "stems": stem_paths,
    }))


if __name__ == "__main__":
    main()
