/** A bounded evidence package for the existing musical-review receipt contract. */
import { parseMidi, parseMusicXmlNotes } from "@keyspilli/midi";
import { assertMusic, identityHash, isHash } from "./acoustic-receipt.js";
import { sha256Hex } from "./fixture-evidence.js";
import { auditExactInputs, evidenceObject, parseExactInputRegistry, readExactAsset, type ExactInputRegistry, type ExactInputAudit } from "./exact-input-evidence.js";
import { parseMusicalOutputIdentity, parseMusicalReviewReceipt, sameMusicalOutput, summarizeMusicalReviews,
  type MusicalOutputIdentity, type MusicalReviewMode, type MusicalReviewReceipt } from "./musical-review.js";
export interface FullReviewMode {
  mode: MusicalReviewMode;
  identity: MusicalOutputIdentity | null;
  outputClock: { assetId: string; endBeat: number; endSeconds: number; captureOffsetSeconds: number } | null;
  artifacts: Record<"midi" | "musicxml" | "playerSnapshot" | "playerCapture" | "playerAudio" | "capturePlan", string | null>;
  receiptAssetIds: string[];
}
export interface FullReviewPiece {
  id: string; compositionId: string; performanceId: string | null;
  classification: "real" | "synthetic";
  sourceAssetId: string | null;
  sourceClock: { assetId: string; startSeconds: number; endSeconds: number } | null;
  provenance: { code: string; config: string; renderer: string } | null;
  modes: FullReviewMode[];
}
export interface FullOutputReviewRequest {
  schemaVersion: 1; kind: "keyspilli-full-output-review-request"; registrySha256: string; pieces: FullReviewPiece[];
}
const ARTIFACTS = ["midi", "musicxml", "playerSnapshot", "playerCapture", "playerAudio", "capturePlan"] as const;
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,125}$/.test(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const nullableId = (v: unknown) => v === null || validId(v);

export function parseFullOutputReviewRequest(input: unknown): FullOutputReviewRequest {
  const raw = evidenceObject(input, "full review request"), request = raw as unknown as FullOutputReviewRequest;
  assertMusic(raw.schemaVersion === 1 && raw.kind === "keyspilli-full-output-review-request" && isHash(raw.registrySha256), "unsupported or unpinned review request");
  assertMusic(Array.isArray(request.pieces) && request.pieces.length > 0 && request.pieces.length <= 3, "one to three bounded complete arrangements required");
  assertMusic(new Set(request.pieces.map(p => p.id)).size === request.pieces.length && new Set(request.pieces.map(p => p.compositionId)).size === request.pieces.length, "distinct piece and composition identities required; covers stay in one composition");
  for (const p of request.pieces) {
    assertMusic(p && validId(p.id) && p.id.length <= 95 && validId(p.compositionId) && nullableId(p.performanceId)
      && ["real", "synthetic"].includes(p.classification) && nullableId(p.sourceAssetId), "invalid composition/performance/source identity");
    assertMusic(p.sourceClock === null || (p.sourceClock && validId(p.sourceClock.assetId) && nonnegative(p.sourceClock.startSeconds) && positive(p.sourceClock.endSeconds)
      && p.sourceClock.endSeconds > p.sourceClock.startSeconds && p.sourceClock.endSeconds <= 1800), "invalid explicit source clock extent");
    assertMusic(p.provenance === null || (p.provenance && [p.provenance.code, p.provenance.config, p.provenance.renderer].every(validId)), "invalid code/config/renderer identity");
    assertMusic(Array.isArray(p.modes) && p.modes.length === 2 && new Set(p.modes.map(m => m.mode)).size === 2 && p.modes.every(m => ["Original", "Chords"].includes(m.mode)), "independent Original and Chords modes required");
    for (const m of p.modes) {
      if (m.identity !== null) { const parsed = parseMusicalOutputIdentity(m.identity); assertMusic(parsed.mode === m.mode, "output identity mode confusion"); }
      assertMusic(m.outputClock === null || (m.outputClock && validId(m.outputClock.assetId) && positive(m.outputClock.endBeat) && m.outputClock.endBeat <= 1e6
        && positive(m.outputClock.endSeconds) && m.outputClock.endSeconds <= 1800 && nonnegative(m.outputClock.captureOffsetSeconds) && m.outputClock.captureOffsetSeconds <= 5), "invalid explicit output clock/coverage");
      assertMusic(m.artifacts && Object.keys(m.artifacts).length === ARTIFACTS.length && ARTIFACTS.every(key => nullableId(m.artifacts[key])), "all six export/Player artifact slots must be explicit");
      assertMusic(Array.isArray(m.receiptAssetIds) && m.receiptAssetIds.length <= 16 && m.receiptAssetIds.every(validId) && new Set(m.receiptAssetIds).size === m.receiptAssetIds.length, "bounded unique receipt references required");
    }
  }
  return JSON.parse(JSON.stringify(request)) as FullOutputReviewRequest;
}

function modeBinding(p: FullReviewPiece, m: FullReviewMode, registry: ExactInputRegistry) {
  const pin = (id: string | null) => id === null ? null : { id, sha256: registry.assets.find(a => a.id === id)?.sha256 ?? null };
  const dependencies = new Set<string>();
  function include(id: string | null | undefined) {
    if (!id || dependencies.has(id)) return; dependencies.add(id);
    const t = registry.assets.find(a => a.id === id)?.transformation;
    for (const ref of t ? [...t.inputs, t.code, t.config, t.renderer] : []) include(ref);
  }
  [p.sourceAssetId, p.sourceClock?.assetId, p.provenance?.code, p.provenance?.config, p.provenance?.renderer,
    m.outputClock?.assetId, ...Object.values(m.artifacts)].forEach(include);
  const dependencyPins = [...dependencies].sort().map(id => {
    const a = registry.assets.find(a => a.id === id);
    return a ? { id: a.id, sha256: a.sha256, role: a.role, permission: a.permission, snapshots: a.snapshots, transformation: a.transformation } : { id, sha256: null };
  });
  const contents = { schemaVersion: 1, kind: "keyspilli-full-output-evidence-binding", pieceId: p.id, compositionId: p.compositionId, performanceId: p.performanceId,
    classification: p.classification, source: pin(p.sourceAssetId), sourceClock: p.sourceClock ? { ...p.sourceClock, asset: pin(p.sourceClock.assetId) } : null,
    provenance: p.provenance ? { code: pin(p.provenance.code), config: pin(p.provenance.config), renderer: pin(p.provenance.renderer) } : null,
    mode: m.mode, identity: m.identity, outputClock: m.outputClock ? { ...m.outputClock, asset: pin(m.outputClock.assetId) } : null,
    artifacts: Object.fromEntries(ARTIFACTS.map(key => [key, pin(m.artifacts[key])])), dependencyPins };
  return { id: `full-output-${p.id}-${m.mode.toLowerCase()}`, sha256: identityHash(contents), contents };
}

/** The recorder writes RIFF PCM16; inspect all frames without imposing the 4-second paired-input limit. */
function pcm16Clock(b: Buffer) {
  assertMusic(b.length >= 44 && b.toString("ascii", 0, 4) === "RIFF" && b.readUInt32LE(4) + 8 === b.length && b.toString("ascii", 8, 12) === "WAVE", "invalid WAV");
  let fmt: Buffer | null = null, data: Buffer | null = null;
  for (let at = 12; at < b.length;) {
    assertMusic(at + 8 <= b.length, "truncated WAV chunk");
    const length = b.readUInt32LE(at + 4), end = at + 8 + length, kind = b.toString("ascii", at, at + 4);
    assertMusic(end + length % 2 <= b.length, "truncated WAV chunk");
    if (kind === "fmt ") { assertMusic(fmt === null, "duplicate WAV format"); fmt = b.subarray(at + 8, end); }
    if (kind === "data") { assertMusic(data === null, "duplicate WAV data"); data = b.subarray(at + 8, end); }
    at = end + length % 2;
  }
  assertMusic(fmt && fmt.length >= 16 && data && data.length > 0 && fmt.readUInt16LE(0) === 1 && fmt.readUInt16LE(14) === 16, "PCM16 WAV required");
  const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4);
  assertMusic([1, 2].includes(channels) && sampleRate >= 8000 && sampleRate <= 96000 && data.length % (2 * channels) === 0
    && fmt.readUInt16LE(12) === channels * 2 && fmt.readUInt32LE(8) === sampleRate * channels * 2, "invalid WAV frame clock");
  let nonzero = false; for (let i = 0; i < data.length; i += 2) if (data.readInt16LE(i) !== 0) { nonzero = true; break; }
  assertMusic(nonzero, "digital-zero capture is a diagnostic, not complete audible output");
  return { frames: data.length / (2 * channels), channels, sampleRate, durationSeconds: data.length / (2 * channels * sampleRate) };
}
type ReviewSummary = ReturnType<typeof summarizeMusicalReviews>;
export interface PreparedFullReviewMode {
  mode: MusicalReviewMode;
  evidenceCompleteness: "complete" | "incomplete";
  blockers: string[];
  binding: ReturnType<typeof modeBinding>;
  receiptTemplate: unknown;
  receiptIssues: string[];
  declaredReviewStatus: ReviewSummary["status"];
  sourceCorrectness: ReviewSummary["source"];
  sourceCompleteness: "not-established";
  listening: ReviewSummary["listening"];
  keyboard: ReviewSummary["keyboard"];
  reviewerAuthentication: "not-performed";
}
export interface FullOutputReviewPackage {
  schemaVersion: 1; kind: "keyspilli-full-output-review-package";
  requestSha256: string; audit: ExactInputAudit;
  pieces: Array<{ id: string; compositionId: string; performanceId: string | null; status: "blocked" | "synthetic-only" | "ready-for-independent-review"; modes: PreparedFullReviewMode[] }>;
  status: "blocked" | "synthetic-only" | "ready-for-independent-review";
  musicalAcceptance: "not-established"; providerCalls: 0; limitations: string[]; packageSha256: string;
}

