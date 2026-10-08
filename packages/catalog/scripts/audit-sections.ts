#!/usr/bin/env node
/**
 * Catalog-wide song-section ledger and section-map integrity gate.
 *
 * Read-only. For every known catalog base it reports whether a real section
 * map already resolves, whether the retained source MIDI carries timed form
 * markers that are not mapped yet, and whether an Ultimate Guitar candidate
 * exists. It exits non-zero when a section map could never resolve or is
 * structurally invalid, so CI can gate map changes.
 *
 * Inputs that do not exist locally (seed MIDI, learner review) are reported as
 * unavailable rather than treated as failures; this checkout may be partial.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMidi } from "@keyspilli/midi";

type Evidence = "source" | "chart" | "estimated";

interface Section {
  id: string;
  label: string;
  startBeat: number;
  endBeat: number;
  type?: string;
  evidence?: Evidence;
}

interface MapEntry {
  baseId: string;
  sourceArtifactHash: string;
  playbackTempoBpm: number;
  sourceFile?: string;
  provenance?: string;
  advancedNotesSha256?: string;
  sections: Section[];
}

interface LedgerRow {
  baseId: string;
  lane: "mapped-source" | "mapped-chart" | "marker-harvest" | "ug-candidate" | "estimate-only";
  served: "public" | "blocked" | "unknown";
  mapped: boolean;
  seedMarkers: string[] | null;
  ugCandidate: boolean;
}

const VALID_EVIDENCE = new Set<string>(["source", "chart", "estimated"]);
const HEX64 = /^[0-9a-f]{64}$/;

export interface CapturedSectionBase {
  baseId: string;
  sourceArtifactHash: string;
  advancedNotesSha256: string;
  playbackTempoBpm: number;
  servedAtCapture: boolean;
}

/** Frozen playback identities extend the ledger to uploads and transcriptions.
 * They describe the capture, not current service availability or acceptance. */
export function capturedSectionBases(input: unknown, errors: string[]): Map<string, CapturedSectionBase> {
  const result = new Map<string, CapturedSectionBase>();
  if (!input || typeof input !== "object") { errors.push("captured bases: invalid document"); return result; }
  const doc = input as {schemaVersion?:unknown;capturedAt?:unknown;entries?:unknown};
  if (doc.schemaVersion !== 1) errors.push("captured bases: schemaVersion must be 1");
  if (typeof doc.capturedAt !== "string" || !Number.isFinite(Date.parse(doc.capturedAt))) errors.push("captured bases: invalid capturedAt");
  if (!Array.isArray(doc.entries)) { errors.push("captured bases: entries must be an array"); return result; }
  for (const raw of doc.entries) {
    if (!raw || typeof raw !== "object") { errors.push("captured bases: malformed entry"); continue; }
    const entry = raw as CapturedSectionBase;
    const at = `captured[${entry.baseId}]`;
    let valid = true;
    const reject = (message:string) => { errors.push(`${at}: ${message}`); valid = false; };
    if (typeof entry.baseId !== "string" || !/^[a-z0-9-]+$/.test(entry.baseId)) reject("invalid baseId");
    if (typeof entry.sourceArtifactHash !== "string" || !HEX64.test(entry.sourceArtifactHash)) reject("invalid sourceArtifactHash");
    if (typeof entry.advancedNotesSha256 !== "string" || !HEX64.test(entry.advancedNotesSha256)) reject("invalid advancedNotesSha256");
    if (!Number.isFinite(entry.playbackTempoBpm) || entry.playbackTempoBpm <= 0) reject("invalid playbackTempoBpm");
    if (typeof entry.servedAtCapture !== "boolean") reject("invalid servedAtCapture");
    if (result.has(entry.baseId)) reject("duplicate baseId");
    if (valid) result.set(entry.baseId, entry);
  }
  return result;
}

