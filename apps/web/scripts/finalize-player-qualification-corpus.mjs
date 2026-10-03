import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const run = resolve(process.env.KEYSPILLI_PLAYER_CORPUS_RUN ?? "output/song-prep/player-qualification-20261003");
const plan = JSON.parse(readFileSync(join(run, "model-facing/cases.plan.json"), "utf8"));
const bundle = JSON.parse(readFileSync(join(run, "capture-fixtures/bundle.json"), "utf8"));
const resultsDir = join(run, "capture-receipts");
const outputKeyPath = join(run, "evaluator-only/answer-key.json");
const answerKey = JSON.parse(readFileSync(outputKeyPath, "utf8"));
const groups = Object.fromEntries(["clean", "known-fault", "control"].map(group => [group, plan.cases.filter(item => item.group === group).length]));
if (plan.cases.length !== 24 || groups.clean !== 8 || groups["known-fault"] !== 8 || groups.control !== 8)
  throw new Error(`Refusing to finalize unexpected task inventory: ${JSON.stringify({ total: plan.cases.length, ...groups })}`);
if (Object.keys(plan.captures).length !== 40 || answerKey.cases.length !== 24)
  throw new Error("Refusing to finalize: expected 40 unique Player captures and 24 evaluator entries");
const receipts = new Map();
for (const capture of Object.values(plan.captures)) {
  const path = join(resultsDir, `${capture.clipId}.json`);
  if (!existsSync(path)) throw new Error(`Capture receipt missing: ${path}`);
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  if (receipt.clipId !== capture.clipId) throw new Error(`Capture receipt identity mismatch: ${path}`);
  if (receipt.player.sourceCommit !== bundle.provenance.playerSourceCommit
    || receipt.player.mainSampleFixCommit !== bundle.provenance.mainSampleFixCommit)
    throw new Error(`Capture receipt source pin differs from the fixture bundle: ${path}`);
  if (!receipt.player.sampleAssets?.length || receipt.player.oscillatorFallbackStarts !== 0)
    throw new Error(`Capture receipt has no pinned sampler assets or reports oscillator fallback: ${path}`);
  const mediaPath = join(run, "model-facing", receipt.audio.path);
  const mediaBytes = readFileSync(mediaPath);
  if (mediaBytes.length !== receipt.audio.bytes || createHash("sha256").update(mediaBytes).digest("hex") !== receipt.audio.sha256)
    throw new Error(`Captured PCM hash or byte length mismatch: ${mediaPath}`);
  receipts.set(capture.clipId, receipt);
}
if (receipts.size !== 40) throw new Error(`Expected 40 distinct successful capture receipts; found ${receipts.size}`);

function pin(value, durationSecondsHint = null) {
  if (typeof value === "string") {
    const receipt = receipts.get(value);
    if (!receipt) throw new Error(`Unknown captured clip: ${value}`);
    return { path: receipt.audio.path, sha256: receipt.audio.sha256, durationSeconds: receipt.audio.durationSeconds };
  }
  const path = relative(join(run, "model-facing"), value.path).split("\\").join("/");
  const bytes = readFileSync(join(run, "model-facing", path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== value.sha256) throw new Error(`Control asset hash changed: ${path}`);
  return { path, sha256, durationSeconds: durationSecondsHint ?? value.durationSeconds };
}

const byId = new Map(answerKey.cases.map(entry => [entry.id, entry]));
const cases = plan.cases.map(item => {
  const result = { id: item.id, mode: item.mode, group: item.group };
  if (item.mandatoryGate) result.mandatoryGate = item.mandatoryGate;
  if (Array.isArray(item.audioPaths)) result.audioPaths = [];
  else {
    result.reference = pin(item.reference);
    result.candidate = pin(item.candidate);
  }
  const answer = byId.get(item.id);
  if (answer) {
    if (typeof item.reference === "string") answer.referenceAudio = pin(item.reference);
    if (typeof item.candidate === "string") answer.candidateAudio = pin(item.candidate);
    else if (item.candidate?.sha256) answer.candidateAudio = pin(item.candidate);
    if (answer.expected?.defect) {
      const duration = answer.candidateAudio.durationSeconds;
      const maximumClaimWidthSeconds = Number(Math.min(5, duration * 0.25).toFixed(4));
      answer.tolerance.maximumClaimWidthSeconds = maximumClaimWidthSeconds;
      const [start, end] = answer.expected.affectedSpanSeconds;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > duration)
        throw new Error(`Known-fault affected span is invalid for final PCM duration: ${item.id}`);
      answer.expected.fullAffectedSpanWidthSeconds = Number((end - start).toFixed(4));
      answer.expected.fullAffectedSpanExceedsClaimWidthCap = end - start > maximumClaimWidthSeconds;
      answer.expected.interpretation = "A correct full affected-span finding remains grounded detection; when it exceeds maximumClaimWidthSeconds it receives no localization credit, not an unsupported-claim or fault-miss label.";
    }
  }
  if (item.group === "known-fault" && !answer?.renderedEventAudit)
    throw new Error(`Known-fault case lacks a production-resolved event audit: ${item.id}`);
  return result;
});

writeFileSync(join(run, "model-facing/cases.json"), JSON.stringify({ schemaVersion: 1, sourceClass: "self-authored synthetic Player pilot", cases }, null, 2) + "\n");
writeFileSync(outputKeyPath, JSON.stringify(answerKey, null, 2) + "\n");
writeFileSync(join(run, "capture-receipts/index.json"), JSON.stringify({ schemaVersion: 1,
  generatedAt: new Date().toISOString(), clips: [...receipts.values()] }, null, 2) + "\n");
console.log(JSON.stringify({ cases: cases.length, playerClips: receipts.size,
  missingAudioCases: cases.filter(item => Array.isArray(item.audioPaths)).length,
  mandatoryGates: cases.filter(item => item.mandatoryGate).map(item => item.mandatoryGate),
  output: join(run, "model-facing/cases.json") }, null, 2));
