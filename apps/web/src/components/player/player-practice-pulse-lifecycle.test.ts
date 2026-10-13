import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeMusicXml, type Variant } from "@keyspilli/midi";
import {
  DEFAULT_SETTINGS, PlaybackEngine, loadSongPracticePulse, loadSongPrefs,
  playbackMeasures, playbackTiming, resolveTimedNotes, saveSettings, saveSongPrefs,
  type AudioLike, type EngineSongMeta, type PlayerSettings, type SongData, type TimedNote,
} from "@keyspilli/player-core";
import { playerPracticeTiming, resolvePlayerPracticePulse, startPracticeWithPulse } from "./player-practice-pulse";
import { prepareScoreNavigation } from "./sheet-navigation";

// Replay the current Player's resolution/effects and settings callbacks, rather
// than a copy of the recovery logic. This is a bounded lifecycle test, not a DOM
// mount or a physical-audio test; navigation, storage and scheduling are real.
const path = new URL("./Player.tsx", import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const player = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "FullPlayer")!;
const statements = player.body!.statements;
const effects = statements.filter((node): node is ts.ExpressionStatement => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect");
const resolution = statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "pulseResolution"))!;
const recovery = effects.filter(node => node.getText(source).includes("pulseResolution") && !node.getText(source).includes("engineRef"));
const timeline = effects.find(node => node.getText(source).includes("engine.setSettings(pulseResolution.settings"))!;
const updateSettings = statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "updateSettings")!;
let pulseNoticeExpression = "";
let practiceStart: ts.TryStatement | undefined;
function inspect(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "p") {
    const expression = node.children.find((child): child is ts.JsxExpression => ts.isJsxExpression(child)
      && !!child.expression?.getText(source).includes("practicePulseNotice"));
    if (expression?.expression) pulseNoticeExpression = expression.expression.getText(source);
  }
  if (ts.isTryStatement(node) && node.tryBlock.getText(source).includes("startPracticeWithPulse(")) practiceStart = node;
  ts.forEachChild(node, inspect);
}
inspect(player);
function run(code: string, bindings: Record<string, unknown>): unknown {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}

