# Keyspilli roadmap implementation — 2 October 2026

## Authorization and scope

User authorized “Fix all the issues” and explicitly selected “All implementable roadmap work” on 1–2 October. Binding brief source: `/Users/reidar/Projectos/Keyspilli/docs/proposals/2026-10-01-project-wide-improvement-portfolio.md`. All 66 active proposals remain in scope. PR-30 is excluded because its former issue is deleted; PR-63–78 are already implemented, with #185 owner trial outstanding.

Implement in isolated `codex/roadmap-implementation`, baseline `d9aff249900e053b4a9ee21cd40df6e1419541f3`; preserve primary `codex/organ` WIP. No source generation/catalog rewrite, external acquisition, production mutation or destructive purge without its actual existing contract/owner authorization. Preserve private mutation/edge boundaries, publication locks/journals, source/variant identity and owner UI decisions. No new framework or dependencies unless an actual need defeats current helpers/platform.

## Execution order

1. Preference validation, native shortcuts (79), deterministic grading (37), public read model/count (02), library pagination/favorites/URL/empty states (01/03).
2. Route/body policy (42), publication revision coherence (43), schema/config readiness (44/45), worker progress/shutdown (24), deploy-only retry (28), restored app proof (25).
3. Saved/versioned passages (05), local history (06), actionable diagnostics (07), tempo ladder (08), resume home (04), preference export/sets (12/13).
4. Input timestamps/calibration/velocity/pedal/device eligibility (09/10/11), audio graph/interruption/sample readiness (48/50/51), range/spelling/holds (52/53/54), source controllers and support hand (49/55).
5. Replay-safe intake/preflight (38/39), version-safe owner maintenance/reversible deletion (40/41), receipts/skills/source edits/exports/score navigation (16/19/18/17/21/14/15), job inbox (80).
6. Performance/memory/resource baselines (22/23/46), filesystem durability (47), independent symbolic tests (61), privacy-safe diagnostics (62), dependency and demand-driven boundaries (29/31), accessibility throughout (20).
7. Implement eligible opt-in take/fingering/rhythm/harmony/dynamics/recall/study workflows (33/34/56/57/58/59/60/81/83), then bounded offline/repeat/recording alignment/MIDI output (32/35/36/82).
8. Off-host replication (26): owner selected Google Drive and no additional heavy encryption. Reuse existing tools and their built-in encryption; verify the known account restriction before enabling. Destination configuration and bounded retention remain explicit operational gates.

## Verification and review focus

Trace each concrete flow and caller before editing; add the smallest behavior regression that fails against the baseline, implement at the shared boundary, run the relevant suite/typecheck and then broad integration checks at stable milestones. Keep each milestone commit reviewable; final fresh-context review and CI before proposed merge/deploy. Store large output in bounded worktree logs. Browser/app fixtures must use isolated data roots. No tests against production.

Focus: public-before-pagination ordering/visibility, malformed storage, stale request generations, native modifier/composition and held-key releases, grading order/repeated pitches/chords, revision/cancellation races, auth header precedence/body limits, source/key/pedal/dynamics identity, interruption/reconnect, malformed policies/diagnostics redaction and schema downgrade refusal.

## Rulings and environment

- Ruling: user has already reviewed the full proposal portfolio and approved implementation of all implementable work; execute without another plan/implementation permission loop.
- Ruling: runtime shell resolves Node 20 via Hermes symlink; use explicit `/Users/reidar/.nvm/versions/node/v22.22.3/bin` for all npm/tests. Do not mutate global runtime symlinks.
- Ruling: routed discovery still stale after sync and B.AI/Nebula return HTTP 405; block routed children, use one independently available native GPT-6 Luna helper. Account-wide in-flight usage cannot be proven, so no child fan-out.
- Pre-flight: public DB projection feeds API/library/home/artists; parent owns this boundary. Grader association is independent and delegated with disjoint grading-only files. Later history/diagnostics consume grading version, audio transitions and publication revisions; those dependencies stay explicit.

