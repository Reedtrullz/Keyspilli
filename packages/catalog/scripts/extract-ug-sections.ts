#!/usr/bin/env node
/**
 * Extract form headings and chord names from a saved Ultimate Guitar tab page.
 *
 * This is deliberately label extraction only. It reads a local HTML file,
 * reports the chart's own section headings and chord sequence, and never
 * computes beat boundaries, fetches a page, or writes
 * catalog/song-sections.json. Aligning those headings to an arrangement's
 * beat clock stays an owner-reviewed step, because a chord chart describes a
 * song rather than any particular performance.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export interface ExtractedSection {
  label: string;
  chords: string[];
}

export interface ExtractedChart {
  source: "ultimate-guitar";
  tabId: number | null;
  sections: ExtractedSection[];
}

const SECTION_HEADER = /^\[([A-Za-z][A-Za-z0-9 /-]*)\]$/;
const CHORD_TAG = /\[ch\](.*?)\[\/ch\]/gi;
const STRUCTURAL_TAGS = new Set(["tab", "ch", "/tab", "/ch"]);

function decodeAttributeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function readWikiContent(html: string): { content: string; tabId: number | null } {
  const match = /<div[^>]*class="[^"]*js-store[^"]*"[^>]*\sdata-content="([^"]*)"/i.exec(html)
    ?? /<div[^>]*\sdata-content="([^"]*)"[^>]*class="[^"]*js-store[^"]*"/i.exec(html);
  if (!match) {
    throw new Error("No js-store data-content payload found; save the full tab page as HTML.");
  }
  const payload = match[1];
  if (!payload) {
    throw new Error("js-store data-content payload is empty.");
  }
  const root = JSON.parse(decodeAttributeEntities(payload)) as {
    store?: { page?: { data?: { tab?: { id?: number }; tab_view?: { wiki_tab?: { content?: unknown } } } } };
  };
  const data = root.store?.page?.data;
  const content = data?.tab_view?.wiki_tab?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Tab payload has no wiki_tab content; the page may need a different tab type.");
  }
  const tabId = typeof data?.tab?.id === "number" ? data.tab.id : null;
  return { content, tabId };
}

/** Parse a saved Ultimate Guitar page into ordered section headings. */
export function parseChartHtml(html: string): ExtractedChart {
  const { content, tabId } = readWikiContent(html);
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = SECTION_HEADER.exec(line);
    if (header) {
      const label = header[1]!.trim();
      if (!STRUCTURAL_TAGS.has(label.toLowerCase())) {
        current = { label, chords: [] };
        sections.push(current);
      }
      continue;
    }
    if (!current) continue;
    for (const chord of line.matchAll(CHORD_TAG)) {
      const name = chord[1]!.trim();
      if (name) current.chords.push(name);
    }
  }
  if (!sections.length) {
    throw new Error("No form headings found; this tab is not a sectioned chord chart.");
  }
  return { source: "ultimate-guitar", tabId, sections };
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    throw new Error("Usage: extract-ug-sections <saved-tab.html>");
  }
  const html = await readFile(file, "utf8");
  process.stdout.write(JSON.stringify(parseChartHtml(html), null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error instanceof Error ? error.message : error) + "\n");
    process.exitCode = 1;
  });
}
