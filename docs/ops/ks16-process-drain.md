# KS-16 bounded process drain (#280)

## Observed boundary

The retained Wave4 verifier exited 0, but its process group was still detected at
the first post-close probe. The host rejected that attempt and later confirmed
group closure. The remaining process was not identified. Three authored TSX
controls did not reproduce the event; diagnostic process-member inventories
could not be qualified across the execution environment's PID namespace boundary.
The older Wave3 failure still lacks its original inner receipt.

A separate authored finite-helper control through the unchanged runner establishes
a narrower robustness case: after its leader exited 0, the helper received TERM
but completed its original 75 ms timer naturally. The runner still classified it
as `descendants`. This does not establish the historical verifier's helper or state.

## Bounded correction plan

1. Commit and run regressions against the unchanged runner, retaining the RED
   receipts and all failed fixtures before editing production code.
2. Allow at most 250 ms of passive group drain only after an actual closed,
   zero-exit, unsignalled, otherwise safe command. Keep the original monotonic
   command deadline and abort handler authoritative across every wait.
   Absence must be observed within that window, including a timestamp after
   the probe. If the allowance expires first, later absence can establish
   cleanup but the command remains refused as `descendants`; an authoritative
   timeout or cancellation retains priority over that refusal.
3. Require the same final direct-child close and whole-group absence certificate.
   Persistent descendants keep the existing TERM/KILL cleanup and refusal rules.
   Any non-ESRCH probe error becomes sticky uncertainty for this invocation:
   `groupClosed` remains false even if a later probe reports absence, matching
   the conservative handling of signal errors. The stage therefore stays
   ambiguous and retains its lock; it cannot become a retryable known failure.
4. Run the focused process/host tests and relevant typechecks, obtain independent
   review, and let the root integration task run the complete combined gates.

Receipt schema, input/runtime/implementation pins, stage budget, log limits,
attempt limits, mutation locks and artifact acceptance remain governed by the
existing preparation contract. An implementation change requires a new run;
the retained failed run must not be retroactively accepted or resumed under
changed pins. Structural completion remains provisional musical evidence.

## Regression boundaries

The finite helper acknowledges its TERM handler before its leader exits and is
armed at the first actual successful post-close signal-0 probe. Its unchanged
timer must complete without receiving TERM after the correction. A persistent
helper still requires bounded escalation and refusal. Cancellation and controlled
deadline expiry are anchored to that same phase, including an overdue monotonic
deadline whose callback has not yet run. A delayed poll and a delay during the
first absence probe each must refuse absence first observed after 250 ms while
the original command budget remains unexpired. Nonzero and signalled exits receive no
passive success allowance. Transient and persistent probe errors, and a signal
error with separately owned test cleanup, must remain ambiguous.

Failed test fixtures and receipts are retained under the test's ignored output
directory and named in its log. The raw historical records and each diagnostic
observer limitation remain separate evidence; this correction claims only the
authored finite-teardown contract gap.
