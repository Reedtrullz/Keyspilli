#!/usr/bin/env node
/** Pairwise, pin-bound listening triage through Anti's explicit `listen` profile. */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, lstat, realpath, rename, stat, chmod } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUDIO_REVIEW_LIMITS,
  buildAntiListenArgs,
  buildAudioReviewCoverage,
  buildRepairQueue,
  buildEvidenceV2ReviewPrompt,
  buildReviewPrompt,
  gatewayAudioRouteCatalogContractSha256,
  mapClipFindingToSource,
  parseAntiDryRunStdout,
  parseAntiLiveStdout,
  planResumableJobs,
  sha256Text,
  stableJson,
  validateAudioReport,
  validateAudioMediaReceipt,
  validateGatewayAudioRouteCatalog,
  validateListenEnvelope,
  validateManifestFiles,
  validateReviewManifest,
  type ComparisonStatus,
  type ReviewProfile,
  type AntiListenEnvelope,
  type GatewayAudioRoutePin,
  type ReviewJob,
  type ReviewManifest,
  type RunState,
} from "../src/lib/audio-review.js";

const execFile = promisify(execFileCallback);
const CAPABILITIES = {
  schemaVersion: 2,
  manifestSchemaVersion: 2,
  reportSchemaVersion: 2,
  reviewProfiles: { legacy: { schemaVersion: 1, default: true }, "evidence-v2": { schemaVersion: 2, default: false } },
  provider: "anti.listen",
  pairwiseAudio: true,
  dryRun: true,
  safeResume: true,
  validatesCompleteOutput: true,
  mapsSourceOutputAnchors: true,
  symbolicEvidenceSeparate: true,
  repairQueue: true,
  requiresGatewayBackendAttemptLimit: 1,
  validatesOrderedSubmissionReceipt: true,
  validatesGatewayModelAllowlist: true,
  strictLiveStdout: true,
  supports: {
    maxClipBytes: AUDIO_REVIEW_LIMITS.maxClipBytes,
    maxPairBytes: AUDIO_REVIEW_LIMITS.maxPairBytes,
    maxClipSeconds: AUDIO_REVIEW_LIMITS.maxClipSeconds,
    maxOutputTokens: AUDIO_REVIEW_LIMITS.maxOutputTokens,
    maxProviderCallsPerJob: AUDIO_REVIEW_LIMITS.maxProviderCallsPerJob,
  },
};

