# Spectral onset evidence for Gemini review

The demonstrated workaround for unreliable Gemini attack counting is to estimate
onsets locally and submit their provenance to Gemini for advisory interpretation.
This optional DSP support belongs to Keyspilli. Anti remains a standalone Gemini
client using an existing connected Google AI account; it does not install or run
the detector and does not require Keyspilli or another provider account.

Use a worktree-local Python environment with
`services/transcribe/requirements-onset-evidence.txt`. There are no neural weights,
runtime downloads, provider calls or catalog mutations. The existing isolated
music-review environment already supplies these pinned dependencies.

From the compatible Keyspilli checkout:

```sh
/absolute/worktree/.venv-audio/bin/python services/transcribe/src/onset_evidence.py \
  /absolute/captured-clip.wav ACTUAL_LOWERCASE_SHA256 /absolute/new-onset-report
```

The input must be a hash-pinned regular mono PCM16 WAV at32 or44.1kHz, at most
2MiB and30seconds. Missing, changed, malformed and digital-zero inputs refuse
locally. Output is an exclusive new directory containing `receipt.json` and
`anti-evidence.json`; reruns never overwrite existing evidence. The receipt binds
the exact bytes, detector configuration and source-code hash. Times are relative
to the captured WAV, with no inferred tempo grid or source-clock correction.

The portable bundle includes only clip identity and measured spectral onset
estimates. It excludes local paths, authored event answers and saved human
responses. It preserves unknown source authority and measurement uncertainty.

Prepare one explicitly selected clip for Anti without uploading:

```sh
/absolute/python /absolute/anti/scripts/anti.py review-music \
  --model gemini-3.1-pro --audio /absolute/captured-clip.wav \
  --evidence-json /absolute/new-onset-report/anti-evidence.json \
  --prompt 'Explain the supplied spectral onset estimates, citing their claim ID. Preserve uncertainty. Do not invent additional attacks or present reading measurements as independent hearing.' \
  --max-output-tokens 4096 --probe-unverified-audio --dry-run
```

After upload is authorized, removing `--dry-run` makes one bounded Gemini
request. The authorization applies to both the WAV and the measurement bundle.
No Gemini public API key is needed for this connected-account Antigravity path.
The helper validates exact audio/bundle identity before submission and keeps
all model findings advisory. The original measurements remain separate from the
model response, even if its prose claims agreement with the sound.

## Observed scope

The frozen detector settings found345 distinct authored event-start groups
within100ms across110 nonzero synthetic clips from one sampled Player piano bank.
Five digital-silence and five missing-input controls refuse locally. Development
and heldout results are recorded separately in the run evidence. No parameters
were fitted to evaluator answers. Original held/repeated controls yield1 and4
estimated onsets; Pro preserved both measurements and their uncertainty in fresh
assisted reviews. This is an assisted workflow, not blind hearing qualification.

The older RMS-threshold onset display gave2 and3 estimates on those same clips;
it remains explicitly coarse. This new spectral tool is optional and does not
silently replace that estimator or its saved reports.

Onset estimates are not per-note transcription: a chord may produce one onset
with several notes. Acoustic pitches, note releases, real-song and second-bank
coverage, source fidelity, pianist suitability and musical acceptance remain
unestablished. Do not infer pitch/scale correctness from onset counts or make
automatic note repairs from these measurements.

For explicitly monophonic pitch-window estimates and a caller-supplied scale,
see [pitch evidence](pitch-evidence.md). That optional command has separate
limits and receipts; onset counts alone still provide no pitch evidence.

References: [librosa onset detection](https://librosa.org/doc/0.10.2/onset.html)
describes spectral flux and peak picking; [Google's audio limitations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/audio-understanding#limitations)
warn about non-speech recognition and describe the audio timestamp setting.
Public API documentation does not establish private Antigravity behavior.
