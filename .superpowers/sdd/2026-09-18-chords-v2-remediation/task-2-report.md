# Task 2 report — coherent phrase backing strategy

Date: 2026-09-18
Base: `56f40d5`
Scope: Task 2 only; no UI, catalogue, live data, merge, push, deployment, or production mutation.

## Result

Status: PARTIAL. The bounded producer selector correction is implemented and tested: it compares the actual merged source/protected/held candidate, protects the deterministic first structural source attack plus explicit `identitySource: "vocals"` evidence, carries protection across repeated sparse seams, and preserves source rests during regeneration. A separate opt-in conservative source-only preview now reduces repeated short source voicing members without generated pitches; it does not change the Oops attack grid and is not presented as an automatic rhythm fix. The Oops real-song rhythm limitation remains unresolved at `479/479`; no generated-only real change is claimed. The final Task 1 allocator remains the only final allocation pass.

## TDD evidence

### RED

Fresh red run after adding the correction-focused identity, merged-candidate, seam, and rest tests, before the correction:

```text
Test Files  1 failed (1)
Tests       2 failed | 73 passed (75)
```

The failures were the merged sparse candidate still selecting `sparse-harmonic` when retained protected attacks made the attack union no better, and the seam test retaining a `sourceLane`-only note. The generated-only label-only path stayed green. The follow-up added the multi-event held/protected seam and source-rest regressions.

### GREEN

Focused producer and arrangement-change tests:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npm run test -w @keyspilli/player-core -- test/melody-accompaniment.test.ts
Test Files  1 passed (1)
Tests       76 passed (76)
```

The source-only preview follow-up passed the focused producer suite at `85/85`
and the full player-core suite at `258/258`, with typecheck and `git diff --check`
passing. The default mode remains byte-equivalent in the dedicated regression.
The follow-up also skips the generic three-tone and uncovered-span reducers in
conservative mode, and protects unresolved phrase ranges from opt-in thinning.

Full player-core suite:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npm run test -w @keyspilli/player-core
Test Files  15 passed (15)
Tests       258 passed (258)
```

Typecheck:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH npm run typecheck -w @keyspilli/player-core
exit 0
```

## Producer change

- Sparse comparison is bounded to supported harmonic events with `source-measure-boundary` phase when source support exists; no pulse library, generated-note quota, or second producer was added.
- The sparse candidate wins only when the merged candidate strictly reduces attack locations, with occupancy and bounded per-hand sounding penalty measured over retained/protected/held notes. Generated duplicates at preserved source pitches are filtered before the final allocator.
- Protection is limited to the deterministic first structural source attack plus explicit `identitySource: "vocals"` evidence; `sourceLane` remains available metadata, not reviewed hook identity. There is no generated-note quota heuristic.
- Sparse phase continues across adjacent equivalent chord events while carrying protected notes and source-rest boundaries through the regenerated candidate.
- `strategy: "harmonic-backing"` takes precedence when generated backing is actually rendered; unchanged phrases now use neutral `reasons: []` instead of treating exact equality as musical success.
- Notes-derived/generated-only harmony remains label-only under `harmonicSupport: "authored-only"`; its source reduction can still reduce dense source stacks, but it cannot synthesize support.

## Real-fixture gate

The exact current-head reproduction was run with Node 22:

```sh
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  node_modules/.bin/tsx \
  docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts
