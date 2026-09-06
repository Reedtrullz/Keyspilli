# Shadow-corpus mission reports

The shadow corpus is a local, provider-neutral engineering fixture. It gives
the decoder and arrangement pipeline deterministic symbolic inputs without
turning a protected reference recording into a generation dependency. Corpus
media and benchmark/reference files stay outside the repository and are never
copied into a report.

## Evidence flow

The bounded local flow is:

1. Build or receive a path-safe corpus manifest with explicit license and
   source-record provenance.
2. Evaluate the shadow items and synthetic alignment calibration.
3. Freeze generation candidates before opening any benchmark reference.
4. Run the seven-song inventory/benchmark and Red Baron stage-survival tools
   only when their independent local inputs exist.
5. Aggregate the resulting JSON diagnostics with
   `report:shadow-mission`.

The aggregator is a reporting boundary. It does not download, parse, render,
arrange, upload, deploy, or mutate the catalog. Its output contains counts,
statuses, hashes, logical IDs, and bounded diagnostics; raw notes, binary
payloads, and physical paths are omitted or redacted.

## Mission report

Run it with an envelope containing any available report sections:

```text
npm run report:shadow-mission -w @keyspilli/catalog -- \
  --input /absolute/local/shadow-mission-input.json \
  --out /absolute/local/shadow-mission-report.json
```

Alternatively, pass sections separately with `--shadow`, `--alignment`,
`--retrieval`, `--benchmark`, `--red-baron`, `--disk`, and `--corpus`. Inputs
and output must be explicit local paths outside the repository. The command
returns a deterministic, path-redacted JSON report; repeated runs over the
same evidence produce the same canonical digest.

The report separates:

- disk and corpus provenance;
- per-item shadow status, output summaries, and failures;
- synthetic alignment recovery and its 3-window/32-bar calibration;
- the seven-song inventory and missing evidence;
- candidate freeze order and whether it preceded reference access;
- the first observed Red Baron stage loss;
- shadow-engineering, benchmark-human-listening, and production readiness;
- explicit safety actions and non-claims.

Missing evidence is represented as `null`, `unavailable`, or `UNAVAILABLE`.
It is never converted into zero coverage, a successful alignment, or a
recognizability claim. In particular, `SHADOW_ENGINEERING_READY` means that
the bounded shadow fixtures passed their engineering checks; it says nothing
about whether a Sabaton, Free Bird, or other real-song arrangement is
recognizable.

## Readiness boundaries

`SHADOW_ENGINEERING_READY` is available when the supplied shadow evaluation
contains one or more items and all selected items are ready, with no blocked or
not-ready items. If that report is absent, the state is `UNAVAILABLE`; if it
exists but fails, the state is `BLOCKED`.

`BENCHMARK_READY_FOR_HUMAN_LISTENING` is deliberately stricter. Every required
benchmark item must be present, use an available symbolic output with a passing
structural gate, have independently aligned reference evidence covering at
least three validated windows, and have an accepted human review. The
aggregator does not create an audio listening pack. Without that complete
evidence it reports `BLOCKED` (or `UNAVAILABLE` when no benchmark report was
supplied).

`PRODUCTION_READY` is always `BLOCKED` in this local mission report. A report
cannot attest to a deploy, production health, catalog mutation, or live
listening result. Those require separate authorized operational and human
gates.

## Safety and non-claims

Keep protected references and acquired corpus media in a bounded local working
directory. Do not stage them, upload them, or use them during generation. The
reference remains evaluation-only and can be opened only after the candidate
freeze. Automated metrics support review but do not replace at least two human
listeners assessing melody recognition, accompaniment usefulness, rhythm/bar
alignment, wrong-note severity, and playability.

The report is intentionally compatible with partial progress: it is useful
when only synthetic shadow evidence exists, while making the missing real-song
candidate, alignment, audio, or human evidence visible rather than silently
claiming success.
