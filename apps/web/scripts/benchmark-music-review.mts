import { readMusicAudio } from "../src/lib/music-review.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import {
  gradeAcousticCase,
  summarizeCandidate,
  DEFAULT_MATCH_POLICY,
  type CaseTruth,
  type CaseGrade,
} from "@keyspilli/catalog/src/music-benchmark.js";
import {
  identityHash,
  parseAcousticReceipt,
  type AcousticNote,
  type AnalyzerIdentity,
  type AcousticReceipt,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
import {
  runAcousticAnalyzer,
  terminalAnalyzerReceipt,
  type AnalyzerRequest,
} from "../../../services/transcribe/src/acoustic-analyzer.js";
const argv = process.argv.slice(2);
const arg = (name: string) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const manifestPath = arg("--manifest"),
  candidate = arg("--candidate"),
  split = arg("--split"),
  output = arg("--output");
if (
  !manifestPath ||
  !candidate ||
  !["development", "heldout"].includes(split ?? "") ||
  !output
)
  throw new Error(
    "--manifest --candidate --split development|heldout --output NEW_DIR required",
  );
const manifestBytes = await readFile(resolve(manifestPath));
const manifest = JSON.parse(manifestBytes.toString()) as {
  cases: Array<{ id: string; split: string; mediaPath: string; input: string }>;
};
const root = resolve(manifestPath, "..");
const keyBytes = await readFile(
  join(root, "evaluator-only/evaluator-key.json"),
);
const key = JSON.parse(keyBytes.toString()) as {
  cases: Array<{
    id: string;
    category: CaseTruth["category"];
    critical: boolean;
    played: Array<{
      id: string;
      midi: number;
      onsetSeconds: number;
      hand: "L" | "R";
    }>;
  }>;
};
const identityPath = arg("--identity");
const identity: AnalyzerIdentity = identityPath
  ? JSON.parse(await readFile(resolve(identityPath), "utf8"))
  : {
      id: candidate,
      version: "unconfigured",
      checkpointSha256: "0".repeat(64),
      codeSha256: "0".repeat(64),
      frontendSha256: "0".repeat(64),
      configSha256: "0".repeat(64),
      runtime: "unconfigured",
      device: "cpu",
      precision: "float32",
      config: {},
    };
const execute = argv.includes("--execute");
const python = arg("--python");
if (
  execute &&
  (!identityPath ||
    !python ||
    !isAbsolute(python) ||
    !["basic-pitch", "transkun"].includes(candidate))
)
  throw new Error(
    "explicit pinned --identity and absolute --python required for execution",
  );
const codePins = await Promise.all(
  [
    import.meta.url,
    new URL("../../../packages/catalog/src/music-benchmark.ts", import.meta.url)
      .href,
    new URL("../e2e/player-audio-capture.ts", import.meta.url).href,
  ].map(async (url) =>
    createHash("sha256")
      .update(await readFile(new URL(url)))
      .digest("hex"),
  ),
);
const capturePins = await Promise.all(
  manifest.cases
    .filter((c) => c.split === split && c.input === "player")
    .map(async (c) => ({
      id: c.id,
      sha256: createHash("sha256")
        .update(await readFile(join(root, "capture-receipts", c.id + ".json")))
        .digest("hex"),
    })),
);
const mediaPins = await Promise.all(
  manifest.cases
    .filter((c) => c.split === split)
    .map(async (c) => ({
      id: c.id,
      sha256: await readFile(join(root, c.mediaPath))
        .then((bytes) => {
          if (bytes.length > 2 * 1024 * 1024)
            throw new Error("oversized benchmark audio");
          return createHash("sha256").update(bytes).digest("hex");
        })
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        }),
    })),
);
const fingerprint = identityHash({
  mediaPins,
  codePins,
  capturePins,
  recorderClock: "audio-worklet-frame",
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  keySha256: createHash("sha256").update(keyBytes).digest("hex"),
  candidate,
  identity,
  split,
  policy: DEFAULT_MATCH_POLICY,
});
const dest = resolve(output);
const resume = argv.includes("--resume");
if (resume) {
  const old = JSON.parse(await readFile(join(dest, "experiment.json"), "utf8"));
  if (old.fingerprint !== fingerprint)
    throw new Error("changed experiment refuses resume");
} else {
  await mkdir(dest, { recursive: false });
  await writeFile(
    join(dest, "experiment.json"),
    JSON.stringify({
      schemaVersion: 1,
      fingerprint,
      candidate,
      identity,
      split,
      policy: DEFAULT_MATCH_POLICY,
      providerCalls: 0,
    }),
    { flag: "wx" },
  );
}
await mkdir(join(dest, "worker"), { recursive: true });
const grades: CaseGrade[] = [];
for (const c of manifest.cases.filter((c) => c.split === split)) {
  const gradePath = join(dest, c.id + ".grade.json");
  if (resume) {
    try {
      grades.push(JSON.parse(await readFile(gradePath, "utf8")) as CaseGrade);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!/^x[a-f0-9]{14}$/.test(c.id) || c.mediaPath !== "media/" + c.id + ".wav")
    throw new Error("unsafe case identity");
  const capture = await readFile(
    join(root, "capture-receipts", c.id + ".json"),
    "utf8",
  )
    .then(
      (t) =>
        JSON.parse(t) as {
          audio: AcousticReceipt["audio"];
          capture?: {
            recorderClock: string;
            sourceClockOffsetsSeconds: Partial<
              Record<"voice" | "backing", number>
            >;
          };
        },
    )
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    });
  let bytes: Buffer | undefined;
  try {
    bytes = await readFile(join(root, c.mediaPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sha = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : "0".repeat(64);
  const audio = capture?.audio ?? {
    sha256: sha,
    sampleRate: 32000,
    channels: 1,
    frames: 96000,
    durationSeconds: 3,
    derivativeSha256: null,
  };
  if (audio.sha256 !== sha) throw new Error("stale capture pin");
  if (bytes) await readMusicAudio({...audio, path: join(root, c.mediaPath)});
  const request: AnalyzerRequest = {
    audioPin: { ...audio, path: join(root, c.mediaPath) },
    analyzerIdentity: identity,
    model: candidate as AnalyzerRequest["model"],
    timeoutSeconds: 120,
  };
  const terminal = join(dest, c.id + ".receipt.json");
  let recovered: AcousticReceipt | null = null;
  if (resume) {
    try {
      recovered = parseAcousticReceipt(
        JSON.parse(await readFile(terminal, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let receipt: AcousticReceipt;
  const receiptDir = arg("--receipt-dir");
  if (recovered) receipt = recovered;
  else if (receiptDir) {
    receipt = parseAcousticReceipt(
      JSON.parse(
        await readFile(
          join(resolve(receiptDir), c.id + ".receipt.json"),
          "utf8",
        ),
      ),
    );
    if (identityHash(receipt.analyzer) !== identityHash(identity))
      throw new Error("changed receipt candidate");
  } else if (!bytes)
    receipt = terminalAnalyzerReceipt(
      request,
      "unavailable",
      "Missing input control or capture not available; no inference",
    );
  else
    receipt = await runAcousticAnalyzer(request, {
      enabled: execute,
      python: python ?? "/unconfigured",
      workDir: join(dest, "worker"),
    });
  if (
    identityHash(receipt.analyzer) !== identityHash(identity) ||
    receipt.audio.sha256 !== audio.sha256
  )
    throw new Error("changed terminal receipt identity");
  const truth = key.cases.find((t) => t.id === c.id);
  if (!truth) throw new Error("missing evaluator key");
  if (
    c.input === "player" &&
    capture?.capture?.recorderClock !== "audio-worklet-frame"
  )
    throw new Error("unqualified recorder clock");
  const notes: AcousticNote[] = (c.input === "missing" ? [] : truth.played).map(
    (n) => ({
      ...n,
      onsetSeconds:
        n.onsetSeconds +
        (capture?.capture?.sourceClockOffsetsSeconds[
          n.hand === "L" ? "backing" : "voice"
        ] ?? 0),
      keyOffsetSeconds: null,
      soundingOffsetSeconds: null,
      confidence: null,
    }),
  );
  const grade = gradeAcousticCase(
    {
      id: c.id,
      split: split as CaseTruth["split"],
      category: truth.category,
      critical: truth.critical,
      audioSha256: audio.sha256,
      expectedRefusal: c.input === "missing",
      notes,
    },
    receipt,
    DEFAULT_MATCH_POLICY,
  );
  if (!recovered) {
    const partial = terminal + ".pending";
    await writeFile(partial, JSON.stringify(receipt), { flag: "wx" });
    await rename(partial, terminal);
  }
  const pending = gradePath + ".pending";
  try {
    await writeFile(pending, JSON.stringify(grade), { flag: "wx" });
  } catch (error) {
    if (
      !resume ||
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      identityHash(JSON.parse(await readFile(pending, "utf8"))) !==
        identityHash(grade)
    )
      throw error;
  }
  await rename(pending, gradePath);
  grades.push(grade);
  console.log(
    JSON.stringify({
      id: c.id,
      status: receipt.status,
      counts: grade.onset50.counts,
    }),
  );
}
const summary = summarizeCandidate(grades);
await writeFile(
  join(dest, "summary.json"),
  JSON.stringify({ fingerprint, candidate, split, ...summary }, null, 2),
  { flag: resume ? "w" : "wx" },
);
console.log(JSON.stringify(summary));
