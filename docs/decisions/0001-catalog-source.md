# ADR 0001 — Catalog source

Status: accepted (2026-08-09)

## Decision

The seed catalog (~100 songs) is sourced from public-domain/private-use classical
MIDI collections (piano-midi.de, Mutopia as fallback) plus any personal MIDI
files. Every song records its source URL and license note in
`catalog/manifest.json`. The app is private, single-user, non-commercial.

## Consequences

- No licensing workflow, no monetization.
- Provenance is recorded per song for personal traceability.
- Arrangement quality varies by source; the pipeline (quantize/hand-split)
  normalizes everything into Keyspilli variants.
