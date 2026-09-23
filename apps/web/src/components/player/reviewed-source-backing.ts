import type { SongData } from "@keyspilli/player-core";

const winnerFingerprint = "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664";

/** Excerpt-tested reduction of the user-selected Winner accompaniment source. */
export function reviewedSourceBacking(data: SongData): SongData["notes"] | null {
  const fingerprint = data.sourceFingerprint;
  if (fingerprint !== winnerFingerprint && !fingerprint?.startsWith(`${winnerFingerprint}:timing:`)) return null;
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
