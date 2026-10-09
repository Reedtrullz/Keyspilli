#!/usr/bin/env python3
"""Fetch a bounded, revision-checked SynTheory triad smoke set; never calls a model."""
import argparse
import array
import hashlib
import io
import json
from pathlib import Path
import random
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid
import wave

REVISION = "92c814ff4731c1b12194ab51f5a8a356ac514a67"
QUALITIES = ("major", "minor", "aug", "dim")
INVERSIONS = (5, 6, 64)


def selection(roots):
    # Inspected upstream ordering; validate each returned label before trusting it.
    return [(root * 1104 + q * 276 + i * 92, root, quality, inv)
            for root in roots for q, quality in enumerate(QUALITIES)
            for i, inv in enumerate(INVERSIONS)]


def check_row(item, expected):
    idx, root, quality, inversion = expected
    row = item["row"]
    actual = (item["row_idx"], row["root_note_pitch_class"], row["chord_type"],
              row["inversion"], row["midi_program_num"])
    if item.get("truncated_cells") or actual != (idx, root, quality, inversion, 0):
        raise ValueError("Dataset row/schema/order changed; inspect before updating the pin")
    return row


def fetch(url, limit):
    # Only the documented dataset server, including redirects. No credentials used.
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            validate_url(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    validate_url(url)
    with urllib.request.build_opener(Redirect).open(url, timeout=25) as response:
        content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError("Response exceeds bounded download size")
        return content, response.headers.get("x-revision")


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "datasets-server.huggingface.co"
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError("Unexpected dataset asset host")


def prepare(output, roots):
    if not shutil.which("ffmpeg"):
        raise ValueError("Existing ffmpeg required; no automatic dependency installation")
    if shutil.disk_usage(output.parent).free < 30 * 1024**3:
        raise ValueError("Below the 30 GiB free-space guard")
    output.mkdir()  # Refuse overwrite, including incomplete earlier runs.
    (output / "audio").mkdir()
    manifest = {"dataset": "meganwei/syntheory", "revision": REVISION,
                "config": "chords", "split": "train", "roots": roots,
                "status": "preparing", "assessment": "not-run", "answers": []}
    tasks = []
    try:
        choices = selection(roots)
        random.SystemRandom().shuffle(choices)
        for expected in choices:
            query = urllib.parse.urlencode(dict(dataset=manifest["dataset"], config="chords",
                                                split="train", offset=expected[0], length=1))
            payload, revision = fetch("https://datasets-server.huggingface.co/rows?" + query, 1024**2)
            if revision != REVISION:
                raise ValueError("Missing/stale dataset-server revision; refuse mixed snapshots")
            rows = json.loads(payload)["rows"]
            if len(rows) != 1:
                raise ValueError("Expected exactly one complete dataset row")
            row = check_row(rows[0], expected)
            asset = next(a for a in row["audio"] if a["type"] == "audio/wav")
            raw, _ = fetch(asset["src"], 8 * 1024**2)
            identifier = uuid.uuid4().hex
            relative = "audio/" + identifier + ".wav"
            # Upstream WAV is float extensible; normalize container, preserve channels/rate.
            converted = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0",
                "-map_metadata", "-1", "-c:a", "pcm_s16le", str(output / relative)],
                input=raw, capture_output=True, timeout=30)
            if converted.returncode:
                raise ValueError("ffmpeg audio conversion failed")
            content = (output / relative).read_bytes()
            with wave.open(io.BytesIO(content)) as wav:
                duration = wav.getnframes() / wav.getframerate()
                pcm = array.array("h", wav.readframes(wav.getnframes()))
            if sys.byteorder != "little":
                pcm.byteswap()
            peak = max((abs(x) for x in pcm), default=0)
            if not 0 < duration <= 30 or peak <= 1:
                raise ValueError("Empty, silent, or unexpectedly long sample")
            tasks.append({"id": identifier, "audio": relative})
            manifest["answers"].append({"id": identifier, "row_idx": expected[0],
                "labels": {k: v for k, v in row.items() if k != "audio"},
                "inversion_index": INVERSIONS.index(row["inversion"]),
                "source_sha256": hashlib.sha256(raw).hexdigest(),
                "audio_sha256": hashlib.sha256(content).hexdigest(),
                "duration_seconds": duration, "pcm_peak": peak})
            print(f"Prepared {len(tasks)}/{len(choices)}", flush=True)
        manifest["status"] = "prepared-not-evaluated"
    finally:
        if manifest["status"] != "prepared-not-evaluated":
            manifest["status"] = "incomplete"
        # No source filenames, signed URLs or answer labels in the model-facing tasks.
        (output / "tasks.json").write_text(json.dumps(tasks, indent=2) + "\n")
        (output / "answers.json").write_text(json.dumps(manifest, indent=2) + "\n")


def self_test():
    assert len(selection([0, 6])) == 24
    assert selection([0])[2] == (184, 0, "major", 64)
    item = {"row_idx": 92, "row": {"root_note_pitch_class": 0, "chord_type": "major",
            "inversion": 6, "midi_program_num": 0}}
    assert check_row(item, selection([0])[1])["inversion"] == 6
    item["row"]["inversion"] = 1
    try:
        check_row(item, selection([0])[1])
    except ValueError:
        pass
    else:
        raise AssertionError("Incorrect inversion encoding accepted")
    for url in ("http://datasets-server.huggingface.co/a", "https://example.com/a"):
        try:
            validate_url(url)
        except ValueError:
            continue
        raise AssertionError("Unexpected host accepted")
    print("Self-check passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path)
    parser.add_argument("--roots", nargs="+", type=int, default=[0], choices=range(12))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if args.output is None or not 1 <= len(set(args.roots)) == len(args.roots) <= 2:
            parser.error("Supply a NEW output directory and one or two distinct pitch classes")
        try:
            prepare(args.output.resolve(), args.roots)
        except Exception as error:
            # Avoid accidentally printing signed URLs from network exceptions.
            detail = str(error) if isinstance(error, ValueError) else type(error).__name__
            print(f"Preparation failed: {detail}. Retain partial receipts.", file=sys.stderr)
            sys.exit(1)
