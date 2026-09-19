# T4–T7 runtime checkpoint

Captured on 2026-09-19 from branch `codex/finish-chords-mode` after the
scoped player/e2e changes through the preview-race and practice-repeat fixes.
This is engineering evidence, not musical or keyboard acceptance.

## Closed engineering checks

- Arrangement audition now has one lifecycle boundary in `Player.tsx`:
  source, role/routing, hand, instrument, mix, speed, transpose, explicit
  external seek, loop, tool close, navigation, and unmount clean up directly
  scheduled preview voices. Internal transport synchronization during preview
  startup does not masquerade as an external seek. A browser probe observed
  oscillator `stop()` calls after a running Full preview was changed to the
  right-hand source.
- Audition uses actual scheduled note identity rather than encoded-audio hash
  inequality. At the Blackbird scratch fixture's beat-14 seek position,
  Original scheduled C4, Full scheduled G4 and did not schedule C4; an empty
  melody passage scheduled no notes. All four roles remained audible and the
  seek position was preserved.
- Practice uses the same arrangement target: wait-mode grading reported
  `Play: G4 (right hand)`, and the play-along capture scheduled G4 without the
  Original C4 target at the same position.
- Chord mode labels Sheet Music and downloads as Original-backed exports.
  This is a contract warning; it does not rewrite the export payload.
- `PlaybackEngine.previewPlan` has a focused empty-passage regression test;
  it returns no notes or chords for a genuine gap.
- Practice startup has small defensive preview-cancellation guards both at
  `beginPractice()` and at `repeatPractice()`, covering keyboard/MIDI direct
  repeat and microphone repeat setup in code. No reliable user-path regression
  currently proves this boundary: a direct handler experiment was removed
  after mutation showed aggregate oscillator stop totals were not specific to
  the active preview, and native modal reachability is blocked. Treat this as
  an instrumentation/reachability follow-up, not a closed P2 claim.

## Verification

All passed with Node `v22.22.3`:

```text
player-core engine.test.ts                         44 passed
web focused unit tests                              47 passed
web typecheck                                      passed
web production build                               passed
changed browser slice                               5 passed
worker/stale-reply/real-audio browser slice         3 passed
moving-preview + external-seek browser test          1 passed
```

The canonical loader evaluator also passed all five pinned artifacts in both
default and conservative lanes. Its report revision remains `d4e4006`, the
evidence-plumbing revision; the evaluator is not a release or production
runtime claim.

## T3 boundary still open

The runtime path is bounded and truthful, but source/melody identity is not
closed by these checks. The canonical replay still reports, in the default
lane, 182.375 unresolved beats and 223.625 fallback/review beats for Queen;
the other targets retain their documented source-coverage and semantic
identity limits. The next feasible source action is evidence-authorized
review/recovery: inspect an independently identified Queen score/source lane
for meter phase and voice semantics, preserve the canonical artifact, build a
disposable bounded worksheet/fixture, compare complete-song allocated events
at 108 BPM, and update the manifest/findings. Until that exists, unresolved
spans remain Original-retained and automatic melody is not promoted.

These checks do not establish recognizable melody, comfortable fingering,
target-tempo performance, pedal cleanliness, balance, human listening
acceptance, or public production deployment. G4 remains open.
