/**
 * Score Chords-mode harmony labels against expert reference chords.
 *
 *   git clone --depth 1 https://github.com/AndyWeasley2004/POP909-CL-Dataset output/pop909-cl
 *   npx tsx packages/midi/scripts/chord-benchmark.ts output/pop909-cl/POP909_processed [--split dev|holdout|all] [--limit N] [--tuning tuning.json] [--gate] [--rows]
 *
 * POP909-CL (MIT) stores each song's piano score on one track and its
 * expert-reviewed chords as block chords on the last track. The score goes
 * through the catalogue's own `buildVariants`, so both labellers see exactly
 * the Advanced notes the app would have. Every fifth song (001-based number
 * divisible by 5) is held out: tune on `dev`, report `holdout`.
 * `--tuning` merges a JSON object over CHORDS_TUNING.harmony for experiments.
 * `--gate` exits 1 when held-out accuracy is below CHORDS_TUNING.gate.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CHORDS_TUNING,
  buildVariants,
  inferHarmonyTimeline,
  keyName,
  parseMidi,
  type HarmonyTuning,
} from "../src/index.js";
import { chordsFromBlocks, chordsFromLabels, scoreChords, type ChordScore } from "../src/chord-scoring.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dir = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (!dir) {
  console.error("usage: chord-benchmark.ts <POP909_processed dir> [--split dev|holdout|all] [--limit N] [--tuning file.json] [--gate] [--rows]");
  process.exit(2);
}
const split = flag("--split") ?? "all";
const limit = Number(flag("--limit") ?? Infinity);
const tuningPath = flag("--tuning");
const tuning: HarmonyTuning = tuningPath
  ? { ...CHORDS_TUNING.harmony, ...JSON.parse(readFileSync(tuningPath, "utf8")) }
  : CHORDS_TUNING.harmony;

type Row = { song: string; split: "dev" | "holdout"; beats: number; stored: ChordScore; harmony: ChordScore };
const rows: Row[] = [];
const failures: string[] = [];
const files = readdirSync(dir).filter((file) => file.endsWith(".mid")).sort();
for (const file of files) {
  if (rows.length + failures.length >= limit) break;
  const song = basename(file, ".mid");
  const songSplit = Number(song) % 5 === 0 ? "holdout" : "dev";
  if (split !== "all" && split !== songSplit) continue;
  try {
    const parsed = parseMidi(new Uint8Array(readFileSync(join(dir, file))));
    // The chord track is the file's last track.
    const chordTrack = Math.max(...parsed.notes.map((note) => note.sourceOrigins?.[0]?.track ?? -1));
    const score = parsed.notes.filter((note) => note.sourceOrigins?.[0]?.track !== chordTrack);
    const reference = chordsFromBlocks(parsed.notes.filter((note) => note.sourceOrigins?.[0]?.track === chordTrack));
    const key = keyName(parsed.keySig, parsed.keyMode === 1);
    const advanced = buildVariants({ ...parsed, notes: score }, { title: song, artist: "POP909", tempo: parsed.tempoBpm, key })
      .find((variant) => variant.level === "advanced");
    if (!advanced || !reference.length) throw new Error("no Advanced variant or reference chords");
    const endBeat = Math.min(
      Math.max(...reference.map((chord) => chord.endBeat)),
      Math.max(...advanced.measures.map((measure) => measure.endBeat)),
    );
    const harmony = inferHarmonyTimeline(advanced.notes, advanced.measures, { key: advanced.key, tuning });
    rows.push({
      song,
      split: songSplit,
      beats: endBeat,
      stored: scoreChords(reference, chordsFromLabels(advanced.chords, endBeat), endBeat),
      harmony: scoreChords(reference, chordsFromLabels(harmony, endBeat), endBeat),
    });
  } catch (error) {
    failures.push(`${song}: ${(error as Error).message}`);
  }
}

const mean = (values: Array<number | null>) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Number((known.reduce((sum, value) => sum + value, 0) / known.length).toFixed(4)) : null;
};
const summarize = (subset: Row[], pick: (row: Row) => ChordScore) => ({
  root: mean(subset.map((row) => pick(row).root)),
  majMin: mean(subset.map((row) => pick(row).majMin)),
  sevenths: mean(subset.map((row) => pick(row).sevenths)),
  segmentation: mean(subset.map((row) => pick(row).segmentation)),
});
const report: Record<string, unknown> = { songs: rows.length, failures: failures.length };
for (const part of ["dev", "holdout"] as const) {
  const subset = rows.filter((row) => row.split === part);
  if (!subset.length) continue;
  report[part] = { songs: subset.length, stored: summarize(subset, (row) => row.stored), harmony: summarize(subset, (row) => row.harmony) };
}
if (args.includes("--rows")) report.rows = rows;
if (failures.length) report.failureExamples = failures.slice(0, 10);
console.log(JSON.stringify(report, null, 2));

if (args.includes("--gate")) {
  const holdout = rows.filter((row) => row.split === "holdout");
  const result = summarize(holdout, (row) => row.harmony);
  const passed = holdout.length > 0
    && (result.majMin ?? 0) >= CHORDS_TUNING.gate.minMajMinAccuracy
    && (result.root ?? 0) >= CHORDS_TUNING.gate.minRootAccuracy;
  console.error(passed
    ? `gate passed: held-out major/minor ${result.majMin}, root ${result.root}`
    : `gate failed: held-out major/minor ${result.majMin} (need ${CHORDS_TUNING.gate.minMajMinAccuracy}), root ${result.root} (need ${CHORDS_TUNING.gate.minRootAccuracy})`);
  if (!passed) process.exit(1);
}
