import type { MeasureInfo } from "./types.js";

export const NOTATION_MEASURES = "keyspilli-notation-measures-v1";

/** Bounded declared coordinates only; no repeat, authorship or timing authority. */
export function readNotationMeasures(text: string): MeasureInfo[] {
  if (text.length > 262144) throw new Error("notation measure map exceeds bounds");
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || !rows.length || rows.length > 2048) throw new Error("invalid notation measure map");
  let previousEnd = 0;
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 2) throw new Error("invalid notation measure map");
    const [startBeat, endBeat] = row;
    if (!Number.isFinite(startBeat) || startBeat < 0 || Math.abs(startBeat - previousEnd) > 1e-9
      || !Number.isFinite(endBeat) || endBeat <= startBeat || endBeat > 4096) throw new Error("invalid notation measure map");
    previousEnd = endBeat;
    return { index, startBeat, endBeat };
  });
}

export function writeNotationMeasures(measures: readonly MeasureInfo[]): string | null {
  if (!measures.length) return null;
  if (measures.length > 2048 || measures.some((measure, index) => measure.index !== index)) throw new Error("invalid notation measure map");
  const text = JSON.stringify(measures.map(measure => [measure.startBeat, measure.endBeat]));
  readNotationMeasures(text);
  return text;
}
