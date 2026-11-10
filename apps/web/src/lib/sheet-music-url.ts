export function sheetMusicUrl(songId: string, revision: string | null | undefined): string {
  const query = revision === undefined ? "" : `?revision=${revision === null ? "unpinned" : encodeURIComponent(revision)}`;
  return `/api/v1/sheet/${encodeURIComponent(songId)}${query}`;
}
