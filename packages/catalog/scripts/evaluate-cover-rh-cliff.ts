/**
 * Local-only causal diagnostic for the Cover Very Easy -> Beginner RH edge.
 * Inputs are project-owned symbolic fixtures; no media or network access is
 * performed and the output contains logical IDs/hashes only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildVariants,
  type MetalArrangementTraceEvent,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import { sha256Hex } from "../src/fixture-evidence.js";
import {
  canonicalCoverRhCliffJson,
  evaluateCoverRhIdentityCliff,
  type CoverRhCliffReport,
} from "../src/cover-rh-cliff.js";
import { ROOT } from "../src/paths.js";

type Fixture = { id: "classical" | "cover" | "pop"; label: string; logicalRef: string; path: string };

const FIXTURES: Fixture[] = [
  {
    id: "classical",
    label: "Clair de lune",
    logicalRef: "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json",
    path: join(ROOT, "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"),
  },
  {
    id: "cover",
    label: "River Flows in You",
    logicalRef: "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json",
    path: join(ROOT, "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"),
  },
  {
    id: "pop",
    label: "Hello",
    logicalRef: "data/artifacts/adele-hello/a/notes.json",
    path: join(ROOT, "data/artifacts/adele-hello/a/notes.json"),
  },
];

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsed(value: unknown): ParsedMidi {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const notes = Array.isArray(record.notes) ? record.notes as Note[] : [];
  const timeSig: [number, number] = Array.isArray(record.timeSig) && record.timeSig.length === 2
    ? [finiteNumber(record.timeSig[0], 4), finiteNumber(record.timeSig[1], 4)]
    : [4, 4];
  return {
    format: Number.isInteger(record.format) ? Number(record.format) : 1,
    division: Number.isInteger(record.division) ? Number(record.division) : 480,
    tempoBpm: finiteNumber(record.tempoBpm, 120),
    keySig: Number.isInteger(record.keySig) ? Number(record.keySig) : 0,
    keyMode: record.keyMode === 1 ? 1 : 0,
    timeSig,
    notes,
    trackNames: ["project-owned cover RH diagnostic"],
    durationBeats: Math.max(0, finiteNumber(record.durationBeats, 0), ...notes.map((note) => note.start + note.dur).filter(Number.isFinite)),
  };
}

function digest(notes: Note[]): string {
  const rows = notes.map((note) => [
    note.midi,
    note.start.toFixed(6),
    note.dur.toFixed(6),
    note.vel,
    note.hand ?? "",
    note.identitySource ?? "",
  ]).sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return sha256Hex(new TextEncoder().encode(JSON.stringify(rows)));
}

function canonicalBundle(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBundle);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonicalBundle(item)]));
}

async function evaluateFixture(fixture: Fixture, revision: string): Promise<CoverRhCliffReport & { logicalRef: string; sourceDigest: string; levelDigests: Record<string, string> }> {
  const bytes = new Uint8Array(await readFile(fixture.path));
  const source = parsed(JSON.parse(new TextDecoder().decode(bytes)));
  const trace: MetalArrangementTraceEvent[] = [];
  const variants = buildVariants(source, { title: fixture.label, artist: "project-owned diagnostic" }, {
    arrangementProfile: "learner",
    maxDurBeats: null,
    trace: { record: (event) => trace.push(event) },
  });
  const report = evaluateCoverRhIdentityCliff({
    fixture: { id: fixture.id, label: fixture.label },
    source: source.notes,
    sourceMetadata: {
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      noteCount: source.notes.length,
      onsetCount: new Set(source.notes.map((note) => note.start.toFixed(6))).size,
      tempoBpm: source.tempoBpm,
      timeSig: source.timeSig,
      durationBeats: source.durationBeats,
    },
    variants,
    trace,
    revision,
    digests: Object.fromEntries(variants.map((variant) => [variant.level, digest(variant.notes)])),
  });
  return {
    ...report,
    logicalRef: fixture.logicalRef,
    sourceDigest: sha256Hex(bytes),
    levelDigests: Object.fromEntries(variants.map((variant) => [variant.level, digest(variant.notes)])),
  };
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6)
    ?? (outFlag >= 0 ? process.argv[outFlag + 1] : undefined);
  const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice(11)
    ?? (process.argv.indexOf("--revision") >= 0 ? process.argv[process.argv.indexOf("--revision") + 1] : undefined)
    ?? "unspecified";
  const reports = await Promise.all(FIXTURES.map((fixture) => evaluateFixture(fixture, revision)));
  const canonical = canonicalBundle({
    schemaVersion: 1,
    mission: "CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION",
    revision,
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
    fixtures: reports,
  });
  const text = JSON.stringify(canonical, null, 2) + "\n";
  if (out) await writeFile(out, text);
  else process.stdout.write(text);
  if (out) process.stdout.write(`cover-rh-cliff: wrote ${out}\n`);
}

await main();
