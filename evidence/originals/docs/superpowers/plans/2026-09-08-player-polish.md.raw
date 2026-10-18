# Player polish Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Work inline by default; no subagents are needed. Steps use checkbox syntax for tracking.

**Goal:** Make starting, reading, and repeating piano practice clear on desktop and phone while preserving playback correctness and honest arrangement provenance.

**Architecture:** Evolve the current Player owner, view components, CSS, and PlaybackEngine. Reuse current controls, chord selection, range calculation, dialogs, persistence, and test infrastructure. Add one small practice-setup component; avoid a toolbar framework, new state library, or player rewrite.

**Tech Stack:** React 19, Next.js 15, TypeScript, Tailwind/CSS, Canvas/SVG, existing Vitest and Playwright, project Node 22 runtime.

**Spec:** The accepted live UI review:
`/Users/reidar/.codex/visualizations/2026/09/08/01a0825f-8d09-7a03-b0f3-115c7ac82bae/player-review/review.md`.
This plan makes that review concrete. Its screenshots are the visual baseline.

## Global constraints

- Preserve the existing white/charcoal design and useful pitch colours.
- No new dependencies, catalogue rebuild, transcription changes, source retirement, or audio-engine replacement.
- Preserve existing storage keys, route IDs, exports, hand selection, transpose, sound selection, and cancellation behavior.
- Preserve visible beta and unverified-timing warnings; full source details remain accessible.
- No false promise that inferred sections are verses/choruses, source tempo is verified, or display changes simplify the music.
- No automatic overwrite of a saved 88-key preference. New layout defaults must not silently migrate user settings.
- Preserve direct-sheet metadata-only loading; cosmetic controls must not eagerly fetch the complete arrangement.
- Before long tests/builds run `df -h /System/Volumes/Data`; stop below 30 GiB free.
- Use an isolated `codex/player-polish` worktree at execution time. The current checkout has unrelated catalogue/transcription WIP.
- This document is planning only. Implementation, PR, merge, and deployment are separate execution steps; no deployment occurs while planning.
- All repository paths below are relative to `/Users/reidar/Projectos/Keyspilli`; resolve them against the execution worktree.

## Implementation decisions

The default control order will be Play/Pause, Practice, Hands, Speed, Loop. View and Adjust form a secondary group. Download, Favorite, and Learned belong with song metadata. The mobile layout uses two explicit control rows.

Practice opens a preparation dialog without seeking or playing. It offers:
- Input: computer keyboard, connected MIDI, or opt-in microphone. Show actual availability and keep permission errors actionable.
- Behavior: Play along or Wait for notes.
- Scope: From current position (default), From beginning, or Selected loop when a valid loop exists.
- Count-in: Off or 4 beats, default Off. The label is four beats, not one bar.
- Start practice and Cancel.

Start captures a bounded practice interval. Notes beginning before that interval are not scored. A selected loop is practiced once per scored attempt, with a clear Repeat passage action; never silently wrap a consumed grader. Normal ungraded looping remains unchanged.

Keyboard display remains the existing fitted range or all 88 keys. Label the fitted mode “Fit passage” because the current algorithm follows measures, not the whole song. On narrow screens with an explicit 88-key setting, show a one-click Fit passage suggestion rather than changing the preference.

## Task 1: Establish baseline and simplify the controls

**Files:** Modify `apps/web/src/components/player/Player.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/player/SettingsDialog.tsx`; extend `apps/web/e2e/player-ui.spec.ts`.

**Interfaces:** Existing `updateSettings`, `togglePlay`, `seekToMeasure`, loop handlers, preference keys, and lazy sheet shell remain owners of behavior. No new toolbar abstraction.