## Implementation ledger

Pending does not mean blocked; code completion, automated checks and human/device/ops acceptance are separate. Record evidence here; never close a proposal solely because a unit check passed.

| Proposal | Scope | State | Evidence / remaining gate |
| --- | --- | --- | --- |
| PR-01 | Paginate The Library Without Losing Favorites | Implemented; browser checked | Public favorite ID expansion and 601-selection bounded POST reviewed; 250-group isolated browser fixture: all pages, off-page favorite, reload/back; bounded 60-group pages. |
| PR-02 | Count The Same Filtered Public Rows That Are Listed | Implemented; checked | Real SQLite public-before-filter/group/count/page tests; home and artist aggregates use public rows. |
| PR-03 | Preserve Library State In The URL And Improve Empty States | Implemented; browser checked | Validated native URL state; loading/error/retry/reset and distinct empty states; malformed local lists covered. |
| PR-04 | Make Home A Resume-And-Practice Workspace | Partly implemented; browser checked | Home opens exact public last-practised variant and shows bounded recent activity; invalid/removed targets retained unavailable, deliberate resume in Player. Fresh catalog Add action present. Opt-in short authored starter remains tied to PR-39/83. |
| PR-05 | Save Named Passages And Practice Notes | Implemented; browser checked | Bounded validated local store; complete SHA-256 musical target binding, beat ranges, native bookmark UI and deliberate resume. Reload/select and stale/range unit checks pass; combined browser check passes. |
| PR-06 | Retain A Local Practice History With Explicit Context | Implemented; browser checked | 200-run cap, explicit source/context/result/count-in/completed/incomplete/cancelled/interrupted states; clear/download controls. Browser proves cancelled/completed reload; pagehide interruption verified in the browser. |
| PR-07 | Show Where Practice Went Wrong | Implemented; browser checked | Stable bounded target/raw-adjusted input diagnostics, saved twelve-event problem view, unchanged aggregate scores; flawed wait run reopens measured window without autoplay. |
| PR-08 | Add An Opt-In Tempo Ladder For A Saved Passage | Pending | — |
| PR-09 | Calibrate Input Timing Without Hiding Raw Results | Implemented; checks/review ongoing | Monotonic keyboard/MIDI timestamps, epoch guards, setup-bound ±250 ms nullable offsets and raw/adjusted diagnostics; delayed dispatch/seek/opposite-offset checks pass. Hardware protocol documented; no measured hardware latency. |
| PR-10 | Respect MIDI Velocity, Sustain And Device Selection | Implemented; checks/review ongoing | Device/channel filter, velocity and CC64 metadata, independent physical input sustain and sampled voice, unplug cleanup; focused mocks pass. Real keyboard/pedal acceptance outstanding. |
| PR-11 | Make Microphone Practice Eligibility Explicit | Implemented; synthetic checked | Monophonic passage guard including carry overlap; quiet/unresolved/pitch-present signal state and permission/device-loss interruption. Keyboard/MIDI remain available; detector/device quality unverified. |
| PR-12 | Back Up And Restore Owner Practice Preferences | Implemented; reviewed and checked | Strict 2 MiB versioned owner-state export/import, actual browser download/preview/merge, optional history, exact-source musical choice activation and hardware calibration reset. Per-song field merges, malformed sidecar replace cleanup and quota rollback regression pass. localStorage has no cross-tab atomic transaction; failed rollback requires visible recheck. |
| PR-13 | Organize Repertoire Into Owner Practice Sets | Pending | — |
| PR-14 | Export The Selected Chords And Transposed Arrangement | Pending | — |
| PR-15 | Navigate And Follow Playback In Sheet Music | Pending | — |
| PR-16 | Put Version-Bound Musical Review Receipts In An Owner Workspace | Pending | — |
| PR-17 | Preview Owner Harmony Corrections Before Publication | Pending | — |
| PR-18 | Show Difficulty Skills And Cross-Level Differences | Pending | — |
| PR-19 | Explain Import Transformations And Source Authority | Pending | — |
| PR-20 | Expand Accessibility Verification Across All Learning Views | Pending | — |
| PR-21 | Admit A Second Authored Chord Source Without Provider-Specific IDs | Pending | — |
| PR-22 | Establish Reproducible Product Performance Budgets | Pending | — |
| PR-23 | Bound Retained Sheet SVG Memory As Well As DOM | Pending | — |
| PR-24 | Make Worker Health And Graceful Shutdown Observable | Implemented; fixture checked | Service implementation and 124 isolated tests pass; bounded snapshot/checker, shutdown lease fences, Compose grace/health and ops fixtures integrated. Fresh foundation review completed; actual production-image shutdown acceptance pending. |
| PR-25 | Verify Restored Backups Through The Actual App | Implemented; fixture checked | Runtime db.sqlite, image/epoch metadata, opt-in isolated pinned web verifier, paired backup fixtures and HTTP verifier fixtures. No actual container/real backup restore proof yet. |
| PR-26 | Replicate Coherent Backups To An Owner-Selected Off-Host Target | Implemented; fixture checked, activation gated | Owner proposed Google Drive without extra client encryption. Immutable rclone paired transfer, streamed verify, marker-last and disabled independent service/ops status pass fixtures. Local backup succeeded; Nytt offsite still failed. Existing protected Drive remote needs configuration/proof; remote retention explicitly no deletion. No private transfer enabled. |
| PR-27 | Give Publication Recovery A Safe Owner Interface | Pending | — |
| PR-28 | Separate Deployment Retry From Catalog Rebuild | Implemented; fixture checked | Dispatch defaults deploy_only; target/all validation and full confirmation. No VPS dispatch executed. |
| PR-29 | Add Focused Dependency, Permissions And Security Maintenance | Implemented; local checks | Job-scoped package write; Dependabot and SECURITY.md; hashed isolated Python test closure, 35 Python checks pass. GitHub private vulnerability reporting enabled and read back true; Linux CI still required. |
| PR-31 | Narrow Player And Catalog Boundaries Where New Work Needs Them | Implemented; review ongoing | One input hook owns listeners/permissions/release cleanup. Explicit read-runtime and research exports; touched read consumers migrated, root/deep compatibility retained. No bundle improvement claim. |
| PR-32 | Download An Explicit Private Offline Practice Pack | Pending | — |
| PR-33 | Record A MIDI Practice Take And Replay It Against The Target | Pending | — |
| PR-34 | Add Reviewed Fingering And Transition Guidance | Pending | — |
| PR-35 | Introduce Bounded Repeat Playback For A Supported MusicXML Subset | Pending | — |
| PR-36 | Build A Rights-Cleared Recording-Aligned Practice Prototype | Pending | — |
| PR-37 | Make Late/Missed Grading Independent Of Frame/Input Ordering | Implemented; checked | 12 grading cases: frame/input order, repeated pitch, chords, delayed timestamps and wrong-note priority; native helper plus parent review. |
| PR-38 | Make Content-Addressed Upload Replays Non-Destructive | Pending | — |
| PR-39 | Preview Symbolic Parts And Arrangement Intent Before Publishing | Pending | — |
| PR-40 | Add Version-Checked Owner Catalog Maintenance | Pending | — |
| PR-41 | Offer Reversible Owner Deletion With Tombstones | Pending | — |
| PR-42 | Define And Enforce Per-Route Mutation And Body Contracts | Implemented; checked | Shared byte/deadline JSON reader across mutations; play counter now authenticated; auth/body/stream barriers pass. Production edge check pending. |
| PR-43 | Return One Publication Revision Across Detail, Sheet And Exports | Implemented; reviewed and checked | Whole publication ID/journal assembly guard plus legacy pair cache barrier; all detail/sheet/export/PDF paths forward exact pin. Browser checks same-revision MIDI and stale pin 409. Fresh review fixes title-row reassembly and legacy cached bytes/metadata race. |
| PR-44 | Version Catalog Schemas And Refuse Unsafe Downgrades | Implemented; checked | Atomic SQLite epoch 0→1; refuses newer schema before mutation; rollback/row-preservation tests. Restore image/epoch metadata pending PR-25. |
| PR-45 | Validate Runtime Configuration And Report Capability Readiness | Implemented; fixture checked | Catalog liveness/readiness, redacted startup validation, owned write-path checks, read-only binary/config preflight and finite worker parser implemented; missing/read-only/binary/config fixtures pass. Provider/model readiness stays unknown; production-image acceptance pending. |
| PR-46 | Isolate Media Processing With Measured CPU, Memory And PID Budgets | Pending | — |
| PR-47 | Specify And Test Publication Durability Beyond Process Failure | Pending | — |
| PR-48 | Add A Deterministic Audible-Graph Regression Oracle | Pending | — |
| PR-49 | Preserve Source MIDI Pedal Intent Separately From Key Holds | Pending | — |
| PR-50 | Make Audio Interruptions Pause Or Invalidate Practice Explicitly | Implemented; browser checked | Blur/visibility/pagehide/selected MIDI loss interrupt practice, cancel count-in and release capture/voices; actual AudioContext state notifications also interrupt wait mode; output-state rAF guard stops before time advances. Browser blur records interrupted history, no automatic resume. |
| PR-51 | Expose Sample Readiness And Switch Timbres Only At Safe Boundaries | Implemented; reviewed and checked | Visible uninitialized/loading/ready/failed, same-context two-retry bound, wait or declared fallback policy, initial load latency and external sample disclosure. Per-run timbre latch and selected-context observer regressions pass; calibration/history bind actual timbre. Ready replacement waits for Play/Practice/Preview boundary; no hardware/network latency claim. |
| PR-52 | Model Keyboard Range And Warn About Unreachable Targets | Pending | — |
| PR-53 | Use Source-Aware Pitch Spelling Across Learner Views | Pending | — |
| PR-54 | Show Holds, Carry-Over Notes And Rests In Letter And Lead Views | Pending | — |
| PR-55 | Separate Practised Hands From Audible Support | Pending | — |
| PR-56 | Add Opt-In Hold And Release Grading With Honest Input Eligibility | Pending | — |
| PR-57 | Distinguish Chord-Tone Discovery From Held Voicing And Transitions | Pending | — |
| PR-58 | Add A Rhythm-Only Passage Coach With Meter-Aware Cues | Pending | — |
| PR-59 | Teach Functional Harmony Without Promoting Inferred Analysis | Pending | — |
| PR-60 | Preserve Source Dynamics And Make Synthetic Accents Explicit | Pending | — |
| PR-61 | Add Bounded Differential And Metamorphic Symbolic Tests | Pending | — |
| PR-62 | Export A Privacy-Safe Diagnostic Bundle | Pending | — |
| PR-79 | Preserve Native Shortcuts And Composition In Piano Input | Implemented; checked | Native modifier/composition guard in shared keyboard input and player shortcuts; held keyup still releases. 12 input checks pass. |
| PR-80 | Reopen Recent Import Jobs From A Bounded Inbox | Implemented; unit checked | Latest 50 jobs, manual retry, stable reopen links, sanitized states and canonical artifact availability. Multi-job browser check passes: reopen/reload, another submission, missing/reconciliation states and list/status retry. |
| PR-81 | Offer An Opt-In Passage Recall Attempt With Fading Guidance | Pending | — |
| PR-82 | Play A Chosen Arrangement On An Explicit MIDI Output | Pending | — |
| PR-83 | Admit Short Authored Studies Without Weakening Song Gates | Pending | — |