interface Options {
  manifestPath: string;
  outputDir: string;
  python: string;
  antiScript: string;
  baseUrl: string;
  model: string;
  maxRequests: number;
  dryRun: boolean;
  sendAudio: boolean;
  resume: boolean;
  reviewProfile: ReviewProfile;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const hashBytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeId = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");

function parseOptions(argv: string[]): Options {
  if (argv[0] === "capabilities") throw new Error("__CAPABILITIES__");
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!;
    if (!item.startsWith("--")) { positional.push(item); continue; }
    if (["--dry-run", "--send-audio", "--resume"].includes(item)) flags.add(item);
    else {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${item} requires a value`);
      if (values.has(item)) throw new Error(`${item} may be specified only once`);
      values.set(item, value);
    }
  }
  if (positional.length !== 2) throw new Error("Usage: review-song-audio.mts MANIFEST.json OUTPUT_DIR --dry-run|--send-audio --anti-python /absolute/python --anti-script /absolute/anti.py --base-url URL --model MODEL [--review-profile legacy|evidence-v2] [--max-requests N] [--resume]");
  const dryRun = flags.has("--dry-run");
  const sendAudio = flags.has("--send-audio");
  if (dryRun === sendAudio) throw new Error("Select exactly one of --dry-run or --send-audio");
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`${name} is required; provider and runtime selection must be explicit`);
    return value;
  };
  const rawMaxRequests = values.get("--max-requests");
  const maxRequests = rawMaxRequests === undefined ? 0 : Number(rawMaxRequests);
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0 || maxRequests > 300) throw new Error("--max-requests must be an integer from 0 to 300");
  if (sendAudio && maxRequests < 1) throw new Error("--send-audio requires an explicit positive --max-requests total cap");
  const reviewProfile = values.get("--review-profile") ?? "legacy";
  if (reviewProfile !== "legacy" && reviewProfile !== "evidence-v2") throw new Error(`unsupported review profile ${reviewProfile}; choose legacy or evidence-v2`);
  return {
    manifestPath: resolve(positional[0]!), outputDir: resolve(positional[1]!),
    python: required("--anti-python"), antiScript: required("--anti-script"),
    baseUrl: required("--base-url"), model: required("--model"), maxRequests,
    dryRun, sendAudio, resume: flags.has("--resume"), reviewProfile,
  };
}

function safeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("--base-url must be HTTP(S) without embedded credentials, query, or fragment");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return hashBytes(bytes);
}

async function atomicWrite(path: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temp, path);
}

async function initializeOutput(outputDir: string, resume: boolean): Promise<void> {
  try {
    const info = await lstat(outputDir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("output path must be a real directory, not a symlink or file");
    if (!resume) {
      const existing = await readFile(join(outputDir, ".codex-review-output-sentinel")).catch(() => null);
      if (existing) throw new Error("output directory already contains a review run; choose a new directory or use --resume");
      const { readdir } = await import("node:fs/promises");
      if ((await readdir(outputDir)).length) throw new Error("output directory is not empty; choose a new directory or use --resume");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (resume) throw new Error("cannot resume: output directory does not exist");
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
  }
  await mkdir(join(outputDir, "evidence", "clips"), { recursive: true, mode: 0o700 });
  await mkdir(join(outputDir, "evidence", "responses"), { recursive: true, mode: 0o700 });
  await mkdir(join(outputDir, "prompts"), { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  await chmod(join(outputDir, "evidence"), 0o700);
  await chmod(join(outputDir, "evidence", "clips"), 0o700);
  await chmod(join(outputDir, "evidence", "responses"), 0o700);
  await chmod(join(outputDir, "prompts"), 0o700);
}

async function copyPinnedClips(manifest: ReviewManifest, outputDir: string) {
  const captured: Array<Record<string, unknown>> = [];
  const pathByHash = new Map<string, string>();
  for (const job of manifest.jobs) {
    for (const [attachment, clip] of [["reference", job.referenceClip], ["candidate", job.candidateClip]] as const) {
      let retainedPath = pathByHash.get(clip.sha256);
      if (!retainedPath) {
        retainedPath = join(outputDir, "evidence", "clips", `${clip.sha256}.wav`);
        try {
          const existing = await readFile(retainedPath);
          if (hashBytes(existing) !== clip.sha256) throw new Error(`retained clip was edited: ${retainedPath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const inputBytes = await readFile(clip.path);
          if (inputBytes.length !== clip.bytes || hashBytes(inputBytes) !== clip.sha256) throw new Error(`stale clip pin: ${clip.path}`);
          await atomicWrite(retainedPath, inputBytes);
        }
        pathByHash.set(clip.sha256, retainedPath);
      }
      captured.push({ jobId: job.id, attachment, originalPath: clip.path, retainedPath, sha256: clip.sha256, bytes: clip.bytes, durationSeconds: clip.durationSeconds, assetStartSeconds: clip.assetStartSeconds });
    }
  }
  return { captured, pathByHash };
}

class AntiCommandFailure extends Error {
  partialStdoutSha256?: string;
  partialStderrSha256?: string;
  constructor(message: string, partial: { partialStdoutSha256?: string; partialStderrSha256?: string } = {}) {
    super(message);
    this.name = "AntiCommandFailure";
    this.partialStdoutSha256 = partial.partialStdoutSha256;
    this.partialStderrSha256 = partial.partialStderrSha256;
  }
}

function validateDryRun(raw: unknown, expectedAudio: { hashes: readonly [string, string]; bytes: readonly [number, number] }) {
  const estimates = isRecord(raw) && Array.isArray(raw.estimates) ? raw.estimates : [];
  const resolvedModel = estimates.length === 1 && isRecord(estimates[0]) ? estimates[0].model : null;
  if (!isRecord(raw) || raw.mode !== "listen" || typeof resolvedModel !== "string" || !resolvedModel.trim()) throw new Error("Anti dry run did not identify mode=listen and one resolved model");
  const coverage = raw.media_coverage;
  if (!isRecord(coverage) || coverage.kind !== "audio" || coverage.listening_verification !== "not_run" || coverage.provider_audio_acceptance !== "unverified") {
    throw new Error("Anti dry run lacks explicit audio capture and not-listened coverage metadata");
  }
  validateAudioMediaReceipt(coverage, { audioHashes: expectedAudio.hashes, audioBytes: expectedAudio.bytes, gatewayAttempts: 0 });
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  if (stages.length !== 1 || !isRecord(stages[0]) || stages[0].name !== "listen" || stages[0].max_attempts !== 1 || stages[0].possible_retries !== 0 || Number(stages[0].max_output_tokens) > AUDIO_REVIEW_LIMITS.maxOutputTokens) {
    throw new Error("Anti dry run did not confirm the one-call listen limits");
  }
  return { coverage, resolvedModel };
}

