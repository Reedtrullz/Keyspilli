import { expect, it, vi } from "vitest";
import { createHeldInput } from "./held-input";

it("releases a shared pitch only after its final owner, including slides and cleanup", () => {
  const on = vi.fn(() => true), off = vi.fn();
  const held = createHeldInput(on, off);
  held.press("key:a", 60); held.press("pointer:7", 60);
  held.press("pointer:7", 60);
  expect(on).toHaveBeenCalledExactlyOnceWith(60);
  held.press("pointer:7", 64);
  expect(off).not.toHaveBeenCalled();
  held.release("key:a"); expect(off).toHaveBeenCalledExactlyOnceWith(60);
  held.releaseAll(); held.releaseAll();
  expect(off.mock.calls).toEqual([[60], [64]]);
});

it("does not retain rejected notes or release a pitch it never acquired", () => {
  const off = vi.fn();
  const held = createHeldInput(() => false, off);
  expect(held.press("pointer:1", 60)).toBe(false);
  held.release("pointer:1"); held.releaseAll();
  expect(off).not.toHaveBeenCalled();
});

it("holds only pedal-owned input voices until pedal-up and force releases on cleanup", () => {
  const on = vi.fn(() => true), off = vi.fn();
  const held = createHeldInput(on, off);
  held.setPedal("midi:a:0:", true);
  held.press("midi:a:0:60", 60); held.release("midi:a:0:60");
  held.press("key:a", 64); held.release("key:a");
  expect(off.mock.calls).toEqual([[64]]);
  held.setPedal("midi:a:0:", false); expect(off.mock.calls).toEqual([[64], [60]]);
  held.setPedal("midi:a:0:", true); held.press("midi:a:0:62", 62); held.release("midi:a:0:62");
  held.releaseAll(); expect(off.mock.calls).toEqual([[64], [60], [62]]);
});
