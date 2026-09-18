# Chords v2 Task 2 checkpoint — phrase strategy and Oops backing lineage

Date: 2026-09-18
Implementation base: `e739cf7`; final commit is reported with the handoff.

The exact reproduction script now emits the full final backing stream and source backing stream, attack locations, and per-attack source/generated lineage. It also reads the preserved historical result only for comparison; it does not rewrite that JSON or the Task 1 checkpoint.

## Current results

| Fixture | Final notes | Source support | Generated | Max attacks/measure | Final backing events | Final/source attack locations | Added vs source |
|---|---:|---:|---:|---:|---:|---:|---:|
| Blackbird | 1041 | 432 | 0 | 10 | 487 | 454 / 454 | 0 |
| Oops | 1433 | 601 | 0 | 14 | 850 | 479 / 479 | 0 |
| Hell | 1110 | 443 | 0 | 11 | 572 | 470 / 471 | 0 |

## Oops `[64,108]`

Current final accompaniment has `119` notes across `76` attack locations; the source backing has `241` notes across those same `76` locations. The complete current stream and the exact attack list are emitted by:

```sh
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm exec --no -- tsx \
  docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts
```

All `850` final backing events are source-linked, with `0` generated events. The current output therefore explains its `+135` full source-support-note delta and `+35` window-note delta against the preserved historical aggregate as source identity/retention, not a generated-note quota. The current window has no synthesized attack locations.

## Boundary

The historical baseline was `84` notes / `55` attack locations in this window and maximum `8` attacks/measure; current is `119` / `76` and maximum `14`. These are structural stream comparisons only. They do not establish that Oops sounds useful, is comfortable to play, or is fixed for the real song.
