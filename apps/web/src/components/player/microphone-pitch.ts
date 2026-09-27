/** Emit one finite feedback attack per detected pitch edge. Silence rearms it. */
export function microphonePitchEdge(midi: number | null, lastMidi: number | null, elapsedMs: number): { lastMidi: number | null; fire: boolean } {
  if (midi === null) return { lastMidi: null, fire: false };
  return midi !== lastMidi && elapsedMs > 120 ? { lastMidi: midi, fire: true } : { lastMidi, fire: false };
}
