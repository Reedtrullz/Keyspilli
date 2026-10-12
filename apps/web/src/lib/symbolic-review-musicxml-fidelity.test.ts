import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSymbolicScore } from "./symbolic-review-input";

describe("score review cannot reinterpret unsupported transposition as source truth", () => {
  it.each(["musicxml", "mxl"] as const)("refuses %s without a written-pitch fallback", (format) => {
    const xml = '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><transpose><chromatic>-2</chromatic></transpose></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
    const bytes = format === "mxl" ? zipSync({ "score.musicxml": strToU8(xml) }) : strToU8(xml);
    expect(() => parseSymbolicScore(bytes, format)).toThrow(/transpose.*concert-pitch/i);
  });
});
