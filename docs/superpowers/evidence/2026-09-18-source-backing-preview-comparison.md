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
| Blackbird | conservative | 499 | 454 | 20 | 20 | 479 | 0 | 499 | 131 | 129 | 54 |
| Oops | default | 850 | 479 | 601 | 397 | 249 | 0 | 850 | 350 | 237 | 204 |
| Oops | conservative | 783 | 479 | 75 | 70 | 708 | 0 | 783 | 348 | 319 | 201 |

The result is not monotonic density reduction: Blackbird conservatively retains
12 more full source-linked events than the default path because protected
anchors bypass reductions the default resolver would otherwise make. Oops
loses 67 full events, but its 479 attack locations are unchanged. The option is
therefore a source-only voicing-density preview, not a temporal simplifier.

## Oops `[64,108)`

| Mode | Final backing events | Attack locations | Accompaniment events | Accompaniment attacks | Retained-unclassified | Generated | Source-linked |
|---|---:|---:|---:|---:|---:|---:|---:|
| Default | 151 | 85 | 119 | 76 | 32 | 0 | 151 |
| Conservative | 131 | 85 | 13 | 12 | 118 | 0 | 131 |

The conservative preview removes 20 full events in this interval while
preserving all 85 source attack locations. It emits no generated events and no
pitch without source lineage. The support-only counters remain separate from
the full backing stream because retained-unclassified source events are still
part of the final backing output.

## Boundary

The original Oops complaint about dense temporal attacks remains unresolved:
neither mode changes the attack grid. A real rhythm correction still needs
reviewed source lane/identity or authored phrase/chord annotation, or a
separate user-selectable temporal reduction with preview and source lineage.
