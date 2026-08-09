/**
 * Fetch ~110 solo-piano MIDI files from Mutopia (public-domain / CC-BY-SA
 * collection) into data/seed-midi/ and write catalog/manifest.json.
 * Idempotent: skips already-downloaded files unless --force.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SEED_DIR = join(ROOT, "data", "seed-midi");
const MANIFEST = join(ROOT, "catalog", "manifest.json");
const LISTING =
  "https://www.mutopiaproject.org/cgibin/make-table.cgi?startat={start}&searchingfor=&Composer=&Instrument=Piano&Style=&collection=&id=&solo=&recent=&timelength=&timeunit=&lilyversion=&preview=";
const TARGET = 110;
const MAX_PER_COMPOSER = 6;
const force = process.argv.includes("--force");

interface Row {
  title: string;
  composer: string;
  instrumentation: string;
  style: string;
  license: string;
  midUrl: string;
}

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(start: number): Promise<{ rows: Row[]; more: boolean }> {
  const res = await fetch(LISTING.replace("{start}", String(start)), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`listing ${start}: HTTP ${res.status}`);
  const html = await res.text();
  const groups = html.split(/<table class="table-bordered result-table">/i).slice(1);
  const rows: Row[] = [];
  for (const g of groups) {
    const innerRows = g.split(/<tr/i).slice(1);
    const cells = (i: number) =>
      (innerRows[i] ? [...innerRows[i]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1] ?? "")) : []);
    const mid = g.match(/href="(https:\/\/www\.mutopiaproject\.org\/ftp\/[^"]+\.mid)"/);
    if (!mid) continue;
    const r1 = cells(0);
    const r2 = cells(1);
    const r3 = cells(2);
    rows.push({
      title: r1[0] || "Untitled",
      composer: (r1[1] || "").replace(/^by\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim(),
      instrumentation: r2[0] || "",
      style: r2[2] || "",
      license: r3[1] || "",
      midUrl: mid[1] ?? "",
    });
  }
  const more = /make-table\.cgi\?startat=\d+/.test(html);
  return { rows, more };
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
  await mkdir(join(ROOT, "catalog"), { recursive: true });
  const seen = new Set<string>();
  const perComposer = new Map<string, number>();
  const picked: Row[] = [];

  for (let start = 0; picked.length < TARGET * 1.6 && start < 3000; start += 10) {
    const { rows, more } = await fetchPage(start);
    for (const r of rows) {
      const inst = r.instrumentation.toLowerCase();
      if (!inst.includes("piano")) continue;
      const key = `${r.composer}|${r.title}`.toLowerCase();
      if (seen.has(key)) continue;
      const c = perComposer.get(r.composer) ?? 0;
      if (c >= MAX_PER_COMPOSER) continue;
      seen.add(key);
      perComposer.set(r.composer, c + 1);
      picked.push(r);
    }
    if (!more) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  // Prefer solo-piano pieces ("for Piano") when we have enough.
  const solo = picked.filter((r) => /^for\s+piano$/i.test(r.instrumentation));
  const list = (solo.length >= TARGET ? solo : picked).slice(0, TARGET);
  console.log(`${list.length} candidates (${solo.length} solo piano)`);

  const entries: Record<string, unknown>[] = [];
  let failures = 0;
  for (const r of list) {
    const slug = slugify(`${r.composer}-${r.title}`);
    const file = `${slug}.mid`;
    const dest = join(SEED_DIR, file);
    try {
      await access(dest);
      if (!force) {
        entries.push(mkEntry(slug, r, file));
        continue;
      }
    } catch {}
    try {
      const res = await fetch(r.midUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error("too small");
      await writeFile(dest, buf);
      entries.push(mkEntry(slug, r, file));
      console.log(`+ ${file}`);
    } catch (e) {
      failures++;
      console.warn(`- skip ${file}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  await writeFile(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, songs: entries }, null, 2));
  console.log(`manifest: ${entries.length} songs, ${failures} download failures`);
}

function mkEntry(slug: string, r: Row, file: string): Record<string, unknown> {
  return {
    id: slug,
    title: r.title,
    artist: r.composer,
    category: "Classical",
    style: "classical",
    mood: "peaceful",
    sourceUrl: r.midUrl,
    sourceFile: file,
    license: r.license || "Mutopia (public domain or CC-BY-SA; private use)",
    instrument: r.instrumentation,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
