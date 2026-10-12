# KS-08 source phrase protection pilot — 12 October 2026

The ordinary source reducer now has an explicit, source-bound protection
contract and a reachable local preparation workflow. Selected note attacks,
key releases, pitches and known hands survive in the requested tiers, or the
candidate is refused. Default callers keep the prerequisite behavior. This is
a bounded KS-08 implementation, not completion of automatic role recognition
or independent musical acceptance.

## Bound evidence and behavior

`PhrasePlanV1` records exact source SHA-256, composition/performance, native
clock, source origins and occurrences, phrase bounds, roles, priorities,
evidence declarations and allowed transformations. Required events use exact
preservation. Optional events are checked against their declared policy.
Source parts, instruments and physical hands do not establish a musical role.

Catalog intake snapshots actual symbolic bytes and the canonical plan before
its first asynchronous boundary. It uses the native parse for clock checks;
playback tempo remains separate, and `preserveSourceBeats` clock erasure is
refused. The manifest pins the plan and input; the plan participates in the
config fingerprint. Sidecars retain the complete plan and before/after report
alongside historical preparation changes and artifact fidelity. An existing
policy cannot silently disappear on rebuild.

Rest checks use the whole explicitly declared role inventory across overlapping
phrases and include supported source CC64 sounding duration. Compatible unisons
retain distinct source occurrences; ambiguous or incompatible merged parents
are refused. Restoration retains the caller's duration ceiling and established
difficulty limits. Generated chord/bass metadata is recomputed from final notes;
separately supplied charts retain their existing authority.

The inspector produces unknown-authority, unrequired role proposals. The
preparer retains exact plan bytes, raw/canonical/source hashes, creates both
Player modes, and verifies a fresh local import plus idempotent re-import.
Its result remains provisional. The canonical skill explains this opt-in
workflow; installation and release are separate actions.

## Reproduce the finite evaluation

Use repository-supported Node 22.22.3 and installed dependencies:

```sh
node --import tsx packages/midi/scripts/evaluate-phrase-pilot.ts
npm test --workspace @keyspilli/midi -- phrase-plan.test.ts
npm test --workspace @keyspilli/catalog -- phrase-plan-ingest.test.ts
npm test --workspace @keyspilli/web -- phrase-plan-cli.test.ts chords-preparation.test.ts
```

The complete result is [evaluation.json](evaluation.json). Fixed corpus SHA-256:
`7fe96e90fe5921bdb8945583b51650a71eab81109667d25c7c28cf18fb2fb15b`.
The six original authored controls cover an inner melody, hand crossing, guitar
hook, breathing phrase, doubled riff and changing-tempo pickup. They deliberately
put identity events on triplet timing that ordinary quantization changes. This
is a targeted stress set, not a population sample.

| Observation | Result |
| --- | ---: |
| Compositions / requested tier outputs | 6 / 36 |
| Required-event comparisons | 288 |
| Ordinary exact pitch/attack/release/hand retention | 0 / 288 |
| Opt-in exact retention | 288 / 288 |
| Real MIDI and MusicXML reparses | 72 |
| Required-event comparisons after export | 576 / 576 retained |
| Existing selector: declared identity events found | 48 / 48 |
| Existing selector: all proposed identity events | 96 |
| Selector precision / recall against declared identity | 50% / 100% |

The selector includes all accompaniment in these controls. It is not reliable
semantic role assignment, and hooks/bass are not distinguished automatically
from melody. Preservation cannot correct an incorrectly selected role. Both
`selectionAccuracy` and `musicalAcceptance` remain `not-established` in actual
protection reports.

The corpus has development/holdout labels, but all controls were exercised
during implementation. Those labels are organizational: this is not untouched
holdout, independent source annotation, listening, keyboard review or real-song
calibration.

## Verification and independent challenge

Before final whole-diff sign-off, the implemented candidate passed:

| Check | Result |
| --- | ---: |
| Full MIDI package | 566 / 566 |
| Phrase-specific MIDI controls (included above) | 38 / 38 |
| Actual catalog phrase intake controls | 11 / 11 |
| New inspection/preparation CLI controls | 14 / 14 |
| Existing ordinary Chords preparation controls | 3 / 3 |
| MIDI, catalog, web and song-tools typechecks | Passed |
| Plugin package, extracted preflight and ordinary preparation | Passed, 28 members |

Independent probes compared six sources in default, source, learner and metal
profiles with the unchanged prerequisite: all 24 deep comparisons were equal.
A separate consumer check matched 576 source events through 72 exports, with
maximum onset/release error `3.55e-15` beats for these triplet controls. Export
tick tolerance remains a separate constraint for general source timing.

Independent review found and prompted regressions for mixed beat clocks under
a playback override, cross-phrase role rests, pedal resonance through silence,
wildcard occurrence aliases, lost unlisted unison lineage, repeated work, and a
disabled duration ceiling. Later intake review found native-clock rewriting
and mutable caller plan/source buffers across an await. Each material case was
reproduced before correction; original failed receipts remain in the Wave 2
evidence package.

The 4,000-event compilation probe fell from 7,278 ms to 74 ms after indexing and
visited-object freezing. With 200 notes, 1,000 role rests took 10 ms instead of
961 ms. These are single-run measurements in this environment, not production
latency guarantees. Serialized size, nesting, inventory, lineage, tempo-map and
existing pedal work limits provide explicit bounds.

The combined Wave 2 report records final commit/tree identities, independent
sign-off, whole-workspace checks and draft PRs. Software gates do not approve
role selection, keyboard suitability, acoustic quality, Chords fidelity or
publication. Broad KS-08 and independent full-output acceptance remain separate.
