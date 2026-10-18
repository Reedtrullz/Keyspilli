import { expect, it, vi } from "vitest";
import { audioActivationPending, resumeAudioContext } from "../src/audio-activation.js";

it("coalesces native resume requests until running and reports their settlement", async () => {
  let state: AudioContextState = "suspended";
  let complete: (() => void) | undefined;
  const context = { get state() { return state; }, resume: vi.fn(() => new Promise<void>(resolve => { complete = resolve; })) };
  const settled = vi.fn();
  resumeAudioContext(context, settled);
  resumeAudioContext(context, settled);
  expect(context.resume).toHaveBeenCalledTimes(1);
  expect(audioActivationPending(context)).toBe(true);
  expect(settled).not.toHaveBeenCalled();
  state = "running";
  if (!complete) throw new Error("Missing native resume request");
  complete();
  await Promise.resolve();
  expect(audioActivationPending(context)).toBe(false);
  expect(settled).toHaveBeenCalledTimes(1);
  resumeAudioContext(context, settled);
  expect(context.resume).toHaveBeenCalledTimes(1);
});

it("reports a refused activation as settled so suspension remains an interruption", async () => {
  let refuse: ((error: Error) => void) | undefined;
  const context = { state: "suspended" as const, resume: vi.fn(() => new Promise<void>((_resolve, reject) => { refuse = reject; })) };
  const observed: string[] = [];
  resumeAudioContext(context, () => { observed.push(context.state); });
  if (!refuse) throw new Error("Missing native resume request");
  refuse(new Error("Audio activation refused"));
  await Promise.resolve();
  expect(audioActivationPending(context)).toBe(false);
  expect(observed).toEqual(["suspended"]);
});

it("does not resume a closed context", () => {
  const context = { state: "closed" as const, resume: vi.fn(() => Promise.resolve()) };
  const settled = vi.fn();
  resumeAudioContext(context, settled);
  expect(context.resume).not.toHaveBeenCalled();
  expect(audioActivationPending(context)).toBe(false);
  expect(settled).not.toHaveBeenCalled();
});
