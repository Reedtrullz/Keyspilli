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
| #119 download dialog | Implemented locally | Native modal, Escape and keyboard traversal, focus return verified in synthetic Chromium scratch flow | Wider browser/device check pending |
| #133 recent songs | Implemented locally | Newest grouped sort precedes limit/offset; 201-song fixture keeps new unplayed entry while popularity stays separate | Live catalog readback pending |
| #119 upload/import boundaries | Implemented locally | 10 MiB pre-read guard, duplicate-submit lock, frozen metadata, unmount abort, busy/reconciliation messages; seven synthetic Chromium checks passed | Live worker and network interruption behavior unverified |
| #119 API/preferences | Implemented locally | Auth-first 400 for null/array/primitive/malformed JSON; saved string lists and per-song modes validated; typecheck and full suite passed | None for tested shapes |
| #119 tutorial progress | Implemented locally | Server/revisit copy, reconciliation/cancellation distinctions, dense async source formatted | Live tutorial service unverified |
| #114–#123 except #118/#120/#121/#122, #128–#136 except #128–#132/#134–#136, remaining #119 items | Pending | See implementation plan and audit reports in this checkout | Engineering fixes and independent checks |

Musical acceptance, live backup measurements, merge and deployment are separate owner gates. Tests and synthetic fixtures do not establish them.