- [x] Inspect repository instructions, branch state, and running local servers. Create the isolated worktree from the current intended UI base; carry this plan as a document, not the unrelated WIP.
- [x] Compare the UI base to the reviewed deployment. The local Player inspected during planning lacks the live preview's source-notice text. Locate that notice on the execution base before editing it; preserve its data and warning semantics.
- [x] Capture baseline desktop 1440×900, tablet 1024×768, phone 390×844, and short landscape 844×390 using an ordinary seeded song plus the preview example where available.
- [x] Reorder the existing JSX into primary practice controls, secondary view/adjust controls, and song actions. Keep Play strongest; make export visually secondary.
- [x] Add visible “Speed” and “Bar” labels. Add native 50%, 75%, 100% speed presets beside the existing +/- control. Preserve the current speed bounds.
- [x] Replace the misleading measure span tooltip “click to jump” with a real labeled integer bar input. Convert displayed 1-based values through `seekToMeasure(value - 1)`; reject nonintegers and clamp to the available measures.
- [x] Put loop controls next to the timeline. Use existing loop state and section handlers; expose start/end bar inputs, enable/clear, and a textual “Bars X–Y” range. Reject reversed/empty ranges. Keep inferred section names neutral.
- [x] Use “Right hand / input” and “Left hand / accompaniment” for the gain labels: the inspected audio engines route by hand and input uses the right-hand bus. Keep stored `voiceGain` and `pianoGain` names.
- [x] Keep one primary 88-key control in Adjust, removing the redundant Settings copy. Do not remove the stored preference.
- [x] Verify keyboard order follows visual order, controls have useful names, and disclosure buttons report expanded state. Commit this independently reviewable layout/copy change.

**Regression check** (add inside existing Playwright setup; SONG is already defined):
```ts
test("bar jump is keyboard operable", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const bar = page.getByRole("spinbutton", { name: "Bar" });
  await bar.fill("3");
  await bar.press("Enter");
  await expect(bar).toHaveValue("3");
  expect(Number(await page.getByLabel("Seek").inputValue())).toBeGreaterThan(0);
});
```

## Task 2: Fit the stage without shrinking the music

**Files:** Modify `Player.tsx`, `FallingCanvas.tsx`, `globals.css`; extend `apps/web/e2e/player-ui.spec.ts`.

**Interfaces:** Preserve `FallingCanvas` props and `measureMidiRange`. The canvas measures its own rendered size; it must not change the playback timeline.

- [x] Remove the width-driven 960/540 displayed aspect-ratio lock. Let the player surface allocate the available vertical space with CSS grid/flex and `100dvh`.
- [x] Preserve a usable normal document flow for short windows. Add a session-only Focus control to hide song/nav details and expand the practice surface; do not reuse or overwrite Full width.
- [x] Keep a concise source-status line outside Arrangement details. Use native `details/summary` for the full source description and links. Timing uncertainty remains visible in normal and focus layouts.
- [x] In FallingCanvas replace the fixed logical W/H with measured CSS-pixel dimensions. Use devicePixelRatio only for backing-store sharpness. Compute keyboard height independently from width; start at 96px phone / 140px desktop, then validate the captures.
- [x] Observe both width and height, including while paused. A ResizeObserver invalidates one draw; preserve the existing single active animation loop and cancel it on unmount.
- [x] Retain the existing range algorithm and out-of-range indicators. Expose Fit passage clearly on phone. Labels must use CSS-pixel size floors instead of shrinking with the old 960px coordinate system.
- [x] Keep the strike line, keyboard, and transport together at 390×844 and 1440×900. In short landscape, Focus must make the essential playing surface usable without trapping page scroll.
- [x] Capture the same states and viewports as the baseline; commit once geometry and interaction checks pass.

**Regression assertion** (inside an existing browser test after enabling Focus):
```ts
const box = await page.getByLabel("Falling notes player").boundingBox();
expect(box).not.toBeNull();
expect(box!.y).toBeGreaterThanOrEqual(0);
expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
expect(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
)).toBe(true);
```
Also resize height only while paused and confirm the backing canvas height changes; a screenshot alone does not prove that redraw path.