class Calls implements AudioLike {
  clicks: Array<{ at: number; accent: string }> = [];
  notes: TimedNote[] = [];
  cancels = 0;
  clock = () => 0;
  ensure() {}
  noteOn(note: TimedNote) { this.notes.push(note); }
  noteOff() {}
  metronomeClick(beat: number, when = 0, accent?: "group") {
    this.clicks.push({ at: Number((this.clock() + when).toFixed(8)), accent: beat === 0 ? "bar" : accent ?? "pulse" });
  }
  cancelAll() { this.cancels++; }
  setGains() {}
  dispose() {}
  sustainPedal = false;
}
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
const songId = "delayed-score-pulse";
const key = `keyspilli.song-prefs.v1:${songId}`;
const song: SongData = {
  tempoBpm: 120, timeSig: [5, 8], key: "C", chords: [], sourceFingerprint: "delayed-score-pulse-source",
  notes: [{ midi: 60, start: 0, dur: .5, vel: 80 }, { midi: 64, start: 3, dur: .5, vel: 80 }],
  measures: [{ index: 0, startBeat: 0, endBeat: 3 }, { index: 1, startBeat: 3, endBeat: 5.5 }],
  timeSigEvents: [{ beat: 0, tick: 0, timeSig: [6, 8] }, { beat: 3, tick: 1440, timeSig: [5, 8] }],
};
const selectedPulse = { pulse: "eighth" as const, beatGroups: [
  { timeSig: [6, 8] as const, groups: [3, 3] }, { timeSig: [5, 8] as const, groups: [2, 3] },
] };
const initialTiming = playerPracticeTiming(song, playbackMeasures(song), playbackTiming(song));
function acceptedTiming(): EngineSongMeta {
  const variant: Variant = { ...song, level: "advanced", difficultyScore: 0, bassPattern: "source" };
  const map = prepareScoreNavigation(writeMusicXml(variant, "Delayed score", "Keyspilli"), song, "revision", "revision");
  return playerPracticeTiming(song, map.measures, playbackTiming(song));
}
function playerLifecycle() {
  const saved = loadSongPracticePulse(songId);
  let settings: PlayerSettings = { ...DEFAULT_SETTINGS, metronome: true, ...(saved.settings ? { practicePulse: saved.settings } : {}) };
  let practicePulseNotice = saved.notice ?? "";
  const setSettings = vi.fn((next: PlayerSettings) => { settings = next; });
  const setPracticePulseNotice = (notice: string) => { practicePulseNotice = notice; };
  const initial = { song: { id: songId }, chordUnavailableReason: null };
  const bindings = () => ({ settings, practicePulseNotice, setSettings, setPracticePulseNotice, initial, saveSongPrefs,
    resolvePlayerPracticePulse, useMemo: (factory: () => unknown) => factory(), useEffect: (effect: () => void) => effect() });
  const render = (engineSongTiming: EngineSongMeta) => run(
    `${resolution.getText(source)}\n${recovery.map(node => node.getText(source)).join("\n")}\nreturn { resolution: pulseResolution, notice: (${pulseNoticeExpression}) };`,
    { ...bindings(), engineSongTiming },
  ) as { resolution: ReturnType<typeof resolvePlayerPracticePulse>; notice: string | null };
  const synchronize = (engine: PlaybackEngine, engineSongTiming: EngineSongMeta, current = render(engineSongTiming)) => run(timeline.getText(source), {
    ...bindings(), engineRef: { current: engine }, engineSongTiming, pulseResolution: current.resolution,
    duration: engine.duration, notes: engine.notes, audioChords: [], guidanceNotes: engine.gradingNotes, loop: null, syncTransportState() {},
  });
  const changeUnrelatedSetting = (engine: PlaybackEngine) => run(`${updateSettings.getText(source)}\nupdateSettings({ keyboardLabels: "off" });`, {
    ...bindings(), engineRef: { current: engine }, gradingRef: { current: false }, sourceBackingNotes: undefined, saveSettings,
  });
  const startUnchanged = (engine: PlaybackEngine, engineSongTiming: EngineSongMeta) => run(practiceStart!.getText(source), {
    ...bindings(), eng: engine, engineSongTiming, startPracticeWithPulse,
    setup: { input: "keyboard", wait: false, scope: "beginning", countInBeats: 0, metronome: true },
    range: { startSec: 0, endSec: 2 }, setPracticeError: (message: string) => { throw new Error(message); },
  });
  return { render, synchronize, changeUnrelatedSetting, startUnchanged, settings: () => settings, setSettings };
}
function engineFor(settings: PlayerSettings, timing: EngineSongMeta) {
  const audio = new Calls();
  const engine = new PlaybackEngine(audio, resolveTimedNotes(song, 1, 0), 8, timing, settings);
  audio.clock = () => engine.time;
  return { audio, engine };
}
function play(engine: PlaybackEngine) {
  engine.start(); for (let i = 0; i < 120; i++) engine.tick(.025); engine.stop();
}

it("keeps saved intent through the arithmetic map and activates it after the accepted score arrives", async () => {
  expect(playbackTiming(song)).toBeUndefined();
  expect(initialTiming.measureStarts).toEqual([0, 2.5, 5]);
  saveSongPrefs(songId, { practicePulse: selectedPulse });
  const savedBytes = stored.get(key);
  const lifecycle = playerLifecycle();
  const pending = lifecycle.render(initialTiming);
  expect(pending.resolution.settings.practicePulse).toBeUndefined();
  const { engine, audio } = engineFor(pending.resolution.settings, initialTiming);
  play(engine); expect(audio.clicks.map(click => click.at)).toEqual([0, .5, 1, 1.25, 1.5, 2, 2.5, 3]); // existing quarter clicks plus displayed bar starts
  expect(audio.clicks.some(click => click.accent === "group")).toBe(false);
  expect(stored.get(key)).toBe(savedBytes);
  expect(lifecycle.settings().practicePulse).toEqual(selectedPulse);
  expect(pending.notice).toMatch(/Default quarter-note clicks.*current bar map.*choice is kept/);
  const verifiedTiming = await Promise.resolve().then(acceptedTiming);
  expect(verifiedTiming.measureStarts).toEqual([0, 3]);
  expect(verifiedTiming.measureStartBeat).toBeUndefined(); // accepted displayed bars do not assert source phase
  const ready = lifecycle.render(verifiedTiming);
  expect(ready.notice).toBeFalsy();
  expect(ready.resolution.settings.practicePulse).toEqual(selectedPulse);
  lifecycle.synchronize(engine, verifiedTiming, ready);
  engine.seek(0); audio.clicks = []; play(engine);
  expect(audio.clicks).toHaveLength(11);
  expect(audio.clicks.filter(click => click.accent === "group")).toEqual([{ at: .75, accent: "group" }, { at: 2, accent: "group" }]);
  expect(stored.get(key)).toBe(savedBytes);
});

