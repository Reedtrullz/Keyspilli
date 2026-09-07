# Preserve tutorial harmony through the source difficulty ladder

The user reported that every extracted MIDI sounded good. Record this as positive listening evidence for the three raw candidates (Queen, Metallica and In My Mind), not acceptance of the generated difficulty levels. Exact raw MIDI hashes are in the adjacent JSON.

## Root cause and change

`buildVariants` routed explicit `source` imports through the historical Easy bass revoicing, replacing every retained bass note with the global tonic. This erased harmonic changes after successful extraction. Both the tutorial diagnostics and the disabled source-assisted worker explicitly select this profile. The fix preserves imported bass pitches for explicit `source`, as already done for `learner`. The unspecified legacy profile keeps its existing behavior; metal, raw extraction, Medium and Advanced are unchanged. No new extraction algorithm or dependency.

A changing C/G/A/F bass regression failed before the fix and passes afterward, including MIDI/XML serialization. Before/after Easy notes lacking the same LH pitch at the same onset in Medium: Queen525→0; Metallica671→0; In My Mind148→0. This checks pitch provenance within the difficulty ladder, not independent musical accuracy. Easy note counts can increase because distinct bass notes no longer collapse onto the same tonic. The internal Very Easy level inherits the correction too.

Bumped `INGEST_VARIANT_POLICY_ID` to `learner-variant-ladder-v6-source-harmony`, allowing artifact fingerprints to identify the changed generation policy. This does not regenerate existing songs. Raw accepted MIDI files and prior comparison outputs are preserved.

## Validation

- MIDI suite:368 tests pass across13 files. Typecheck passes. An initial test fixture omitted required keySig/keyMode metadata; corrected before the successful typecheck.
- Catalog suite:1,085 tests pass across117 files after the policy-version change.
- Rebuilt all five public difficulty exports for each of the three songs; all structural serialization checks pass.
- Called the real `ingestSource` for all three in a new isolated `KEYSPILLI_DATA_DIR` under `output/tutorial-recovery/isolated-ingest`. Each creates six internal difficulty rows, a valid source-profile manifest and artifacts. SQLite has18 rows and integrity_check=ok. This is real local ingest/persistence coverage, not an HTTP upload, worker request, source acquisition, or production validation.
- VB/B are intentionally RH-only under this profile. Their earlier end does not alone prove dropped melody: sustained closing LH notes are omitted by that policy. No speculative ending patch was added. Musical ending/identity retention remains a listening check.

Private five-level audio is being prepared alongside the existing accepted raw comparisons. Source discovery and tutorial decoding are still not enabled in the worker. The disabled source-assisted route currently accepts verified native MIDI, with source eligibility and release gates intact. No production release, catalog mutation, newly licensed source or independent full-song reference certification is claimed.
