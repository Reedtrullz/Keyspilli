# Pairwise audio review demo

This local demonstration exercises the pairwise Anti adapter with generated piano audio. It contains no commercial song or recording and makes no listening or musical-quality claim.

## Frozen pack and existing preview

The prepared pack lives under the ignored `output/song-prep/audio-review-demo-20261003/` directory in the Keyspilli worktree:

- `demo/manifest.json` pins two 21-second pairwise jobs, one for Original and one for Chords.
- `demo/reference.wav`, `demo/original.wav` and `demo/chords.wav` are frozen mono PCM16 WAV inputs. Do not rerender these while the parent qualification run is using them.
- `controls/model-facing/cases.json` and its hash-named WAVs are synthetic blind software controls.
- `controls/evaluator-only/answer-key.json` contains expected answers. Keep it out of reviewer context.

The completed no-upload run is [`report.md`](../output/song-prep/audio-review-demo-20261003/demo/final-no-upload-20261003/report.md) with its machine-readable [`report.json`](../output/song-prep/audio-review-demo-20261003/demo/final-no-upload-20261003/report.json). It reports two planned dry-run jobs, zero gateway attempts and unestablished musical acceptance. The WAVs, report and evaluator key are local ignored evidence and are not included in Git.

## Controlled baseline status — 2026-10-03

The parent-owned baseline sent four jobs total: two Pro and two Flash baseline attempts, with zero blind controls. For both routes, the Original response was complete, while the Chords response was partial/truncated and remains refused. The complete Pro Original envelope was separately materialized offline from its retained response with zero additional HTTP attempts; its original ambiguous state is unchanged. Neither baseline route is qualified, and neither should be treated as an audio-review default.

An explicitly low-effort Flash stage is now in progress using requested alias `gemini-3.8-flash-low`, wire canonical `gemini-3.8-flash`, and low reasoning/thinking settings, with a maximum of ten new backend attempts. Its protocol is pinned separately from the baseline. No result or route-qualification claim is made until that stage's retained evidence is reviewed. Provider listening remains unverified even for complete envelopes.

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
  --base-url http://127.0.0.1:62823/v1 --model gemini-3.1-pro
```

Open `$OUT/report.md` for the preview or `$OUT/report.json` for the complete receipt. Anti's local `--dry-run` records the planned audio attachments but performs zero gateway requests. This command is specific to the current host's installed runtime and local Anti helper; use the canonical skill's placeholder command on another host.

`apps/web/scripts/create-audio-review-demo.mts` is the deterministic pack generator. Running it renders new audio into its chosen output path, so leave it alone while consuming the frozen pack above.