## Task 3: Make practice preparation and grading scope correct

**Files:** Create `apps/web/src/components/player/PracticeSetupDialog.tsx`. Modify `Player.tsx`, `GradingPanel.tsx`, `packages/player-core/src/engine.ts`; extend `packages/player-core/test/engine.test.ts` and `apps/web/e2e/player-ui.spec.ts`.

**Interfaces:** Extend the shared API compatibly:
```ts
startGrading(
  wait: boolean,
  range?: { startSec: number; endSec: number },
): void
```
No range retains existing whole-song behavior for callers/tests. The UI explicitly supplies the chosen range. Seconds use the engine's current speed-adjusted timeline. Validate finite bounds, clamp to song duration, and reject end <= start before mutating transport.

The new dialog returns a local setup value:
```ts
type PracticeSetup = {
  input: "keyboard" | "midi" | "microphone";
  wait: boolean;
  scope: "current" | "beginning" | "loop";
  countInBeats: 0 | 4;
};
```
Keep this type in the component and export it for Player; no global settings schema or new storage migration.

- [x] Trace every `startGrading`, `finishGrading`, input handler, and loop reset caller on the execution base.
- [x] Add the engine regression below and run it before implementing the range parameter.
- [x] Filter gradeable notes to onset >= startSec and onset < endSec, retaining the existing ornament threshold and hand selection. Seek to startSec only after the user starts.
- [x] End a play-along attempt at its range boundary. For wait mode, finish when the bounded target list is exhausted. Preserve the result until dismissed or repeated. Empty target intervals show “No playable notes in this passage” without starting audio or reporting a score.
- [x] Add the setup dialog using existing dialog focus/motion patterns. Opening it pauses current playback but preserves position; Cancel leaves it paused at that position. Grading and chord practice cannot be active simultaneously.
- [x] Move microphone setup/permission ownership out of the live grading panel so setup and active input share one controlled lifecycle. Only request permission after the user selects microphone and invokes its enable action. Denial keeps Start unavailable for microphone and offers keyboard/MIDI alternatives.
- [x] Route the selected input consistently, including the existing wait-mode handling. Test keyboard and microphone wait advancement against the same target; do not claim microphone timing accuracy from fake input.
- [x] For count-in, freeze playhead and scoring until the four beat countdown completes. Derive beat duration from current tempo and speed using existing timing helpers. Cancel timers/audio on Cancel, navigation, unmount, or mode exit; ensure duplicate Start clicks cannot create multiple runs.
- [x] Keep grading controls compact outside note lanes. Disable range/tempo/hand changes during an active scored attempt, with “Finish practice to change setup”; retain Stop/Finish access.
- [x] Practice loop scope runs once, then Repeat creates a fresh grader for the same range. Suspend transport wrapping during that attempt and restore the prior ungraded loop on exit.
- [x] Verify opening/cancelling never seeks, scoring excludes earlier notes, count-in cannot leak, and normal ungraded Play/Loop still works. Commit.

**Engine regression** (uses the existing engine() fixture and its three notes):
```ts
it("grades only the requested passage without rewinding", () => {
  const { eng } = engine();
  eng.startGrading(true, { startSec: 0.5, endSec: 1.5 });
  expect(eng.time).toBe(0.5);
  expect(eng.finishGrading()?.total).toBe(2);
});
```

**UI regression** (extend existing player test):
```ts
test("practice setup preserves the selected position", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const seek = page.getByLabel("Seek");
  await seek.fill("20");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up practice" })).toBeVisible();
  await expect(seek).toHaveValue("20");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(seek).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});
```

## Task 4: Polish falling notes and simplify chord guidance

**Files:** Modify `FallingCanvas.tsx`, `ChordStrip.tsx`, `globals.css`; extend `ChordStrip.test.tsx` and existing browser coverage.

