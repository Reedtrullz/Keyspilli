# Tutorial extraction runtime candidate — 2026-09-08

Status: **isolated Linux amd64 CLI image built and smoke-tested**, not deployed. Owner explicitly authorized the Docker smoke run. Production Dockerfile, worker routing and deployment configuration are unchanged. See the dated validation below; full HTTP worker packaging remains unverified.

`services/transcribe/Dockerfile.tutorial` is a separate Python 3.12 CLI image for local, authorized tutorial media. It contains no Node worker, transcription models, Torch or Demucs. A Dockerfile-specific ignore file limits build context to the two Python sources, tests and requirements; local videos and the optional venv are excluded.

## Dependencies and license evidence

`requirements-tutorial.txt` pins all 33 distributions observed in `output/tutorial-recovery/venv` on this checkout. LumaChords 0.1.4 requires Python >=3.12 and NumPy >=2.4.2. Its package initializer imports `entrypoint`, which imports `app`, so calling geometry still loads broad GUI/MIDI/render dependencies. This is a separate extraction image, **not a stripped geometry-only dependency set**. The candidate uses normal dependency resolution and `pip check`, never `--no-deps`.

`tutorial-runtime-dependencies-2026-09-08.json` records exact installed versions, declared requirements, Python requirements, license metadata/classifiers and packaged license-file paths. This is local distribution evidence, not proof that Linux wheels resolve or that every native library is present. The local environment has no pip module; an importlib.metadata + packaging requirement scan found no missing or conflicting active requirements. Geometry imports and `init_state()` succeeded locally; 20 synthetic Python tests passed.

LumaChords and OpenCV report Apache-2.0; NumPy carries BSD/0BSD/MIT/Zlib/CC0 components; Mido, pyfluidsynth, pygame-menu, pyvips, fonttools and most support packages report MIT/BSD-family licenses. Crossfiledialog and Verovio report LGPL-3.0-only; pyvips-binary LGPL-3.0-or-later; pygame LGPL. Matplotlib reports its PSF-style license; tqdm MPL-2.0 AND MIT; yt-dlp Unlicense. `ffmpeg-python` reports UNKNOWN in its License field but the installed classifier and LICENSE identify Apache licensing; PyOpenGL/accelerate have BSD classifiers. See the JSON for every package rather than interpreting missing/verbose metadata as proprietary licensing.

These are free/open-source dependencies with no noncommercial-only restriction identified in the recorded metadata. Preserve notices and packaged licenses. Redistribution of an image also requires fulfilling applicable LGPL/GPL source and relinking obligations for native binaries, including Debian FFmpeg and bundled wheels; this record is not a completed redistribution compliance package. Extracting a copyrighted tutorial does not grant rights to distribute its music or arrangements.

The Python base is pinned to the official Docker Hub multi-platform index digest. All 33 Python releases are hash-locked with 769 published distribution hashes retrieved from official PyPI release JSON; pip uses `--require-hashes`. `tutorial-runtime-artifact-hashes-2026-09-08.json` records filenames, hashes and source URLs. No wheels were downloaded. This fixes accepted source artifacts, not Linux installability. Debian apt packages are still resolved from live repositories and are not version/hash locked: that is the OS layer reproducibility ceiling. If pip selects an sdist, isolated build-tool dependencies are also not covered by these runtime hashes; record the build result and replace that path with verified wheels or a separately locked build environment before claiming byte reproducibility. Capture the native package/license manifest from the clean build.

## Clean-container gate (run on a host with adequate disk)

From the repository root, after confirming at least 30 GiB free:

```sh
docker build --platform linux/amd64 -f services/transcribe/Dockerfile.tutorial -t keyspilli-tutorial:candidate .
docker run --rm --network none keyspilli-tutorial:candidate --help
docker run --rm --network none --entrypoint python keyspilli-tutorial:candidate -m pip check
docker run --rm --network none --entrypoint python keyspilli-tutorial:candidate -m unittest discover -s /app/test -p 'test_tutorial_*.py'
```

The build itself checks the real geometry import path and initializes the detector, then runs synthetic tests. The runtime is non-root. For a rights-cleared source, create an empty output directory writable by your UID and run:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=128m --memory 2g --cpus 2 \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/authorized-input:/input:ro" -v "$PWD/tutorial-candidate-output:/output:rw" \
  keyspilli-tutorial:candidate /input/tutorial.mp4 --output /output/review.json
```

Use a fresh output name; the extractor rejects existing JSON/MIDI outputs. Capture the image digest, `pip freeze`, `dpkg-query -W`, full smoke output and a real extraction receipt before claiming container success. Linux native import failures or unavailable pinned wheels keep this gate closed; resolve them explicitly rather than silently removing dependencies.

`.github/workflows/tutorial-runtime-candidate.yml` is a manual `workflow_dispatch` smoke job on Ubuntu 24.04, matching the existing pinned checkout action. It enforces 30 GiB free, builds this image, runs the CLI, dependency check, real geometry initialization and synthetic tests without runtime network access, then records image/package evidence in logs. It has read-only repository permissions and no push/deploy step. It was not dispatched during this work; it becomes usable after the workflow is available to GitHub. A passing job establishes packaging only.

## Remaining delivery gates

Container success would establish only packaging. Production remains disabled until source rights are established, the downstream tempo/meter interpretation is reviewed (attack pulse is not quarter-note BPM; MIDI 120 BPM is elapsed-time encoding), and listening/playability review accepts melody, accompaniment, timing and ending coverage for the actual arrangement. Synthetic tests and imports cannot satisfy these gates.


## Linux smoke result — 8 September 2026

The final image `sha256:aa23a869f45a706e3e924d6212cb587866405505cb2c4776561d4b5c465dc002` passes CLI, pip consistency, non-root geometry initialization and34 synthetic tests with network disabled and a read-only filesystem. A full222.6-second development video extracts1140 notes in233 seconds on Apple Silicon under amd64 emulation with4 CPUs/2GiB RAM. Both note events and raw MIDI bytes exactly match the saved macOS reference. The extracted MIDI produces four valid B/E/M/A exports through host Node22:177/548/1119/1119 notes. This is not a clean Linux HTTP worker test.

The first two-CPU real runs hit the existing120-second FFmpeg scanline deadline. Early chroma-aligned cropping avoids converting the entire frame to RGB; full scanline bytes remain identical on all20 development videos and randomized YUV420 edge/odd/even fixtures. Four CPUs got past scanning but exposed a Linux grayscale keyboard-height discrepancy. Layout verification now tries the existing RGB fallbacks when a detector result disagrees with established geometry, accepting only a channel that passes the unchanged comparison limits. Initial calibration and note extraction thresholds are unchanged. The final run succeeds; previous failures remain under output/tutorial-recovery/linux-smoke-v1 through v3.

`tutorial-linux-runtime-2026-09-08.json` records image identity, source hashes, resolved Python/native packages, checks, pixel preservation and exact MIDI parity. The image remains local; it was not pushed or deployed. Existing24 accepted difficulty note files are preserved.34 Python and89 worker tests pass. Native amd64 throughput and two-CPU capacity are not established by this emulated run. Use4 CPUs for reproducing the measured local emulation result.

Build caveat: pyvips3.2.0 came from the pinned source tarball and produced wheel SHA256238588caf5f124a0434fda760aeb6e03b45fe89eb4a4fea1a49ff28928d47e39. Its isolated build tooling and Debian apt repository contents are not fully locked. Preserve the resulting image digest; do not claim byte-reproducible rebuilds.
