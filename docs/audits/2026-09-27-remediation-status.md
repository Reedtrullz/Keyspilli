# Keyspilli audit remediation status

Implementation branch: `codex/audit-remediation`, based on audited `origin/main` `cd4e42822dd48963d982c270e4f0b93594ac7993`. The primary `codex/organ` checkout and its work in progress are untouched.

| Scope | State | Evidence | Remaining acceptance |
| --- | --- | --- | --- |
| #119 runtime pin | Implemented | `.nvmrc` and root engine range; Node v22.22.3; baseline typecheck and 2,236 tests passed | None for runtime setup |
| #124 MXL workload | Implemented locally | Matched EOCD counts and central directory; bounded actual extraction via Node zlib; 28 ingest tests passed | Broader adversarial archive review in Task 12 |
| #125–#126 MusicXML semantics | Implemented locally | Comments excluded, malformed XML rejected, unsupported repeats/endings/navigation rejected; MIDI suite 428 tests passed | Additional MusicXML constructs remain unverified |
| #127 MIDI format | Implemented locally | Format 2/unknown and multi-track format 0 rejected; valid format 0/1 tests passed | None for this format boundary |
| #113 prepared backing | Implemented locally | Metadata title edit retained exact bytes and loader selection; unchanged-source re-ingest repinned under lock; changed source/content blocked with `SOURCE_REVIEW_REQUIRED`; concurrent and rollback fixtures passed | Independent musical review remains required for changed content |
| #120 publication cancellation | Implemented locally | Job link and six rows commit in one DB transaction under artifact lock; cancellation before/after fence and journal replay fixtures passed; queued-only deletion | Live worker concurrency remains unverified |
| #132 retry states | Implemented locally | SQL retry transition excludes active, complete, review and reconciliation states; route tests passed | None for tested states |
| #136 handoff confirmation | Implemented locally | Atomic read/affirm transition preserves accepted upload hash and binding across delayed and duplicate confirmation | None for tested states |
| #118 source-search timeout | Implemented locally | 100 ms stalled-header and stalled-body fixtures both abort/retry; normal provider tests pass | Live provider behavior unverified |
| #134 PDF export isolation | Implemented locally | Two-export abort and timeout fixtures retain shared Chromium; late page closes; pre-launch abort tested | Production Chromium not exercised |
| #135 notation cache identity | Implemented locally | Worker protocol A→oversized B→A and failed B replay confirm cached/uncached A pages | Real WASM workload beyond browser warm-up check unverified |
| #119 notation deadline | Implemented locally | Worker timeout settles all pending requests and invalidates old sessions; Playwright warm-up rejection reaches error state without page error | Full cross-browser check pending |
| #121 sampler chord fallback | Implemented locally | Chord-only pending sample fixture attacks through one initialized oscillator fallback with current gains/pedal | Independent listening needed |
| #122 hand gain routing | Implemented locally | Separate sampled RH/LH output buses survive live gain changes; synth/organ routing fixtures pass | Independent listening needed |
| #128 microphone feedback | Implemented locally | Finite feedback event, no held voice after final accepted note; pitch-edge/silence tests pass | Microphone hardware check pending |
| #129 sampled clicks | Implemented locally | Scheduled click tracked and stopped/disconnected by cancelAll | Audible pause/seek check pending |
| #130 oscillator input | Implemented locally | Held input avoids scheduled cutoff; all oscillators stop on noteOff/cancelAll/dispose; repeated pitch fixture passes | Keyboard hardware check pending |
| #131 sampler pedal fallback | Implemented locally | Fallback creation copies current sustain state | Independent listening needed |
| #115–#116 scheduling intervals | Implemented locally | Seeked chord tails, loop and song endpoint clipping, overshoot and rest cases; engine/organ suites passed | Real playback and listening needed |
| #123 short chord preview | Implemented locally | 0.125-second chord retained in engine preview; accompaniment preview shares the engine plan; organ honors the supplied span | Browser preview listening needed |
| #114–#117 transpose parity | Implemented locally | C/E at +2 renders D/F# in strip and text views; raw chord stays C/E; bounds and out-of-MIDI-range audio guarded; original-key notices clear at zero | Real sampled playback and visual review needed |
| #119 download dialog | Implemented locally | Native modal, Escape and keyboard traversal, focus return verified in synthetic Chromium and mobile WebKit scratch flows | Wider device check pending |
| #133 recent songs | Implemented locally | Newest grouped sort precedes limit/offset; 201-song fixture keeps new unplayed entry while popularity stays separate | Live catalog readback pending |
| #119 upload/import boundaries | Implemented locally | 10 MiB pre-read guard, duplicate-submit lock, frozen metadata, unmount abort, busy/reconciliation messages; synthetic Chromium checks passed | Live worker and network interruption behavior unverified |
| #119 API/preferences | Implemented locally | Auth-first 400 for null/array/primitive/malformed JSON; saved string lists and per-song modes validated; typecheck and full suite passed | None for tested shapes |
| #119 tutorial progress | Implemented locally | Server/revisit copy, reconciliation/cancellation distinctions, dense async source formatted | Live tutorial service unverified |
| #119 full-output golden gate | Implemented locally | Optional accepted playback hash and separate strict gate; generated-note mutation changes the full digest; no pins added | Current private artifact snapshot differs from accepted input hashes, so candidate replay and owner listening remain pending |
| #119 portable browser fixtures | Implemented locally | Private source roots require explicit environment variables; nine Chromium and one mobile WebKit synthetic checks pass without private files, including multi-page score navigation | Private musical corpus remains opt-in |
| #119 retention policy | Policy documented; operational acceptance pending | `docs/ops.md` classifies live data, review evidence and backup rotation; 9.45 MB synthetic archive/hash/retention probe; backup and ops fixtures pass | Live backup duration/freshness, actual rotation and host capacity remain unverified; no live-data deletion enabled |

