# Chords v2 Task 5 final finding ledger

Date: 2026-09-18
Branch: `codex/musically-useful-chords-mode`
Current implementation head: `773e52c`; evidence ledger baseline: `c099796`

This ledger closes the audit findings without upgrading structural evidence to
musical acceptance.

| Finding | Status | Evidence and boundary | Next action for this goal |
|---|---|---|---|
| P1 competing phrase strategy is not exercised on current real controls | Partial / unresolved | The current real controls remain source-rhythm/fallback with `generatedNoteCount=0`; source provenance and fail-closed harmonic policy are preserved. The complete Oops and Blackbird captures are now durable, but they do not prove that a sparse harmonic candidate was selected or useful. | Use the one-phrase worksheet now to compare the existing source-only candidate. If a new harmonic candidate is later desired, add validated authored/UG chart evidence only for that bounded comparison. |
| P1 useful competing rhythm strategy is unproven | Engineering preview available; musical validation pending | Oops `[64,108]` has a bounded source-linked reduction capture; the evidence records attack counts and the unchanged `479/479` attack-location limitation without calling it musical success. Source-only temporal simplification does not require new harmonic pitches. | Complete `2026-09-18-blackbird-14-26.5-phrase-review-worksheet.md`: label only the phrase's source IDs, listen to Original vs Automatic, and decide `accept-source-reduction`, `retain-source-reduction-partial`, or `reject-and-review`. |
| P1 support has no available-hand allocator | Fixed and structurally tested | Task 1 tests cover source-hand preservation/available-hand allocation, crossing protection, support velocity, and allocator-only fallback provenance. This is not global voice-leading, fingering, pedal, or human-playability proof. | Keep the structural guard and run the required tempo/pedal/hand-comfort musical gate on the bounded phrase. |
| P1 melody identity is inferred and correction was not phrase-actionable | Workflow fixed; semantic proof pending | Task 3 phrase-local source/rest choices, stale/overlap review, fingerprint validation, reset, and browser persistence are tested. Automatic melody remains inferred; no source packet supplies semantic melody gold. | Use the exact Blackbird source-ID worksheet for one phrase; keep every unreviewed ID unresolved and feed only reviewed identity into any future harmony evidence. |
| P1 written-event checks are not human-playability acceptance | Required musical gate pending | Written sounding/span limits, held-note behavior, relative support velocity, and same-stream projections are tested. They do not establish fingering, pedal comfort, repeated-attack comfort, or beginner playability. | Listen now with normal sustain and record recognizability, backing usefulness, melody audibility, and hand comfort before using “playable” as an acceptance label. |
| P2 phrase status could be read as musical quality | Fixed and tested | Status copy is neutral (`changed`, `unchanged`, `need review`); source-preview copy discloses that temporal backing reduction is unavailable without reviewed identity. | Keep structural status separate from any future human-reviewed phrase result. |
| P2 role audition is not an isolated backing stem | Disclosed and tested | The UI explicitly says Accompaniment includes retained/unclassified source notes; durable captures verify non-empty role/wiring paths, not stem purity. | Add role-coverage counts or a true isolated stem only if required; do not relabel current audition. |
| P2 focused tests do not prove the real musical claim | Partially covered; musical gate remains open | Fresh producer, UI, typecheck/build, exact-fixture, Oops, and complete Blackbird capture checks cover engineering contracts and integrity. Human listening remains pending. | Run the bounded human rubric now; source-ID annotation is needed to promote a result to validated identity, not to begin diagnosis. |

## Task status

| Task | Status |
|---|---|
| Task 1 hand allocation/balance | Fixed and structurally tested; human playability unclaimed |
| Task 2 coherent phrase strategy | Partial; source-only preview available, musical decision pending |
| Task 3 phrase-local melody correction | Fixed and browser-tested; semantic melody truth unclaimed |
| Task 4 truthful status/evaluation coverage | Fixed and locally verified; listening pending |
| Task 5 verification/evidence/handoff | In progress until exact-head CI completes; local diff, push, PR update, and artifacts are done |

No merge, deploy, catalogue rebuild, live-data mutation, or production claim is
included in this ledger.
