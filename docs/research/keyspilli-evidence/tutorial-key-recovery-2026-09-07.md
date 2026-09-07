# Tutorial key-light recovery — continuation after the no-release decision

User authorized continued work toward “just works.” This pass changes the evidence: a maintained local video-to-note command now automatically reproduces a previously accepted full-song extraction. It does not reverse the earlier no-release decision or claim general metal-audio accuracy.

## What worked

`services/transcribe/src/tutorial_keys.py` reuses LumaChords0.1.4 keyboard calibration and Keyspilli's accepted colored-key detector. It scans up to8 early frames for two consistent full88-key geometries, then restarts extraction at video time zero. This avoids dropping the introduction while calibration is learning. Black and white keys are sampled at different heights, away from the strike-line glow. It records blue/green provenance without claiming which color is a hand or vocal melody. MIDI preserves native event time and initial silence.

| Case | Result |
|---|---|
| ABBA, full original308-second tutorial | **1,533/1,533 notes exactly match** the accepted key-light extraction, including onset and duration. Geometry found at4s and8s; no supplied coordinates or reference note input. |
| Same video resized/reencoded to640px,45s excerpt | **157/157 notes exactly match** over the first44s. Calibration found clean frames at16s and24s, then extraction restarted at0. This is robustness evidence, not a second independent song. |
| Queen, Bohemian Rhapsody, new374-second piano-part tutorial | Automatic calibration at8s/12s; **2,374 notes** extracted without coordinate changes. MIDI round trip preserves every event. Musical accuracy is not independently scored; accompaniment, not a claimed vocal-melody arrangement. |
| Livgardet / HotMelody | Rejected calibration. The stylized partial keyboard is outside this command's verified full88-key scope. No output or catalog write. |
| Alphaville, Forever Young, another creator video | Visual inspection shows filmed hands and a different layout;23.976fps also falls outside current25–60fps scope. Not processed or counted as successful. |

ABBA agreement is a regression against the prior accepted extraction, not independent musical truth or a new qualifying release case. No note reference enters the extractor; comparison happens afterward. The original20+6 holdouts were not used. Bohemian Rhapsody is a new development diagnostic outside that cohort.

## What failed before this result

The unmodified LumaChords detector did not solve the task. Its ABBA45s extraction produced193 notes with only3 matches against157 accepted events at80ms; even a diagnostic constant-offset search found only5. On Livgardet it produced41 notes against274 accepted events with1 native-timing match,5 at the best diagnostic offset. These are agreement diagnostics, not independent reference certification. The headless notation exporter also crashed with an IndexError; the private trial exported native events before notation rendering instead.

The first attempted reuse of the old falling-bar extractor was also wrong: that was an intermediate ABBA artifact, not its successful final path. The accepted repair used illuminated keys. Switching to that existing path, with automatically detected geometry, is what produced exact agreement. No new transcription model, selector tuning or song-specific coordinates were added.

A first resized calibration failed; normalizing image scale alone was insufficient. Searching later clean frames and comparing key centers rather than unstable shadow-edge widths established consistent geometry. Both detection hypotheses and failures remain privately recorded.

## Run locally

Python3.12 and FFmpeg are required. This is an optional experimental environment, **not a new production dependency or enabled worker route**:

```sh
uv venv --python 3.12 output/tutorial-recovery/venv
uv pip install --python output/tutorial-recovery/venv/bin/python 'lumachords==0.1.4'
PYTHONDONTWRITEBYTECODE=1 output/tutorial-recovery/venv/bin/python \
  services/transcribe/src/tutorial_keys.py /absolute/path/to/tutorial.mp4 \
  --output output/tutorial-recovery/new-result.json
PYTHONDONTWRITEBYTECODE=1 output/tutorial-recovery/venv/bin/python \
  services/transcribe/test/test_tutorial_keys.py
```

The command requires a local video ≤250MiB and600s,640–1920px wide,360–1080px high,25–60fps, stable complete88-key geometry and supported blue/green illumination. It bounds decoded scan data to256MiB and subprocess duration. It refuses an existing output path. JSON and MIDI are written locally; no catalog connection, source search, upload, account, paid service or publication occurs. All output is marked experimental/review-required with source rights unverified and melody inclusion unknown. Colored filmed keyboards, partial keyboards, other palettes and arbitrary tutorial layouts are not advertised as supported.

Six local regressions pass: repeated notes, duration/native frame time, white flashes/purple background/one-frame bleed rejection, ending-note closure, ambiguous/out-of-frame geometry rejection, and MIDI initial-silence/event timing. Full ABBA and Queen MIDI comparisons contain1533 and2374 events respectively, with numerical timing error below1e-12 seconds at these60fps inputs. Tests require only NumPy/Mido; calibration requires the optional LumaChords environment. Existing Node CI does not run these Python regressions; the exact local command/result is recorded.

LumaChords code is Apache2.0; it documents automatic calibration and experimental detection limitations in its [README](https://github.com/adalkiran/lumachords) and [known issues](https://github.com/adalkiran/lumachords/blob/main/KNOWN-ISSUES.md). Its dependency notices include LGPL components; no packaging/compliance claim is made by a local trial. No model weights were added. Source rights are separate and remain unverified for the new Queen/Alphaville videos.

## Review and next evidence

Local page: http://127.0.0.1:8874/tutorial-recovery/review.html . It contains equally loudness-normalized source piano and the new Queen MIDI rendering, plus optional persistent defect notes. Original: https://www.youtube.com/watch?v=a7vqHDWG8y0 . No relistening is requested for the accepted ABBA control or rejected old metal A/Bs.

Private evidence and runtime: `output/tutorial-recovery/`. Machine-readable hashes/results: `tutorial-key-recovery-2026-09-07.json` in this directory. Source videos and note payloads are not committed. Previous production and catalog state remain unchanged; this pass made no production requests or mutations.

Remaining before “just works”: independent note/audio checks on unfamiliar complete tutorials; melody-bearing sources rather than accompaniment-only cases; reliable supported-layout/source discovery; eligibility/provenance and worker integration; all five-level musical retention; six qualifying complete imports and release gates. Current result is a concrete removal of manual geometry from one demonstrated successful route, not musical certification or a released beta.