async function checkRuntime(options: Options): Promise<{ python: string; antiScript: string; antiScriptSha256: string }> {
  if (!options.python.startsWith("/") || !options.antiScript.startsWith("/")) throw new Error("--anti-python and --anti-script must be absolute paths");
  const python = await realpath(options.python);
  const antiScript = await realpath(options.antiScript);
  const pythonProbe = await execFile(python, ["--version"], { timeout: 5_000, maxBuffer: 32_000 });
  const versionText = `${pythonProbe.stdout}${pythonProbe.stderr}`;
  const match = versionText.match(/Python (\d+)\.(\d+)/);
  if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 10)) throw new Error(`Anti requires Python 3.10+; selected runtime reported ${versionText.trim() || "unknown version"}`);
  await stat(antiScript);
  const help = await execFile(python, [antiScript, "listen", "--help"], { timeout: 10_000, maxBuffer: 256_000 });
  for (const option of ["--base-url", "--model", "--audio", "--probe-unverified-audio", "--max-calls", "--retry", "--fallback-policy", "--max-output-tokens", "--run-timeout", "--no-pre-read", "--prompt-file", "--save-output", "--json", "--dry-run"]) {
    if (!help.stdout.includes(option)) throw new Error(`selected Anti helper lacks required listen option ${option}`);
  }
  return { python, antiScript, antiScriptSha256: await sha256File(antiScript) };
}

async function fetchGatewayModelCatalog(baseUrl: string): Promise<{ value: unknown; rawSha256: string; routeContractSha256: string }> {
  const url = `${safeBaseUrl(baseUrl)}/models`;
  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`gateway model catalog GET failed with HTTP ${response.status}; no audio request was sent`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 2 * 1024 * 1024) throw new Error("gateway model catalog exceeds the 2 MiB preflight limit");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new Error("gateway model catalog exceeds the 2 MiB preflight limit");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("gateway model catalog GET returned invalid JSON; no audio request was sent"); }
  return {
    value,
    rawSha256: sha256Text(text),
    routeContractSha256: gatewayAudioRouteCatalogContractSha256(value),
  };
}

function makeFingerprint(manifestSha256: string, antiScriptSha256: string, options: Options, prompts: Record<string, string>, gatewayRouteContractSha256: string | null) {
  const profileContract = options.reviewProfile === "evidence-v2" ? { reviewProfile: "evidence-v2", reviewSchemaVersion: 2 } : {};
  return sha256Text(stableJson({ manifestSha256, antiScriptSha256, model: options.model, baseUrl: safeBaseUrl(options.baseUrl), maxRequests: options.maxRequests, dryRun: options.dryRun, gatewayRouteContractSha256, prompts, ...profileContract }));
}

function newState(manifest: ReviewManifest, manifestSha256: string, fingerprint: string, maxRequests: number, gatewayCatalog: { rawSha256: string; routeContractSha256: string } | null, reviewProfile: ReviewProfile): RunState {
  return {
    schemaVersion: 1,
    reviewProfile,
    reviewSchemaVersion: reviewProfile === "evidence-v2" ? 2 : 1,
    manifestSha256,
    fingerprint,
    ...(gatewayCatalog ? { gatewayCatalogSha256: gatewayCatalog.rawSha256, gatewayRouteContractSha256: gatewayCatalog.routeContractSha256 } : {}),
    maxRequests,
    attemptsUsed: 0,
    jobs: Object.fromEntries(manifest.jobs.map(job => [job.id, { status: "planned" as const, attempts: 0 as const }])),
  };
}

async function invokeAnti(options: Options, job: ReviewJob, clipPaths: Map<string, string>, prompt: string, outputDir: string, dryRun = options.dryRun) {
  const safe = safeId(job.id);
  const promptPath = join(outputDir, "prompts", `${safe}.txt`);
  await atomicWrite(promptPath, `${prompt}\n`);
  const args = buildAntiListenArgs({
    python: options.python,
    antiScript: options.antiScript,
    baseUrl: options.baseUrl,
    model: options.model,
    referenceAudio: clipPaths.get(job.referenceClip.sha256)!,
    candidateAudio: clipPaths.get(job.candidateClip.sha256)!,
    promptFile: promptPath,
    dryRun,
  });
  try {
    const result = await execFile(options.python, args, { cwd: dirname(options.antiScript), timeout: 93_000, maxBuffer: 1_500_000, windowsHide: true });
    return { stdout: result.stdout, stderr: result.stderr, promptPath, command: [options.python, ...args] };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = Buffer.isBuffer(failure.stdout) ? failure.stdout : Buffer.from(failure.stdout ?? "", "utf8");
    const stderr = Buffer.isBuffer(failure.stderr) ? failure.stderr : Buffer.from(failure.stderr ?? "", "utf8");
    const partialStdoutSha256 = stdout.length ? hashBytes(stdout) : undefined;
    const partialStderrSha256 = stderr.length ? hashBytes(stderr) : undefined;
    const safe = safeId(job.id);
    if (stdout.length) await atomicWrite(join(outputDir, "evidence", "responses", `${safe}.partial.stdout.txt`), stdout);
    if (stderr.length) await atomicWrite(join(outputDir, "evidence", "responses", `${safe}.partial.stderr.txt`), stderr);
    throw new AntiCommandFailure(`Anti listen process ended without a complete command result${failure.code ? ` (${failure.code})` : ""}`, { partialStdoutSha256, partialStderrSha256 });
  }
}

