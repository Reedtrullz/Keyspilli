import type { ChordLabel, Note, SongData } from "@keyspilli/player-core";

const winnerFingerprint = "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664";
const dreamerFingerprint = "variant:ozzy-osbourne-dreamer:a:ozzy-osbourne-dreamer-a:552ee76720620c3aba739c9442757f9675f99b2994a2f410471a583f250745b5:notes:6be7abe3a7498c1f8beab543dcd62cfac5c23635d42ed82764fa705b607bd020";
const fixYouFingerprint = "variant:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0:a:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0-a:1e867afd1e1a389672199ebef7c355d0674b9995a40d655f7425f86b9967c851:notes:f251038e1ab8bdb0c5b23026d670fa819d5784580cf139db00e81ad1d09b2e9b";
const surviveFingerprint = "variant:gloria-gaynor-i-will-survive:a:gloria-gaynor-i-will-survive-a:df59b0eb90e4c2ecf9c8b9cf13cba3bcdd8c9ea9942bdb09ee54b7664538784a:notes:448373fe2bb4a5c8e510b26dd6a226b5ab3366cb37808bc9029af965564dc8e1";
const armyFingerprint = "variant:status-quo-in-the-army-now:a:status-quo-in-the-army-now-a:0cccaa9f5ad91707327ab6c1f311e30e3de6fb3c91d1695f862c646b8772ab65:notes:f61af5ba58446fd7cafc71ae95569a75d1dc16ca584d787d40ec317c359656ad";
const allOfMeFingerprint = "variant:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x:a:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x-a:504cf2504309905c76338b1e0bd0d4b5b09fd45f3029ba5ebdd1881274ae0d76:notes:2d8212fa850c7dfcbc3dbf0029f4b22a2ee93385fe686214b48b20db28865cfb";

/** Excerpt-tested reduction of the user-selected Winner accompaniment source. */
export function reviewedSourceBacking(data: SongData): SongData["notes"] | null {
  if (data.sourceFingerprint === dreamerFingerprint && data.tempoBpm === 80) {
    return data.notes.filter((note) => note.sourceLane === "blue keys");
  }
  if (data.sourceFingerprint === fixYouFingerprint && data.tempoBpm === 68) {
    return data.notes.filter((note) => note.sourceLane === "blue keys" || note.sourceLane === "green keys");
  }
  if (data.sourceFingerprint === allOfMeFingerprint) {
    const rightByBeat = new Map<number, Note[]>();
    for (const note of data.notes) if (note.hand === "R") {
      rightByBeat.set(note.start, [...(rightByBeat.get(note.start) ?? []), note]);
    }
    return data.notes.filter((note) => {
      if (note.hand === "L") return true;
      const stack = rightByBeat.get(note.start) ?? [];
      return stack.length >= 2 && Math.max(...stack.map((played) => played.midi)) - Math.min(...stack.map((played) => played.midi)) <= 12
        && stack.every((played) => played.midi <= 77);
    });
  }
  if (data.sourceFingerprint !== winnerFingerprint) return null;
  if (data.timeSig[0] !== 4 || data.timeSig[1] !== 4
    || data.timeSigEvents?.some((event) => event.timeSig[0] !== 4 || event.timeSig[1] !== 4)) return null;

  // ponytail: This exact-source pilot uses its established 4-beat bars and
  // an earlier accompaniment refrain; use source-role metadata for other songs.
  const leftAttacks = new Map<number, number[]>();
  for (const note of data.notes) {
    if (note.hand !== "L") continue;
    const bar = Math.floor(note.start / 4);
    const attacks = leftAttacks.get(bar) ?? [];
    if (!attacks.includes(note.start)) attacks.push(note.start);
    leftAttacks.set(bar, attacks);
  }
  for (const attacks of leftAttacks.values()) attacks.sort((a, b) => a - b);
  const priorBars = [72, 65, 66, 67, 68, 69, 70, 71];
  const sourceRight = data.notes.filter((note) => note.hand === "R");
  const finalRefrain = Array.from({ length: 15 }, (_, offset) => {
    const targetBar = 129 + offset;
    const sourceBar = priorBars[offset % priorBars.length]!;
    return sourceRight.filter((note) => sourceBar * 4 <= note.start && note.start < (sourceBar + 1) * 4)
      .map((note) => ({ ...note, start: note.start + (targetBar - sourceBar) * 4 }));
  }).flat();
  return [
    ...data.notes.filter((note) =>
      (note.hand !== "L" || (leftAttacks.get(Math.floor(note.start / 4))?.indexOf(note.start) ?? -1) < 3)
      && !(note.hand === "R" && 516 <= note.start && note.start < 576)
      && !(note.hand === "R" && note.start === 576 && note.midi >= 80)),
    ...finalRefrain,
  ].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** Short played keys that carry the groove between the larger chord attacks. */
export function reviewedRhythmNotes(data: SongData, chords: readonly ChordLabel[], chordAttacks: readonly ChordLabel[]): Note[] {
  const survive = data.sourceFingerprint === surviveFingerprint;
  const army = data.sourceFingerprint === armyFingerprint;
  if ((!survive && !army) || !chords.some((chord) => chord.sourceKind === "authored")) return [];
  const short = data.notes.filter((note) => note.dur <= 0.26 && (survive
    ? note.hand === "R" && 60 <= note.midi && note.midi <= 84
    : note.hand === "L" && 48 <= note.midi && note.midi <= 60));
  const grouped = new Map<number, Note[]>();
  for (const note of short) grouped.set(note.start, [...(grouped.get(note.start) ?? []), note]);
  const result: Note[] = [];
  for (const [beat, notes] of grouped) {
    if (chordAttacks.some((chord) => Math.abs(chord.beat - beat) < 0.01)) continue;
    const chord = chords.find((candidate) => candidate.beat <= beat && beat < candidate.beat + (candidate.durationBeats ?? 0));
    if (!chord) continue;
    const sounding = chordAttacks.find((attack) => chord.beat <= attack.beat && attack.beat < chord.beat + (chord.durationBeats ?? 0));
    if (!sounding) continue;
    const tones = new Set(sounding.notes.map((midi) => midi % 12));
    const played = notes.filter((note) => tones.has(note.midi % 12));
    if (survive && played.length < 2) continue;
    result.push(...played.map((note) => ({ ...note, vel: Math.min(note.vel, 64) })));
  }
  return result;
}
