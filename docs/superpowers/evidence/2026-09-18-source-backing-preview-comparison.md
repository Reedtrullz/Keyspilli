# Source-backing preview comparison

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
Node: `v22.22.3`

This is a current-worktree diagnostic for human review. It compares the
explicit `sourceBackingMode: "default"` path with the opt-in
`sourceBackingMode: "conservative"` path. It is not a musical acceptance or
rhythm-repair result.

Both modes used the same options:

```ts
{
  durationBeats,
  sourceFingerprint,
  selection: "automatic",
  allowRests: true,
  soundingPolicy: "coherent-phrase",
  harmonicSupport: "authored-only",
}
```

The conservative run adds only `sourceBackingMode: "conservative"`. Chords
were `resolveChordSources(data).auto.chords`; the labels are notes-derived and
do not authorize generated harmonic audio under `authored-only`.

## Complete fixture output

| Fixture | Mode | Final backing events | Attack locations | Accompaniment events | Accompaniment attacks | Retained-unclassified | Generated | Source-linked | Phrase records | Changed phrases | Needs review |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Blackbird | default | 487 | 454 | 432 | 410 | 55 | 0 | 487 | 131 | 111 | 54 |
| Blackbird | conservative | 515 | 454 | 33 | 33 | 482 | 0 | 515 | 131 | 129 | 54 |
| Oops | default | 850 | 479 | 601 | 397 | 249 | 0 | 850 | 350 | 237 | 204 |
| Oops | conservative | 922 | 479 | 192 | 133 | 730 | 0 | 922 | 448 | 261 | 261 |

The result is not monotonic density reduction: Blackbird conservatively retains
28 more full source-linked events than the default path, and Oops retains 72
more. Protected and unresolved source notes bypass the default reducer; the
conservative mode intentionally does not apply the generic three-tone or
uncovered-span reduction. Both songs keep their original attack-location count.
The option is therefore a source-only voicing preview, not a temporal
simplifier.

## Oops `[64,108)`

| Mode | Final backing events | Attack locations | Accompaniment events | Accompaniment attacks | Retained-unclassified | Generated | Source-linked |
|---|---:|---:|---:|---:|---:|---:|---:|
| Default | 151 | 85 | 119 | 76 | 32 | 0 | 151 |
| Conservative | 157 | 85 | 37 | 24 | 120 | 0 | 157 |

The conservative preview retains 6 more full events than the default in this
interval while preserving all 85 source attack locations. It emits no generated
events and no pitch without source lineage. The support-only counters remain
separate from the full backing stream because retained-unclassified source
events are still part of the final backing output.

Protected and unresolved source notes are emitted as `retained-unclassified`
and remain mandatory input to the final sounding-limit pass. That pass still
runs, but these notes bypass ordinary support allocation and velocity reduction;
the preview is not a claim of safer density or physical playability.

## Boundary

The original Oops complaint about dense temporal attacks remains unresolved:
neither mode changes the attack grid. A real rhythm correction still needs
reviewed source lane/identity or authored phrase/chord annotation, or a
separate user-selectable temporal reduction with preview and source lineage.