function reportMarkdown(report: Record<string, any>): string {
  const lines = [
    "# Keyspilli music listening review",
    "",
    `- Status: **${report.status}**`,
    `- Review profile/schema: \`${report.reviewProfile}\` / \`${report.reviewSchemaVersion}\``,
    `- Manifest SHA-256: \`${report.manifestSha256}\``,
    `- Provider: \`${report.provider.name}\`; requested model: \`${report.provider.requestedModel}\``,
    `- Captured clips: ${report.captureEvidence.files.length}; attempts reserved: ${report.submissionEvidence.attemptsReserved}; validated completed responses: ${report.coverage.completeJobCount}; compared: ${report.coverage.comparedJobCount}; abstained: ${report.coverage.abstainedJobCount}; ambiguous jobs: ${report.submissionEvidence.ambiguousJobs}`,
    "- Listening calibration: **unqualified**; musical acceptance: **not established**.",
    "- Audio token usage: **not exposed / not inferred**.",
    "",
    "## Mode and phrase coverage",
    "",
    "| Mode | Validated complete responses / planned | Compared | Abstained | Phrases compared / planned | Unreviewed gaps | Status |",
    "| --- | ---: | ---: | ---: | --- | --- | --- |",
  ];
  for (const mode of ["original", "chords"] as const) {
    const row = report.coverage.byMode[mode];
    lines.push(`| ${mode} | ${row.jobsComplete}/${row.jobsPlanned} | ${row.jobsCompared} | ${row.jobsAbstained} | ${row.phrasesCompared.join(", ") || "none"} / ${row.phrasesPlanned.join(", ") || "none"} | ${row.gaps.join(", ") || "none"} | ${row.disposition} |`);
  }
  lines.push("", "## Resolved playback and separate symbolic evidence", "");
  for (const mode of ["original", "chords"] as const) {
    const replay = report.resolvedReplays[mode];
    lines.push(`### ${mode === "original" ? "Original" : "Chords"} — ${replay.difficulty} (${replay.resolvedVariantId})`, "",
      `- Renderer: ${replay.renderer.backend} ${replay.renderer.version}; ${replay.renderer.instrument.name}; bank \`${replay.renderer.instrument.bankSha256}\`.`,
      `- Exact-note check: ${replay.symbolicChecks.exactNotes.status}.`,
      `- Playability check: ${replay.symbolicChecks.playability.status}${replay.symbolicChecks.playability.reason ? ` — ${replay.symbolicChecks.playability.reason}` : ""}.`,
      `- Replay audio: \`${replay.asset.path}\` (${replay.asset.sha256}).`, "");
  }
  lines.push("## Findings", "");
  const anyFindings = report.jobs.some((job: any) => Array.isArray(job.findings) && job.findings.length);
  if (!anyFindings) lines.push("No validated finding has been retained. An empty list means only that no defect was detected in a covered excerpt; it is not approval.", "");
  for (const row of report.jobs) {
    lines.push(`### ${row.mode} / ${row.phraseId} — ${row.status}`, "");
    if (row.status === "dry-run") lines.push("No provider request was sent. This confirms local capture and Anti listen preflight only.", "");
    if (row.review) lines.push(row.review.summary, "", `Overall uncertainty: ${row.review.uncertainty} (descriptive, not calibrated).`, "");
    if (row.comparisonStatus) lines.push(`Comparison status: **${row.comparisonStatus}**. Provider listening attestation: **unverified**.`, "");
    if (row.review?.attachments) {
      for (const attachment of ["reference", "candidate"] as const) lines.push(`- ${attachment}: ${row.review.attachments[attachment].content} — ${row.review.attachments[attachment].evidence}`);
      for (const limitation of row.review.limitations) lines.push(`- Limitation: ${limitation}`);
      lines.push("");
    }
    for (const finding of row.findings ?? []) {
      const mapped = finding.sourceBeatStart === null || finding.sourceBeatEnd === null
        ? "source-beat mapping unavailable"
        : `source beats ${finding.sourceBeatStart.toFixed(2)}–${finding.sourceBeatEnd.toFixed(2)}`;
      lines.push(`- **${finding.classification} / ${finding.severity} ${finding.area}** in ${finding.attachment} at ${finding.startSeconds.toFixed(2)}–${finding.endSeconds.toFixed(2)} s (${mapped}; uncertainty ${finding.uncertainty}). ${finding.evidence}`, `  - Suggested check/repair: ${finding.proposedRepair}`);
    }
    for (const item of row.repairQueue ?? []) lines.push(`  - Repair state: ${item.status}. ${item.acceptance}`);
    if (row.submission?.mediaCoverage) lines.push(`  - Anti media receipt: captured/submission metadata retained; provider listening field remains ${row.submission.mediaCoverage.listening_verification ?? "unverified"}.`);
    lines.push("");
  }
  lines.push("## Repair and recheck", "",
    "Verify each reported passage against the pinned source notes, difficulty, and playback snapshot. Apply only the smallest supported reversible edit. Rerender with a new bank/settings/output pin, then create a fresh manifest for the finding and its neighboring phrase. Recheck both modes if shared source material changed. Keep stale reports for history; they do not transfer to changed output.", "",
    "Listening triage does not verify exact notes, learner playability, full-song quality, or production acceptance.", "");
  return lines.join("\n");
}

