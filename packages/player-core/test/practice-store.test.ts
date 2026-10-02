import { afterEach, expect, it, vi } from "vitest";
import { loadPracticeState, savePracticeState, passageAvailable, practiceFingerprint, recordAttempt, type PracticeAttempt, type SavedPassage } from "../src/practice-store.js";

afterEach(() => vi.unstubAllGlobals());
it("binds passages to complete source content and keeps bounded, explicit run outcomes", async () => {
  let raw: string | null = null;
  vi.stubGlobal("localStorage", { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } });
  const fingerprint = await practiceFingerprint({ notes: [60, 62, 64], policy: "backing-only" });
  expect(fingerprint).not.toBe(await practiceFingerprint({ notes: [60, 61, 64], policy: "backing-only" }));
  const target = { variantId: "song-e", baseId: "song", fingerprint };
  const passage: SavedPassage = { id: "p1", name: "Pickup and hold", sectionId: "full", note: "Relax", target, startBeat: 0.5, endBeat: 8.5, createdAt: "2026-10-02T00:00:00Z" };
  expect(passageAvailable(passage, target, 9)).toBe(true);
  expect(passageAvailable(passage, { ...target, fingerprint: "sha256:" + "a".repeat(64) }, 9)).toBe(false);
  expect(passageAvailable(passage, target, 8)).toBe(false);
  const state = loadPracticeState();
  state.passages.push(passage);
  expect(savePracticeState(state)).toBe(true);
  expect(loadPracticeState().passages).toEqual([passage]);
  const attempt: PracticeAttempt = { id: "a1", target, startBeat: 0.5, endBeat: 8.5, startedAt: passage.createdAt, finishedAt: passage.createdAt,
    outcome: "cancelled", countInCompleted: false, context: { mode: "falling", difficulty: "easy", input: "keyboard", wait: false, speed: 0.5, transpose: 2, hand: "both", soundSource: "synth", backgroundMode: "piano", accompanimentStyle: "bass-chords", bpm: 120 }, result: null };
  recordAttempt(attempt);
  expect(loadPracticeState().attempts[0]?.outcome).toBe("cancelled");
  recordAttempt({ ...attempt, outcome: "completed", countInCompleted: true, result: { total: 1, hit: 1, wrong: 0, missed: 0, late: 0, accuracyPct: 100 } });
  expect(loadPracticeState().attempts).toHaveLength(1);
  for (let index = 0; index < 205; index++) recordAttempt({ ...attempt, id: `a${index}` });
  expect(loadPracticeState().attempts).toHaveLength(200);
  expect(loadPracticeState().attempts[0]?.id).toBe("a204");
  raw = JSON.stringify({ version: 99, passages: [passage], attempts: [] });
  expect(loadPracticeState().passages).toEqual([]);
  raw = JSON.stringify({ version: 1, passages: [{ ...passage, endBeat: Infinity }], attempts: [] });
  expect(loadPracticeState().passages).toEqual([]);
  raw = "x".repeat(1_048_577);
  expect(loadPracticeState().passages).toEqual([]);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw Error("quota"); } });
  expect(savePracticeState(state)).toBe(false);
});
