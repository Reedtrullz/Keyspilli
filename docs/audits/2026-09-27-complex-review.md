# Keyspilli — complex code and lifecycle audit

27 September 2026. Follow-up to the [project-wide review](/Users/reidar/Projectos/Keyspilli/docs/audits/2026-09-27-project-review.md).

## Result and scope

Thirteen additional defects have focused reproductions and GitHub issues: one P1, eleven P2, and one P3. Fourteen probes across eight files demonstrate their triggers. Together with the earlier reviews, this produces 23 defect issues and one ten-item polish backlog (#113–#136 inclusive).

The most consequential new finding is an MXL archive-validation bypass: the validator and decompressor interpret different entry counts. Other findings concern silent changes to imported music, held-note ownership, worker/job races, shared browser cancellation, notation cache identity, and lost upload bindings.

Audited current main `cd4e42822dd48963d982c270e4f0b93594ac7993` in `/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli`. The remote main SHA was rechecked at closeout. The original `/Users/reidar/Projectos/Keyspilli` checkout remains older and contains pre-existing WIP; it was not used as current-main evidence or reset. No application code was changed.

This is a broad source audit with targeted runtime reproductions, not a claim to have exhausted every possible bug or validated every production song. Prior passing tests do not cover these interleavings and malformed-input cases.

## New issue index

| Finding | Priority | Issue |
| --- | --- | --- |
| F11 | P1 | [#124 — MXL archive guard and decompressor disagree on entry counts](https://github.com/Reedtrullz/Keyspilli/issues/124) |
| F12 | P2 | [#125 — MusicXML imports silently omit repeated sections](https://github.com/Reedtrullz/Keyspilli/issues/125) |
| F13 | P2 | [#126 — MusicXML comments are parsed as active musical content](https://github.com/Reedtrullz/Keyspilli/issues/126) |
| F14 | P2 | [#127 — MIDI format 2 is silently flattened into synchronous playback](https://github.com/Reedtrullz/Keyspilli/issues/127) |
| F15 | P2 | [#128 — Microphone practice feedback starts held notes without releasing them](https://github.com/Reedtrullz/Keyspilli/issues/128) |
| F16 | P2 | [#129 — Sampled metronome clicks survive pause and cancellation](https://github.com/Reedtrullz/Keyspilli/issues/129) |
| F17 | P2 | [#130 — Oscillator input notes cut off while the key is still held](https://github.com/Reedtrullz/Keyspilli/issues/130) |
| F18 | P3 | [#131 — Sampler fallback ignores sustain-off until another setting change](https://github.com/Reedtrullz/Keyspilli/issues/131) |
| F19 | P2 | [#132 — Retry endpoint requeues jobs that are already processing](https://github.com/Reedtrullz/Keyspilli/issues/132) |
| F20 | P2 | [#133 — Recently added excludes new songs outside the top 200 by popularity](https://github.com/Reedtrullz/Keyspilli/issues/133) |
| F21 | P2 | [#134 — Cancelling one PDF export can abort another export](https://github.com/Reedtrullz/Keyspilli/issues/134) |
| F22 | P2 | [#135 — Notation cache can mix pages from different scores](https://github.com/Reedtrullz/Keyspilli/issues/135) |
| F23 | P2 | [#136 — Delayed handoff confirmation can erase an accepted upload binding](https://github.com/Reedtrullz/Keyspilli/issues/136) |

## Detailed findings

### F11 · P1 · MXL archive guard and decompressor disagree on entry counts

[GitHub #124](https://github.com/Reedtrullz/Keyspilli/issues/124).

The pre-inflate guard reads EOCD totalEntries at +10, while the installed fflate unzipSync reads entries-on-this-disk at +8. The guard neither requires these fields to agree nor rejects spanning/ZIP64 structures consistently with the decoder. A malformed archive can pass both entry-count and aggregate-size limits while the decoder consumes additional entries.

**Reproduction:** A genuine 201-entry MXL is rejected; changing only the count used by the guard to zero makes the same archive publish six variants. A second probe declares a 65 MiB entry: the ordinary header is rejected at 64 MiB, but the inconsistent header reaches a mocked unzipSync boundary. The mock stops before allocation. No large decompression or process crash was attempted.

**Correction:** Make validation and extraction use the same interpretation. Reject multi-disk/inconsistent counts and unsupported ZIP64 locators, validate the full central directory, and enforce entry/size limits at the extraction boundary. Retain bounded regression probes for both counts and sizes.

**Limits:** The validation bypass is reproduced. Out-of-memory denial of service is the source-supported consequence of unbounded decoder allocation, not a live exploitation result. The deployed private edge still restricts who may upload.

Source locations:

- [packages/catalog/src/ingest.ts:191](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/catalog/src/ingest.ts#L191)
- [packages/catalog/src/ingest.ts:224](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/catalog/src/ingest.ts#L224)

Probe: [catalog.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/catalog.test.ts); [mxl-budget.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/mxl-budget.test.ts).

### F12 · P2 · MusicXML imports silently omit repeated sections

[GitHub #125](https://github.com/Reedtrullz/Keyspilli/issues/125).

The parser visits each written measure once and ignores repeat/ending playback directives. Accepted scores are regenerated without that structure, changing song form and duration without warning.

**Reproduction:** A two-measure, eight-quarter-note score with forward/backward repeat times=2 returns eight notes and eight beats instead of the repeated sixteen. The workload validator accepts it.

**Correction:** Until repeat and ending expansion is supported, explicitly reject unsupported playback-form directives with an actionable message. Do not silently publish a shortened source. Cover simple repeats and alternate endings.

**Limits:** Synthetic parser reproduction; no production song's repeat fidelity was asserted.

Source locations:

- [packages/midi/src/parseXml.ts:102](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/midi/src/parseXml.ts#L102)

Probe: [parser.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/parser.test.ts).

Playback semantics reference: [primary documentation](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/).

### F13 · P2 · MusicXML comments are parsed as active musical content

[GitHub #126](https://github.com/Reedtrullz/Keyspilli/issues/126).

Regex extraction scans raw XML, including comments. Commented-out notes, measures or tempo metadata can change playback or reject an otherwise valid score.

**Reproduction:** A measure containing four real quarter notes and one commented-out quarter note produces five notes and five beats.

**Correction:** Parse XML structure or safely exclude non-content nodes before all musical extraction. Keep external-entity resolution disabled. Test commented notes, measures and tempo declarations, not only the note regex.

**Limits:** Synthetic parser reproduction; no XML external-entity vulnerability is claimed.

Source locations:

- [packages/midi/src/parseXml.ts:101](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/midi/src/parseXml.ts#L101)
- [packages/midi/src/parseXml.ts:109](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/midi/src/parseXml.ts#L109)

Probe: [parser.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/parser.test.ts).

### F14 · P2 · MIDI format 2 is silently flattened into synchronous playback

[GitHub #127](https://github.com/Reedtrullz/Keyspilli/issues/127).

The parser reads the format field but does not enforce supported formats. Format-2 tracks are independent patterns; the code merges their events and tempo maps into one simultaneous song.

**Reproduction:** A two-pattern format-2 fixture passes parsing and assertSourceWorkload and yields two attacks at beat zero in a single merged timeline.

**Correction:** Reject format 2 and unknown format values at the shared parser boundary until explicit pattern selection is implemented. Validate format-0 track-count constraints as well.

**Limits:** Parser/workload reproduction, not a production import. Mido's official documentation confirms format-2 asynchronous semantics.

Source locations:

- [packages/midi/src/parse.ts:48](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/midi/src/parse.ts#L48)
- [packages/midi/src/parse.ts:198](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/midi/src/parse.ts#L198)

Probe: [parser.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/parser.test.ts).

Playback semantics reference: [primary documentation](https://mido.readthedocs.io/en/stable/files/midi.html#file-types).

### F15 · P2 · Microphone practice feedback starts held notes without releasing them

[GitHub #128](https://github.com/Reedtrullz/Keyspilli/issues/128).

handleMicNote marks each brief feedback note fromInput=true. Sampled and organ engines interpret that as a held physical key and discard durSec. The microphone path never sends noteOff when pitch changes or becomes silent. Organ voices can accumulate until global cancellation. A final accepted input may be started after finishGrading has already cancelled audio.

**Reproduction:** Calling the real handleMicNote with a ready mocked sampler schedules duration=undefined and stopId=input:60, with no stop call. Source tracing confirms microphone silence only clears lastMidi and that the organ also uses an unbounded input voice.

**Correction:** Give microphone feedback an explicit finite lifetime or pair it with reliable release events on silence, pitch change and grading completion. Preserve physical-key input ownership and ensure final completion does not leave a new voice running.

**Limits:** Real engine-to-sampler scheduling with mocked audio. Organ impact is source-traced; no microphone/speaker listening test was performed.

Source locations:

- [packages/player-core/src/engine.ts:301](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/engine.ts#L301)
- [packages/player-core/src/sampler-audio.ts:138](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/sampler-audio.ts#L138)
- [packages/player-core/src/organ-audio.ts:358](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/organ-audio.ts#L358)
- [apps/web/src/components/player/Player.tsx:1185](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/components/player/Player.tsx#L1185)

Probe: [audio.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/audio.test.ts).

### F16 · P2 · Sampled metronome clicks survive pause and cancellation

[GitHub #129](https://github.com/Reedtrullz/Keyspilli/issues/129).

SamplerAudioEngine creates metronome oscillators without tracking them. cancelAll stops sampled notes and oscillator fallback only, leaving lookahead clicks scheduled across pause, seek, loop wrap and metronome-off changes.

**Reproduction:** After metronomeClick(0, 0.1), cancelAll leaves the oscillator's only stop at 0.16 seconds. Synth and organ cancellation paths track clicks.

**Correction:** Use the existing tracked-click lifecycle pattern so cancelAll also stops future sampled-engine clicks and disconnects their nodes.

**Limits:** Mocked Web Audio scheduling; audible post-pause clicks were not recorded.

Source locations:

- [packages/player-core/src/sampler-audio.ts:156](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/sampler-audio.ts#L156)
- [packages/player-core/src/sampler-audio.ts:188](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/sampler-audio.ts#L188)

Probe: [audio.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/audio.test.ts).

### F17 · P2 · Oscillator input notes cut off while the key is still held

[GitHub #130](https://github.com/Reedtrullz/Keyspilli/issues/130).

The oscillator engine schedules a fixed stop for every note, including physical keyboard/MIDI input. fromInput only controls note-off filtering. The engine's input durSec=0.4 therefore cuts held notes off after about half a second, unlike the held-input behavior of sampled piano and organ.

**Reproduction:** With fromInput=true and no noteOff, all three oscillators receive stop calls before 0.6 seconds.

**Correction:** Separate held input lifetime from scheduled-note duration using the existing fromInput flag. Release held voices on noteOff/all-notes-off/dispose while preserving bounded scheduled notes.

**Limits:** Mocked oscillator scheduling. Preserve deliberate instrument envelope character; the defect concerns forced termination before physical release.

Source locations:

- [packages/player-core/src/engine.ts:289](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/engine.ts#L289)
- [packages/player-core/src/audio.ts:173](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/audio.ts#L173)

Probe: [audio.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/audio.test.ts).

### F18 · P3 · Sampler fallback ignores sustain-off until another setting change

[GitHub #131](https://github.com/Reedtrullz/Keyspilli/issues/131).

When sustain is disabled before the first fallback note, the sampler stores false but creates AudioEngine later without copying it. The new fallback retains its default sustain=true. Only subsequent setter calls synchronize it.

**Reproduction:** Set sampler.sustainPedal=false while samples remain pending, then noteOn: the fallback observes sustainPedal=true.

**Correction:** Copy the current pedal value whenever fallback is initialized, alongside existing gain synchronization. Share initialization with the chord-only fallback fix in #121.

**Limits:** Mocked pending sampler and inspected fallback property.

Source locations:

- [packages/player-core/src/sampler-audio.ts:41](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/sampler-audio.ts#L41)
- [packages/player-core/src/sampler-audio.ts:142](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/player-core/src/sampler-audio.ts#L142)

Probe: [audio.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/audio.test.ts).

### F19 · P2 · Retry endpoint requeues jobs that are already processing

[GitHub #132](https://github.com/Reedtrullz/Keyspilli/issues/132).

Retry unconditionally updates any existing job to queued. This revokes an active worker's logical ownership and permits another worker to claim the same job while the first is still running. Work uses a shared job directory. Publication lease checks limit stale commits but do not make concurrent processing safe.

**Reproduction:** Claim a queued job, invoke the real authenticated retry route, then claim again: retry returns 200 and a second distinct lease is issued while the first worker has not stopped.

**Correction:** Allow retries only from explicitly retryable terminal states and return 409 for active/completed jobs. Perform the state transition atomically and clear stale lease fields consistently. If active restart is desired, make cancellation and restart separate coordinated operations.

**Limits:** Real route and SQLite state transition; no competing external media subprocesses were launched.

Source locations:

- [apps/web/src/app/api/youtube/jobs/[id]/retry/route.ts:29](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/app/api/youtube/jobs/[id]/retry/route.ts#L29)
- [services/transcribe/src/worker.ts:211](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/services/transcribe/src/worker.ts#L211)

Probe: [jobs-and-listing.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/jobs-and-listing.test.ts).

### F20 · P2 · Recently added excludes new songs outside the top 200 by popularity

[GitHub #133](https://github.com/Reedtrullz/Keyspilli/issues/133).

The home page requests 200 grouped songs using the default popularity sort, then sorts that truncated set by creation time. New zero-play songs disappear from Recently added once enough older songs rank ahead of them.

**Reproduction:** An isolated 201-song catalog with 200 older played songs and one newest unplayed song omits the newest song from the exact home-page selection expression.

**Correction:** Add/reuse a newest-first catalog sort and apply it before pagination. Fetch the required twelve groups directly.

**Limits:** Real grouped catalog query; no browser screenshot required for the deterministic selection defect.

Source locations:

- [apps/web/src/app/page.tsx:9](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/app/page.tsx#L9)
- [packages/catalog/src/db.ts:449](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/catalog/src/db.ts#L449)

Probe: [jobs-and-listing.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/jobs-and-listing.test.ts).

### F21 · P2 · Cancelling one PDF export can abort another export

[GitHub #134](https://github.com/Reedtrullz/Keyspilli/issues/134).

PDF requests share browserPromise. If a request is cancelled after obtaining the browser but before newPage resolves, its cancellation handler closes that shared browser, destroying unrelated export pages.

**Reproduction:** With two real route invocations and mocked Chromium, export A is navigating and export B is waiting for newPage. Aborting B closes the browser; both requests return 503.

**Correction:** Cancellation should own only its request's page/context. Close a late-created page when it resolves; coordinate browser disposal only for a shared-browser failure, not one request's abort.

**Limits:** Deterministic route concurrency with fake Chromium, not a live browser hang or PDF render.

Source locations:

- [apps/web/src/app/api/song/[id]/export/route.ts:145](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/app/api/song/[id]/export/route.ts#L145)
- [apps/web/src/app/api/song/[id]/export/route.ts:164](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/app/api/song/[id]/export/route.ts#L164)

Probe: [pdf.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/pdf.test.ts).

### F22 · P2 · Notation cache can mix pages from different scores

[GitHub #135](https://github.com/Reedtrullz/Keyspilli/issues/135).

All sessions mutate one Verovio toolkit. Preparing a score above the 4 MiB cache threshold returns before evicting the previous score's cache entry, which still references that toolkit. Reopening the old score skips loading it and combines cached old SVG pages with uncached pages rendered from the newer score.

**Reproduction:** Execute the real worker protocol with an injected fake toolkit: prepare A and cache page 1; prepare oversized B; reopen A. Page 1 contains A, while uncached page 2 contains B.

**Correction:** Invalidate prepared cache entries before mutating their shared toolkit, including uncacheable and failed loads, or ensure a cache hit's toolkit still owns the exact score. Test A -> oversized B -> A with both cached and uncached pages.

**Limits:** Real worker source/protocol with injected toolkit. No actual WASM layout or browser visual test.

Source locations:

- [apps/web/public/verovio/render-worker.mjs:48](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/public/verovio/render-worker.mjs#L48)
- [apps/web/public/verovio/render-worker.mjs:154](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/public/verovio/render-worker.mjs#L154)

Probe: [notation-worker.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/notation-worker.test.ts).

### F23 · P2 · Delayed handoff confirmation can erase an accepted upload binding

[GitHub #136](https://github.com/Reedtrullz/Keyspilli/issues/136).

The confirmation route reads the handoff before awaiting the body. Another request can affirm and bind an upload in that interval. The delayed request then affirms its stale snapshot, and unconditional UPSERT replaces the terminal accepted record with AWAITING_USER_FILE and erases uploadedSourceSha256/intake binding.

**Reproduction:** Pause the real confirmation route at req.json(), persist a bound GENERATION_ACCEPTED handoff using the real lifecycle functions, then resume confirmation. It returns 200 and the stored state moves backward with the uploaded hash removed.

**Correction:** Read and validate current state after body parsing, and use an atomic compare-and-set/transaction for state changes. Preserve terminal upload bindings; stale confirmations must not overwrite them.

**Limits:** Real route, validation functions and SQLite; the competing upload's completed state was constructed through its real lifecycle functions, without running another full ingestion.

Source locations:

- [apps/web/src/app/api/source-handoffs/[id]/confirm/route.ts:17](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/apps/web/src/app/api/source-handoffs/[id]/confirm/route.ts#L17)
- [packages/catalog/src/source-candidate-handoff.ts:385](https://github.com/Reedtrullz/Keyspilli/blob/cd4e42822dd48963d982c270e4f0b93594ac7993/packages/catalog/src/source-candidate-handoff.ts#L385)

Probe: [handoff.test.ts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/handoff.test.ts).

## Additional source-observed risks and improvement candidates

These have not been promoted to reproduced-defect issues in this pass. Their evidence and missing verification are explicit.

| Area | Observation and implication | Smallest useful next check/change |
| --- | --- | --- |
| Notation warm-up errors | `SheetMusicView.tsx:192` starts `void Promise.all(...)` after marking the sheet ready, without a rejection handler. The scroll-loading branch at 251 catches its equivalent failure. A warm-up rejection can escape the existing outer try/catch. | Inject a page-2 render rejection; route it through the existing sheet error handling. Browser fault injection remains unperformed. |
| Worker reconciliation | `worker.ts:261`, `300`, and `541` reduce ingestion errors to a generic `Error`; the catch retries unless the message begins with `SOURCE_REVIEW_REQUIRED:` or is a bot challenge. `ingestSource` also returns a structured `ARTIFACT_RECONCILIATION_REQUIRED` code. Recovery-needed status can lose its classification. | Run a publication-recovery fixture through the worker, preserve the structured classification, and stop futile automatic retries. Existing artifact journals still protect publication; this is not a demonstrated data-loss finding. |
| Persisted preference shape | `prefs.ts:125` trusts generic parsed JSON. Player loads favorites/learned arrays and later calls `.includes`; `loadSongPrefs` accepts any string as mode, which Player casts to `ViewMode`. Syntactically valid but wrong-shaped storage can break controls. | Validate expected array/enum shapes at existing read boundaries; test corrupt and legacy localStorage in the browser. Avoid a new preference framework. |
| JSON object boundaries | YouTube POST at `api/youtube/route.ts:61` and metadata PATCH at `api/songs/[id]/route.ts:46` cast parsed JSON to a record, then access properties. JSON `null` is valid JSON and bypasses the parse-error fallback. | Add an object/non-array guard and return 400. Source-observed; this pass did not invoke these routes with null. |
| Shared lifecycle consistency | Sampled, oscillator and organ engines implement similar input, sustain, metronome and cancellation contracts with divergent outcomes. Four new audio findings plus earlier sampler findings show a cross-engine coverage gap. | Reuse a small behavioral contract table across the existing audio tests; fix the shared ownership rules before extracting abstractions. Real listening remains necessary. |
| Code concentration | `simplify.ts` is 3,445 lines, `accompaniment.ts` 2,414, and `Player.tsx` 2,718 at the reviewed SHA. Musical transforms, UI state and async resource ownership are difficult to inspect together. | Separate a boundary only when its concrete bug fix needs it; prioritize explicit source/voice/session ownership and portable regression fixtures over a broad rewrite. File size alone is not a defect. |
| Import feature coverage | Supporting an extension does not guarantee supporting every construct in that format. Repeats and format-2 MIDI are reproduced examples; additional notation constructs need an explicit supported/unsupported inventory. | Document supported playback semantics and reject unsupported song-form constructs before publication. Do not claim ornaments, dynamics, transposing-instrument notation or pedal interpretation are verified. |
| Retained tutorial media and backups | Tutorial cache retention and backup duration grow with media volume. Source inspection alone cannot establish current free space, backup freshness or user-visible pause length on the host. | Reuse the preservation-aware retention item in #119; measure exact referenced files and a backup window before setting a retention policy. No live host checks were run. |

The current deployment is intentionally private and single-user. Potential multi-user isolation or quota designs are not automatically defects in that contract. Existing private-edge owner authentication remains required.

## Coverage and rejected hypotheses

| Surface | Inspected or exercised | Boundary |
| --- | --- | --- |
| MIDI/MusicXML/MXL | Parsers, workload limits, archive guard, shared ingestion; synthetic parser and genuine small-archive probes | No large decompression, process exhaustion, or corpus-wide semantic certification |
| Catalog publication | Ingest ownership, artifact locks/journals, metadata snapshots, grouped listing | Isolated catalogs only; no production mutations |
| Worker/jobs | Claims, leases, retry, cancellation, publication and reconciliation classification | Real SQLite/route transitions; no competing yt-dlp or transcription subprocesses |
| Player/audio | Microphone/keyboard input, sample fallback, sustain, metronome, cancellation; prior turn covered loops/seeking/preview and hand routing | Mocked Web Audio/instrument scheduling; no listening or MIDI hardware test |
| Source handoff | Confirmation, state persistence, upload binding and stale requests | Real route/lifecycle/database with controlled competing state |
| Notation/PDF | Worker cache identity and shared export browser cancellation | Real protocol/route code, injected toolkit/Chromium; no WASM layout or visual browser validation |
| Request/security boundaries | Mutation auth, private proxy contract, request body handling, tutorial resolver/cache/process limits | Source inspection and existing fixtures; not a live penetration test |
| Operations/CI | Backup/restore scripts, deployment/CI configuration, source/runtime relationship | Prior fixture results available; no live backup/restore/deploy or container/Python advisory scan |

Checks that did **not** justify additional issues:

- The suspected metadata stale-source overwrite is guarded by source-fingerprint comparison under the base writer lock. That does not resolve the separately reproduced backing-deletion issue #113.
- MIDI workload guards already bound tempo events, notes-times-tempo work, measure/grid and pair work, with validation around tempo integration. An unbounded-work claim from file size alone would be incorrect.
- Tutorial process groups have bounded deadlines/cancellation and cache access is confined and hashed. No path traversal was established.
- Orphaned worker-job recovery runs during polling; it is not restricted to process startup.
- The deployed Caddy template enforces the private authentication boundary and normalizes forwarded identity/IP headers. A same-origin check by itself was not treated as owner authorization.
- Backup/restore code checks archive paths/file types, hashes and SQLite integrity. This says nothing about today's host backup success.
- MusicXML octave-shift markup does not, by itself, mean the parser must transpose the encoded pitches: encoded pitches already represent sounding pitch. This hypothesis was rejected after checking [MusicXML's element definition](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/octave-shift/).

## Reproduction and verification

New probes are in [the complex-audit artifact directory](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex). They are ignored local audit artifacts, not committed application tests. They deliberately assert current broken behavior; a fix must replace those expectations with regression assertions for correct behavior.

From the reviewed checkout:

```sh
export PATH=/Users/reidar/.hermes/node/bin:$PATH
node node_modules/vitest/vitest.mjs run --config output/project-review-2026-09-27/complex/vitest.config.mts
```

- Latest result: **14 probes passed across 8 files**, 3.46 seconds, Node 22.22.3. [Raw result](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/results.log).
- Parser: three cases; MXL count and size boundaries: two; audio: four; job/listing: two; PDF, notation worker and handoff: one each.
- Synthetic catalog handles were closed and temporary fixture catalogs removed. Audio/browser/notation substitutes are identified per finding.
- `npm audit --omit=dev --json` returned **zero reported vulnerabilities**. [Raw audit](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/complex/npm-audit.json). This is the registry's production-dependency advisory result, not a whole-system security guarantee; Python, OS/container and development dependencies were not audited in this step.
- All 13 new published issue titles, URLs and bodies were read back and compared to authored drafts. Each body includes a commit-pinned source location, trigger, correction and limits.
- The earlier review's typechecks and **2,236 tests across 220 files** passed. They were not rerun in this pass because application source was unchanged; the new probes extend those checks rather than claiming a new full-suite run.
- Disk closeout: 39 GiB available on the local data volume. No unbounded scratch/build loop was run.

## Priority and limits

1. Fix MXL validation/extraction agreement (#124) and the existing prepared-backing loss (#113).
2. Make source-handoff, active retry and cancellation/publication transitions atomic (#136, #132, #120).
3. Correct silent import semantics and notation cache identity (#125–#127, #135), then transpose/source consistency from the first review.
4. Repair the audio lifetime/routing/cancellation contracts together, using the focused reproductions and actual instrument listening.
5. Isolate PDF request cancellation (#134), correct the home-page query (#133), and work through the bounded polish backlog (#119).

No application fixes, commits, PRs, merges, deployments, production imports, credential reads, or musical acceptance changes were made. Live production behavior, real browser layout/accessibility/performance, physical MIDI/microphone behavior, every catalog arrangement, and independent pianist/listener acceptance remain unverified. Passing hashes and structural tests do not establish musical quality. Historical corpus drift counts were not reverified or used as current findings.
