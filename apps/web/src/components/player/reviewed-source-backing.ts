import type { SongData } from "@keyspilli/player-core";

const winnerFingerprint = "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664";

/** Excerpt-tested reduction of the user-selected Winner accompaniment source. */
export function reviewedSourceBacking(data: SongData): SongData["notes"] | null {
  const fingerprint = data.sourceFingerprint;
  if (fingerprint !== winnerFingerprint && !fingerprint?.startsWith(`${winnerFingerprint}:timing:`)) return null;

  // ponytail: This exact-source pilot uses its established 4-beat bars; add
  // source-role metadata and measure-aware reduction after whole-song review.
  const leftAttacks = new Map<number, number[]>();
  for (const note of data.notes) {
    if (note.hand !== "L") continue;
    const bar = Math.floor(note.start / 4);
    const attacks = leftAttacks.get(bar) ?? [];
    if (!attacks.includes(note.start)) attacks.push(note.start);
    leftAttacks.set(bar, attacks);
  }
  for (const attacks of leftAttacks.values()) attacks.sort((a, b) => a - b);
  return data.notes.filter((note) => note.hand !== "L"
    || (leftAttacks.get(Math.floor(note.start / 4))?.indexOf(note.start) ?? -1) < 3);
}
