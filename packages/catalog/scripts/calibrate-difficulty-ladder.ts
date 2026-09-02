/**
 * Reproducible, local-only learner ladder calibration.
 *
 * The inputs are tracked project-owned symbolic artifacts.  The output is
 * logical-ID JSON: no absolute paths, timestamps, network, or publication.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildVariants,
  type Note,
  type ParsedMidi,
  type MetalArrangementTraceEvent,
  type Variant,
} from "@keyspilli/midi";
import { sha256Hex } from "../src/fixture-evidence.js";
import {
  canonicalDifficultyLadderJson,
  evaluateDifficultyLadder,
  type DifficultyLadderEvaluation,
  type DifficultyLadderLevelMetrics,
} from "../src/arrangement-evaluation.js";
import { ROOT } from "../src/paths.js";

type FixtureSpec = {
  id: string;
  logicalRef: string;
  title: string;
  artist: string;
  path?: string;
  inlineNotes?: Note[];
  tempoBpm?: number;
  timeSig?: [number, number];
  durationBeats?: number;
};

function syntheticFullBandNotes(): Note[] {
  const vocals: Note[] = [
    { midi: 64, start: 0, dur: 1.5, vel: 105, hand: "R", identitySource: "vocals" },
    { midi: 65, start: 2, dur: 1.5, vel: 102, hand: "R", identitySource: "vocals" },
    { midi: 67, start: 4, dur: 1.5, vel: 100, hand: "R", identitySource: "vocals" },
    { midi: 69, start: 6, dur: 1.5, vel: 104, hand: "R", identitySource: "vocals" },
  ];
  const guitar: Note[] = [
    ...[[52, 59, 64], [55, 62, 67], [57, 64, 69], [52, 59, 64]].flatMap((stack, index) =>
      stack.map((midi) => ({ midi, start: index * 2, dur: 0.75, vel: 90, hand: "R" as const, identitySource: "guitar" as const }))),
    ...[40, 43, 45, 40].map((midi, index) => ({ midi, start: index * 2, dur: 1.5, vel: 88, hand: "L" as const, identitySource: "guitar" as const })),
  ];
  return [...vocals, ...guitar];
}

const FIXTURES: FixtureSpec[] = [
  {
    id: "classical",
    logicalRef: "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json",
    path: join(ROOT, "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"),
    title: "Clair de lune",
    artist: "Claude Debussy",
  },
  {
    id: "cover",
    logicalRef: "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json",
    path: join(ROOT, "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"),
    title: "River Flows in You",
    artist: "Yiruma",
  },
  {
    id: "pop",
    logicalRef: "data/artifacts/adele-hello/a/notes.json",
    path: join(ROOT, "data/artifacts/adele-hello/a/notes.json"),
    title: "Hello",
    artist: "Adele",
  },
  {
    id: "synthetic-full-band",
    logicalRef: "synthetic:full-band",
    title: "Synthetic full-band",
    artist: "Keyspilli test fixture",
    inlineNotes: syntheticFullBandNotes(),
    tempoBpm: 120,
    timeSig: [4, 4],
    durationBeats: 8,
  },
];

function maxEnd(notes: Note[]): number {
  return Math.max(0, ...notes.map((note) => note.start + note.dur));
}

function parsed(value: Record<string, unknown>): ParsedMidi {
  const notes = Array.isArray(value.notes) ? value.notes as Note[] : [];
  const timeSig: [number, number] = Array.isArray(value.timeSig) && value.timeSig.length === 2
    ? [Number(value.timeSig[0]), Number(value.timeSig[1])] as [number, number]
    : [4, 4];
  const tempoBpm = typeof value.tempoBpm === "number" && Number.isFinite(value.tempoBpm) && value.tempoBpm > 0
    ? value.tempoBpm
    : 120;
  const durationBeats = typeof value.durationBeats === "number" && Number.isFinite(value.durationBeats) && value.durationBeats >= 0
    ? value.durationBeats
    : maxEnd(notes);
  return {
    format: 1,
    division: 480,
    tempoBpm,
    keySig: 0,
    keyMode: 0,
    timeSig,
    notes,
    trackNames: ["project-owned calibration fixture"],
    durationBeats,
    title: typeof value.title === "string" ? value.title : undefined,
  };
}

function inlineBytes(fixture: FixtureSpec): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    notes: fixture.inlineNotes ?? [],
    tempoBpm: fixture.tempoBpm ?? 120,
    timeSig: fixture.timeSig ?? [4, 4],
    durationBeats: fixture.durationBeats ?? 0,
  }));
}

function digest(notes: Note[]): string {
  const canonical = notes
    .map((note) => [
      note.midi,
      note.start.toFixed(6),
      note.dur.toFixed(6),
      note.vel,
      note.hand ?? "",
      note.identitySource ?? "",
    ])
    .sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)));
}

function variantSummary(variant: Variant, ladderLevel: DifficultyLadderLevelMetrics): Record<string, unknown> {
  return {
    digest: digest(variant.notes),
    noteCount: ladderLevel.noteCount,
    rightHandCount: ladderLevel.rightHandCount,
    leftHandCount: ladderLevel.leftHandCount,
    onsetCount: ladderLevel.onsetCount,
    durationBeats: ladderLevel.durationBeats,
    maxSimultaneity: ladderLevel.maxSimultaneity,
  };
}

async function main(): Promise<void> {
  const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
    ?? (process.argv[process.argv.indexOf("--out") + 1] || undefined);
  const fixtures: Array<Record<string, unknown>> = [];
  for (const fixture of FIXTURES) {
    const bytes = fixture.inlineNotes
      ? inlineBytes(fixture)
      : new Uint8Array(await readFile(fixture.path!));
    const source = parsed(fixture.inlineNotes
      ? { notes: fixture.inlineNotes, tempoBpm: fixture.tempoBpm, timeSig: fixture.timeSig, durationBeats: fixture.durationBeats }
      : JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
    const trace: MetalArrangementTraceEvent[] = [];
    const variants = buildVariants(source, { title: fixture.title, artist: fixture.artist }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
      trace: { record: (event) => trace.push(event) },
    });
    const ladder: DifficultyLadderEvaluation = evaluateDifficultyLadder({
      fixture: { id: fixture.id, label: fixture.title },
      sourceNotes: source.notes,
      variants,
      trace,
    });
    fixtures.push({
      id: fixture.id,
      logicalRef: fixture.logicalRef,
      source: {
        sha256: sha256Hex(bytes),
        noteCount: source.notes.length,
        onsetCount: new Set(source.notes.map((note) => note.start.toFixed(6))).size,
        tempoBpm: source.tempoBpm,
        timeSig: source.timeSig,
        durationBeats: source.durationBeats,
      },
      levels: Object.fromEntries(variants.map((variant) => [variant.level, variantSummary(variant, ladder.levels[variant.level]!)])),
      ladder,
      determinism: {
        canonicalSha256: sha256Hex(new TextEncoder().encode(canonicalDifficultyLadderJson(ladder))),
      },
    });
  }
  const report = {
    schemaVersion: 1,
    mission: "difficulty-ladder-calibration",
    startingRevision: "d41ac4178817e75a8c7217768b8ac7779613100c",
    profile: "learner",
    scope: { behavioralFixes: 0, externalReferenceUsed: false, audioGenerated: false, productionReplay: false },
    fixtures,
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}

await main();
