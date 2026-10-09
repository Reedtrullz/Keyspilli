# Automatic Score Review

Use the explicitly selected checkout's `check_checkout.py` result. Require
`score_review.status=compatible`; compatibility is not provider availability.
The checkout owns parsing, receipts, repairs and the static result page. This
plugin bundles instructions and preflight only, not application code or recordings.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts capabilities
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts \
  /absolute/input.json /absolute/new-output --offline
```

No flag defaults offline. No Anti account, listening form or pianist is needed.
The version-1 score input pins a v2 manifest and each mode's delivery, replay,
clock/role/hand evidence and independent-source authority. JSON/Markdown/HTML
results contain located findings, scoped conformance/structural receipts and a
repair queue. Never trust legacy manifest-declared checker passes on their own.

Saved audio is joined only when manifest/profile/job/media/raw hashes agree:
append `--anti-result /absolute/retained-run/report.json` in offline mode.
Explicit live mode is `--send-audio --max-requests 1` with one job and all
`--anti-python`, `--anti-script`, `--base-url`, `--model`,
`--account-binding-json` options. Binding is private, instance scoped and
verified before generation. Do not print or package the binding. No refresh,
retry, resume, fallback or account/model substitution is allowed.

Exit 0 is a completed diagnosis, not approval; 2 is invalid/prerequisite-blocked;
3 is an attempted rejected/failed audio result with local receipts retained.
Unknown roles/hands/authority limit the claim; they are not owner review tasks.
Score equality is not hearing, recognizable-song correctness or pianist approval.
Provider-only advice cannot change notes. Trusted source-supported previews use
bounded edits and automatic fresh rechecks with neighbors protected.

Do not resume immutable failed studies. Provider listening remains unverified,
musicalAcceptance not-established, productionAdmission false. Candidate artifacts
do not imply installed adoption, publication or deployment authorization.
