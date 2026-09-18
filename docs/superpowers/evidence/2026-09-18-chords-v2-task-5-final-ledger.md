# Chords v2 Task 5 final finding ledger

Date: 2026-09-18
Branch: `codex/musically-useful-chords-mode`
Current implementation/evidence head before final handoff: `773e52c`

This ledger closes the audit findings without upgrading structural evidence to
musical acceptance.

| Finding | Status | Evidence and boundary | Next action if the goal continues |
|---|---|---|---|
| P1 competing phrase strategy is not exercised on current real controls | Partial / unresolved | The current real controls remain source-rhythm/fallback with `generatedNoteCount=0`; source provenance and fail-closed harmonic policy are preserved. The complete Oops and Blackbird captures are now durable, but they do not prove that a sparse harmonic candidate was selected or useful. | Supply a validated authored/UG chart, then compare source reduction against one bounded sparse phrase candidate on the exact reviewed window. |
| P1 useful competing rhythm strategy is unproven | Blocked on source/phrase evidence | Oops `[64,108]` remains the known source-linked reduction case; the evidence records attack counts and the unchanged `479/479` attack-location limitation without calling it musical success. | Attach reviewed source-lane/voice identity, meter and phrase boundaries/phase, explicit melody/bass/hook/rest annotations, and validated harmonic coverage for one phrase. Implement the smallest candidate comparison for that phrase and re-run the exact fixture report. |
| P1 support has no available-hand allocator | Fixed and structurally tested | Task 1 tests cover source-hand preservation/available-hand allocation, crossing protection, support velocity, and allocator-only fallback provenance. This is not global voice-leading, fingering, pedal, or human-playability proof. | Keep the structural guard; add human/tempo/pedal acceptance only if the product goal requires a stronger claim. |
| P1 melody identity is inferred and correction was not phrase-actionable | Workflow fixed; semantic proof pending | Task 3 phrase-local source/rest choices, stale/overlap review, fingerprint validation, reset, and browser persistence are tested. Automatic melody remains inferred; no source packet supplies semantic melody gold. | Review selected source IDs on a bounded phrase and feed reviewed identity into any future harmony evidence. |
| P1 written-event checks are not human-playability acceptance | Partial / correctly bounded | Written sounding/span limits, held-note behavior, relative support velocity, and same-stream projections are tested. No claim is made about fingering, pedal comfort, repeated-attack comfort, or beginner playability. | Add tempo/repeated-attack and pedal-on/off review plus human ratings before using “playable” as an acceptance label. |
| P2 phrase status could be read as musical quality | Fixed and tested | Status copy is neutral (`changed`, `unchanged`, `need review`); source-preview copy discloses that temporal backing reduction is unavailable without reviewed identity. | Keep structural status separate from any future human-reviewed phrase result. |
| P2 role audition is not an isolated backing stem | Disclosed and tested | The UI explicitly says Accompaniment includes retained/unclassified source notes; durable captures verify non-empty role/wiring paths, not stem purity. | Add role-coverage counts or a true isolated stem only if required; do not relabel current audition. |
| P2 focused tests do not prove the real musical claim | Partially covered; musical gate remains open | Fresh producer, UI, typecheck/build, exact-fixture, Oops, and complete Blackbird capture checks cover engineering contracts and integrity. Human listening remains pending. | Run the bounded human rubric for recognizability, backing usefulness, melody audibility, and hand comfort after reviewed source annotations exist. |

## Task status

| Task | Status |
|---|---|
| Task 1 hand allocation/balance | Fixed and structurally tested; human playability unclaimed |
| Task 2 coherent phrase strategy | Partial and concretely blocked on reviewed source/phrase annotations |
| Task 3 phrase-local melody correction | Fixed and browser-tested; semantic melody truth unclaimed |
| Task 4 truthful status/evaluation coverage | Fixed and locally verified; listening pending |
| Task 5 verification/evidence/handoff | In progress until final diff review, push, draft PR update, and exact-head CI |

No merge, deploy, catalogue rebuild, live-data mutation, or production claim is
included in this ledger.
