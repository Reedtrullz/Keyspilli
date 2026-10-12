import type { MeasureInfo } from "../src/types.js";

export const pickupKinds = ["simple", "compound", "meter-change"] as const;
export type PickupKind = typeof pickupKinds[number];

/** Self-authored controls: an initial rest/attack, ordinary bars, then one rest bar. */
export function pickupFixture(kind: PickupKind, fullBars = 2): { xml: string; measures: MeasureInfo[]; endBeat: number } {
  const compound = kind === "compound";
  const initial = compound ? [6, 8] : [4, 4];
  const pickup = compound ? 1.5 : 1;
  const attributes = (meter: number[], divisions = false) => `<attributes>${divisions ? "<divisions>4</divisions>" : ""}<time><beats>${meter[0]}</beats><beat-type>${meter[1]}</beat-type></time></attributes>`;
  const note = (step: string, beats: number) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${beats * 4}</duration><voice>1</voice><staff>1</staff></note>`;
  const rest = (beats: number) => `<note><rest/><duration>${beats * 4}</duration></note>`;
  const measures: MeasureInfo[] = [{ index: 0, startBeat: 0, endBeat: pickup }];
  const xmlMeasures = [`<measure number="0" implicit="yes">${attributes(initial, true)}<direction><sound tempo="120"/></direction>${rest(.5)}${note("C", pickup - .5)}</measure>`];
  let endBeat = pickup;
  const steps = ["D", "E", "F", "G", "F", "E", "D", "C"];
  for (let index = 0; index < fullBars; index++) {
    const width = compound || kind === "meter-change" && index > 0 ? 3 : 4;
    const change = kind === "meter-change" && index === 1 ? attributes([6, 8]) : "";
    xmlMeasures.push(`<measure number="${index + 1}">${change}${Array.from({ length: width }, (_, beat) => note(steps[(index * 4 + beat) % steps.length]!, 1)).join("")}</measure>`);
    measures.push({ index: measures.length, startBeat: endBeat, endBeat: endBeat + width });
    endBeat += width;
  }
  const tailWidth = compound || kind === "meter-change" && fullBars > 1 ? 3 : 4;
  xmlMeasures.push(`<measure number="${fullBars + 1}">${rest(tailWidth)}</measure>`);
  measures.push({ index: measures.length, startBeat: endBeat, endBeat: endBeat + tailWidth });
  endBeat += tailWidth;
  return { xml: `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${xmlMeasures.join("")}</part></score-partwise>`, measures, endBeat };
}

/** Actual format-0 MIDI: 120 BPM through beat 4, 60 BPM thereafter, EOT at 12. */
export function twoTempoMidi(metadata: Array<{ beat: number; text: string }> = [], pedalChanges: Array<{ beat: number; value: number }> = []): Uint8Array {
  const varint = (value: number) => {
    const out = [value & 127];
    while ((value >>>= 7) > 0) out.unshift((value & 127) | 128);
    return out;
  };
  const events = [
    ...metadata.map(event => {
      const bytes = [...new TextEncoder().encode(event.text)];
      return { beat: event.beat, bytes: [255, 127, ...varint(bytes.length), ...bytes] };
    }),
    ...pedalChanges.map(event => ({ beat: event.beat, bytes: [176, 64, event.value] })),
    { beat: 0, bytes: [255, 81, 3, 7, 161, 32] },
    { beat: 0, bytes: [255, 88, 4, 4, 2, 24, 8] },
    { beat: 0, bytes: [144, 60, 80] },
    { beat: 1, bytes: [128, 60, 0] },
    { beat: 4, bytes: [255, 81, 3, 15, 66, 64] },
    { beat: 4, bytes: [144, 64, 80] },
    { beat: 5, bytes: [128, 64, 0] },
    { beat: 8, bytes: [144, 67, 80] },
    { beat: 9, bytes: [128, 67, 0] },
    { beat: 12, bytes: [255, 47, 0] },
  ].sort((a, b) => a.beat - b.beat);
  let previous = 0;
  const body = events.flatMap(event => {
    const tick = event.beat * 480;
    const bytes = [...varint(tick - previous), ...event.bytes];
    previous = tick;
    return bytes;
  });
  return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
    77, 84, 114, 107, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body]);
}