**Interfaces:** Keep chord provenance and transposed pitch data intact. Reuse ChordStrip's existing current/next selection and virtualization rather than building a second timeline.

- [x] Make Now → Next visible on desktop as well as phone. Limit the default preview to current plus the next few chords; keep full progression behind an explicit expansion.
- [x] Put miniature voicings behind “Show chord shapes” in that expansion. Preserve inferred/unknown provenance labels in compact and expanded forms.
- [x] Use `ctx.measureText(label).width + padding <= barWidth` as the label-fit condition. Put unreadable narrow-note labels in a separate current-note cue rather than letting them overlap adjacent bars.
- [x] Keep LH/RH distinct, add a small hand legend, and choose readable text contrast on each bar. Remove the heavy text stroke where a readable solid label fits.
- [x] Measure the longest visible chord label for a safe left gutter and clamp drawing coordinates. Remove the duplicate decimal-seconds stage label.
- [x] Check dense chords, consecutive accidentals, transposition, 88 keys, fitted range, high/low register, paused resize, and reduced motion.
- [x] Keep existing ChordStrip behavior tests passing and add assertions that current/next names and provenance match between compact and expanded states. Save before/after screenshots; commit.

## Task 5: Make other views and feedback match their labels

**Files:** Modify `Player.tsx` (including its lazy sheet shell), `BeginnerView.tsx`, `LeadSheetView.tsx`, `SheetMusicView.tsx`, `ChordPracticePanel.tsx`, `SettingsDialog.tsx`, and `globals.css`. Extend existing source-selection/transpose tests; add `LeadSheetView.test.tsx` only if the existing render tests cannot host these cases.

**Interfaces:** Keep route ID `beginner`; change only its displayed label to “Note letters.” Keep difficulty labels unchanged. Existing chord duration/provenance remains authoritative.

- [x] Rename Beginner view to Note letters in both normal and lazy-shell menus, accessibility labels, and hints. Add hand/octave context and a compact next-measure preview without changing arrangement notes.
- [x] Show only controls meaningful to each view. Audio settings remain usable but must not imply that the static score visually transposes.
- [x] Add native score zoom/fit-width controls by changing the page wrapper size, not regenerating score data. Keep lazy page loading and normal scrolling. Identify the current page; do not add playback-follow without score/playhead mapping.
- [x] In LeadSheetView distinguish no lyrics anywhere in the arrangement from a measure with no sung words. Show “No lyrics available for this arrangement” only for the former.
- [x] Include a preceding chord at measure start only if its declared duration or established timeline semantics cover that beat. Stop at explicit gaps; preserve provenance. A truly chordless/rest measure gets an honest state and helpful text rather than invented harmony.
- [x] Add pitch/octave labels to otherwise anonymous melody dots. Use conditional helper text instead of always claiming lyrics/chords are present.
- [x] In chord practice show scope explicitly: “Current bar — 1 chord” or “Selected passage — N chords,” matching the actual target construction. Enlarge reference key labels and reuse the explicit input status.
- [x] Add a Settings “Preview sound” action using the existing current audio engine and a short fixed phrase at user invocation. Cancel its notes on close, navigation, source change, or starting practice; preserve current song position.
- [x] Validate the three Lead Sheet cases with synthetic data: chord spanning a bar boundary, explicit harmony gap, and arrangement without lyrics. Existing transpose tests must remain green.
- [x] Save mode screenshots and commit. Record repeated clef changes as a separate engraving investigation; do not alter transcription/engraving in this polish pass.

## Task 6: Integrated acceptance and handoff

**Files:** Update this plan's checkboxes and add `docs/research/keyspilli-evidence/player-polish-2026-09-08.md` with actual execution date, commits, screenshots, checks, and limits.

