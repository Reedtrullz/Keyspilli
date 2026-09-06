# Red Baron lineage checkpoint — 2026-09-01

Cold, local-only diagnostic. The accepted Red Baron reference stayed
evaluation-only and was not supplied to generation or tuning.

The optional path-free trace emitted:

| Stage | Events | Selected/accepted |
| --- | ---: | ---: |
| raw (guitar) | 1,599 | source events |
| lead | 1,599 guitar | 430 guitar + 241 vocals |
| semantic | 352 | 352 |
| decision | 1,198 guitar | 363 guitar |
| final/canonical | 1,229 guitar | 1,229 |
| Easy | 460 guitar | 460 |

The complete trace also contained cleaned (259), cluster (352), chord (203),
left-hand (700), and all-source final/difficulty events. The retained-stem
smoke trace had 21,281 events and zero difficulty events without a canonical
parent key. Public MIDI/IR shapes remain unchanged; tracing is opt-in.

For a source-filtered projection over three explicit 104-beat windows, the
survival evaluator returned `ready`:

| Transition | Source | Target | Matched | Rejected | Modified/replaced | Additions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| raw → decoder | 1,227 | 1,227 | 1,227 | 886 | 0 | 0 |
| decoder → semantic | 1,227 | 268 | 268 | 1,144 | 83 | 0 |
| semantic → canonical | 268 | 940 | 268 | 0 | 262 | 672 |
| canonical → Easy | 940 | 355 | 355 | 585 | 322 | 0 |

The first large observed loss is decoder/decision-to-semantic retention; the
canonical stage expands accompaniment events. These projections are diagnostic
because semantic events are aggregates and stages are source-filtered. Raw
pitch support is weak, so no Red Baron-specific decoder or arranger tuning is
justified.

Full path-free trace/report are retained locally under the bounded artifact
root as `red-baron-lineage.trace.json` and `red-baron-lineage.report.json`.
No reference bytes, source paths, audio, or benchmark assets are committed.