## Issue accounting

The 23 reproduced defects have local fixes and focused regressions. “Fixed” here means the engineering gate passes in this checkout; the limitations below remain separate.

| Issue | Local result | Outstanding evidence |
| --- | --- | --- |
| #113 | Prepared backing survives metadata and compatible re-ingest | Musical review for changed sources |
| #114 | Visible chords transpose with playback | Listening and visual review |
| #115 | Chord seek plays only the remaining tail | Listening |
| #116 | Notes, chords and clicks clip at loop ends | Playback review |
| #117 | Static score and downloads disclose original key | Visual review |
| #118 | Source-search deadline covers response bodies | Live provider behavior |
| #120 | Cancellation and publication share the commit fence | Live worker concurrency |
| #121 | Pending sampler uses initialized chord fallback | Listening |
| #122 | Sampler RH/LH gains route separately | Listening |
| #123 | Short chord previews retain positive spans | Listening |
| #124 | MXL extraction follows bounded validated entries | Broader archive corpus |
| #125 | MusicXML comments cannot become notes | Broader notation corpus |
| #126 | Unsupported repeats/navigation reject before publication | Other unverified constructs |
| #127 | MIDI format 2/unknown reject | None for tested formats |
| #128 | Mic feedback is finite and grading-safe | Hardware check |
| #129 | Sampled clicks cancel/disconnect | Audible check |
| #130 | Oscillator input holds until release | Keyboard check |
| #131 | Sampler fallback inherits pedal state | Listening |
| #132 | Retry only moves eligible terminal errors | Live worker concurrency |
| #133 | Grouped newest sort precedes limit | Live catalog readback |
| #134 | Export abort isolates shared browser pages | Production Chromium behavior |
| #135 | Shared notation toolkit cache tracks score identity | Real WASM corpus |
| #136 | Handoff confirmation cannot erase accepted upload binding | Live race behavior |

The ten #119 checklist items are tracked individually:

| Item | Local result | Remaining |
| --- | --- | --- |
| Full-output golden pin | Optional pin and strict playback gate implemented; legacy gate preserved | All 12 full-output pins require input replay and independent listening; current local artifact hashes differ from accepted corpus |
| Portable musical browser checks | Synthetic Chromium and mobile WebKit checks pass; private fixture roots are opt-in | Private musical corpus remains opt-in |
| Notation request deadline | 30-second worker deadline, disposal and retry tests pass | Real WASM stall behavior |
| Upload recovery/state | Size, busy, duplicate, abort and reconciliation flows tested | Live network/worker interruption |
| Node runtime | `.nvmrc` pins 22.22.3 | None locally |
| Download dialog | Native modal, Escape, focus and traversal tested | Broader device review |
| Progress copy | Server/revisit and cancellation/reconciliation copy updated | Live service review |
| Async formatting | Tutorial import code formatted without new state machine | None |
| Transpose controls | Shared ±24 bound, persistence and range tests pass | Listening at extremes |
| Retention | Data classes and dry-run policy documented; synthetic cost measured | Host backup freshness/duration, actual rotation and capacity |

The eight additional risk areas from the complex review are accounted for:

| Area | Result | Limit |
| --- | --- | --- |
| Notation warm-up errors | Rejection enters existing error state | Real browser faults beyond injection unverified |
| Worker reconciliation | Structured recovery code remains terminal and replayable | Live recovery drill unverified |
| Persisted preference shape | Lists and mode enum validated | Other persisted schemas outside scope |
| JSON object boundaries | Auth-first object guards and 400 route tests | Live proxy path unverified |
| Shared audio lifecycle | Cross-engine ownership regressions added | Listening/hardware review |
| Code concentration | Fixes localized; no size-only rewrite | Further splitting requires a concrete boundary |
| Import feature coverage | Known unsupported song forms reject; semantics documented | Ornaments, dynamics, transposing instruments and pedal notation unverified |
| Retained media/backups | Preservation policy and synthetic timing recorded | Live size, duration, freshness and deletion policy pending |

Final synthetic gates: Node 22.22.3 typecheck passed; 2,284 tests passed across six workspaces; production web build passed; nine Chromium and one mobile WebKit browser cases passed; one-song synthetic catalog verification passed; backup and ops fixtures passed. The replacement-job regression found during final review is covered in `packages/catalog/test/reconcile.test.ts`. The ordinary catalog pipeline cannot rebuild the full catalog in this isolated checkout because 147 private seed files are absent. Musical acceptance, live backup measurements, merge and deployment are separate owner gates. Tests and synthetic fixtures do not establish them.
