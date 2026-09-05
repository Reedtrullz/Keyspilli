# Advanced catalog repair implementation plan

1. Add failing unit tests for transcription fragments with and without independent audio onsets, including reordered-input determinism.
2. Implement the smallest pure continuation-collapse helper in `packages/catalog/src/transcribe.ts`; invoke it only in the audio-onset-filtered transcription path and bump the filter version.
3. Add deterministic Advanced repair classification using existing learner metrics: auto-repair only high-confidence audio fragmentation, block confirmed-broken missing-source artifacts, and leave authored ambiguity as review-only.
4. Trace authored source-to-Advanced output. Repair only demonstrated pipeline loss; otherwise record the non-finding.
5. Rebuild recoverable source families in scratch storage and compare before/after objective metrics. Do not mutate production.
6. Fix the confirmed duration metadata mismatch through its owning data path.
7. Run focused, package, workspace, typecheck, determinism, diff, and disk gates. Commit and push coherent green checkpoints.
8. Update the evidence ledger and Keyspilli Obsidian project note with changes, non-claims, source availability, and remaining blockers.
