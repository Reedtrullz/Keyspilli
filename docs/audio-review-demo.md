# Pairwise audio review demo

This local demonstration exercises the pairwise Anti adapter with generated piano audio. It contains no commercial song or recording and makes no listening or musical-quality claim.

## Frozen pack and existing preview

The prepared pack lives under the ignored `output/song-prep/audio-review-demo-20261003/` directory in the Keyspilli worktree:

- `demo/manifest.json` pins two 21-second pairwise jobs, one for Original and one for Chords.
- `demo/reference.wav`, `demo/original.wav` and `demo/chords.wav` are frozen mono PCM16 WAV inputs. Do not rerender these while the parent qualification run is using them.
- `controls/model-facing/cases.json` and its hash-named WAVs are synthetic blind software controls.
- `controls/evaluator-only/answer-key.json` contains expected answers. Keep it out of reviewer context.

The completed no-upload run is [`report.md`](../output/song-prep/audio-review-demo-20261003/demo/low-alias-no-upload-20261003/report.md) with its machine-readable [`report.json`](../output/song-prep/audio-review-demo-20261003/demo/low-alias-no-upload-20261003/report.json). It reports two planned dry-run jobs, zero gateway attempts and unestablished musical acceptance. The WAVs, report and evaluator key are local ignored evidence and are not included in Git.

## Controlled baseline status — 2026-10-03

The parent-owned baseline sent four jobs total: two Pro and two Flash baseline attempts, with zero blind controls. For both routes, the Original response was complete, while the Chords response was partial/truncated and remains refused. The complete Pro Original envelope was separately materialized offline from its retained response with zero additional HTTP attempts; its original ambiguous state is unchanged. Neither baseline route is qualified, and neither should be treated as an audio-review default.

The separately pinned low-effort Flash stage completed two integration jobs: both returned complete envelopes and passed ordered-media/model checks, with one backend attempt per job. The observer confirmed requested alias `gemini-3.8-flash-low`, wire canonical `gemini-3.8-flash`, and low reasoning/thinking settings. The retained report is the [parent study report](</Users/reidar/Projectos/anti-keyspilli-music-demo-20261003/listening-report.md>), with machine-readable [JSON](</Users/reidar/Projectos/anti-keyspilli-music-demo-20261003/listening-report.json>). Across eight synthetic controls, 5/8 narrow criteria passed, 4/8 answers were fully grounded, and all 4/4 mandatory negative gates passed. These measures answer different questions; they do not qualify the route. The identical-pair c01 matched the pair but invented eight E5-to-E4 scale notes and timestamps; the fixture contains five notes, C5, A4, G4, E4, D4, at 0, 0.375, 0.75, 1.125, and 1.5 seconds. c02 got contour direction but also claimed incorrect C4–C5 pitches and timing for a C4–G4 fixture. c03 placed repeated E attacks at 3.6/4.5 seconds instead of E at 0/0.25 seconds and G at 0.75 seconds. c04 invented a prior progression/Picardy third and a late final chord for a single C-major versus C-minor triad pair sounding at 0 seconds. Treat those unsupported details as failures. This is not route qualification or a calibration pass. There are zero real-song cases, and musical acceptance remains unestablished.

## Native adjudication and repair refusal

The native review compared listener claims with the frozen media and symbolic events. Its retained report is the [native agent decision](</Users/reidar/Projectos/anti-keyspilli-music-demo-20261003/agent-decision.md>), with machine-readable [JSON](</Users/reidar/Projectos/anti-keyspilli-music-demo-20261003/agent-decision.json>).

- Original: the reported minor acoustic difference was discarded because the reference and candidate WAV bytes are identical.
- Chords: the high-severity claim was rejected as an automatic repair. Original and Chords share the exact 39-note accompaniment; the Original also has 41 declared melody notes. Both use the same static C-major harmony, so there are no harmonic changes to lose. The four-beat sparse chord attacks are intentional for this beginner backing. Keep only a density-difference observation.
- This is the required evidence check for any proposed edit: compare the exact claim to pinned media and symbolic events, then refuse changes unsupported by those records. Listener severity labels do not override source evidence.

This demonstrates advisory findings followed by agent-owned source/media adjudication and repair refusal. The fixture remains unchanged. Do not turn this into a routine listening or quality-validation chore for the learner, and do not treat the demonstration as musical acceptance.

## Fresh offline dry run

From the Keyspilli checkout, choose a new output directory for each run. This command uses the already frozen manifest and clips; it does not invoke the generator, fetch the gateway catalog or submit audio.

```sh
DEMO="$PWD/output/song-prep/audio-review-demo-20261003"
OUT="$DEMO/demo/no-upload-review-$(date +%Y%m%d-%H%M%S)"
KEYSPILLI_NODE="/Users/reidar/.nvm/versions/node/v22.22.3/bin/node"
ANTI_PYTHON="/Library/Frameworks/Python.framework/Versions/3.10/bin/python3"
ANTI_SCRIPT="/Users/reidar/.codex/worktrees/stream-integration/codex-antigravity-auth/codex_antigravity_auth/skills/anti/scripts/anti.py"

PATH="$(dirname "$KEYSPILLI_NODE"):$PATH" \
PYTHONPATH="/Users/reidar/Projectos/.anti-music-listening-validation-20261003" \
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  "$DEMO/demo/manifest.json" "$OUT" \
  --dry-run --max-requests 0 \
  --anti-python "$ANTI_PYTHON" --anti-script "$ANTI_SCRIPT" \
  --base-url http://127.0.0.1:62823/v1 --model gemini-3.8-flash-low
```

Open `$OUT/report.md` for the preview or `$OUT/report.json` for the complete receipt. Anti's local `--dry-run` records the planned audio attachments but performs zero gateway requests. This command is specific to the current host's installed runtime and local Anti helper; use the canonical skill's placeholder command on another host.

`apps/web/scripts/create-audio-review-demo.mts` is the deterministic pack generator. Running it renders new audio into its chosen output path, so leave it alone while consuming the frozen pack above.
