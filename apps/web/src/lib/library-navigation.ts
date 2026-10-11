import { PUBLIC_DIFFICULTY_ORDER } from "@keyspilli/midi";

export const KEY_ROOTS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "Cb", "B#", "E#", "Fb"];
export const LIBRARY_KEYS = [...KEY_ROOTS, ...KEY_ROOTS.map(key => `${key}m`)];
export const BASS_PATTERNS = ["block", "octave", "oompah", "walking", "pedal", "arpeggio"];
export const DEFAULT_QUERY = { q: "", importMethod: "", key: "", bass: "", artist: "", difficulty: "", style: "", mood: "", category: "", sort: "popular", favorites: false, page: 1 };
export type LibraryQuery = typeof DEFAULT_QUERY;

export function readLibraryQuery(params: URLSearchParams): LibraryQuery {
  const pick = (key: string, choices: readonly string[], fallback = "") => choices.includes(params.get(key) ?? "") ? params.get(key)! : fallback;
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").slice(0, 256), artist: (params.get("artist") ?? "").slice(0, 256),
    style: (params.get("style") ?? "").slice(0, 256), mood: (params.get("mood") ?? "").slice(0, 256), category: (params.get("category") ?? "").slice(0, 256),
    importMethod: pick("importMethod", ["midi", "sheet-music", "youtube", "other"]),
    key: pick("key", LIBRARY_KEYS), bass: pick("bass", BASS_PATTERNS), difficulty: pick("difficulty", PUBLIC_DIFFICULTY_ORDER),
    sort: pick("sort", ["popular", "title", "artist", "difficulty", "newest"], "popular"),
    favorites: params.get("favorites") === "1", page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function writeLibraryQuery(params: URLSearchParams, query: LibraryQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("legacy"); // This library only displays public levels.
  for (const [key, value] of Object.entries(query)) {
    next.delete(key);
    if (value !== DEFAULT_QUERY[key as keyof LibraryQuery]) next.set(key, key === "favorites" ? "1" : String(value));
  }
  return next;
}

type LibraryReturn = { playerId: string; href: string; scrollY: number; restoreScroll: boolean };
const RETURN_KEY = "keyspilli.library-return.v1";

export function parseLibraryReturn(value: string | null): LibraryReturn | null {
  try {
    const row = JSON.parse(value ?? "null");
    if (!row || typeof row.playerId !== "string" || !row.playerId || row.playerId.length > 256 ||
        typeof row.href !== "string" || row.href.length > 16_384 || !row.href.startsWith("/songs") ||
        typeof row.scrollY !== "number" || !Number.isFinite(row.scrollY) || row.scrollY < 0 || row.scrollY > 10_000_000) return null;
    const url = new URL(row.href, "https://keyspilli.invalid");
    if (url.origin !== "https://keyspilli.invalid" || url.pathname !== "/songs") return null;
    const params = writeLibraryQuery(new URLSearchParams(), readLibraryQuery(url.searchParams));
    return { playerId: row.playerId, href: `/songs${params.size ? `?${params}` : ""}${url.hash.slice(0, 256)}`, scrollY: row.scrollY, restoreScroll: row.restoreScroll === true };
  } catch { return null; }
}

export function readLibraryReturn(playerId?: string): LibraryReturn | null {
  try {
    const context = parseLibraryReturn(window.sessionStorage.getItem(RETURN_KEY));
    return context && (!playerId || context.playerId === playerId) ? context : null;
  } catch { return null; }
}

export function saveLibraryReturn(context: Omit<LibraryReturn, "restoreScroll"> & { restoreScroll?: boolean }): void {
  try {
    const validated = parseLibraryReturn(JSON.stringify(context));
    if (validated) window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(validated));
  } catch { /* Storage can be unavailable; the link still opens the library. */ }
}

export function transferLibraryReturn(fromId: string, toId: string): void {
  const context = readLibraryReturn(fromId);
  if (context) saveLibraryReturn({ ...context, playerId: toId });
}