export function validateCapturedMap(entry: Pick<MapEntry,"baseId"|"sourceArtifactHash"|"advancedNotesSha256"|"playbackTempoBpm">,
  captured: ReadonlyMap<string,CapturedSectionBase>, errors:string[]): void {
  const identity = captured.get(entry.baseId);
  if (!identity) return; // Seed and learner inventories retain their existing checks.
  for (const field of ["sourceArtifactHash","playbackTempoBpm"] as const) {
    if (entry[field] !== identity[field]) errors.push(`map[${entry.baseId}]: ${field} differs from captured playback identity`);
  }
  if (entry.advancedNotesSha256 !== undefined && entry.advancedNotesSha256 !== identity.advancedNotesSha256) {
    errors.push(`map[${entry.baseId}]: advancedNotesSha256 differs from captured playback identity`);
  }
}

export function ugCandidateIds(songs: Array<{id:string;title?:string;artist?:string;source?:string}>, ug: Array<{artist?:string;song?:string}>): Set<string> {
  const slug = (value:string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const key = (artist:string,title:string) => slug(artist)+":"+slug(title);
  const identities = new Set(ug.filter(row=>row.artist&&row.song).map(row=>key(row.artist!,row.song!)));
  const ids = new Set(ug.filter(row=>row.artist&&row.song).map(row=>slug(row.artist!+" "+row.song!)));
  for (const song of songs) {
    if (song.source === "ug-tabs" || (song.artist && song.title && identities.has(key(song.artist,song.title)))) ids.add(song.id);
  }
  return ids;
}

function repoRoot(): string {
  // scripts/ -> packages/catalog -> packages -> repository root
  return fileURLToPath(new URL("../../../", import.meta.url));
}

/**
 * Seed MIDI is gitignored runtime state, so an operator can point the ledger
 * at a checkout that has it without moving catalog JSON out of this tree.
 */
function seedDir(root: string): string {
  const flag = process.argv.indexOf("--seed-dir");
  if (flag >= 0 && process.argv[flag + 1]) return process.argv[flag + 1]!;
  return join(root, "data/seed-midi");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function validateEntry(entry: MapEntry, errors: string[]): void {
  const at = "map[" + entry.baseId + "]";
  if (!entry.baseId || typeof entry.baseId !== "string") errors.push("entry without baseId");
  if (!HEX64.test(entry.sourceArtifactHash || "")) {
    errors.push(at + ": sourceArtifactHash must be 64 lowercase hex characters");
  }
  if (!Number.isFinite(entry.playbackTempoBpm) || entry.playbackTempoBpm <= 0) {
    errors.push(at + ": playbackTempoBpm must be positive");
  }
  if (!Array.isArray(entry.sections) || entry.sections.length === 0) {
    errors.push(at + ": sections must be a non-empty array");
    return;
  }
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const section of entry.sections) {
    if (!section || typeof section !== "object") {
      errors.push(at + ": malformed section object");
      continue;
    }
    if (typeof section.id !== "string" || !section.id) errors.push(at + ": section without id");
    else if (ids.has(section.id)) errors.push(at + ": duplicate section id " + section.id);
    else ids.add(section.id);
    if (typeof section.label !== "string" || !section.label.trim()) {
      errors.push(at + ": section without label");
    } else if (section.label.length > 160) {
      errors.push(at + ": label longer than 160 characters");
    }
    if (typeof section.evidence === "string" && !VALID_EVIDENCE.has(section.evidence)) {
      errors.push(at + ": unknown evidence " + section.evidence);
    }
    if (!Number.isFinite(section.startBeat) || section.startBeat < previousEnd) {
      errors.push(at + ": sections overlap or run backwards before " + section.label);
    }
    if (!Number.isFinite(section.endBeat) || section.endBeat <= section.startBeat) {
      errors.push(at + ": non-positive span for " + section.label);
    }
    previousEnd = Number.isFinite(section.endBeat) ? Math.max(previousEnd, section.endBeat) : previousEnd;
  }
}

function seedMarkers(path: string): string[] | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = parseMidi(readFileSync(path));
    return (parsed.sections || []).map((section) => section.label);
  } catch {
    return [];
  }
}

