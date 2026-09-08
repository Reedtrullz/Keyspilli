# Source tutorial difficulty: local passage evidence

Audited the 24 persisted public B/E/M/A variants from the six v10 tutorial candidates. Input paths and SHA256 hashes, whole-song metrics and flagged passage measurements are in `tutorial-difficulty-2026-09-08.json`. No source notes, accepted audio, reducer policy or difficulty limits changed.

All 24 pass the existing `assessPlayability` simultaneous/sounding, whole-song attack-density and median-IOI checks. This is a structural assessment, not all `validateVariants` checks or human musical acceptance.

| Candidate | B/E/M/A peak attacks/sec in 0.5s | B/E/M/A max sounding notes (both hands) |
|---|---|---|
| Queen | 4 / 6 / 12 / 14 | 1 / 3 / 8 / 8 |
| Metallica old | 4 / 6 / 10 / 10 | 1 / 3 / 6 / 6 |
| In My Mind | 4 / 6 / 6 / 6 | 1 / 3 / 3 / 3 |
| Nirvana | 4 / 6 / 8 / 8 | 1 / 3 / 5 / 5 |
| AC/DC | 4 / 4 / 8 / 8 | 1 / 3 / 6 / 6 |
| Metallica second source | 4 / 6 / 10 / 10 | 1 / 3 / 6 / 6 |

The global limits in `validate.ts` are B: 2 simultaneous/sounding, 6 attacks/sec mean, 0.08s median IOI; E: 5/12/0.08; M: 12/16/0.08; A: 13/18/0.08. They were calibrated against catalog distributions. Applying these mean-density ceilings to a half-second peak would create a new policy, so this report does not do that. The reducer separately uses 12-semitone sounding-span caps for source-profile hands; all audited per-hand spans are at most 12. The existing Beginner spacing policy is 375ms, which can still put two attacks into half a second (reported as 4/sec).

The flagged Queen Beginner 166–170s passage has one sounding RH note at a time, peak 4 attacks/sec, and a largest adjacent RH movement of 9 semitones in 0.8125s at 167.3125s. Metallica old Easy 58–62s has peak 2/sec, at most three sounding notes globally, an LH octave and RH movement of 2 semitones. The second Metallica source at 58–62s has peak 4/sec, at most two sounding notes globally and a 14-semitone RH movement in 0.6875s. These distinct source names must not be conflated with the accepted old-source clip.

The larger review finding is outside those clips: the second Metallica Beginner/Easy has a 31-semitone RH movement in 375ms at 230.9375s. Queen Beginner/Easy has a 24-semitone movement in 875ms at 70.6875s. Old Metallica's largest movement is 44 semitones but follows a five-second attack gap; magnitude alone is insufficient to classify it. These are report-only review candidates: no existing leap threshold makes them validation failures. Review the timestamped source passage and hand assignment before any local correction. Do not drop notes globally or tighten a level from these measurements alone.

`measurePlayability` now exposes earliest worst half-second windows, simultaneous chord and held-note spans, and timestamped adjacent highest-note leaps per hand. Chords count as one rhythmic attack. Highest-note movement is an explicit proxy, not inferred fingering; global spans cover both hands and must never be interpreted as one-hand reach. Nearby windows include only attacks starting within the stated interval and omit earlier sustains; use whole-song metrics for overlap limits.

Reproduce from the repository root with Node 22:

```sh
node node_modules/tsx/dist/cli.mjs docs/research/keyspilli-evidence/audit-tutorial-difficulty.mts > docs/research/keyspilli-evidence/tutorial-difficulty-2026-09-08.json
node node_modules/vitest/vitest.mjs run packages/midi/test/playability-audit.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/midi/tsconfig.json
```

Validation: 14 focused tests pass, including chord atomicity, half-open boundary, earliest maximum, input-order invariance, released-note non-overlap and located leap evidence. MIDI package typecheck passes. No production or subjective playability claim.

## Isolated correction hypothesis: preserve source lanes

`probe-metallica-hand-lanes.mts` diagnoses the second Metallica source and produces `metallica-hand-lane-candidate-2026-09-08.json` without writing a MIDI or changing accepted variants. It matches each of the 1,714 parsed notes to one extracted color event, asserts that only proposed input hand labels change, rebuilds two complete ladders and asserts both validate.

The extracted tracks are named `blue keys` and `green keys`. `parseMidi` correctly does not interpret colors as authoritative hands. Without explicit hands, `buildVariants` calls `splitHands`: the whole-song boundary is MIDI59/60. At 230.5333s the blue accompaniment plays64, then71 at230.7167 and76 at230.9167; the green lane plays91/95 at230.9167/230.9333. All five enter RH because they are above middle C. The Easy melody/spacing reductions omit the intermediate71 and join blue64 to green95: a 31-semitone jump at230.9375s after grid rounding. The notes are present in the extraction; the manufactured part is treating two source lanes as one continuous hand/melody.

The candidate explicitly maps this source's blue lane to L and green lane to R before the existing source-profile reducer. `splitPreservingHands` already handles this; no octave fold or new reducer is needed for this hypothesis. In 229–233s the RH sequence becomes84,95,93,91,88,90. Its maximum leap is11 semitones with1.5625s between attacks, and the Easy accompaniment returns to L. Easy whole-song note count stays665; Beginner435→354, Medium1508→1673, Advanced1541→1704, reflecting different selection after proper lane separation. The candidate does not certify global difficulty: Easy LH still has a22-semitone movement in0.5625s elsewhere, while Beginner's largest RH movement is17 semitones after4.375s.

Actionable integration proposal: support an explicitly reviewed per-tutorial color-to-hand mapping at extraction/MIDI serialization, use existing recognizable `LH`/`RH` track names so `parseMidi` preserves it, and pass the source profile unchanged. Keep absent mappings unverified; do not universally infer blue=L/green=R. `normalizePianoRange` only repairs notes outside21–108 and cannot fix this case. Metal `monophonicPath`/`toRegister` are detector-oriented revoicing helpers; applying them to this source would alter real high green melody pitches and fail to address the lost lane identity.

Before adopting this candidate, review this source's color/staff convention and listen across its passages; this proposal changes that source's whole ladder. Existing accepted old Metallica and Queen artifacts remain untouched. No source-media download or render was performed. The standalone probe's assertions pass with Node22:

```sh
node node_modules/tsx/dist/cli.mjs docs/research/keyspilli-evidence/probe-metallica-hand-lanes.mts > docs/research/keyspilli-evidence/metallica-hand-lane-candidate-2026-09-08.json
```