it("keeps the saved pulse when an unrelated setting is saved during runtime fallback", () => {
  saveSongPrefs(songId, { practicePulse: selectedPulse });
  const lifecycle = playerLifecycle();
  const pending = lifecycle.render(initialTiming);
  const { engine } = engineFor(pending.resolution.settings, initialTiming);
  lifecycle.changeUnrelatedSetting(engine);
  expect(lifecycle.settings().keyboardLabels).toBe("off");
  expect(loadSongPrefs(songId).practicePulse).toEqual(selectedPulse);
  expect(lifecycle.render(acceptedTiming()).resolution.settings.practicePulse).toEqual(selectedPulse);
});

it("retains an unsupported choice safely until the user explicitly selects default clicks", () => {
  const unsupported = { pulse: "eighth" as const, beatGroups: [{ timeSig: [7, 8] as const, groups: [2, 2, 3] }] };
  saveSongPrefs(songId, { practicePulse: unsupported });
  const savedBytes = stored.get(key);
  const lifecycle = playerLifecycle();
  const timing = acceptedTiming();
  const current = lifecycle.render(timing);
  const { engine, audio } = engineFor(current.resolution.settings, timing);
  play(engine); expect(audio.clicks.some(click => click.accent === "group")).toBe(false);
  expect(lifecycle.render(timing).notice).toMatch(/7\/8.*Set up practice/);
  expect(stored.get(key)).toBe(savedBytes);
  expect(lifecycle.settings().practicePulse).toEqual(unsupported);
  expect(() => startPracticeWithPulse(engine, lifecycle.settings(), songId, timing,
    { input: "keyboard", wait: false, scope: "beginning", countInBeats: 0, practicePulse: unsupported }, { startSec: 0, endSec: 2 })).toThrow(/7\/8/);
  expect(stored.get(key)).toBe(savedBytes);
  startPracticeWithPulse(engine, lifecycle.settings(), songId, timing,
    { input: "keyboard", wait: false, scope: "beginning", countInBeats: 0 }, { startSec: 0, endSec: 2 });
  expect(loadSongPrefs(songId).practicePulse).toBeUndefined();
});

it("keeps malformed saved settings visibly excluded from runtime and current intent", () => {
  stored.set(key, JSON.stringify({ practicePulse: { pulse: "eighth", beatGroups: [{ timeSig: [5, 8], groups: [2, 2] }] } }));
  const lifecycle = playerLifecycle();
  const current = lifecycle.render(initialTiming);
  expect(current.notice).toMatch(/Saved practice pulse was invalid.*Set up practice/);
  expect(lifecycle.settings().practicePulse).toBeUndefined();
  const { engine } = engineFor(current.resolution.settings, initialTiming);
  expect(() => play(engine)).not.toThrow();
});

it("does not resynchronize notes and clicks after an unchanged no-count-in practice start", () => {
  const lifecycle = playerLifecycle();
  const timing = acceptedTiming();
  const original = lifecycle.settings();
  const { engine, audio } = engineFor(original, timing);
  lifecycle.startUnchanged(engine, timing);
  engine.start();
  // A changed settings identity is the dependency that schedules the real
  // Player timeline effect after the synchronous no-count-in start.
  if (lifecycle.settings() !== original) lifecycle.synchronize(engine, timing);
  expect(audio.notes).toHaveLength(1);
  expect(audio.clicks).toHaveLength(1);
  expect(audio.cancels).toBe(0);
  expect(lifecycle.settings()).toBe(original);
  expect(lifecycle.setSettings).not.toHaveBeenCalled();
});
