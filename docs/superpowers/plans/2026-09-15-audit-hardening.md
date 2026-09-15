# Audit hardening implementation

Base: main `211a4b6198b80ab5ea6839f6bdf113ab00c0c0ed`. Existing `codex/organ` work remains untouched.

1. Reproduce and repair MusicXML rest/measure/divisions/tempo interpretation; reject unsupported timing/parts explicitly. Own parser tests establish source truth.
2. Repair repeated-loop scheduling and long-frame bounds; unify review policy loading/failure behavior; normalize pagination and cancel stale discovery.
3. Bound upload admission and parsed symbolic work, and PDF concurrency/full-operation time; preserve meaningful busy/reconciliation errors.
4. Replace expiring directory locks with OS-released SQLite file locks using the existing dependency. Preserve post-swap state/backup material and a durable reconciliation marker; test failures and crashed lock owners.
5. Coordinate backup snapshot with paused writer containers, publish a checksummed completion marker, provide a verified isolated restore path; repair authenticated target-aware rebuild checks and SSH options.
6. Update vulnerable dependencies within the existing supported line. Run baseline/targeted/full tests, types, production build, browser smoke and restore fixtures; establish current-main catalogue validation on an isolated copy and repair only source-backed data in isolation.
7. Review the integrated diff, resolve findings, document exact verification and remaining human/live boundaries, and prepare a reviewable branch/PR. No deployment inferred from audit implementation.

Use existing helpers and dependencies; regression checks first for each defect. No changes to owner musical verdicts, source identity or production data.
