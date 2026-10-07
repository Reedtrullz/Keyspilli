import type { Section } from "@keyspilli/midi";

const SECTION_TYPES = new Set([
  "verse",
  "chorus",
  "bridge",
  "intro",
  "outro",
  "pre-chorus",
  "interlude",
  "custom",
]);
const EVIDENCE = new Set(["source", "chart", "estimated"]);

/**
 * Owner-authored practice sections sit at the top of the label hierarchy,
 * above retained source markers and chart maps. They deliberately carry no
 * evidence value: "source" would overstate marker provenance and "estimated"
 * would demote a deliberate human edit to a machine guess.
 */
export function validateOwnedSections(value: unknown): string | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return "sections must be an array or null";
  if (value.length === 0) return "sections must contain at least one section";
  if (value.length > 512) return "sections must contain at most 512 entries";
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const section of value as Array<Partial<Section> | null | undefined>) {
    if (!section || typeof section !== "object") return "sections must contain only objects";
    const id = section.id;
    if (typeof id !== "string" || !id.trim() || id.length > 160) return "each section needs a short non-empty id";
    if (ids.has(id)) return "section ids must be unique";
    ids.add(id);
    const label = section.label;
    if (typeof label !== "string" || !label.trim()) return "each section needs a label";
    if (label.trim().length > 160) return "section labels must be 160 characters or fewer";
    if (section.type !== undefined && !SECTION_TYPES.has(String(section.type))) {
      return "section type must be a known form role";
    }
    if (section.evidence !== undefined && !EVIDENCE.has(String(section.evidence))) {
      return "section evidence must be source, chart or estimated";
    }
    const start = section.startBeat;
    const end = section.endBeat;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      return "section startBeat must be a non-negative number";
    }
    if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
      return "section endBeat must be greater than startBeat";
    }
    if (start < previousEnd) return "sections must not overlap or run backwards";
    previousEnd = end;
  }
  return null;
}

/**
 * Parse a persisted row value. Invalid or absent data yields null so song
 * loading falls back to maps and estimates instead of failing.
 */
export function parseOwnedSections(raw: string | null | undefined): Section[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (validateOwnedSections(parsed) !== null) return null;
  return parsed as Section[];
}
