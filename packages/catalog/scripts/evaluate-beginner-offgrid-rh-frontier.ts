/**
 * Read-only, path-free diagnostic for the preregistered Beginner RH frontier.
 * It requires the project-owned symbolic fixture data mounted under `data/`;
 * no generated MIDI is written.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildVariants, type MetalArrangementTraceEvent, type Note, type ParsedMidi } from "@keyspilli/midi";
import { canonicalBeginnerOffGridRhFrontierJson, evaluateBeginnerOffGridRhFrontier, type BeginnerOffGridRhFrontierReport } from "../src/beginner-offgrid-rh-frontier.js";
import { ROOT } from "../src/paths.js";

type Fixture = { id: "classical" | "cover" | "pop"; label: string; logicalRef: string; path: string };
const FIXTURES: Fixture[] = [
  { id: "classical", label: "Clair de lune", logicalRef: "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json", path: join(ROOT, "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json") },
  { id: "cover", label: "River Flows in You", logicalRef: "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json", path: join(ROOT, "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json") },
  { id: "pop", label: "Hello", logicalRef: "data/artifacts/adele-hello/a/notes.json", path: join(ROOT, "data/artifacts/adele-hello/a/notes.json") },
];

function numberOr(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

function parsed(value: unknown): ParsedMidi {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const notes = Array.isArray(record.notes) ? record.notes as Note[] : [];
  const timeSig: [number, number] = Array.isArray(record.timeSig) && record.timeSig.length === 2
    ? [numberOr(record.timeSig[0], 4), numberOr(record.timeSig[1], 4)] : [4, 4];
  return { format: Number.isInteger(record.format) ? Number(record.format) : 1, division: Number.isInteger(record.division) ? Number(record.division) : 480, tempoBpm: numberOr(record.tempoBpm, 120), keySig: Number.isInteger(record.keySig) ? Number(record.keySig) : 0, keyMode: record.keyMode === 1 ? 1 : 0, timeSig, notes, trackNames: ["project-owned off-grid RH diagnostic"], durationBeats: Math.max(0, numberOr(record.durationBeats, 0), ...notes.map((note) => note.start + note.dur).filter(Number.isFinite)) };
}

async function evaluateFixture(fixture: Fixture, revision: string): Promise<BeginnerOffGridRhFrontierReport & { logicalRef: string }> {
  const bytes = await readFile(fixture.path);
  const source = parsed(JSON.parse(new TextDecoder().decode(bytes)));
  const trace: MetalArrangementTraceEvent[] = [];
  const variants = buildVariants(source, { title: fixture.label, artist: "project-owned diagnostic" }, { arrangementProfile: "learner", maxDurBeats: null, trace: { record: (event) => trace.push(event) } });
  return { ...evaluateBeginnerOffGridRhFrontier({ fixture: { id: fixture.id, label: fixture.label }, sourceNotes: source.notes, variants, trace, revision }), logicalRef: fixture.logicalRef };
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? (outIndex >= 0 ? process.argv[outIndex + 1] : undefined);
  const revisionIndex = process.argv.indexOf("--revision");
  const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice(11) ?? (revisionIndex >= 0 ? process.argv[revisionIndex + 1] : undefined) ?? "unspecified";
  const reports = await Promise.all(FIXTURES.map((fixture) => evaluateFixture(fixture, revision)));
  const text = JSON.stringify({
    schemaVersion: 1,
    mission: "BEGINNER_OFF_GRID_INTERIOR_RH_BUDGET_FRONTIER",
    revision,
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
    fixtures: reports.map((report) => JSON.parse(canonicalBeginnerOffGridRhFrontierJson(report))),
  }, null, 2) + "\n";
  if (out) { await writeFile(out, text); process.stderr.write(`beginner-offgrid-rh-frontier: wrote ${out}\n`); }
  else process.stdout.write(text);
}

await main();
