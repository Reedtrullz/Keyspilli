# Player Instrument UI Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task in the current task. Do not dispatch agents unless separately authorized. Steps use checkbox syntax for tracking.

**Goal:** Make Keyspilli a stable, readable and directly playable piano learning interface, using OnlinePianist's strongest interaction ideas.

**Architecture:** Keep PlaybackEngine as the musical/audio authority and Player.tsx as the composition owner. Extract only the real tool-panel and keyboard/input responsibilities needed by this work; reuse existing preferences, keyboard geometry, audio and grading paths. UI changes must not rebuild the engine or alter song position.

**Tech Stack:** Existing Next.js 15 / React / TypeScript, Canvas 2D, Tailwind/CSS, Web Audio, Web MIDI, Vitest and Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-player-instrument-ui.md` — read it before execution.

## Execution status — 9 September 2026

Implementation for Tasks 1–7 is present in `codex/player-instrument-ui`. The local acceptance work and verification limits are documented in `docs/research/keyspilli-evidence/player-instrument-ui-2026-09-09/README.md`.

Delivery adjustment: A–C share one integrated review branch and PR, rather than three partial releases. No release was merged or deployed. Native dialogs replace the old panel wrapper; static bevels replace proposed gradients. Physical MIDI/touch feel, listening acceptance and production release checks remain separate from local automated evidence.

## Global constraints

- Baseline release: PR #91, main commit `f3a2b1085ba6b8c8299a6472cd9c44ad5eede9fa`. Recheck main when starting implementation.
- Preserve unrelated WIP in `/Users/reidar/Projectos/Keyspilli`. Existing review worktree: `/Users/reidar/Projectos/.keyspilli-worktrees/player-polish`.
- Execute in a fresh isolated `codex/player-instrument-ui` branch from verified main; carry this plan/spec into that worktree. Do not reset the original checkout or assume the old merged branch is current main.
- Use Node `/Users/reidar/.nvm/versions/node/v22.22.3/bin`; do not rely on the malformed local Node shim.
- No new packages, wholesale Player rewrite, generic panel framework, new audio scheduler or duplicated key geometry.
- Preserve `keyspilli.prefs.v1`, existing values and song preferences; new fields must tolerate old/malformed storage.
- Do not auto-enable microphone, broaden MIDI permissions or change saved display choices during migration.
- Retain full arrangement range while playing, seeking, changing speed or selecting a hand.
- UI settings must not seek, start playback or end a scored attempt. Sound preview retains its existing explicit pause/position behavior.
- Rendering optimization: retain refs/live time, idle canvas while paused, and cached key geometry. Avoid React state updates per pointer move when the pitch is unchanged.
- Default Light appearance, note names on, computer-key overlay off. Input octave starts at middle-C mapping each new mounted player session; do not persist a surprising octave offset.
- Do not remove accessible names or make color the only way to identify a state.

## Delivery sequence

| Release | Tasks | Deliverable | Risk |
|---|---|---|---|
| A | 1–4 | Stable tools, keyboard landmarks, input status, instrument finish | Low/medium: layout and preference migration |
| B | 5–6 | Mouse/touch piano and safe input ownership | Medium/high: note lifetimes and grading |
| C | 7–8 | Clock-based rhythm feedback, complete acceptance and release | Medium: timing semantics and responsive regression |

Task 8's release checks apply to A and B as well; never defer basic validation until C. Recording is a separate follow-up, not a blocker. Tasks are sequential because they share Player/FallingCanvas state. Each task is a reviewable commit. Ship each release only after its acceptance checks and explicit release authorization.

## Verified current code and planned ownership

| File | Current responsibility / planned change |
|---|---|
| `apps/web/src/components/player/Player.tsx` | Transport, panel state, engine/input lifetime, range calculation, grading; wire new UI without replacing orchestration. |
| `apps/web/src/components/player/SettingsDialog.tsx` | Existing sound/organ/source controls, focus and modal behavior. Extract content rather than reimplementing its options. Remove obsolete wrapper only after all callers move. |
| `apps/web/src/components/player/PlayerTools.tsx` (new) | Tool triggers and one active panel. Only panel presentation state lives here or in its single controlled owner. |
| `apps/web/src/components/player/SoundControls.tsx` (new) | Extracted existing sound controls, shared with a legacy wrapper only while it still has callers. |
| `apps/web/src/components/player/FallingCanvas.tsx` | Shared geometry, drawing, key hints and pointer surface. Keep note animation in Canvas. |
| `apps/web/src/components/player/InputStatus.tsx` (new) | Input status, octave buttons/hints, keyboard-map toggle and MIDI retry/connection feedback. |
| `apps/web/src/components/player/player-motion.ts` | Reuse reduced-motion and presence conventions, including inert exiting panels. |
| `apps/web/src/components/player/PracticeSetupDialog.tsx` | Clarify computer/on-screen input label in Release B; preserve existing input enum and grading scopes. |
| `apps/web/src/app/globals.css` | Tool overlay/sheet positioning, scoped stage colors, responsive control layout. |
| `packages/player-core/src/types.ts`, `prefs.ts` | Three new display preference fields, defaults and explicit enum/boolean validation. |
| `packages/player-core/src/input.ts` | Reuse KEYMAP, KeyboardInput octave and MidiInput. Add observable octave/release cleanup and physical input identity only where needed. |
| `packages/player-core/src/views/falling.ts` | Reuse keyboardRects/passageMidiRange. Add one shared geometry/hit-test path used by rendering and pointer input. |
| `packages/player-core/src/engine.ts` | Existing handleNoteOn/off, fromInput voices and scheduling remain authoritative. Change only if tests expose a required lifecycle integration. |
| Existing tests | `packages/player-core/test/prefs.test.ts`, `packages/player-core/src/input.test.ts`, `packages/player-core/test/player-core.test.ts`, `apps/web/src/components/player/FallingCanvas.test.tsx`, `apps/web/e2e/player-ui.spec.ts`, `apps/web/e2e/app.spec.ts`. |

## Interaction contract

Desktop main row: Play / Practice / Hands / Speed, then View / Display / Sound / Input / Focus. Keep the seek row and Loop compact. If this cannot fit at a breakpoint, put Display/Sound/Input behind a single Tools trigger; do not squeeze labels or create page overflow. Default breakpoint for the compact trigger: below 1100px; validate against actual content and zoom before finalizing.

Display contains Fit Passage / 88 keys, note labels, computer-key hints, stage appearance, chord guide and full width. Sound contains existing instrument/organ controls, sound preview, hand gains, accompaniment/source choice and sustain. Input contains keyboard octave, mapping help and MIDI connection/retry. Keep Practice and chord-practice activation in the learning controls rather than burying activation inside sound settings.

One secondary panel is open at a time. Desktop panel is anchored and out of flow, max-width 420px, constrained to viewport. Phone panel is a fixed bottom sheet with scrollable contents and maximum 60dvh; it temporarily covers content without resizing the stage. Desktop is a labelled nonmodal region; mobile is a modal dialog with background inertness and focus trap. Escape/backdrop/close restore trigger focus. Opening menus or sheets never counts as playing a note. Exiting panels become inert before their animation completes.

An input status line is part of the keyboard chrome, at most 24px high, not a new global toolbar row. It displays e.g. `Computer keys · C4–E5 · Z/X octave` or `MIDI connected · Computer keys available`. If that input range lies outside the fixed display, show `Input outside view` with a Reset octave action. Never pan the arrangement automatically.

## Task 1 — Replace nested Adjust/Settings with stable tool panels

**Files:** Player.tsx, SettingsDialog.tsx, new PlayerTools.tsx/SoundControls.tsx, globals.css, player-ui.spec.ts.

**Interfaces:**
```ts
type PlayerTool = "display" | "sound" | "input";
// One controlled state, replacing overlapping showAdjust/showSettings state.
const [openTool, setOpenTool] = useState<PlayerTool | null>(null);
// SoundControls receives the existing settings/onChange/onPreview and chord-source
// props from SettingsDialog unchanged. It owns no playback state.
```

- [ ] Add an integration regression around the existing player: record canvas boundingBox, open Display, Sound and Input, close with Escape, and check canvas x/y/width/height are within 1 CSS px throughout. First run should fail because triggers do not exist and current Adjust alters height.
```ts
const stage = page.getByLabel("Falling notes player");
const before = (await stage.boundingBox())!;
for (const name of ["Display", "Sound", "Input"]) {
  await page.getByRole("button", { name, exact: true }).click();
  const after = (await stage.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name, exact: true })).toBeFocused();
}
```
- [x] Extract existing SoundControls JSX and callbacks. Preserve every organ option, source selector, gain, sustain control and preview behavior. Add the controlled panel shell and replace obsolete Adjust/Settings state, refs, hotkey guards and render paths. Search every SettingsDialog/showSettings/showAdjust caller before deleting anything.
```css
.player-tools { position: relative; }
.player-tool-panel { position: absolute; inset: calc(100% + 8px) 0 auto auto; width: min(420px, calc(100vw - 24px)); max-height: min(560px, 70dvh); overflow: auto; z-index: 40; }
@media (max-width: 640px) {
  .player-tool-panel { position: fixed; inset: auto 0 0; width: auto; max-height: 60dvh; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
}
```
- [ ] Adapt existing dialog focus/motion code for the mobile sheet; keep desktop panels nonmodal. Test outside click, switching tools, Escape, focus return, 200% zoom and hidden/exiting controls. Ensure other notation modes and chord practice retain controls. Run the focused player browser suite; commit `refactor: keep player tools outside the note layout`.

**Acceptance:** no panel-induced geometry shift, no double-open panel, no inaccessible hidden controls, no settings lost, no transport movement from opening/closing tools.

## Task 2 — Add display preferences and keyboard landmarks

**Files:** types.ts, prefs.ts, falling.ts if label helper is shared, FallingCanvas.tsx, PlayerTools.tsx; prefs.test.ts and FallingCanvas.test.tsx.

**Interfaces:**
```ts
// Add to PlayerSettings and explicit loadSettings validation:
keyboardLabels: "notes" | "octaves" | "off"; // default "notes"
showKeyBindings: boolean; // default false
stageTheme: "light" | "charcoal"; // default "light"
```
Existing `showAllKeys` remains the range setting. Do not rename `chordKeys` in storage. No new storage namespace or version migration framework.

- [x] Add preference tests: absent fields use defaults, invalid enum/boolean values fall back, round-trip preserves choices, old speed/hand/sustain values survive. Use the existing localStorage fixture.
```ts
store.set(KEY, JSON.stringify({ speed: 0.75, keyboardLabels: "nonsense", stageTheme: null }));
expect(loadSettings()).toMatchObject({ speed: 0.75, keyboardLabels: "notes", stageTheme: "light", showKeyBindings: false });
```
- [x] Add controls and renderer label rules. Notes mode keeps note names; octaves mode labels only C notes with their octave; off removes textual note names. A small middle-C landmark remains for orientation and has an explanatory accessible description. Computer-key hints occupy a separate label position and never replace musical names. Omit a hint if it cannot fit; do not shrink text indefinitely.
```ts
const showNoteName = settings.keyboardLabels === "notes"
  || (settings.keyboardLabels === "octaves" && midi % 12 === 0);
const isMiddleC = midi === 60;
```
- [ ] Test C4/C5 labels, narrow black keys, off mode and a transposed arrangement. Keep passageMidiRange unchanged. Extend the existing stable-range browser check to label changes and panel toggles; geometry must stay fixed except explicit 88/Fit selection. Run prefs and canvas tests; commit `feat: add piano landmarks and label preferences`.

**Acceptance:** landmarks improve orientation without overlapping labels; saved users retain current appearance and range; new values never corrupt old settings.

## Task 3 — Surface the real keyboard octave and MIDI state

**Files:** input.ts, Player.tsx, new InputStatus.tsx, FallingCanvas.tsx/PlayerTools.tsx; input.test.ts and player-ui.spec.ts.

**Interfaces:** extend KeyboardInput's constructor options without changing InputCallbacks for other users:
```ts
constructor(cb: InputCallbacks, onOctaveChange?: (octave: number) => void)
setOctave(value: number): void // existing 0..4 clamp; notify only on change
releaseAll(): void // release held effective pitches, clear down/heldNotes
```
Player keeps the KeyboardInput instance in a ref and a mirrored display octave. Rendering uses the real exported KEYMAP and `(octave - 2) * 12`; never maintain a second key map. `InputStatus` consumes `{ octave, midiConnected, onOctaveChange, onConnectMidi }`; status text is polite on connection changes, not on every played note.

- [x] Extend input tests so a held key releases its original pitch after changing octave and releaseAll is idempotent. Verify 0/4 limits and callback notifications. Existing heldNotes logic is the foundation.
```ts
const events: string[] = [];
const input = new KeyboardInput({ onNoteOn: m => events.push(`on:${m}`), onNoteOff: m => events.push(`off:${m}`) });
input.handleKey(new KeyboardEvent("keydown", { key: "a" }));
input.setOctave(3);
input.releaseAll(); input.releaseAll();
expect(events).toEqual(["on:60", "off:60"]);
```
- [x] Wire octave buttons and Z/X updates through that instance; render hints from KEYMAP at the effective pitches. Distinguish input octave from arrangement transpose in text. Display unavailable/outside-view states explicitly. Do not recenter Fit Passage to reveal an input key.
- [x] Reuse the existing MidiInput connection object and status rescan. Provide an explicit Connect/Retry action with pending/unsupported/not-connected states; migrate mount-time connection to the explicit action so new sessions do not prompt for permission without intent. Do not add a second connection or polling loop. Preserve device hotplug updates and reject stale completion after unmount. Close tool panels before a practice start as existing setup requires.
- [ ] Check hints match actual notes at octave boundaries, controls do not play stray notes, typing in fields never triggers keyboard input, and MIDI denial still permits computer input. Mock permission states in browser tests; mark real MIDI acceptance separately. Commit `feat: expose keyboard octave and input status`.

**Acceptance:** the displayed mapping is the mapping that plays; MIDI state is accurate; input octave changes never alter the song or viewport.

## Task 4 — Give the existing piano a restrained instrument finish

**Files:** FallingCanvas.tsx, globals.css, PlayerTools.tsx; FallingCanvas.test.tsx and screenshot evidence.

**Interface:** theme is `settings.stageTheme`; use a fixed pair of local color palettes, not a global theming framework.
```ts
const stageColors = settings.stageTheme === "charcoal"
  ? { background: "#15181e", text: "#e4e4e7", grid: "#30343c" }
  : { background: "#fafafa", text: "#3f3f46", grid: "#e4e4e7" };
```
- [ ] Capture light/charcoal comparison targets at 1440×900, phone and short landscape using the existing song fixture. Capture paused, sounding-note, upcoming-note, wait-target and chord-guide states. Evaluate both palettes; avoid claiming contrast compliance from appearance alone.
- [ ] Add modest key gradients/edge shadows and a clear inset/outline for pressed keys. Cache gradients per size/theme. Keep note pitch colors, LH/RH differentiation and chord dots semantically distinct. Actual notes take precedence over guides. Use no animated glow initially; immediate visual state avoids motion/performance cost.
- [x] Ensure all text/grid/chord annotations adopt the selected stage palette. Preserve the existing canvas top legend's readability; do not put an opaque horizontal strip over the notes. Instrument chrome can have a thin top edge, but the falling bars must still meet keys at the same playhead.
- [ ] Run canvas tests and visually check wide/sparse/dense arrangements, longest chord labels, light/charcoal, both ranges and all hand modes. Check no continuous animation loop while paused. Commit `style: refine piano key depth and stage contrast`.

**Release A gate:** Tasks 1–4 plus Task 8's baseline checks. Do not claim new direct mouse/touch play yet.

## Task 5 — Centralize input ownership and safe release

**Files:** Player.tsx, input.ts, input.test.ts; create `apps/web/src/components/player/held-input.ts` and `held-input.test.ts` only for the shared ownership logic needed by keyboard, MIDI and pointer input.

**Reason:** current Player handleNoteOff removes a pitch unconditionally. Multiple fingers or sources can hold the same pitch; one release must not silence the rest. Engine already tags input voices separately from scheduled song voices—preserve that boundary.

**Interface:**
```ts
type HeldInputSource = "keyboard" | "midi" | "pointer";
// token identifies physical ownership: key:a, midi:<device>:<channel>:60, pointer:7.
// Callback is invoked only on first acquire / final release per pitch.
createHeldInput(on: (midi: number) => boolean, off: (midi: number) => void): {
  press(token: string, midi: number): boolean;
  release(token: string): void;
  releaseAll(): void;
};
```
Use Maps, no event bus. Repeated press for the same token/pitch is ignored. A rejected first on callback does not become held. Changing a token's pitch releases its previous ownership first. MidiInput note callbacks gain an optional second identity parameter to distinguish devices/channels, e.g. `onNoteOn(midi, identity?)`; existing callers can ignore it. Add an optional device-disconnect callback to the MidiInput constructor options so Player releases tokens for that device immediately. Include device and MIDI channel in the stable identity for both on and off. Physical-source filtering remains in Player before ownership acquisition. UI pressedKeys tracks sounding input pitches rather than individual fingers.

- [x] Write the ownership regression before implementation:
```ts
const on = vi.fn(() => true), off = vi.fn();
const held = createHeldInput(on, off);
held.press("key:a", 60); held.press("pointer:7", 60);
held.release("pointer:7"); expect(off).not.toHaveBeenCalled();
held.release("key:a"); expect(off).toHaveBeenCalledExactlyOnceWith(60);
expect(on).toHaveBeenCalledExactlyOnceWith(60);
```
Also test rejected note-on, reused token on another pitch, repeated release, two pointers, channel/device disconnection and releaseAll.
- [x] Wire ownership into manual keyboard/MIDI note lifetimes; preserve the engine's boolean acceptance and existing chord grading. Gate acquisitions during count-in/setup and wrong input mode. Always allow releases even after mode changes. Keep microphone grading on its existing path; it must not be treated as a held pointer.
- [x] Add cleanup on blur, document hidden, unmount, practice input switch, sound-engine replacement and disconnected MIDI device. Clear KeyboardInput's down/heldNotes and pointer state too, so reacquisition after focus returns works. Release only input-owned voices; never stop the transport or flush scheduled song notes. Reset ownership before a new practice attempt.
- [ ] Run input and grading regressions, including simultaneous input/song pitch and rejected wait-mode notes. Commit `fix: track shared piano input ownership and release safely`.

**Acceptance:** no stuck notes, premature release or duplicate grade from overlapping owners. This task must pass before touch is enabled.

## Task 6 — Add direct mouse and multitouch piano playing

**Files:** FallingCanvas.tsx, falling.ts, Player.tsx, PracticeSetupDialog.tsx; core geometry tests, FallingCanvas.test.tsx and player-ui.spec.ts.

**Interfaces:**
```ts
// FallingCanvas additions:
onKeyDown?: (pointerId: number, midi: number) => void;
onKeyUp?: (pointerId: number) => void;
// Shared helper in falling.ts, using keyboardRects for geometry:
keyboardMidiAt(x: number, y: number, keys: ReturnType<typeof keyboardRects>): number | null;
```
Coordinates are relative to keyboard origin in CSS pixels. Derive the pointer overlay bounds from the same LEFT_MARGIN, RIGHT_MARGIN and KB_H calculation used by draw, not a copied approximation. Extract that calculation into one local/shared function if necessary. Hit-test black rectangles before whites. CSS coordinates must not be multiplied twice by devicePixelRatio.

- [x] Add geometry tests: center of each white/black key maps back to its MIDI; black-key overlap wins; out-of-bounds returns null; narrow/full-range/high-DPI layouts preserve identity.
```ts
const keys = keyboardRects({ width: 880, lowMidi: 21, highMidi: 108, whiteHeight: 140 });
for (const key of keys.blacks)
  expect(keyboardMidiAt(key.x + key.w / 2, 10, keys)).toBe(key.midi);
expect(keyboardMidiAt(-1, 10, keys)).toBeNull();
```
- [x] Add a transparent pointer layer only over the piano, with `touch-action: none`; leave scrolling elsewhere untouched. On pointerdown, resolve a pitch and capture that pointer. On move, act only if the pitch changes: release prior owner and press new. Moving outside the piano releases; re-entering during a captured drag may acquire again. Pointerup/cancel/lost capture and blur release the token. Mouse accepts the primary button only; simultaneous touch pointers each retain their own identity.
- [x] Stop pointer-originated click propagation on the piano so the parent stage does not pause. Clicking the falling-note area retains existing pause behavior. Wire pointer input to the existing keyboard practice channel; label the practice input choice `Computer / on-screen keys` while preserving stored `keyboard` enum. In MIDI/microphone-only scored attempts, pointer input is disabled with explanatory text; it cannot silently bypass selected-source grading.
- [x] Provide keyboard access through existing computer mapping plus a focusable piano control: left/right select a note, up/down move an octave, Enter holds until keyup, blur releases. A live description announces the selected note on navigation, not the song stream. Prevent Enter on that control from reaching stage pause. Avoid 88 extra tab stops.
- [ ] Verify pointer chords, glissando, same-pitch overlap, release outside, portrait/landscape rotation while held, open-panel interruption, typing guards and pause interaction. Use synthetic PointerEvents for multi-pointer lifecycle tests plus real touch hardware for final acceptance; desktop emulation is not proof of multitouch feel. Commit `feat: play the piano with mouse and touch`.

**Release B gate:** Tasks 5–6, regression suite, real touch acceptance or explicitly defer mobile touch availability. No automatic zoom, added free-play route or keybinding editor.

## Task 7 — Add rhythm feedback from the existing clock

**Files:** Player.tsx, FallingCanvas.tsx or new compact BeatIndicator.tsx if DOM rendering is simpler; existing practice count-in components and player-ui.spec.ts. Change engine.ts only to expose a necessary existing timing signal, not to reschedule audio.

**Timing contract:** `timeRef.current` is the musical position already used by the canvas. Existing audio scheduler uses quarter-note pulses (`60 / tempoBpm / speed`) and `beatsPerMeasure(timeSig)`. Do not invent a denominator-based clock or silently change 12/8 into a different tempo feel. A 12/8 measure currently spans six quarter-note units. Label the visual signal as a pulse/bar-progress cue rather than claiming a newly grouped compound meter.
```ts
const quarterBeat = time / secPerBeat(tempoBpm, speed);
// Locate the current actual measure using its startBeat/endBeat boundaries.
const fraction = Math.max(0, Math.min(1,
  (quarterBeat - measure.startBeat) / (measure.endBeat - measure.startBeat)));
```
Guard absent/zero-length measures by hiding the indicator. Use boundaries from the actual measure list, including pickup/partial bars. Use existing countIn state for the countdown rather than a separate timer.

- [x] Add cases for 4/4, 3/4, 6/8, 12/8, a pickup bar, pause, seek, loop wrap and 50% speed. Assert normalized bar position is unchanged when speed preserves musical position. Use deterministic time values rather than wall-clock sleeps.
- [x] Draw a small bar-progress/pulse cue in existing keyboard/transport chrome; no extra permanent row. Show count-in while active, stop progress while paused, reset correctly at loop entry, and use text/static emphasis under reduced motion. Do not use aria-live on each pulse.
- [x] Clearly distinguish metronome audible on/off from visual progress. Preserve existing chord-accompaniment metronome behavior; do not display an audible-click animation when that scheduler path suppresses clicks. Expose sustain/instrument state in the existing Sound trigger or compact status area; retain the two gain controls rather than introducing an ambiguous master slider.
- [ ] Run clock/loop/count-in tests and listen to representative 4/4 and 12/8 playback at 50/75/100%. Record whether timing was measured or only listened to. Commit `feat: show practice rhythm and sound state`.

## Task 8 — Acceptance, regression and release

**Files:** existing tests plus evidence under `docs/research/keyspilli-evidence/player-instrument-ui-2026-09-09/`; update release PR description and Obsidian project/daily note. Add tests only for meaningful new behavior, not every style declaration.

- [x] Before long builds, run `df -h /System/Volumes/Data`; stop long loops below 30GiB free. Reuse bounded `.player-review` output. Confirm seed data and local production server belong to the isolated worktree.
- [ ] Run focused checks during each task; run the following once per release candidate after changes settle:
```bash
export PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH
npm run typecheck
npm test
npm run build -w @keyspilli/web
npm exec -w @keyspilli/web -- playwright test e2e/player-ui.spec.ts e2e/app.spec.ts --workers=2
git diff --check
```
The browser server must run the new production build, not a stale process. CI runs the full e2e suite and catalogue/access checks; do not equate the two-file local subset with all CI coverage.
- [ ] Capture matching before/after screenshots at 1440×900, 1740×1370, 1024×768, 390×844 and 844×390. Also check a narrow desktop panel and 200% zoom. Show default, every tool, light/charcoal, Fit/88, chord practice, count-in and input states. Open saved image files and reject blank/loading/cropped captures before using them as evidence.
- [ ] Verify non-falling views: Sheet, Lead sheet, Note letters retain natural height, controls, lyrics and keyboard navigation. Verify source provenance, chord duration gaps, chord dots, single-row progression, loops, speed position stability, focused player, sound previews, scored attempt/repeat and exports.
- [ ] Accessibility gate: all triggers have names, current controls expose selected state, focus order is predictable, Escape returns correctly, closed controls cannot be tabbed into, text contrast meets 4.5:1 and relevant nontext boundaries 3:1, and page zoom never hides the only exit. Keyboard/touch/MIDI must not depend solely on color. Do not claim whole-site WCAG compliance.
- [ ] Performance gate: no frame-driven React rerender loop, no continuous RAF while paused, no growing listeners/pointer maps after repeated mount/switch/blur, no newly audible note delay relative to baseline. Profile a dense arrangement and inspect dropped frames; do not add optimization abstractions without a measured regression.
- [ ] Commit scoped files and create a separate PR for each release. Review exact-head CI, update descriptions around the final implementation, and wait for green checks. On explicit ship authorization, merge without touching original-checkout WIP, watch CI/Deploy, confirm authenticated public health reports the exact merge SHA and healthy status, confirm anonymous boundary remains 401, and record live visual verification separately from version health. If release breaks acceptance, revert the responsible release commit through the normal workflow; do not regenerate catalogue data.

## Acceptance matrix

| Surface | Must demonstrate |
|---|---|
| Tool panels | Same canvas rectangle before/open/switch/close; desktop and mobile focus behavior |
| Fit Passage | Same keys/x positions across start/middle/end, speed and hand changes |
| Mapping | Drawn key hint produces that MIDI; Z/X matches displayed octave; input range does not move stage |
| Piano ownership | Two owners on one pitch; final release only; cancel/blur/unmount/device loss safe |
| Pointer surface | Black-key precedence, simultaneous touch, drag/outside, no stage pause |
| Practice | Correct selected source, no count-in leakage, wait target and grading unchanged |
| Visuals | Readable names/hints/landmarks, distinct playing/upcoming/chord states, light/charcoal |
| Rhythm | Pickup/compound meter, pause/seek/loop/speed, existing audio clock retained |
| Accessibility | Keyboard-only completion, no focus trap on desktop, correct modal trap on phone, zoom/reduced motion |
| Production | Exact-version authenticated healthy response, access boundary, release evidence |

## Later release: bounded single-take practice replay

This is deliberately outside Releases A–C. It is not a generic recorder or an MP3/export promise. The smallest useful scope is a replay of accepted keyboard/MIDI/on-screen input for one completed practice passage.

If prioritized, create a separate implementation plan with these fixed constraints:
- Capture accepted note-on/final note-off events after input-source filtering, against a monotonic performance clock relative to the attempt start. Save the original playback settings and passage identity with the take.
- One in-memory take, maximum 10 minutes or 20,000 events; on reaching either cap, finalize with a visible explanation. No account backend, microphone audio capture, multitrack mixing or upload.
- Finalize open notes on attempt stop/blur. Replay is mutually exclusive with live practice grading and uses the existing audio engine; replay does not score itself or alter the song playhead.
- Before repeating an attempt, explicitly show that the next take replaces the current one. Offer discard/replay; reload does not promise persistence.
- Test overlapping notes, canceled attempts, empty takes, caps, altered speed and replay stop. Measure memory and latency before promising export or persistence.

## Self-review and handoff

Coverage: spec control stability → Task 1; range/landmarks/preferences → Task 2; octave/MIDI → Task 3; finish → Task 4; note cleanup/ownership → Task 5; pointer/accessibility interaction → Task 6; rhythm/sound state → Task 7; responsive/regression/release → Task 8. Recording is explicitly scoped separately.

New interfaces are defined above; all other named functions/types are existing source APIs. Exact component prop plumbing should follow current types during implementation; examples describe the required boundary rather than permission to copy an incompatible signature. No product code was changed while writing this plan.
