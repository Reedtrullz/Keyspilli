import { expect, it } from "vitest";
import { microphonePitchEdge } from "./microphone-pitch";

it("attacks once per pitch, rearms on silence, and respects the short refractory interval", () => {
  expect(microphonePitchEdge(60, null, 200)).toEqual({ lastMidi: 60, fire: true });
  expect(microphonePitchEdge(60, 60, 300)).toEqual({ lastMidi: 60, fire: false });
  expect(microphonePitchEdge(null, 60, 300)).toEqual({ lastMidi: null, fire: false });
  expect(microphonePitchEdge(60, null, 50)).toEqual({ lastMidi: null, fire: false });
  expect(microphonePitchEdge(60, null, 200)).toEqual({ lastMidi: 60, fire: true });
  expect(microphonePitchEdge(62, 60, 200)).toEqual({ lastMidi: 62, fire: true });
});