- [x] Use the project's installed Node 22 binary, not an unverified global node shim.
- [x] Run targeted tests after each behavior change, then the integrated checks once:
```sh
npm run test -w @keyspilli/player-core -- test/engine.test.ts
npm run test -w @keyspilli/web
npm run typecheck
npm run build
npm run e2e -w @keyspilli/web -- e2e/player-ui.spec.ts --workers=1
```
- [x] Before the browser suite, verify the local server and seeded f-f-chopin-nocturne-m fixture match the worktree. The default config reuses port 3000: never accept an unrelated server as test evidence. Use a private copied/seeded catalogue, not production data writes.
- [x] Do not use e2e:scratch as if it covers player-ui.spec.ts: its current testMatch only selects bounded-mvp.spec.ts. If scratch isolation is needed, explicitly extend the config and seed the existing player fixture; retain teardown and bounded storage.
- [x] Manually recapture all eight review states at desktop and phone widths, plus tablet and short landscape for the primary stage. Review a normal song, the preview notice, a sparse measure, and a dense passage.
- [x] Check Tab/Shift-Tab order, Escape, focus return, visible focus, 200% zoom, target size, text/bar contrast, reduced motion, and absence of horizontal page overflow. Do not announce full accessibility compliance from screenshots.
- [x] Exercise sampled and synth audio, play/pause/seek, speed, transpose, input note release, cancellation, normal loops, wait mode, and result/repeat. Separate real MIDI/microphone checks from synthetic engine tests in the report.
- [x] Review the final diff for unrelated changes, preserved lazy-sheet payload behavior, new dependencies, and preference migrations.
- [x] Present the tested patch and screenshots. Prepare a PR when implementation is authorized; follow the requested merge/deploy scope rather than assuming that local tests prove production.
- [ ] If deployed later, verify the deployed revision and repeat the live start/practice/resize flow. Log exact outcomes to the Keyspilli Obsidian note and daily Log.

## Acceptance summary

Done means a pianist can choose hands and passage, set speed, prepare input, and start deliberately; the visible strike line and useful keyboard fit the playing layout; note/chord labels are readable; view names and missing-content messages are truthful; old preferences and core playback still work.

The first useful delivery is Tasks 1–3. Tasks 4–5 finish the visual and cross-view polish. Task 6 is the completion gate, not an optional follow-up.

## Self-review

Coverage: toolbar/copy/loop → Task 1; keyboard/viewport/provenance disclosure → Task 2; practice/start/input/count-in → Task 3; note/chord polish → Task 4; settings/alternate views/chord-practice clarity → Task 5; regression and live boundaries → Task 6.

Explicit exclusions: catalogue quality repair, clef/engraving correction, new grading algorithms, fabricated harmony/lyrics, automatic user preference migration, new UI frameworks, and deployment without execution scope.



## Execution record — 08-09-2026

Implemented on `codex/player-polish` in `/Users/reidar/Projectos/.keyspilli-worktrees/player-polish`, based on `origin/main` `0d5f78a`; application commit `04ce0e6`. Original `codex/organ` checkout and unrelated WIP preserved. See [evidence and screenshots](../../research/keyspilli-evidence/player-polish-2026-09-08.md).

Execution variations: reused the accepted live review as the visual baseline plus one local integration baseline; did not recreate all four baseline viewports before component edits. Final primary-stage checks cover all four requested sizes. The production preview ID was absent in the private copied catalogue, so exact preview recapture was unavailable; source-notice warnings have component coverage. Changes were committed as one cohesive player patch because the control and grading changes share Player ownership. Focus uses CSS flex allocation; short windows retain document scroll. Native dialog tabbing can expose browser chrome, while underlying page controls stay inert. Zoom verification used 200% CSS zoom, not OS/browser magnification. Real MIDI/microphone and engraving review remain explicit acceptance limits, not claimed checks.

Task 6 evidence: 1,881 workspace tests, all-workspace typecheck, production build, and 27 browser checks passed. Reviewed desktop/phone views, settings, preparation and chord targets, plus tablet/landscape Focus. No deployment or merge performed.
