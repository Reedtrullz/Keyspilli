/**
 * Read-only KS-09 policy comparison through actual Player replay.
 *
 * node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --split development --policy compare
 * node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --source /absolute/notes.json --policy conservative-backing-v1
 *
 * No provider calls, catalog connection, artifact write or default-policy change.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { validatePlaybackData, type SongData } from "@keyspilli/player-core";
import {
  evaluateHarmonyPilotCase, replayHarmonyPolicy, summarizeHarmonyPilot,
  type HarmonyPilotCase, type HarmonyPilotPolicy,
} from "../src/lib/harmony-pilot-evaluation";

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
const bytes = readFileSync(sourcePath);
const input: unknown = JSON.parse(bytes.toString("utf8"));
const inputSha256 = createHash("sha256").update(bytes).digest("hex");

if (values.source) {
  // Playback validation is shared with the Player. This command computes an
  // alternative generated projection, not a replacement for authored charts.
  const source = input as SongData;
  const errors = validatePlaybackData(source);
  if (errors.length) throw new Error(`Invalid source playback data: ${errors.join("; ")}`);
  console.log(JSON.stringify({
    schemaVersion: 1, purpose: "source-supported-backing-pilot", inputSha256,
    referenceMetrics: null, note: "No reference annotation supplied; pitch classes are observations, not accuracy evidence.",
    policies: policies.map(policy => ({ policy, replay: replayHarmonyPolicy(source, policy) })),
  }, null, 2));
} else {
  const corpus = input as { schemaVersion: number; corpusId: string; cases: HarmonyPilotCase[] };
  if (corpus.schemaVersion !== 1 || !corpus.corpusId || !Array.isArray(corpus.cases) || !corpus.cases.length) throw new Error("Invalid pilot corpus");
  const ids = new Set<string>(), compositions = new Set<string>();
  for (const item of corpus.cases) {
    if (!item.id || !item.compositionId || ids.has(item.id) || compositions.has(item.compositionId)
      || !["development", "holdout"].includes(item.split)) throw new Error("Corpus cases require unique composition IDs and explicit splits");
    ids.add(item.id); compositions.add(item.compositionId);
  }
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
