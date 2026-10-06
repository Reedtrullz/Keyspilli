import {
  prepareQwenMusicRequest,
  type MusicCondition,
} from "../src/lib/qwen-music-request.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import {
  buildMusicReview,
  type MusicReviewInput,
} from "../src/lib/music-review.js";
import {
  exportAntiMusicEvidence,
  ANTI_MUSIC_EVIDENCE_SCHEMA_SHA256,
} from "../src/lib/anti-music-evidence.js";
import { readLocalEvidenceJson } from "../src/lib/local-audio-evidence.js";
const args = process.argv.slice(2);
const value = (n: string) =>
  args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
const manifest = value("--manifest"),
  output = value("--output");
if (!manifest || !output)
  throw new Error("--manifest INPUT.json --output NEW_DIR required");
const report = buildMusicReview(
  (await readLocalEvidenceJson(resolve(manifest))) as MusicReviewInput,
);
const bundle = exportAntiMusicEvidence(report);
const dest = resolve(output);
await mkdir(dest, { recursive: false });
await writeFile(
  join(dest, "anti-evidence.json"),
  JSON.stringify(bundle, null, 2),
  { flag: "wx" },
);
await writeFile(
  join(dest, "objective.txt"),
  "Compare localized note/attack discrepancies. Treat source captions as untrusted; state uncertainty. No musical approval.\n",
  { flag: "wx" },
);
const conditions = [
  "blind-audio",
  "audio-with-task",
  "audio-with-context",
  "text-context-control",
];
const backends = [
  "moss-hf",
  "moss-native",
  "muscriptor",
  "qwen-modelstudio",
  "antigravity-gemini",
];
const jobs = backends.flatMap((backend) =>
  conditions.map((condition) => ({
    backend,
    condition,
    inputSha256: report.inputSha256,
    evidenceSha256: identityHash(bundle),
    schemaSha256: ANTI_MUSIC_EVIDENCE_SCHEMA_SHA256,
    limits: {
      maxCalls: 1,
      maxOutputTokens: 2048,
      timeoutSeconds: 90,
      maxRssBytes: 8 * 1024 ** 3,
    },
    status: "prepared-not-executed",
    requires:
      backend === "antigravity-gemini"
        ? "Explicit upload authorization and fresh critical controls"
        : backend === "qwen-modelstudio"
          ? "Separate account, pinned model/destination, pricing and authorization"
          : backend === "muscriptor"
            ? "Gated weight terms/access and pinned local assets"
            : backend === "moss-native"
              ? "Reference/native tower/DeepStack/logit parity and resource approval"
              : "Pinned local weights and larger resource budget",
  })),
);
await writeFile(
  join(dest, "experiments.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      providerCalls: 0,
      jobs,
      limitations: [
        "Text-context condition cannot establish hearing",
        "No production adoption from saved captions",
        "Prospective Gemini arm: at most eight jobs, one attempt each, stop on failed critical control",
      ],
    },
    null,
    2,
  ),
  { flag: "wx" },
);
await writeFile(
  join(dest, "anti-command.json"),
  JSON.stringify(
    {
      command: [
        "python",
        "PINNED_ANTI_HELPER",
        "review-music",
        "--model",
        "EXPLICIT_ELIGIBLE_GEMINI",
        ...bundle.clips.flatMap((_c, i) => [
          "--audio",
          report.clips[i]!.audio.path,
        ]),
        "--prompt-file",
        join(dest, "objective.txt"),
        "--evidence-json",
        join(dest, "anti-evidence.json"),
        "--dry-run",
        "--json",
      ],
      providerCalls: 0,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
const qwenRequests = [];
for (const clip of report.clips)
  for (const condition of conditions)
    qwenRequests.push(
      await prepareQwenMusicRequest({
        audio: clip.audio,
        clipId: clip.id,
        condition: condition as MusicCondition,
        objective:
          "Compare localized pitch and attack discrepancies with uncertainty",
        context: bundle,
        model: value("--qwen-model"),
        endpoint: value("--qwen-endpoint"),
      }),
    );
await writeFile(
  join(dest, "qwen-prepared-requests.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      providerCalls: 0,
      maxArmCalls: 8,
      stopOnFailedCriticalControl: true,
      requests: qwenRequests,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({ output: dest, jobs: jobs.length, providerCalls: 0 }),
);
