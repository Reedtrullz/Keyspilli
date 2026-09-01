# Task 1 report: external evidence firewall

## Scope

Implemented the provider-neutral external evidence model and generation
firewall in `packages/catalog/src/external-evidence.ts`, exported it from the
catalog index, and added focused Vitest coverage in
`packages/catalog/test/external-evidence.test.ts`.

The implementation defines evidence class, purpose, status, and role unions;
models logical provenance, content identity, confidence, role evidence, and
rejection reasons; rejects benchmark-purpose/class candidates, disallowed
acquisition, missing or malformed SHA-256 identity, and failed/rejected parse
states; and produces deterministic, path-safe candidate-set metadata and
SHA-256 digests. Canonical metadata excludes note/event arrays and physical
locators. Non-finite numeric fields normalize to `null` in canonical output.

## Verification

Commands run from the repository root:

```text
npm test -w @keyspilli/catalog -- --run test/external-evidence.test.ts
✓ test/external-evidence.test.ts (7 tests)
Test Files  1 passed (1)
Tests  7 passed

npm test -w @keyspilli/catalog
Test Files  77 passed (77)
Tests  690 passed (690)

npm run typecheck -w @keyspilli/catalog
tsc --noEmit (passed)

git diff --check
passed
```

The focused test was first run before implementation and failed as expected
because `../src/external-evidence.js` did not exist.

## Commit

Implementation commit: `a4a1368f11d1628da90f501fa2f410cd3d6acf81` (`fix(catalog): fail closed on external evidence metadata`)

## Concerns and boundaries

- This task adds only the pure model/firewall and architecture boundary. It does not ingest MIDI or
  MusicXML, discover providers, align candidates, or alter generation routes;
  those belong to later tasks.
- `assertGenerationEvidence` is intentionally fail-closed for benchmark and
  remote/protected acquisition markers. Callers should supply an explicit
  local-analysis acquisition policy.
- Automated validation does not establish musical recognizability or quality;
  human review remains a separate gate.
- No benchmark media, protected artifacts, secrets, or absolute physical paths
  were added to the implementation or canonical metadata.
- Follow-up hardening validates every supplied acquisition field (including
  malformed objects), recursively removes physical locator/note/event fields,
  redacts file URLs and path-like values, and rejects generic benchmark or
  reference markers in provenance/lineage metadata.
