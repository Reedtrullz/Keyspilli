# Task 1 report — harmony benchmark manifest

Implemented a pure, metadata-only harmony benchmark manifest seam.

## Files

- `packages/catalog/src/harmony-benchmark-manifest.ts`
  - Defines the six-score manifest contract, source PDF hash/metadata, selected OMR/backend provenance, trusted coverage windows and hashes, excluded regions, and explicit candidate/recording availability.
  - Normalizes score/window ordering deterministically, validates IDs, SHA-256 values, finite/non-overlapping beat windows, and fails closed (`status: unavailable`, `eligible: false`) when candidate or recording evidence is unavailable.
  - Canonical serialization is allow-listed and path-safe; absolute/path-like fields and note arrays are rejected, and no source paths or copyrighted bytes are represented.
- `packages/catalog/test/harmony-benchmark-manifest.test.ts`
  - Synthetic coverage for deterministic six-score normalization, unavailable evidence, redaction, and malformed IDs/hashes/windows/path-like fields.

## Verification

- `npm exec -- vitest run packages/catalog/test/harmony-benchmark-manifest.test.ts` — **PASS (3/3)**
- `npm exec -- tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict packages/catalog/src/harmony-benchmark-manifest.ts` — **PASS**
- `git diff --check` — **PASS**

The package-wide typecheck currently also discovers unrelated untracked parent-agent tests whose source modules are not present yet (`harmony-evaluation`, `melody-review-pack`, `rotating-listening-bundle`); this seam itself typechecks cleanly. No index/package/runtime edits, source artifact copies, downloads, uploads, or production changes were made.
