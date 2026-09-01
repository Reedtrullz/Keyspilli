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
✓ test/external-evidence.test.ts (5 tests)
Test Files  1 passed (1)
Tests  5 passed

npm run typecheck -w @keyspilli/catalog
tsc --noEmit (passed)

git diff --check
passed
```

The focused test was first run before implementation and failed as expected
because `../src/external-evidence.js` did not exist.

## Commit

Commit: `5a89a9be0e787b64f69471b9b37276643ec70c32` (`feat(catalog): add external evidence firewall`)

## Concerns and boundaries

- This task adds only the pure model/firewall. It does not ingest MIDI or
  MusicXML, discover providers, align candidates, or alter generation routes;
  those belong to later tasks.
- `assertGenerationEvidence` is intentionally fail-closed for benchmark and
  remote/protected acquisition markers. Callers should supply an explicit
  local-analysis acquisition policy.
- Automated validation does not establish musical recognizability or quality;
  human review remains a separate gate.
- No benchmark media, protected artifacts, secrets, or absolute physical paths
  were added to the implementation or canonical metadata.
