import { expect, it } from "vitest";
import { keyboardRects, keyboardMidiAt } from "../src/views/falling.js";

it("uses black-key precedence and CSS-pixel bounds for every key at narrow and wide sizes", () => {
  for (const width of [320, 880, 1600]) {
    const keys = keyboardRects({ width, lowMidi: 21, highMidi: 108, whiteHeight: 140 });
    for (const key of keys.blacks) expect(keyboardMidiAt(key.x + key.w / 2, 10, keys)).toBe(key.midi);
    for (const key of keys.whites) expect(keyboardMidiAt(key.x + key.w / 2, 139, keys)).toBe(key.midi);
    expect(keyboardMidiAt(-1, 10, keys)).toBeNull();
    expect(keyboardMidiAt(width, 10, keys)).toBeNull();
    expect(keyboardMidiAt(10, 140, keys)).toBeNull();
  }
});
