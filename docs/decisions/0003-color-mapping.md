# ADR 0003 — Pitch color mapping

Status: accepted (2026-08-09)

## Decision

Fixed pitch-class → color mapping used everywhere (notes, keys, bars, labels):

| Pitch | Color |
|---|---|
| C | red |
| C#/Db | red-orange |
| D | orange |
| D#/Eb | amber |
| E | yellow |
| F | green |
| F#/Gb | teal |
| G | blue |
| G#/Ab | indigo |
| A | purple |
| A#/Bb | magenta |
| B | pink |

## Consequences

- One source of truth in `packages/engrave/src/colors.ts` (exported as
  `PITCH_COLORS`), used by the player, sheet rendering, and PDF layouts.
