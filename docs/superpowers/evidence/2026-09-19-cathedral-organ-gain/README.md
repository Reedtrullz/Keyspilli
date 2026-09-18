# Cathedral organ gain runtime probe

This is a bounded, opt-in browser probe for the 2026-09-19 Cathedral organ hand-balance regression. It reuses the checked-in Oops fixture from the Chords v2 test setup and intercepts the first two `GainNode` buses created by `OrganAudioEngine`.

Run from the repository root with Node 22:

```sh
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
npx playwright test docs/superpowers/evidence/2026-09-19-cathedral-organ-gain/organ-gain-probe.spec.ts \
  --config=apps/web/playwright.organ-gain.config.ts --project=chromium
```

The test asserts the exact Oops fixture state: Original arrangement, Organ, Cathedral, persisted 100/100 hand sliders. It records the real AudioParam targets for the right/manual and left/foundation buses while playing and while switching Cathedral → Rock → Cathedral.

The default check is a regression gate: every recorded target on both buses must equal `1.0`. The historical baseline output below was captured with the same probe before the fix and would fail this assertion because newly-created graphs received `1.0/0.4`.

Recorded comparison:

- Baseline `df03e5747eda577353d807da258fe2adc054bd14`: newly-created graphs started at `1.0/0.4`.
- Candidate `20a398a3fe733a6efcf2655dd8f2203f5cf5c3d9`: every initial and recreated graph started at `1.0/1.0`.

The captured output is in `organ-gain-runtime-probe.json`. This probe is evidence-only and is not part of the default Playwright discovery or production runtime.
