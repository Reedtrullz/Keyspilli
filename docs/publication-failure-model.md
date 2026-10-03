# Publication failure model

The supported contract covers a writer exception, process termination, stale
worker ownership, and a database/source commit failure on a local filesystem
that retains completed writes and atomic same-filesystem renames. It does not
promise preservation through power loss, host storage failure, lost writeback,
network filesystem lock semantics, or an inconsistent copied backup.

| Boundary | Recovery behavior |
| --- | --- |
| Staging or validation fails | Current tree remains; unfinished stage is discarded under the base lock. |
| Ownership rejected before swap | Current tree remains; no DB commit occurs. |
| Marker/journal written, old tree still installed | Explicit reconciliation discards the uncommitted stage without changing catalog rows. |
| Old renamed, stage not installed | Explicit reconciliation restores old and discards the uncommitted stage. |
| New installed, DB/source commit incomplete | Journal blocks ordinary reads/writes; validated explicit reconciliation retries the idempotent commit. |
| DB committed, cleanup interrupted | The same commit can replay; cleanup happens under the same lock. |
| Marker ambiguous, manifest invalid, or required file missing | Reconciliation refuses; journal and rollback tree remain for investigation. |

The publication token and reconciliation journal use Node `writeFile` with
`flush: true`. Ordinary staged artifact files and parent directories are not
all explicitly synchronized. SQLite uses WAL with its runtime synchronous
policy; WAL, database and filesystem publication are not one storage transaction.
The journal bridges their **process recovery** boundaries. A flushed marker
alone cannot establish complete storage durability, so recovery also checks
manifest identity and required artifact files before accepting an installed tree.
Production writers validate cross-format semantics before installing it; file
presence during recovery does not detect every possible same-length corruption.

Keep stage, canonical, rollback and journal on the same local filesystem. Do
not unlink lock database inodes, manually clear journals, or restore only a
subset of SQLite/WAL and artifact/source files. Use the stopped-write backup and
isolated restore protocol in `docs/ops.md`; an archive digest is not a disaster
recovery test. Reconciliation cannot turn malformed or unowned journal content
into a new accepted publication.

`packages/catalog/test/publication-durability.test.ts` materializes six bounded
namespace/commit interruption states, including missing-file and ambiguous-token
refusal. Existing publisher tests cover writer rejection, ownership rejection,
post-swap failure, deletion reconciliation and an actual killed lock holder.
These checks exercise process/recovery logic and filesystem operations, not
power loss. Run with Node 22:

```sh
npm test --workspace=packages/catalog -- test/publication-durability.test.ts test/publish.test.ts
```

Before extending this contract to power loss, test a disposable representative
Linux host/storage stack with controlled writeback/power interruption, record
SQLite synchronous settings and filesystem/mount assumptions, and measure
latency before choosing targeted file/directory synchronization. No fsync policy
or production limits are inferred from mocked I/O or this Mac's test duration.


Owner-triggered HTTP recovery additionally pins the exact bounded journal's
SHA-256 under the writer lock, refuses symbolic-link/oversize journal and marker
files, and writes an atomic flushed receipt before journal removal. The receipt
makes an acknowledged digest retry idempotent; it does not strengthen the
power-loss contract above. The inventory and action expose only bounded IDs,
operation/state and redacted static refusal messages.
