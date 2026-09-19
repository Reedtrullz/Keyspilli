# Frozen `8cd09a3` preview-lifecycle review

Date: 2026-09-19 15:52–16:00  
Exact head: `8cd09a38e2bd1d47fd88f198d817fe2d4037613e`  
Reviewed delta: `8cbdf74bd9b9ba18e29379774610c0e401c13a32..8cd09a38e2bd1d47fd88f198d817fe2d4037613e`  
Scope: bounded read-only engineering review; no runtime, catalog, deploy, or source-data mutation.

## Accepted P1 reproduction

The committed preview-cleanup effect in `apps/web/src/components/player/Player.tsx:702-714` includes React `time` in its dependency list and always returns `cancelSoundPreview`. `previewSound` at `:1225-1262` stops the transport, calls `syncTransportState`, then sets `soundPreviewRef.current = true` and schedules the preview. `syncTransportState` updates `time` at `:845-849`, while the transport rAF updates it at `:869-872`.

Reproduction on the exact head:

1. Load the Blackbird scratch fixture with `playwright.chords-v2.t1.config.ts`.
2. Open Sound, select Chord mode, expand Advanced arrangement controls, and close the tool.
3. Click Play and wait 250 ms so the engine playhead and React `time` state differ.
4. Reopen Sound and Advanced arrangement controls, then click Full.
5. A temporary, ephemeral Chromium probe wrapped `OscillatorNode.start/stop`. It observed `{starts: 6, stops: 8, shortStops: 2}` after the preview click; `shortStops` counted stops scheduled less than 80 ms ahead, matching the cancellation path rather than the normal note stop floor.

The resulting render runs the cleanup after the preview is scheduled; `cancelSoundPreview` calls `engineRef.current?.audio.cancelAll()` and clears the preview flag. The UI permits this path, and `previewSound` intentionally stops transport, so it is not an unsupported interaction. The focused stopped-transport audition test remains green, which is why the committed regression did not catch this transition race.

## Required correction boundary

Add a regression proving both sides of the lifecycle contract:

- moving transport → preview: the newly scheduled preview remains audible/scheduled after the transport stop and state synchronization;
- explicit seek → preview cancellation: seeking while a preview is active cancels the preview without leaving stale scheduled voices.

Do not remove cancellation for external playhead changes merely to hide the first regression. The fix must distinguish internal preview startup synchronization from an explicit seek/source/routing change.

## Independent evidence

- Node `v22.22.3`; `/System/Volumes/Data` free space: 60 GiB.
- Player-core engine plus four focused web unit files: 91 tests passed.
- Web typecheck and production build passed.
- Four focused browser contracts passed: role audition with empty melody no-attacks and A/B MIDI identity, source-change cancellation, Original sheet/download labeling, and selected-position practice target `G4`.
- Worker constructor failure, worker `postMessage` failure, and stale-worker reply tests passed with their matching fixture configurations.
- `git diff --check 8cbdf74..8cd09a3` passed.

Engineering evidence only: no human musical acceptance, source/melody semantic approval, physical keyboard acceptance, merge, deploy, or production claim.

## Correction review: frozen `6c6e230` — 19-09-2026

Exact head: `6c6e2302eb18908f6cbdfc936704832bca4775cf`; parent: `8cd09a38e2bd1d47fd88f198d817fe2d4037613e`. The original P1 is scoped closed: replacing `time` with `seekVersion` prevents internal `syncTransportState()` during preview startup from invalidating the new preview. Fresh exact-head Chromium checks passed both the moving-transport → preview audible regression and the prior source-change cancellation regression. Web typecheck passed under Node `v22.22.3`; no broad suite was run.

External path audit:

- Slider, previous/next measure, bar commit, section navigation, and phrase `Seek` all route through `seek()`, which increments `seekVersion`.
- Loop enable/clear/bar/section/phrase changes update `loop`, which remains an explicit cleanup dependency.
- Normal practice entry calls `cancelSoundPreview()` in `openPracticeSetup`; Chord practice calls it in `startChordPractice`; settings/source/routing changes and unmount/navigation remain cleanup dependencies.
- Internal engine seeks for audio swap and speed changes no longer invalidate through `time`; their own source/settings dependencies still clean up previews.

Remaining P2: `repeatPractice()` (`Player.tsx:1501-1510`) bypasses `openPracticeSetup`. Keyboard/MIDI repeat calls `beginPractice()` directly, and microphone repeat reopens setup without cancelling. `beginPractice()` (`:1443-1462`) never calls `cancelSoundPreview()`, while `PlaybackEngine.startGrading()` does not cancel audio when transport/grader are stopped. A user can finish practice, start a Sound preview from the result state, then click Repeat passage and leave preview voices overlapping practice. Centralize preview cancellation at practice start/repeat before calling this lifecycle fully closed.

## P2 correction review: `8e668c6` + `bb4f76e` — 19-09-2026

`beginPractice()` now calls `cancelSoundPreview()` immediately before
`startGrading()`, and `repeatPractice()` cancels before branching. This covers
direct keyboard/MIDI repeat and the microphone branch that reopens setup.

The regression was corrected after review: it samples oscillator stop calls
after Full preview scheduling and dispatches the mounted Repeat passage React
handler while the Sound dialog remains open, so closing the tool cannot provide
the cancellation being asserted. This is a defensive handler-integration
check, not a claim that a user can click an obscured result through a native
modal dialog. The corrected targeted Chromium scratch test passed; web
typecheck and diff-check passed under Node `v22.22.3`.
