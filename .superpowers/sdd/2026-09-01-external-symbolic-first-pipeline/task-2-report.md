# Task 2 report: external symbolic research evidence

Implementation and hardening commits: `630d82c`, `474ae92`, `7cdf5a1`,
`07d794d`; the final local-only barrel boundary is `d167a2c`.

## Delivered

- Added `packages/catalog/src/external-research.ts` with provider-neutral discovery/inventory records, explicit local byte/file ingestion, parser/provenance/hash metadata, uncertain role diagnostics, alignment placeholders, rejection reasons, and deterministic path-safe serialization.
- Delegated MIDI, MusicXML, MXL, and MSCZ handling to the existing native score adapter. Guitar Pro remains unsupported metadata-only; no downloader, converter, network call, production worker wiring, or Note/IR change was added.
- Applied `assertGenerationEvidence` to parsed candidates. Benchmark/reference-purpose candidates are rejected and are never marked generation-usable. Metadata-only leads and parsed research leads remain non-generation records.
- Added the native adapter and external research bridge as direct local
  evaluation imports; the final local-only barrel boundary is recorded in
  `d167a2c`.
- Added focused synthetic coverage in `packages/catalog/test/external-research.test.ts`.
- Hardened serialization/error redaction so HTTP(S) URLs survive intact while physical paths under standard Unix roots and Windows-style locators are redacted; invalid/unsupported local inputs are classified as non-native evidence and discovery/local rows merge by logical source identity or content hash.
- Kept benchmark/reference discovery purpose and class authoritative when a matching local input attempts an override, and added UNC/file-server/unknown-root redaction coverage without corrupting logical refs or HTTP URLs.
- Closed extensionless unknown-root leaks while preserving slash-containing logical identities and URLs.

## Verification

Commands run from the repository root:

```text
./node_modules/.bin/vitest run packages/catalog/test/external-research.test.ts
  1 file, 10 tests passed

./node_modules/.bin/vitest run packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts
  2 files, 20 tests passed

./node_modules/.bin/vitest run packages/catalog/test/native-score-adapter.test.ts packages/catalog/test/research-report.test.ts packages/catalog/test/song-research.test.ts packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts
  5 files, 55 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed

./node_modules/.bin/vitest run packages/catalog/test
  78 files; 697 passed, 6 failed (unchanged unrelated environment failures)
```

The six full-catalog failures are unrelated Hermes subprocess-environment
failures in existing `restore-curated.test.ts` and `verify-catalog.test.ts`
cases: that runtime cannot resolve the workspace `tsx` package. The changed
tests and all neighboring research/native/firewall tests pass.

`git diff --check` passed before commit. Untracked scratch files, plans, and lockfiles were not staged or modified.

## Caveats and non-claims

This task models and validates evidence locally; it does not fetch or acquire external media, align to a target recording, generate arrangements, or establish human recognizability. Role diagnostics use track names, register, monophony, density, and percussion signals, but every emitted role is explicitly uncertain or ambiguous with confidence below certainty. Physical paths are accepted only by the existing path-safe file adapter and are redacted from bridge provenance/JSON summaries; note/event arrays and normalized score payloads are omitted from serialized summaries.
