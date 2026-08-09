/**
 * Fetch MIDI files for the Ultimate Guitar tab list (catalog/ug-tabs.json)
 * from BitMidi (free MIDI archive; personal/private use) into
 * data/seed-midi/ and append entries to catalog/manifest.json.
 *
 * Matching is verified against the BitMidi PAGE TITLE, not just the slug:
 * multi-word titles need >= 0.55 title similarity plus the artist in the
 * title (or >= 0.8 similarity alone); single-word titles must match the
 * page title exactly. `--reset` removes previous ug-tabs entries first.
 */
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SEED_DIR = join(ROOT, "data", "seed-midi");
const MANIFEST = join(ROOT, "catalog", "manifest.json");
const TABS = join(ROOT, "catalog", "ug-tabs.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36";
const DELAY_MS = 1200;
const reset = process.argv.includes("--reset");

interface Tab {
  artist: string;
  song: string;
}

const ROCK_ARTISTS = new Set([
  "Ozzy Osbourne",
  "Rammstein",
  "Sabaton",
  "Avenged Sevenfold",
  "Nothing More",
  "Foo Fighters",
  "Aerosmith",
  "Ghost",
  "Falling In Reverse",
  "The Pretty Reckless",
  "Linkin Park",
  "The Warning",
  "Status Quo",
  "Bon Jovi",
  "Queen",
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/'/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1));
}

function sim(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let o = 0;
  for (const t of ta) if (tb.has(t)) o++;
  return (2 * o) / (ta.size + tb.size);
}

async function fetchText(url: string, retries = 4): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 502 || res.status === 503 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const pageTitleCache = new Map<string, string>();

async function pageTitle(href: string): Promise<string> {
  const cached = pageTitleCache.get(href);
  if (cached !== undefined) return cached;
  const html = await fetchText(`https://bitmidi.com${href}`);
  const title = (html.match(/<title>([^<]+)/)?.[1] ?? "")
    .replace(/ — Free MIDI — BitMidi$/, "")
    .replace(/\.mid$/i, "")
    .trim();
  if (!title || /502|bad gateway|not found|just a moment|attention required|error/i.test(title)) {
    throw new Error(`transient page error: ${title || "empty title"}`);
  }
  pageTitleCache.set(href, title);
  return title;
}

function accepted(tab: Tab, pageTitleText: string): boolean {
  const titleSim = sim(tab.song, pageTitleText);
  const artistTokens = tokens(tab.artist.replace(/^Misc (Soundtrack|Cartoons|Traditional)\s*/, ""));
  const artistHit = artistTokens.size > 0 && [...artistTokens].every((t) => norm(pageTitleText).includes(t));
  const singleWord = tokens(tab.song).size === 1;
  if (singleWord) {
    const t = [...tokens(tab.song)][0]!;
    return tokens(pageTitleText).has(t) && (artistHit || tokens(pageTitleText).size <= 2);
  }
  if (titleSim >= 0.8) return true;
  return titleSim >= 0.55 && artistHit;
}

async function findMatch(tab: Tab): Promise<{ href: string; title: string } | null> {
  const queries = [`${tab.song} ${tab.artist}`, tab.song];
  for (const q of queries) {
    const html = await fetchText(`https://bitmidi.com/search?q=${encodeURIComponent(q)}`);
    const results: { href: string; text: string }[] = [];
    const re = /<a[^>]+href="(\/[a-z0-9-]+-mid)"[^>]*>([\s\S]*?)<\/a>/g;
    for (const m of html.matchAll(re)) {
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text) results.push({ href: m[1]!, text });
    }
    if (results.length === 0) continue;
    // Prefer slug-similar candidates with artist hints, then verify titles.
    const sorted = results
      .map((r) => {
        const base = sim(tab.song, r.text.replace(/\.mid$/i, ""));
        const artistHint = [...tokens(tab.artist)].some((t) => norm(r.text).includes(t)) ? 0.15 : 0;
        return { ...r, slugScore: base + artistHint };
      })
      .sort((a, b) => b.slugScore - a.slugScore);
    for (const r of sorted.slice(0, 5)) {
      const title = await pageTitle(r.href);
      const ok = accepted(tab, title);
      if (process.env.KEYSPILLI_DEBUG === `${tab.artist}|${tab.song}`) {
        console.log(`  [debug] q="${q}" score=${r.slugScore.toFixed(2)} acc=${ok} | ${r.href} | "${title}"`);
      }
      if (ok) return { href: r.href, title };
    }
  }
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main() {
  await mkdir(SEED_DIR, { recursive: true });
  const tabs: Tab[] = JSON.parse(await readFile(TABS, "utf8"));
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as { songs: Record<string, unknown>[] };

  if (reset) {
    const remaining = manifest.songs.filter((s) => s.source !== "ug-tabs");
    const removed = manifest.songs.filter((s) => s.source === "ug-tabs");
    for (const s of removed) {
      await unlink(join(SEED_DIR, String(s.sourceFile))).catch(() => {});
    }
    manifest.songs = remaining;
    console.log(`--reset: removed ${removed.length} ug-tabs entries`);
  }

  const existing = new Set(manifest.songs.map((s) => String(s.sourceFile)));
  const results: { ok: string[]; failed: { artist: string; song: string; reason: string }[] } = { ok: [], failed: [] };
  const queue = tabs.filter((t) => !existing.has(`${slugify(`${t.artist}-${t.song}`)}.mid`));

  let pending = queue;
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    if (pass > 0) {
      console.log(`retry pass ${pass + 1}: ${pending.length} songs, cooling down 30s…`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
    const stillFailed: Tab[] = [];
    for (const tab of pending) {
      const slug = slugify(`${tab.artist}-${tab.song}`);
      const file = `${slug}.mid`;
      const dest = join(SEED_DIR, file);
      try {
        const match = await findMatch(tab);
        if (!match) throw new Error("no verified match");
        const html = await fetchText(`https://bitmidi.com${match.href}`);
        const dl = html.match(/href="(\/uploads\/\d+\.mid)"/);
        if (!dl) throw new Error("no download link on page");
        const res = await fetch(`https://bitmidi.com${dl[1]}`, {
          headers: { "User-Agent": UA, Referer: `https://bitmidi.com${match.href}` },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`download HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 200 || buf.subarray(0, 4).toString() !== "MThd") throw new Error("not a valid MIDI");
        await writeFile(dest, buf);
        manifest.songs.push({
          id: slug,
          title: tab.song,
          artist: tab.artist,
          category: ROCK_ARTISTS.has(tab.artist) ? "Rock" : "Pop",
          style: ROCK_ARTISTS.has(tab.artist) ? "rock" : "pop",
          mood: "energetic",
          sourceUrl: `https://bitmidi.com${match.href}`,
          sourceFile: file,
          license: "BitMidi (free MIDI archive; private use)",
          source: "ug-tabs",
          verifiedTitle: match.title,
        });
        results.ok.push(file);
        console.log(`+ ${file}  <=  ${match.title}`);
      } catch (e) {
        const msg = (e as Error).message;
        if (/transient page error|HTTP 502|HTTP 503|HTTP 429|aborted due to timeout/.test(msg)) {
          stillFailed.push(tab);
        } else {
          results.failed.push({ artist: tab.artist, song: tab.song, reason: msg });
          console.warn(`x ${tab.artist} - ${tab.song}: ${msg}`);
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    pending = stillFailed;
  }
  for (const tab of pending) {
    results.failed.push({ artist: tab.artist, song: tab.song, reason: "transient errors after 3 passes" });
  }

  manifest.songs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await writeFile(
    MANIFEST,
    JSON.stringify({ ...manifest, generatedAt: new Date().toISOString(), count: manifest.songs.length }, null, 2),
  );
  console.log(`\ndone: ${results.ok.length} added, ${results.failed.length} failed`);
  if (results.failed.length) {
    console.log("FAILED:");
    for (const f of results.failed) console.log(`  ${f.artist} - ${f.song}: ${f.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
