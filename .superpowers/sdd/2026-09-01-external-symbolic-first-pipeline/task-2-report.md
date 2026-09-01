# Task 2 report: external symbolic research evidence

Implementation commits: `630d82c1ea659e2aabf122d7027eadaecca5f5c9`, `474ae92440111853beb8a39b9634a8f075da6801`

## Delivered

- Added `packages/catalog/src/external-research.ts` with provider-neutral discovery/inventory records, explicit local byte/file ingestion, parser/provenance/hash metadata, uncertain role diagnostics, alignment placeholders, rejection reasons, and deterministic path-safe serialization.
- Delegated MIDI, MusicXML, MXL, and MSCZ handling to the existing native score adapter. Guitar Pro remains unsupported metadata-only; no downloader, converter, network call, production worker wiring, or Note/IR change was added.
- Applied `assertGenerationEvidence` to parsed candidates. Benchmark/reference-purpose candidates are rejected and are never marked generation-usable. Metadata-only leads and parsed research leads remain non-generation records.
- Exported the native adapter and new external research bridge from `packages/catalog/src/index.ts`.
- Added focused synthetic coverage in `packages/catalog/test/external-research.test.ts`.
- Hardened serialization/error redaction so HTTP(S) URLs survive intact while physical paths under standard Unix roots and Windows-style locators are redacted; invalid/unsupported local inputs are classified as non-native evidence and discovery/local rows merge by logical source identity or content hash.

## Verification

Commands run from `/Users/reidar/Projectos/Keyspilli`:

```text
./node_modules/.bin/vitest run packages/catalog/test/external-research.test.ts
  1 file, 9 tests passed

./node_modules/.bin/vitest run packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts
  2 files, 19 tests passed

./node_modules/.bin/vitest run packages/catalog/test/native-score-adapter.test.ts packages/catalog/test/research-report.test.ts packages/catalog/test/song-research.test.ts packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts
  5 files, 54 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed

./node_modules/.bin/vitest run packages/catalog/test
  78 files; 693 passed, 6 failed (unchanged unrelated environment failures)
```

The six full-catalog failures are unrelated subprocess-environment failures in existing `restore-curated.test.ts` and `verify-catalog.test.ts` cases. They invoke `/Users/reidar/.hermes/node/bin/node --import tsx` with cwd `/Users/reidar`, where `tsx` cannot be resolved (`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`). The changed tests and all neighboring research/native/firewall tests pass.

`git diff --check` passed before commit. Untracked scratch files, plans, and lockfiles were not staged or modified.

## Caveats and non-claims

This task models and validates evidence locally; it does not fetch or acquire external media, align to a target recording, generate arrangements, or establish human recognizability. Role diagnostics use track names, register, monophony, density, and percussion signals, but every emitted role is explicitly uncertain or ambiguous with confidence below certainty. Physical paths are accepted only by the existing path-safe file adapter and are redacted from bridge provenance/JSON summaries; note/event arrays and normalized score payloads are omitted from serialized summaries.
