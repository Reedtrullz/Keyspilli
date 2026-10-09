import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { makeMusicCorpus } from "../src/lib/music-review-corpus.js";
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
const seed = Number(args[args.indexOf("--seed") + 1] ?? 51);
if (!args.includes("--output") || !output)
  throw new Error("--output NEW_DIR required");
const root = resolve(output);
await mkdir(root, { recursive: false });
const corpus = makeMusicCorpus(seed);
for (const dir of [
  "capture-fixtures",
  "media",
  "events",
  "capture-receipts",
  "evaluator-only",
])
  await mkdir(join(root, dir));
const write = async (path: string, value: unknown) =>
  writeFile(join(root, path), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
// Resolve the actual Player schedule before freezing acoustic truth, independently of captured PCM.
const bundleForAudit = join(root, "capture-fixtures/audit-input.json");
await writeFile(
  bundleForAudit,
  JSON.stringify({ fixtures: corpus.fixtures, captures: corpus.captures }),
  { flag: "wx" },
);
const audited = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("apps/web/scripts/audit-player-qualification-fixtures.ts"),
      bundleForAudit,
    ],
    { encoding: "utf8" },
  ),
) as {
  captures: Record<
    string,
    {
      expectedAttackSeconds: number[];
      expectedAttackSecondsByBus: { voice: number[]; backing: number[] };
      renderedEventAudit: {
        notes: Array<{
          midi: number;
          startSeconds: number;
          durationSeconds: number;
          hand: string;
        }>;
        chordEvents: Array<{
          startSeconds: number;
          durationBeats: number;
          midiNotes: number[];
        }>;
      };
    }
  >;
};
for (const item of corpus.key) {
  const audit = audited.captures[item.id];
  if (!audit) continue;
  const notes = [
    ...audit.renderedEventAudit.notes.map((n) => ({
      midi: n.midi,
      onsetSeconds: n.startSeconds,
      durationSeconds: n.durationSeconds,
      hand: n.hand === "L" ? ("L" as const) : ("R" as const),
    })),
    ...audit.renderedEventAudit.chordEvents.flatMap((c) =>
      c.midiNotes.map((midi) => ({
        midi,
        onsetSeconds: c.startSeconds,
        durationSeconds: c.durationBeats / 2,
        hand: "L" as const,
      })),
    ),
  ];
  item.played = notes.map((n, i) => ({
    ...n,
    id: item.id + "-resolved" + i,
    velocity: 76,
    phraseId: "phrase",
    occurrenceId: "o1",
  }));
  Object.assign(corpus.captures[item.id]!, audit);
}
await write("manifest.json", {
  schemaVersion: 1,
  kind: corpus.kind,
  seed,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  cases: corpus.cases,
  limitations: corpus.limitations,
});
await write("evaluator-only/evaluator-key.json", {
  schemaVersion: 1,
  kind: "private-evaluator-key",
  cases: corpus.key,
  keepOutOfAnalyzerContext: true,
});
await write("capture-fixtures/bundle.json", {
  schemaVersion: 1,
  fixtures: corpus.fixtures,
  captures: corpus.captures,
  provenance: {
    type: "self-authored synthetic construction",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  },
});
for (const item of corpus.key)
  await write("events/" + item.id + ".json", {
    schemaVersion: 1,
    kind: "keyspilli-playback-event-snapshot",
    clock: "seconds",
    events: item.played,
  });
for (const item of corpus.cases.filter((c) => c.input === "silence")) {
  const frames = 32000 * 3;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(32000, 24);
  wav.writeUInt32LE(64000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  await writeFile(join(root, item.mediaPath), wav, { flag: "wx" });
}
console.log(
  JSON.stringify({
    output: root,
    cases: corpus.cases.length,
    providerCalls: 0,
    secondBank: "uncovered",
  }),
);
