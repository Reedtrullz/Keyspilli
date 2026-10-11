import { afterEach, expect, it, vi } from "vitest";
import { parseLibraryReturn, readLibraryReturn, saveLibraryReturn, transferLibraryReturn } from "./library-navigation";

afterEach(() => vi.unstubAllGlobals());

it("validates and canonicalizes tab-local library return context", () => {
  const context = { playerId: "lesson-a", href: "/songs?q=piano&key=Cm&page=2&legacy=1&unrelated=discard#library", scrollY: 812, restoreScroll: true };
  expect(parseLibraryReturn(JSON.stringify(context))).toEqual({ ...context, href: "/songs?q=piano&key=Cm&page=2#library" });
});

it("retains supported Unicode filters within their existing query length limits", () => {
  const params = new URLSearchParams(Object.fromEntries(["q", "artist", "style", "mood", "category"].map(key => [key, "ø".repeat(256)])));
  const href = `/songs?${params}`;
  expect(href.length).toBeGreaterThan(4096);
  expect(parseLibraryReturn(JSON.stringify({ playerId: "lesson-a", href, scrollY: 12 }))?.href).toBe(href);
});

it.each(["https://example.com/songs", "//example.com/songs", "/uploads", "/songs/other"])("rejects non-library return target %s", href => {
  expect(parseLibraryReturn(JSON.stringify({ playerId: "lesson-a", href, scrollY: 0 }))).toBeNull();
});

it.each([null, "invalid", "[]", JSON.stringify({ playerId: "", href: "/songs", scrollY: 0 }), JSON.stringify({ playerId: "lesson-a", href: "/songs", scrollY: -1 }), JSON.stringify({ playerId: "lesson-a", href: "/songs", scrollY: "12" })])("rejects malformed library return state", value => {
  expect(parseLibraryReturn(value)).toBeNull();
});

it("keeps context scoped to its player and transfers it to a loaded version", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  saveLibraryReturn({ playerId: "lesson-a", href: "/songs?key=Cm&page=2", scrollY: 800 });
  expect(readLibraryReturn("unrelated")).toBeNull();
  transferLibraryReturn("unrelated", "lesson-b");
  expect(readLibraryReturn("lesson-a")?.scrollY).toBe(800);
  transferLibraryReturn("lesson-a", "lesson-b");
  expect(readLibraryReturn("lesson-a")).toBeNull();
  expect(readLibraryReturn("lesson-b")).toMatchObject({ href: "/songs?key=Cm&page=2", scrollY: 800, restoreScroll: false });
});

it("falls back safely when browser storage access is denied", () => {
  vi.stubGlobal("window", { get sessionStorage() { throw new Error("Storage denied"); } });
  expect(readLibraryReturn("lesson-a")).toBeNull();
  expect(() => saveLibraryReturn({ playerId: "lesson-a", href: "/songs", scrollY: 0 })).not.toThrow();
  expect(() => transferLibraryReturn("lesson-a", "lesson-b")).not.toThrow();
});