function buildPrompt(job: ReviewJob, profile: ReviewProfile): string {
  return profile === "evidence-v2" ? buildEvidenceV2ReviewPrompt(job) : buildReviewPrompt(job);
}

async function materializeReport(manifest: ReviewManifest, state: RunState, options: Options, manifestSha256: string, fingerprint: string, antiScriptSha256: string, captured: Array<Record<string, unknown>>, outputDir: string) {
  const rows: Array<Record<string, any>> = [];
  const complete = new Set<string>();
  for (const job of manifest.jobs) {
    const entry = state.jobs[job.id]!;
    const base: Record<string, any> = {
      id: job.id, mode: job.mode, phraseId: job.phraseId, status: entry.status,
      comparisonStatus: entry.comparisonStatus ?? null,
      clips: {
        reference: { sha256: job.referenceClip.sha256, bytes: job.referenceClip.bytes, durationSeconds: job.referenceClip.durationSeconds },
        candidate: { sha256: job.candidateClip.sha256, bytes: job.candidateClip.bytes, durationSeconds: job.candidateClip.durationSeconds },
      },
      alignment: { status: job.alignment.status, method: job.alignment.method, evidence: job.alignment.evidence.sha256 },
      findings: [], repairQueue: [], submission: null,
    };
    if (entry.status === "ambiguous") {
      const responsePath = join(outputDir, "evidence", "responses", `${safeId(job.id)}.json`);
      const bytes = await readFile(responsePath).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (bytes && entry.envelopeSha256 && hashBytes(bytes) !== entry.envelopeSha256) throw new Error(`retained ambiguous Anti response changed for ${job.id}`);
      base.submission = {
        state: "ambiguous-or-incomplete", attempts: entry.attempts,
        responseSha256: entry.envelopeSha256 ?? null,
        partialStdoutSha256: entry.partialStdoutSha256 ?? null,
        partialStderrSha256: entry.partialStderrSha256 ?? null,
        preflightSha256: entry.preflightSha256 ?? null,
      };
      rows.push(base);
      continue;
    }
    if (entry.status === "complete" || entry.status === "dry-run") {
      const responsePath = join(outputDir, "evidence", "responses", `${safeId(job.id)}.json`);
      const bytes = await readFile(responsePath);
      if (entry.envelopeSha256 && hashBytes(bytes) !== entry.envelopeSha256) throw new Error(`retained Anti response changed for ${job.id}`);
      if (options.dryRun) {
        const raw = parseAntiDryRunStdout(bytes.toString("utf8"), buildPrompt(job, options.reviewProfile));
        base.dryRun = validateDryRun(raw, { hashes: [job.referenceClip.sha256, job.candidateClip.sha256], bytes: [job.referenceClip.bytes, job.candidateClip.bytes] });
      } else {
        const raw = parseAntiLiveStdout(bytes.toString("utf8"));
        const validated = validateListenEnvelope(raw, {
          model: options.model, resolvedModel: entry.resolvedModel ?? options.model, mode: job.mode,
          allowedModelIds: entry.allowedModelIds ?? [],
          durations: { reference: job.referenceClip.durationSeconds, candidate: job.candidateClip.durationSeconds },
          expectedAudioHashes: [job.referenceClip.sha256, job.candidateClip.sha256],
          expectedAudioBytes: [job.referenceClip.bytes, job.candidateClip.bytes],
          reviewProfile: options.reviewProfile,
        });
        const mapped = validated.findings.map(finding => {
          const { sourceBeatStart, sourceBeatEnd, alignmentStatus } = mapClipFindingToSource(job, finding);
          return { ...finding, sourceBeatStart, sourceBeatEnd, alignmentStatus };
        });
        base.review = validated.review;
        base.comparisonStatus = validated.comparisonStatus ?? null;
        base.findings = mapped;
        base.repairQueue = buildRepairQueue(job, validated.findings);
        base.submission = {
          state: "response-validated",
          attemptsReserved: entry.attempts,
          requestedModel: options.model,
          resolvedModel: entry.resolvedModel,
          allowedModelIds: entry.allowedModelIds,
          effectiveModel: validated.envelope.model,
          antiRunStatus: validated.envelope.runStatus,
          listeningAttestation: validated.listeningAttestation,
          mediaCoverage: validated.envelope.metadata.media_coverage,
          audioTokenUsage: null,
          responseSha256: entry.envelopeSha256,
          preflightSha256: entry.preflightSha256 ?? null,
        };
        complete.add(job.id);
      }
    }
    if (entry.status === "complete") complete.add(job.id);
    rows.push(base);
  }
  const report: Record<string, any> = {
    schemaVersion: 2,
    kind: "keyspilli-audio-review-report",
    createdAt: new Date().toISOString(),
    status: options.dryRun ? "dry-run" : rows.every(row => row.status === "complete") ? "triage-complete" : rows.some(row => row.status === "ambiguous") ? "ambiguous" : "partial",
    manifestSha256,
    runFingerprint: fingerprint,
    provider: { name: "anti.listen", requestedModel: options.model, python: options.python, antiScript: options.antiScript, antiScriptSha256, baseUrl: safeBaseUrl(options.baseUrl), maxRequests: options.maxRequests, outputTokenCeiling: AUDIO_REVIEW_LIMITS.maxOutputTokens, gatewayBackendAttemptLimitRequired: 1, gatewayCatalogSha256: state.gatewayCatalogSha256 ?? null, gatewayRouteContractSha256: state.gatewayRouteContractSha256 ?? null },
    captureEvidence: { status: "pinned-local-clips", files: captured },
    submissionEvidence: {
      attemptsReserved: state.attemptsUsed,
      validatedCompleteResponses: rows.filter(row => row.status === "complete").length,
      ambiguousJobs: rows.filter(row => row.status === "ambiguous").length,
      dryRun: options.dryRun,
      proof: options.dryRun ? "Anti media receipt reports zero gateway attempts" : "one bounded Anti listen invocation per reserved attempt",
      audioTokenUsage: null,
    },
    reference: manifest.reference,
    source: manifest.source,
    resolvedReplays: manifest.replays,
    phraseInventory: manifest.phraseInventory,
    coverage: buildAudioReviewCoverage(manifest, complete, new Map(rows.filter(row => row.comparisonStatus).map(row => [row.id, row.comparisonStatus as ComparisonStatus]))),
    reviewProfile: options.reviewProfile,
    reviewSchemaVersion: options.reviewProfile === "evidence-v2" ? 2 : 1,
    jobs: rows,
    listeningCalibration: { status: "unqualified", qualifiedCases: 0, claim: "advisory findings only" },
    providerListeningAttestation: "unverified",
    musicalAcceptance: "not-established",
  };
  validateAudioReport(report);
  return report;
}

