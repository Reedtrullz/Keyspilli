const NOISE = [
  /\s*[[(][^\])]*(piano|synthesia|tutorial|cover|sheet)[^\])]*[\])]/gi,
  /\s*[-–|]\s*(piano|piano (cover|version|tutorial)|easy piano)\s*$/i,
  /\s+(piano )?(cover|tutorial)\s*$/i,
  /\s*[-–—|]\s*(piano\s+)?(accompaniment|karaoke)(\s*[[(][^\])]*[\])])?\s*$/i,
];

export function displaySong(title: string, artist: string): { title: string; artist: string } {
  let t = title;
  for (const re of NOISE) t = t.replace(re, "").trim();
  t = t.replace(/\s+(piano )?(cover|tutorial)\s*$/i, "").trim();
  let a = /^(unknown|various)$/i.test(artist.trim()) ? "" : artist;
  // "Artist - Song" is the YouTube convention; the stored artist is then usually the channel.
  const m = /^(.{2,}?)\s+[-–]\s+(.{2,})$/.exec(t);
  const [, lead, rest] = m ?? [];
  if (lead && rest) {
    a = lead.trim();
    t = rest.trim();
  }
  t = t.replace(/^["“](.+)["”]$/, "$1");
  return { title: t || title, artist: a };
}
