/**
 * Read-only KS-09 policy comparison through actual Player replay.
 *
 * node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --split development --policy compare
 * node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --source /absolute/notes.json --policy conservative-backing-v1
 *
 * No provider calls, catalog connection, artifact write or default-policy change.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  evaluateHarmonyPilotCase, replayHarmonyPolicy, summarizeHarmonyPilot,
  type HarmonyPilotPolicy,
} from "../src/lib/harmony-pilot-evaluation";
import { HARMONY_PILOT_LIMITS, validateHarmonyPilotCorpus, validateHarmonyPilotSource } from "../src/lib/harmony-pilot-validation";

const { values } = parseArgs({ options: {
  source: { type: "string" }, corpus: { type: "string" },
  policy: { type: "string", default: "compare" }, split: { type: "string", default: "development" },
  summary: { type: "boolean", default: false },
} });
const policies: HarmonyPilotPolicy[] = values.policy === "compare" ? ["legacy-backing", "conservative-backing-v1"]
  : values.policy === "legacy-backing" || values.policy === "conservative-backing-v1" ? [values.policy]
    : (() => { throw new Error("--policy must be legacy-backing, conservative-backing-v1 or compare"); })();
if (!["development", "holdout", "all"].includes(values.split)) throw new Error("--split must be development, holdout or all");
if (values.source && values.corpus) throw new Error("Choose --source or --corpus");
const sourcePath = values.source ?? values.corpus ?? new URL("../../../packages/midi/test/fixtures/ks09-harmony-pilot-v1.json", import.meta.url);
const file = openSync(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK);
let bytes: Buffer;
try {
  const before = fstatSync(file);
  if (!before.isFile() || before.size > HARMONY_PILOT_LIMITS.bytes) throw new Error("Pilot input must be a regular JSON file of at most 8 MiB");
  const buffer = Buffer.alloc(before.size + 1); let length = 0;
  while (length < buffer.length) { const count = readSync(file, buffer, length, buffer.length - length, length); if (!count) break; length += count; }
  const after = fstatSync(file);
  if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Pilot input changed while reading");
  bytes = buffer.subarray(0, length);
} finally { closeSync(file); }
const input: unknown = JSON.parse(bytes.toString("utf8"));
const inputSha256 = createHash("sha256").update(bytes).digest("hex");

if (values.source) {
  validateHarmonyPilotSource(input);
  const source = input;
  console.log(JSON.stringify({
    schemaVersion: 1, purpose: "source-supported-backing-pilot", inputSha256,
    referenceMetrics: null, note: "No reference annotation supplied; pitch classes are observations, not accuracy evidence.",
    policies: policies.map(policy => ({ policy, replay: replayHarmonyPolicy(source, policy) })),
  }, null, 2));
} else {
  validateHarmonyPilotCorpus(input);
  const corpus = input;
  const cases = corpus.cases.filter(item => values.split === "all" || item.split === values.split);
  if (!cases.length) throw new Error("No cases in selected split");
  console.log(JSON.stringify({
    schemaVersion: 1, corpusId: corpus.corpusId, inputSha256, split: values.split,
    evidenceScope: "Original synthetic contract examples; not independent listening or real-song calibration.",
    policies: policies.map(policy => {
      const rows = cases.map(item => evaluateHarmonyPilotCase(item, policy));
      return {
        policy, summary: summarizeHarmonyPilot(rows),
        splits: [...new Set(rows.map(row => row.split))].map(split => ({ split, ...summarizeHarmonyPilot(rows.filter(row => row.split === split)) })),
        ...(values.summary ? {} : { rows }),
      };
    }),
  }, null, 2));
}
