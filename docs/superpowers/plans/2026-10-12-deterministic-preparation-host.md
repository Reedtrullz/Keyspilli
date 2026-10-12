# KS-16 deterministic preparation implementation plan

Approved scope: [#273](https://github.com/Reedtrullz/Keyspilli/issues/273) and
[host specification](../specs/2026-10-12-deterministic-preparation-host.md).

1. Add failing contract/admission tests and agree with canonical preflight on the
   independent working-file fingerprint and distinct capabilities.
2. Implement strict request parsing, bounded regular-file reads, fixed config,
   original/snapshot pins, runtime/implementation identity, and exclusive private
   run reservation in focused host libraries.
3. Implement atomic owned state and mutation lock, bounded preparation attempts,
   sanitized subprocess environment, process-group interruption/timeout handling,
   and bounded output capture. Keep maintained preparation behavior unchanged.
4. Validate the known bundle/installation paths after the actual verifier, record
   the full successful inventory at the prepared checkpoint, and seal it without
   replaying the stage. Add the read-only verification command.
5. Exercise actual authored MIDI and selected PhrasePlan integration, plus focused
   fault/integrity controls. Run type checking and the relevant tests, then hand
   the exact commit and evidence to root for independent review and PR lifecycle.

Root owns canonical skill/preflight changes and GitHub. Host code, tests, and
design/operations documentation are the implementation subtask. No providers,
real song acquisition, production writes, musical approvals, merge or deployment
are part of this plan. The existing authorization covers these implementation
steps; no additional generic approval menu is required.