function main(): number {
  const root = repoRoot();
  const errors: string[] = [];
  const warnings: string[] = [];

  const mapDoc = readJson<{ schemaVersion?: number; entries?: MapEntry[] }>(join(root, "catalog/song-sections.json"));
  const entries = mapDoc?.entries || [];
  if (!mapDoc) warnings.push("catalog/song-sections.json missing or unreadable");

  const manifest = readJson<{ songs?: Array<{ id: string; disabled?: boolean; source?: string; title?:string; artist?:string }> }>(
    join(root, "catalog/manifest.json"),
  );
  const learner = readJson<{ verdicts?: Record<string, { blocked?: boolean }> }>(
    join(root, "catalog/learner-review.json"),
  );
  const ug = readJson<Array<{ artist?: string; song?: string }>>(join(root, "catalog/ug-tabs.json"));
  const capturedPath = join(root, "catalog/section-base-identities.json");
  const captured = existsSync(capturedPath) ? capturedSectionBases(readJson<unknown>(capturedPath), errors) : new Map<string,CapturedSectionBase>();
  const markersDir = seedDir(root);
  const hasSeed = existsSync(markersDir);
  if (!hasSeed) warnings.push("data/seed-midi unavailable; marker harvest not assessed in this checkout");

  const manifestIds = new Set((manifest?.songs || []).map((song) => song.id));
  const blocked = new Set(
    Object.entries(learner?.verdicts || {})
      .filter(([, verdict]) => verdict.blocked === true)
      .map(([baseId]) => baseId),
  );
  const seedIds = hasSeed
    ? new Set(
        readdirSync(markersDir)
          .filter((name) => name.endsWith(".mid"))
          .map((name) => basename(name, ".mid")),
      )
    : new Set<string>();
  const known = new Set([...manifestIds, ...Object.keys(learner?.verdicts || {}), ...seedIds, ...captured.keys()]);

  const mapped = new Map<string, MapEntry>();
  for (const entry of entries) {
    validateEntry(entry, errors);
    validateCapturedMap(entry, captured, errors);
    if (!known.has(entry.baseId)) {
      errors.push(
        "map[" + entry.baseId + "]: baseId is not present in catalog/manifest.json, learner review, data/seed-midi or captured playback identities",
      );
    }
    mapped.set(entry.baseId, entry);
    if (blocked.has(entry.baseId)) {
      warnings.push("map[" + entry.baseId + "]: target is learner-blocked, so the map cannot resolve until unblocked");
    }
  }

  const ugList = ugCandidateIds(manifest?.songs ?? [], ug ?? []);
  const rows: LedgerRow[] = [];
  for (const baseId of [...known].sort()) {
    const entry = mapped.get(baseId);
    const markers = hasSeed ? seedMarkers(join(markersDir, baseId + ".mid")) : null;
    const lane: LedgerRow["lane"] = entry
      ? entry.sections[0]?.evidence === "chart"
        ? "mapped-chart"
        : "mapped-source"
      : markers && markers.length
        ? "marker-harvest"
        : ugList.has(baseId)
          ? "ug-candidate"
          : "estimate-only";
    rows.push({
      baseId,
      lane,
      served: blocked.has(baseId) ? "blocked" : manifestIds.has(baseId) ? "public" : "unknown",
      mapped: Boolean(entry),
      seedMarkers: markers,
      ugCandidate: ugList.has(baseId),
    });
  }

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.lane] = (acc[row.lane] || 0) + 1;
    return acc;
  }, {});

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ counts, errors, warnings, rows }, null, 2) + "\n");
  } else {
    const lines = [
      "section ledger: " + rows.length + " known bases",
      JSON.stringify(counts),
      "maps: " + entries.length,
      "errors: " + errors.length,
      "warnings: " + warnings.length,
    ];
    for (const error of errors) lines.push("ERROR " + error);
    for (const warning of warnings) lines.push("WARN  " + warning);
    const harvest = rows.filter((row) => row.lane === "marker-harvest");
    for (const row of harvest) lines.push("HARVEST " + row.baseId + " -> " + (row.seedMarkers || []).join(", "));
    process.stdout.write(lines.join("\n") + "\n");
  }
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
