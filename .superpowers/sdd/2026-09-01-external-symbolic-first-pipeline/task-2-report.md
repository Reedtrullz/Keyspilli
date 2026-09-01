# Task 2 report: external symbolic research evidence

Implementation commit: `630d82c1ea659e2aabf122d7027eadaecca5f5c9`

## Delivered

- Added `packages/catalog/src/external-research.ts` with provider-neutral discovery/inventory records, explicit local byte/file ingestion, parser/provenance/hash metadata, uncertain role diagnostics, alignment placeholders, rejection reasons, and deterministic path-safe serialization.
- Delegated MIDI, MusicXML, MXL, and MSCZ handling to the existing native score adapter. Guitar Pro remains unsupported metadata-only; no downloader, converter, network call, production worker wiring, or Note/IR change was added.
- Applied `assertGenerationEvidence` to parsed candidates. Benchmark/reference-purpose candidates are rejected and are never marked generation-usable. Metadata-only leads and parsed research leads remain non-generation records.
- Exported the native adapter and new external research bridge from `packages/catalog/src/index.ts`.
- Added focused synthetic coverage in `packages/catalog/test/external-research.test.ts`.

## Verification

Commands run from `/Users/reidar/Projectos/Keyspilli`:

```text
./node_modules/.bin/vitest run packages/catalog/test/external-research.test.ts
  1 file, 6 tests passed

./node_modules/.bin/vitest run packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts
  2 files, 16 tests passed

./node_modules/.bin/vitest run packages/catalog/test/native-score-adapter.test.ts packages/catalog/test/research-report.test.ts packages/catalog/test/song-research.test.ts packages/catalog/test/external-evidence.test.ts
  4 files, 45 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed

./node_modules/.bin/vitest run packages/catalog/test
  78 files; 693 passed, 6 failed
```

The six full-catalog failures are unrelated subprocess-environment failures in existing `restore-curated.test.ts` and `verify-catalog.test.ts` cases. They invoke `/Users/reidar/.hermes/node/bin/node --import tsx` with cwd `/Users/reidar`, where `tsx` cannot be resolved (`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`). The changed tests and all neighboring research/native/firewall tests pass.

`git diff --check` passed before commit. Untracked scratch files, plans, and lockfiles were not staged or modified.

## Caveats and non-claims

This task models and validates evidence locally; it does not fetch or acquire external media, align to a target recording, generate arrangements, or establish human recognizability. Role diagnostics use track names, register, monophony, density, and percussion signals, but every emitted role is explicitly uncertain or ambiguous with confidence below certainty. Physical paths are accepted only by the existing path-safe file adapter and are redacted from bridge provenance/JSON summaries; note/event arrays and normalized score payloads are omitted from serialized summaries.