```

The reproduction now emits the complete `finalBackingStream`, the complete source backing stream, every final attack location with source/generated lineage, candidate-kind attribution, and source identity attribution. The historical JSON and Task 1 checkpoint attribution were not changed.

| Fixture | Final notes | Source support | Generated | Max attacks/measure | Final backing events | Final/source attack locations | Added locations vs source |
|---|---:|---:|---:|---:|---:|---:|---:|
| Blackbird | 1041 | 432 | 0 | 10 | 487 | 454 / 454 | 0 |
| Oops | 1433 | 601 | 0 | 14 | 850 | 479 / 479 | 0 |
| Hell | 1110 | 443 | 0 | 11 | 572 | 470 / 471 | 0 |

Oops `[64,108]` exact current result:

- Final accompaniment support: `119` notes, `76` attack locations.
- Full final backing stream: `151` events in the window (`119` source-rhythm/protected accompaniment events plus `32` retained-source events), with `85` attack locations.
- Source backing in the same window: `241` notes, `85` attack locations.
- The final attack-location list is exactly the source-location list: `64, 64.5, 65, 65.5, 66, 66.5, 67, 67.5, 68, 68.5, 69, 69.5, 70, 70.5, 71, 71.5, 72, 72.5, 73, 73.5, 74, 74.5, 75, 75.5, 77.5, 80, 80.5, 81, 81.5, 82, 82.5, 83, 83.5, 84, 84.5, 85, 85.5, 86, 86.5, 87, 87.5, 88, 88.5, 89, 89.5, 90, 90.5, 91, 91.5, 92, 92.5, 93, 93.5, 94, 94.5, 94.875, 95, 95.5, 96, 96.5, 97, 97.5, 98, 98.5, 99, 99.5, 99.75, 100, 100.5, 101, 101.5, 101.75, 102, 102.5, 103, 103.5, 104, 104.5, 105, 105.5, 105.875, 106, 106.5, 107, 107.5`.

The preserved historical baseline was `84` notes / `55` attack locations in this window, `466` source-support notes, and maximum `8` attacks/measure. The current deltas are `+35` window support notes, `+21` window attack locations, `+135` source-support notes, and `+6` maximum attacks/measure. The current full stream explains the increase structurally: all `850/850` final backing events are source-linked, `0` are generated, and `249` are retained-unclassified source events. Candidate/identity attribution is explicit: `601` events are `source-rhythm-or-protected`, `249` are `retained-source`, every source identity is `unannotated`, and there are `0` `sparse-harmonic-generated` events. In `[64,108]`, the full stream contains `119` source-rhythm/protected events and `32` retained-source events; the attack union remains the source union. No current final attack location is newly synthesized, and no density increase is accepted through a generated-note quota.

This is an identity/stream accounting result, not a claim that Oops is musically useful or human-playable. The historical artifact preserves aggregate metrics rather than its full old event lineage, so the exact old-to-new identity mapping is not claimed.

The separate conservative source-only preview was also checked on the same
Oops interval against the current worktree: `157` full backing events at the
same `85` attack locations, `37` accompaniment events at `24` support-only
attack locations, `0` generated events, and `157` source-linked final events.
The default comparison is `151` full events / `85` attacks, `119` support
events / `76` support attacks, and `0` generated. The complete fixture probe
measured Blackbird `515` conservative events versus `487` default and Oops
`922` versus `850`; the conservative path deliberately preserves source
members outside the narrow repeated-short rule. This is a selectable
source-only voicing preview, not an automatic rhythm repair; support-only and
full-stream denominators remain distinct.

Protected and unresolved source notes are emitted as `retained-unclassified`
and remain mandatory input to the final sounding-limit pass. That pass still
runs, but these notes bypass ordinary support allocation and velocity reduction;
the preview is not a claim of safer density or physical playability.

The corrected selector and seam/rest behavior are mechanism-level results from synthetic authored-chart fixtures. The exact real controls still use notes-derived/generated chord labels under `harmonicSupport: "authored-only"`, so they do not receive synthesized harmonic backing.

## Concerns and non-claims

- The authored synthetic tests demonstrate merged-candidate selection, explicit-identity preservation, seam carry, and source-rest handling; they are not a real-song acceptance result.
- A supported melody rest keeps generated backing active; source rests suppress only sparse attacks that would fill a source-timing gap, and do not mute backing because the melody is resting.
- The real Blackbird/Oops/Hell controls use generated/notes-derived chord labels under the authored-only policy, so they remain source-reduction/fallback paths with zero generated backing. The authored-only synthetic winner is not a fix claim for actual Oops.
- No human listening, pedal-on acceptance, fingering review, global voice-leading, UI correction flow, catalogue mutation, deployment, merge, or live verification was performed.

## Changed files

- `packages/player-core/src/accompaniment.ts`
- `packages/player-core/test/melody-accompaniment.test.ts`
- `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts`
- `.superpowers/sdd/2026-09-18-chords-v2-remediation/task-2-report.md`
- `docs/superpowers/evidence/2026-09-18-chords-v2-task-2-checkpoint.md`