async function run(options: Options): Promise<void> {
  options.baseUrl = safeBaseUrl(options.baseUrl);
  const rawManifest = JSON.parse(await readFile(options.manifestPath, "utf8")) as unknown;
  const manifest = await validateManifestFiles(rawManifest);
  if (options.sendAudio && options.maxRequests < manifest.jobs.length) throw new Error(`total request cap ${options.maxRequests} is below ${manifest.jobs.length} planned jobs; no provider work started`);
  const runtime = await checkRuntime(options);
  options.python = runtime.python;
  options.antiScript = runtime.antiScript;
  const manifestSha256 = sha256Text(stableJson(manifest));
  const prompts = Object.fromEntries(manifest.jobs.map(job => [job.id, buildPrompt(job, options.reviewProfile)]));
  const maxRequests = options.sendAudio ? options.maxRequests : 0;
  const gatewayCatalog = options.sendAudio ? await fetchGatewayModelCatalog(options.baseUrl) : null;
  const fingerprint = makeFingerprint(manifestSha256, runtime.antiScriptSha256, options, prompts, gatewayCatalog?.routeContractSha256 ?? null);
  await initializeOutput(options.outputDir, options.resume);
  const statePath = join(options.outputDir, "state.json");
  let state: RunState;
  let resumePlan: ReturnType<typeof planResumableJobs> | null = null;
  if (options.resume) {
    const rawState = JSON.parse(await readFile(statePath, "utf8")) as RunState;
    const savedProfile = rawState.reviewProfile ?? "legacy";
    const savedSchemaVersion = rawState.reviewSchemaVersion ?? 1;
    const selectedSchemaVersion = options.reviewProfile === "evidence-v2" ? 2 : 1;
    if (savedProfile !== options.reviewProfile || savedSchemaVersion !== selectedSchemaVersion) throw new Error("cannot resume: review profile or schema changed");
    if (rawState.fingerprint !== fingerprint) throw new Error("cannot resume: route, prompt, model, media, script, or request cap changed");
    resumePlan = planResumableJobs(rawState, manifest, manifestSha256, maxRequests);
    state = rawState;
  } else {
    state = newState(manifest, manifestSha256, fingerprint, maxRequests, gatewayCatalog, options.reviewProfile);
    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  if (options.resume) {
    const savedManifest = await readFile(join(options.outputDir, "manifest.json"), "utf8").catch(() => "");
    if (!savedManifest || sha256Text(stableJson(JSON.parse(savedManifest))) !== manifestSha256) throw new Error("cannot resume: retained manifest is missing or changed");
  } else {
    await atomicWrite(join(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await atomicWrite(join(options.outputDir, ".codex-review-output-sentinel"), `Keyspilli audio-review ${fingerprint}\n`);
  }
  const { captured, pathByHash } = await copyPinnedClips(manifest, options.outputDir);
  if (resumePlan?.ambiguous.length) {
    for (const id of resumePlan.ambiguous) state.jobs[id]!.status = "ambiguous";
    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const report = await materializeReport(manifest, state, options, manifestSha256, fingerprint, runtime.antiScriptSha256, captured, options.outputDir);
    await atomicWrite(join(options.outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(join(options.outputDir, "report.md"), reportMarkdown(report));
    throw new Error(`resume stopped safely: provider outcome is ambiguous for ${resumePlan.ambiguous.join(", ")}; no automatic replay was attempted`);
  }
  const plan = resumePlan ?? (options.resume
    ? planResumableJobs(state, manifest, manifestSha256, maxRequests)
    : { completed: [], pending: manifest.jobs.map(job => job.id), ambiguous: [] });
  if (plan.ambiguous.length) throw new Error(`resume stopped safely for ambiguous jobs: ${plan.ambiguous.join(", ")}`);

  for (const jobId of plan.pending) {
    const job = manifest.jobs.find(item => item.id === jobId)!;
    let responseSha256: string | undefined;
    let resolvedModel = options.model;
    let preflightSha256: string | undefined;
    let allowedModelIds = state.jobs[job.id]!.allowedModelIds;
    try {
      if (await sha256File(runtime.antiScript) !== runtime.antiScriptSha256) throw new Error("pinned Anti helper changed after preflight; refusing to run against a moving interface");
      if (options.sendAudio) {
        const preflightResult = await invokeAnti(options, job, pathByHash, prompts[job.id]!, options.outputDir, true);
        const preflightEnvelope = parseAntiDryRunStdout(preflightResult.stdout, prompts[job.id]!);
        const preflight = validateDryRun(preflightEnvelope, { hashes: [job.referenceClip.sha256, job.candidateClip.sha256], bytes: [job.referenceClip.bytes, job.candidateClip.bytes] });
        resolvedModel = preflight.resolvedModel;
        if (!gatewayCatalog) throw new Error("live audio is blocked without the pinned gateway model catalog");
        const routePin: GatewayAudioRoutePin = validateGatewayAudioRouteCatalog(gatewayCatalog.value, {
          model: options.model,
          resolvedModel,
          audioBytes: [job.referenceClip.bytes, job.candidateClip.bytes],
          audioDurations: [job.referenceClip.durationSeconds, job.candidateClip.durationSeconds],
        });
        if (routePin.backendAttemptLimit !== 1) throw new Error("gateway route does not enforce one backend attempt");
        allowedModelIds = routePin.allowedModelIds;
        const preflightBytes = Buffer.from(preflightResult.stdout, "utf8");
        preflightSha256 = hashBytes(preflightBytes);
        await atomicWrite(join(options.outputDir, "evidence", "responses", `${safeId(job.id)}.preflight.json`), preflightBytes);
        state.jobs[job.id] = { ...state.jobs[job.id]!, resolvedModel, preflightSha256, allowedModelIds };
        await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
        if (await sha256File(runtime.antiScript) !== runtime.antiScriptSha256) throw new Error("pinned Anti helper changed after dry-run preflight; refusing live submission");
        state.jobs[job.id] = { ...state.jobs[job.id]!, status: "submitted", attempts: 1 };
        state.attemptsUsed += 1;
        await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
      }
      const result = await invokeAnti(options, job, pathByHash, prompts[job.id]!, options.outputDir);
      const responseBytes = Buffer.from(result.stdout, "utf8");
      const responsePath = join(options.outputDir, "evidence", "responses", `${safeId(job.id)}.json`);
      await atomicWrite(responsePath, responseBytes);
      responseSha256 = hashBytes(responseBytes);
      const parsed = options.dryRun
        ? parseAntiDryRunStdout(result.stdout, prompts[job.id]!)
        : parseAntiLiveStdout(result.stdout);
      if (options.dryRun) {
        const dryRun = validateDryRun(parsed, { hashes: [job.referenceClip.sha256, job.candidateClip.sha256], bytes: [job.referenceClip.bytes, job.candidateClip.bytes] });
        state.jobs[job.id] = { status: "dry-run", attempts: 0, envelopeSha256: responseSha256, resolvedModel: dryRun.resolvedModel };
      } else {
        const validated = validateListenEnvelope(parsed, {
          model: options.model,
          resolvedModel,
          allowedModelIds: allowedModelIds ?? [],
          mode: job.mode,
          durations: { reference: job.referenceClip.durationSeconds, candidate: job.candidateClip.durationSeconds },
          expectedAudioHashes: [job.referenceClip.sha256, job.candidateClip.sha256],
          expectedAudioBytes: [job.referenceClip.bytes, job.candidateClip.bytes],
          reviewProfile: options.reviewProfile,
        });
        state.jobs[job.id] = { status: "complete", attempts: 1, envelopeSha256: responseSha256, resolvedModel, ...(validated.comparisonStatus ? { comparisonStatus: validated.comparisonStatus } : {}), ...(preflightSha256 ? { preflightSha256 } : {}), ...(allowedModelIds ? { allowedModelIds } : {}) };
        // The complete envelope remains byte-for-byte in evidence/responses; usage is not reinterpreted.
        void validated;
      }
      await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
    } catch (error) {
      if (options.sendAudio && state.jobs[job.id]!.status === "submitted") state.jobs[job.id] = {
        ...state.jobs[job.id]!,
        status: "ambiguous", attempts: 1,
        ...(responseSha256 ? { envelopeSha256: responseSha256 } : {}),
        ...(error instanceof AntiCommandFailure && error.partialStdoutSha256 ? { partialStdoutSha256: error.partialStdoutSha256 } : {}),
        ...(error instanceof AntiCommandFailure && error.partialStderrSha256 ? { partialStderrSha256: error.partialStderrSha256 } : {}),
      };
      await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
      const report = await materializeReport(manifest, state, options, manifestSha256, fingerprint, runtime.antiScriptSha256, captured, options.outputDir);
      await atomicWrite(join(options.outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await atomicWrite(join(options.outputDir, "report.md"), reportMarkdown(report));
      throw error;
    }
  }
  const report = await materializeReport(manifest, state, options, manifestSha256, fingerprint, runtime.antiScriptSha256, captured, options.outputDir);
  await atomicWrite(join(options.outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(join(options.outputDir, "report.md"), reportMarkdown(report));
  console.log(JSON.stringify({ status: report.status, reportJson: join(options.outputDir, "report.json"), reportMarkdown: join(options.outputDir, "report.md"), attemptsUsed: state.attemptsUsed, maxRequests: state.maxRequests, musicalAcceptance: report.musicalAcceptance }, null, 2));
}

async function main(): Promise<number> {
  try {
    if (process.argv[2] === "capabilities") {
      console.log(JSON.stringify(CAPABILITIES, null, 2));
      return 0;
    }
    const options = parseOptions(process.argv.slice(2));
    await run(options);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "__CAPABILITIES__") { console.log(JSON.stringify(CAPABILITIES, null, 2)); return 0; }
    console.error(`audio review blocked: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
