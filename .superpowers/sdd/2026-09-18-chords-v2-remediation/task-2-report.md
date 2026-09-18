# Task 2 report — coherent phrase backing strategy

Date: 2026-09-18
Base: `e739cf7`
Scope: Task 2 only; no UI, catalogue, live data, merge, push, deployment, or production mutation.

## Result

Status: DONE for the bounded producer selector. The implementation now compares a source-rhythm reduction with a sparse harmonic candidate only when the chord evidence is allowed and validated source-measure phase is available. Empty-source sparse generation keeps its existing boundary behavior. The final Task 1 allocator remains the only final allocation pass.

## TDD evidence

### RED

After adding the final focused strategy tests, before the producer change:

```text
Test Files  1 failed (1)
Tests       2 failed | 70 passed (72)
```

The expected failures were the authored dense phrase not selecting sparse harmonic backing and the simple unchanged phrase still reporting `already-simple`. The generated-only label-only test was already covered by the existing fail-closed path and remained green in that red run; it was retained as a regression for the no-synthesis boundary.

An earlier first run of the three tests failed 3/72, including the initial generated-only fixture shape; that fixture was tightened to contain four-note source stacks so its source reduction assertion tests the intended behavior.

### GREEN

Focused producer tests:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm run test -w @keyspilli/player-core -- test/melody-accompaniment.test.ts
Test Files  1 passed (1)
Tests       72 passed (72)
```

Full player-core suite:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm run test -w @keyspilli/player-core
Test Files  15 passed (15)
Tests       245 passed (245)
```

Typecheck:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm run typecheck -w @keyspilli/player-core
exit 0
```

## Producer change

- Sparse comparison is bounded to supported harmonic events with `source-measure-boundary` phase when source support exists; no pulse library, generated-note quota, or second producer was added.
- The sparse candidate wins only when it reduces attack locations without dropping the first source attack, explicit source-lane/voice anchors, or protected melody, and does not have a worse bounded per-hand sounding penalty. Generated duplicates at preserved source pitches are filtered before the final allocator.
- Sparse phase continues across adjacent equivalent chord events through the existing prior-voicing/sparse-key state.
- `strategy: "harmonic-backing"` takes precedence when generated backing is actually rendered; unchanged phrases now use neutral `reasons: []` instead of treating exact equality as musical success.
- Notes-derived/generated-only harmony remains label-only under `harmonicSupport: "authored-only"`; its source reduction can still reduce dense source stacks, but it cannot synthesize support.

## Real-fixture gate

The exact current-head reproduction was run with Node 22:

```sh
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm exec --no -- tsx \
  docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts
```

The reproduction now emits the complete `finalBackingStream`, the complete source backing stream, every final attack location with source/generated lineage, and a comparison with the preserved historical JSON. The historical JSON and Task 1 checkpoint attribution were not changed.

| Fixture | Final notes | Source support | Generated | Max attacks/measure | Final backing events | Final/source attack locations | Added locations vs source |
|---|---:|---:|---:|---:|---:|---:|---:|
| Blackbird | 1041 | 432 | 0 | 10 | 487 | 454 / 454 | 0 |
| Oops | 1433 | 601 | 0 | 14 | 850 | 479 / 479 | 0 |
| Hell | 1110 | 443 | 0 | 11 | 572 | 470 / 471 | 0 |

Oops `[64,108]` exact current result:

- Final accompaniment support: `119` notes, `76` attack locations.
- Source backing in the same window: `241` notes, `76` attack locations.
- The final attack-location list is exactly the source-location list: `64, 64.5, 65, 65.5, 66, 66.5, 67, 67.5, 68, 68.5, 69, 69.5, 70, 70.5, 71, 71.5, 72, 72.5, 73, 73.5, 74, 74.5, 75, 75.5, 77.5, 80, 80.5, 81, 81.5, 82, 82.5, 83, 83.5, 84, 84.5, 85, 85.5, 86, 86.5, 87, 87.5, 88, 88.5, 89, 89.5, 90, 90.5, 91, 91.5, 92, 92.5, 93, 93.5, 94, 94.5, 94.875, 95, 95.5, 96, 96.5, 97, 97.5, 98, 98.5, 99, 99.5, 99.75, 100, 100.5, 101, 101.5, 101.75, 102, 102.5, 103, 103.5, 104, 104.5, 105, 105.5, 105.875, 106, 106.5, 107, 107.5`.

The preserved historical baseline was `84` notes / `55` attack locations in this window, `466` source-support notes, and maximum `8` attacks/measure. The current deltas are `+35` window support notes, `+21` window attack locations, `+135` source-support notes, and `+6` maximum attacks/measure. The current full stream explains the increase structurally: all `850/850` final backing events are source-linked, `0` are generated, and `249` are retained-unclassified source events. No current final attack location is newly synthesized, and no density increase is accepted through a generated-note quota.

This is an identity/stream accounting result, not a claim that Oops is musically useful or human-playable. The historical artifact preserves aggregate metrics rather than its full old event lineage, so the exact old-to-new identity mapping is not claimed.

## Concerns and non-claims

- The authored synthetic test demonstrates the selector and preserves a source bass/hook; it is not a real-song acceptance result.
- The real Blackbird/Oops/Hell controls use generated/notes-derived chord labels under the authored-only policy, so they remain source-reduction/fallback paths with zero generated backing. The authored-only synthetic winner is not a fix claim for actual Oops.
- No human listening, pedal-on acceptance, fingering review, global voice-leading, UI correction flow, catalogue mutation, deployment, merge, or live verification was performed.

## Changed files

- `packages/player-core/src/accompaniment.ts`
- `packages/player-core/test/melody-accompaniment.test.ts`
- `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts`
- `.superpowers/sdd/2026-09-18-chords-v2-remediation/task-2-report.md`
