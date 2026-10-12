import {
  practicePulseProblem, practicePulseSettingsError, readPracticePulseSettings,
  saveSettings, saveSongPrefs,
  type EngineSongMeta, type LoopRegion, type PlaybackEngine, type PlayerSettings,
  type PracticeBeatGroups, type PracticePulse, type PracticePulseSettings, type SongData,
} from "@keyspilli/player-core";
import type { PracticeSetup } from "./PracticeSetupDialog";
import { playerArrangementEnd } from "./chords-backing";

/** Reuse the Player's existing, already-selected navigation and validated phase. */
export function playerPracticeTiming(
  data: SongData,
  measures: readonly { startBeat: number }[],
  validatedTiming: SongData["sourceTiming"],
): EngineSongMeta {
  return {
    tempoBpm: data.tempoBpm,
    timeSig: data.timeSig,
    measureStarts: measures.map(measure => measure.startBeat),
    ...(data.timeSigEvents?.length ? { timeSigEvents: data.timeSigEvents.map(event => ({ beat: event.beat, timeSig: event.timeSig })) } : {}),
    ...(validatedTiming ? { measureStartBeat: validatedTiming.measureStartBeat } : {}),
    endBeat: playerArrangementEnd(data),
  };
}

export function practicePulseDraft(
  choice: PracticePulse | "default",
  rows: readonly { timeSig: readonly [number, number]; text: string }[],
): { settings: PracticePulseSettings | undefined; error: string | null } {
  if (choice === "default") return { settings: undefined, error: null };
  if (rows.length > 32) return { settings: undefined, error: "Practice grouping supports at most 32 distinct meters." };
  const beatGroups: PracticeBeatGroups[] = [];
  for (const row of rows) {
    const text = row.text.trim();
    if (!text) continue;
    if (text.length > 160 || !/^\d+(?:\s*\+\s*\d+)*$/.test(text)) return { settings: undefined, error: `Grouping in ${row.timeSig.join("/")} needs whole numbers separated by +. Leave it blank for bar accents only.` };
    beatGroups.push({ timeSig: row.timeSig, groups: text.split("+").map(value => Number(value.trim())) });
  }
  const candidate: PracticePulseSettings = { pulse: choice, ...(beatGroups.length ? { beatGroups } : {}) };
  const error = practicePulseSettingsError(candidate);
  return { settings: error ? undefined : readPracticePulseSettings(candidate), error };
}

/** Resolve safe runtime settings without discarding intent on a temporary map. */
export function resolvePlayerPracticePulse(settings: PlayerSettings, timing: EngineSongMeta): { settings: PlayerSettings; notice: string | null } {
  if (settings.practicePulse === undefined) return { settings, notice: null };
  const problem = practicePulseProblem(timing, settings.practicePulse, timing.endBeat ?? 0);
  if (!problem) return { settings, notice: null };
  const { practicePulse: _practicePulse, ...fallback } = settings;
  return { settings: fallback, notice: `Default quarter-note clicks are active for the current bar map. Your pulse choice is kept. ${problem} Review it in Set up practice.` };
}

/** Install the explicit choice before the first graded event; save only a valid start. */
export function startPracticeWithPulse(
  engine: PlaybackEngine,
  current: PlayerSettings,
  songId: string,
  timing: EngineSongMeta,
  setup: PracticeSetup,
  range: LoopRegion,
): PlayerSettings {
  if (setup.practicePulse !== undefined) {
    const error = practicePulseSettingsError(setup.practicePulse);
    if (error) throw new RangeError(error);
  }
  const { practicePulse: _practicePulse, ...rest } = current;
  const pulse = readPracticePulseSettings(setup.practicePulse);
  const metronome = setup.metronome ?? current.metronome;
  const pulseChanged = JSON.stringify(pulse) !== JSON.stringify(current.practicePulse);
  // Preserve identity so an unchanged no-count-in start does not trigger the
  // Player timeline effect after its first notes and clicks have been scheduled.
  const next: PlayerSettings = metronome === current.metronome && !pulseChanged
    ? current : { ...rest, metronome, ...(pulse ? { practicePulse: pulse } : {}) };
  const previous = engine.settings;
  engine.setSettings(next, timing, engine.duration);
  try { engine.startGrading(setup.wait, range, setup.articulation ? setup.articulationToleranceMs ?? 150 : undefined); }
  catch (error) { engine.setSettings(previous, timing, engine.duration); throw error; }
  if (next.metronome !== current.metronome) saveSettings(next);
  if (pulseChanged) saveSongPrefs(songId, { practicePulse: next.practicePulse });
  return next;
}