export async function prepareFullOutputReview(requestValue: unknown, registryValue: unknown, roots: Record<string, string>): Promise<FullOutputReviewPackage> {
  const request = parseFullOutputReviewRequest(requestValue), registry = parseExactInputRegistry(registryValue);
  assertMusic(request.registrySha256 === identityHash(registry), "review request registry changed");
  const audit = await auditExactInputs(registry, roots, "review"), pieces: FullOutputReviewPackage["pieces"] = [];
  const status = new Map(audit.assets.map(a => [a.id, a.status])), byId = new Map(registry.assets.map(a => [a.id, a]));
  const json = async (id: string) => evidenceObject(JSON.parse((await readExactAsset(registry, roots, id, "review")).toString("utf8")), "evidence JSON");
  for (const p of request.pieces) {
    const modes: PreparedFullReviewMode[] = [];
    for (const m of p.modes) {
      const blockers: string[] = [], receiptIssues: string[] = [];
      const requiredAssets = new Set<string>();
      const requireAsset = (id: string | null, slot: string, role?: string): void => {
        if (id !== null && status.get(id) === "available" && role && byId.get(id)?.role !== role) blockers.push(`${id}:wrong-${slot}-role`);
        if (id !== null && requiredAssets.has(id)) return;
        if (id !== null) requiredAssets.add(id);
        if (id === null) blockers.push(`missing-${slot}`);
        else if (status.get(id) !== "available") blockers.push(`${id}:${status.get(id) ?? "unregistered"}`);
        const t = id ? byId.get(id)?.transformation : null;
        if (t) {
          t.inputs.forEach(ref => requireAsset(ref, "transformation-input")); requireAsset(t.code, "code", "code"); requireAsset(t.config, "config", "config");
          if (t.renderer) requireAsset(t.renderer, "renderer", "renderer");
        }
      };
      if (!p.performanceId) blockers.push("missing-performance-identity");
      requireAsset(p.sourceAssetId, "source", "source"); requireAsset(p.sourceClock?.assetId ?? null, "source-clock", "clock");
      for (const role of ["code", "config", "renderer"] as const) requireAsset(p.provenance?.[role] ?? null, role, role);
      for (const key of ARTIFACTS) requireAsset(m.artifacts[key], key);
      requireAsset(m.outputClock?.assetId ?? null, "output-clock", "clock");
      if (!m.identity) blockers.push("missing-output-identity");
      if (m.identity && byId.get(p.sourceAssetId ?? "")?.sha256 !== m.identity.sourceArtifactSha256) blockers.push("source-identity-mismatch");
      const binding = modeBinding(p, m, registry);
      if (!blockers.length) {
        try {
          const [plan, capture, snapshot, clock] = await Promise.all([json(m.artifacts.capturePlan!), json(m.artifacts.playerCapture!), json(m.artifacts.playerSnapshot!), json(m.outputClock!.assetId)]);
          // The existing capture receipt omits mode; bind its independently pinned plan.
          if (plan.mode !== m.mode.toLowerCase() || plan.songId !== m.identity!.variantId) blockers.push("capture-plan-mode-or-variant-mismatch");
          const audio = evidenceObject(capture.audio, "capture audio"), recorder = evidenceObject(capture.capture, "recorder");
          assertMusic(capture.schemaVersion === 1 && capture.kind === "keyspilli-player-capture" && typeof capture.id === "string", "existing Player capture receipt required");
          assertMusic(recorder.recorderClock === "audio-worklet-frame" && nonnegative(recorder.firstSampleContextSeconds)
            && Array.isArray(recorder.sampleAssets) && recorder.sampleAssets.length > 0 && recorder.sampleAssets.length <= 1024
            && recorder.sampleAssets.every(a => a && typeof a === "object" && isHash(a.sha256) && positive(a.bytes)), "sampled Player frame-clock evidence required");
          assertMusic(audio.sha256 === byId.get(m.artifacts.playerAudio!)!.sha256 && recorder.sha256 === audio.sha256, "capture/audio hash mismatch");
          const physical = pcm16Clock(await readExactAsset(registry, roots, m.artifacts.playerAudio!, "review", 256 * 1024 * 1024));
          assertMusic(["frames", "channels", "sampleRate", "durationSeconds"].every(k => Math.abs(Number(audio[k]) - physical[k as keyof typeof physical]) < 1e-8), "capture/audio clock mismatch");
          const output = m.outputClock!;
          assertMusic(clock.basis === "resolved-playback-seconds" && clock.endBeat === output.endBeat && clock.endSeconds === output.endSeconds
            && clock.captureOffsetSeconds === output.captureOffsetSeconds && clock.audioSha256 === audio.sha256 && clock.snapshotSha256 === byId.get(m.artifacts.playerSnapshot!)!.sha256
            && positive(clock.speed) && Number.isInteger(clock.transpose), "output clock binding mismatch");
          assertMusic(recorder.sourceClockOffsetSeconds === output.captureOffsetSeconds, "recorder/output clock offset mismatch");
          assertMusic(physical.durationSeconds + 1 / physical.sampleRate >= output.endSeconds + output.captureOffsetSeconds
            && typeof plan.durationMs === "number" && plan.durationMs / 1000 >= output.endSeconds + output.captureOffsetSeconds, "partial Player capture coverage");
          assertMusic(snapshot.schemaVersion === 1 && snapshot.endBeatExclusive === output.endBeat && Array.isArray(snapshot.notes), "partial/missing Player snapshot extent");
          // owner-admission.musicalHash hashes JSON.stringify(snapshot), not the
          // pretty-printed file bytes. Keep that existing receipt identity intact.
          assertMusic(sha256Hex(Buffer.from(JSON.stringify(snapshot))) === m.identity!.playbackSha256, "existing playback digest mismatch");
          const midi = parseMidi(await readExactAsset(registry, roots, m.artifacts.midi!, "review"));
          const xml = parseMusicXmlNotes((await readExactAsset(registry, roots, m.artifacts.musicxml!, "review")).toString("utf8"));
          assertMusic(midi.durationBeats + 1e-6 >= output.endBeat && xml.durationBeats + 1e-6 >= output.endBeat, "partial export coverage");
        } catch (error) { blockers.push(`invalid-output-evidence:${error instanceof Error ? error.message.slice(0, 180) : "validation"}`); }
      }
      const receipts: MusicalReviewReceipt[] = [];
      for (const id of m.receiptAssetIds) {
        if (status.get(id) !== "available") { receiptIssues.push(`${id}:${status.get(id) ?? "unregistered"}`); continue; }
        try {
          const r = parseMusicalReviewReceipt(await json(id));
          if (!m.identity || !sameMusicalOutput(r, m.identity)) { receiptIssues.push(`${id}:stale-output-identity`); continue; }
          if (!m.outputClock || r.coverage.some(span => span.endBeat > m.outputClock!.endBeat + 1e-6)) { receiptIssues.push(`${id}:coverage-exceeds-output`); continue; }
          if (!r.reviewer.independent) { receiptIssues.push(`${id}:non-independent-observation`); continue; }
          const checks = [r.checks.source, r.checks.listening, r.checks.keyboard];
          if (checks.some(c => c.result !== "pending" && !c.evidence.some(e => e.id === binding.id && e.sha256 === binding.sha256))) { receiptIssues.push(`${id}:stale-package-binding`); continue; }
          if (checks.some(c => c.evidence.some(e => !(e.id === binding.id && e.sha256 === binding.sha256) && !(status.get(e.id) === "available" && byId.get(e.id)?.sha256 === e.sha256)))) { receiptIssues.push(`${id}:unavailable-check-evidence`); continue; }
          if (!blockers.length) receipts.push(r);
        } catch { receiptIssues.push(`${id}:invalid-review-receipt`); }
      }
      const summary = m.identity && m.outputClock ? summarizeMusicalReviews(receipts, m.identity, m.outputClock.endBeat) : null;
      const evidence = [{ id: binding.id, sha256: binding.sha256 }];
      const receiptTemplate = m.identity && m.outputClock ? { schemaVersion: 1, kind: "musical-review-receipt", ...m.identity,
        reviewer: { id: null, role: null, independent: null }, reviewedAt: null, coverage: [{ startBeat: 0, endBeat: m.outputClock.endBeat }], decision: "pending", rationale: null,
        checks: { source: { result: "pending", evidence }, listening: { result: "pending", evidence }, keyboard: { result: "pending", evidence } } } : null;
      modes.push({ mode: m.mode, evidenceCompleteness: blockers.length ? "incomplete" : "complete", blockers, binding, receiptTemplate, receiptIssues,
        declaredReviewStatus: summary?.status ?? "pending", sourceCorrectness: summary?.source ?? "pending", sourceCompleteness: "not-established",
        listening: summary?.listening ?? "pending", keyboard: summary?.keyboard ?? "pending", reviewerAuthentication: "not-performed" });
    }
    pieces.push({ id: p.id, compositionId: p.compositionId, performanceId: p.performanceId, status: modes.some(m => m.blockers.length) ? "blocked" : p.classification === "synthetic" ? "synthetic-only" : "ready-for-independent-review", modes });
  }
  const result = { schemaVersion: 1 as const, kind: "keyspilli-full-output-review-package" as const, requestSha256: identityHash(request), audit, pieces,
    status: pieces.some(p => p.status === "blocked") ? "blocked" as const : pieces.some(p => p.status === "synthetic-only") ? "synthetic-only" as const : "ready-for-independent-review" as const,
    musicalAcceptance: "not-established" as const, providerCalls: 0 as const, limitations: [
      "Preparation only. Existing receipts are supplied human attestations; reviewer identity/independence is not authenticated by this command.",
      "Byte and extent checks do not prove source correctness, source completeness, musical correspondence, audible quality or physical keyboard feasibility.",
      "Composition/performance, source clocks and code/renderer provenance are supplied assertions, independently pinned for review.",
      "Legacy Player capture receipts require a separate capture plan to bind mode; hashes do not authenticate recording origin.",
      "Source approval alone cannot approve backing. Each completed check must bind this complete unchanged mode package.",
      "No golden pins, catalog files, installed plugins or publication state are changed. Synthetic tests cannot grant musical acceptance.",
    ] };
  return { ...result, packageSha256: identityHash(result) };
}
