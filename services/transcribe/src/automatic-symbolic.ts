import { readFile, stat } from "node:fs/promises";
import { parseMidi, writeMidi, midiBeatToNativeSeconds } from "@keyspilli/midi";
import { extractYoutubeVideoId } from "@keyspilli/catalog/src/provenance.js";
import { retrieveExternalSource } from "@keyspilli/catalog/src/external-retrieval.js";
import { researchExternalCandidates } from "@keyspilli/catalog/src/external-research.js";
import { freezeGenerationCandidateSet, buildExternalSymbolicArrangement } from "@keyspilli/catalog/src/external-symbolic-pipeline.js";
import { assertGenerationEvidence, type EvidenceFirewallOptions } from "@keyspilli/catalog/src/external-evidence.js";
import { sha256Hex } from "@keyspilli/catalog/src/fixture-evidence.js";

/** Operator-verified index, never accepted from the import request or search snippets. */
export interface AutomaticSymbolicSource {
  id: string;
  recordingIds: string[];
  artist: string;
  title: string;
  arrangementTitle: string;
  sourceUrl: string;
  sourceSha256: string;
  license: "CC0-1.0" | "CC-BY-4.0" | "CC-BY-SA-4.0" | "Public-Domain";
  licenseEvidenceUrl: string;
  verificationEvidenceUrl: string;
  containsMelody: boolean;
  completeArrangement: true;
}

export function parseAutomaticSourceIndex(value: unknown): AutomaticSymbolicSource[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error("invalid automatic source index");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("invalid source record");
    const r = raw as AutomaticSymbolicSource;
    if ("purpose" in raw || "candidateClass" in raw || "evidenceClass" in raw) throw new Error("Evidence records cannot be imported as source index entries");
    if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) || ids.has(r.id)
      || !Array.isArray(r.recordingIds) || !r.recordingIds.length || r.recordingIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id))
      || [r.artist, r.title, r.arrangementTitle].some((s) => typeof s !== "string" || !s.trim() || s.length > 500)
      || !/^[a-f0-9]{64}$/.test(r.sourceSha256)
      || !["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "Public-Domain"].includes(r.license)
      || typeof r.containsMelody !== "boolean" || r.completeArrangement !== true) throw new Error("unverified automatic source record");
    for (const value of [r.sourceUrl, r.licenseEvidenceUrl, r.verificationEvidenceUrl]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("source evidence requires a public HTTPS URL");
    }
    ids.add(r.id);
    return { ...r, recordingIds: [...r.recordingIds] };
  });
}

export async function loadAutomaticSourceIndex(path: string): Promise<AutomaticSymbolicSource[]> {
  if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error("automatic source index exceeds 8MiB");
  const text = await readFile(path, "utf8");
  if (text.length > 8 * 1024 * 1024) throw new Error("automatic source index exceeds 8MiB");
  return parseAutomaticSourceIndex(JSON.parse(text));
}

/** No publication side effects. The worker must separately pass beta and job ownership gates. */
export async function resolveAutomaticSymbolic(
  requestedUrl: string,
  index: readonly AutomaticSymbolicSource[],
  options: { fetch?: typeof fetch; firewall?: EvidenceFirewallOptions; accompanimentOnly?: boolean } = {},
) {
  // Hash metadata only: reference notes never enter generation. Caller options cannot disable this boundary.
  const protectedHashes: unknown = JSON.parse(await readFile(new URL("./protected-reference-hashes.json", import.meta.url), "utf8"));
  if (!Array.isArray(protectedHashes) || !protectedHashes.length || protectedHashes.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid protected reference registry");
  const firewall: EvidenceFirewallOptions = { ...options.firewall, protectedSha256: [...protectedHashes, ...(options.firewall?.protectedSha256 ?? [])] };
  const id = extractYoutubeVideoId(requestedUrl);
  if (!id) throw new Error("invalid requested YouTube identity");
  const candidates = parseAutomaticSourceIndex(index).filter((r) => r.recordingIds.includes(id));
  if (candidates.length > 1) return { status: "review" as const, reason: "Multiple verified arrangements require selection", attempts: [] };
  const attempts: { sourceId: string; reason: string }[] = [];
  for (const source of candidates.slice(0, 3)) {
    try {
      if (!source.containsMelody && !options.accompanimentOnly) throw new Error("Available source is accompaniment only");
      // Reject the pinned original hash before acquisition or timing normalization.
      assertGenerationEvidence({ id: source.id, purpose: "GENERATION_CANDIDATE", evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", status: "parsed", provenance: { sourceRef: `indexed:${source.id}`, acquisition: "local-bytes" }, content: { sha256: source.sourceSha256 } }, firewall);
      const loaded = await retrieveExternalSource({ initialUrl: source.sourceUrl }, {
        allowNetwork: true, retainBytes: true, maxBytes: 16 * 1024 * 1024,
        signal: AbortSignal.timeout(120000), ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      if (!loaded.parserEligible || loaded.detectedFormat !== "midi" || !loaded.bytes) throw new Error(loaded.rejectionReasons.join("; ") || "A verified native MIDI is required");
      if (sha256Hex(loaded.bytes) !== source.sourceSha256) throw new Error("Source hash changed; verification required");
      const parsed = parseMidi(loaded.bytes);
      const endSeconds = midiBeatToNativeSeconds(parsed, parsed.durationBeats);
      if (!Number.isFinite(endSeconds) || endSeconds <= 0 || endSeconds > 600 || !parsed.notes.length) throw new Error("Source duration or notes are invalid");
      // Fixed 120 BPM encodes native seconds exactly, including source tempo changes.
      const notes = parsed.notes.map((n) => ({ ...n, start: midiBeatToNativeSeconds(parsed, n.start) * 2, dur: (midiBeatToNativeSeconds(parsed, n.start + n.dur) - midiBeatToNativeSeconds(parsed, n.start)) * 2 }));
      const normalized = writeMidi(notes, { tempoBpm: 120, timeSig: parsed.timeSig, title: source.arrangementTitle,
        tracks: [{ name: "Right Hand", notes: notes.filter((n) => n.hand !== "L") }, { name: "Left Hand", notes: notes.filter((n) => n.hand === "L") }] });
      const inventory = await researchExternalCandidates({ title: source.title, artist: source.artist, sourceYoutubeUrl: requestedUrl }, {
        firewall,
        localInputs: [{ id: source.id, bytes: normalized, format: "midi", title: source.title, artist: source.artist,
          sourceRef: `indexed:${source.id}`, sourcePage: source.sourceUrl, version: source.sourceSha256,
          provenanceClass: "OPEN_LICENSE", evidenceClass: "PIANO_COVER_SYMBOLIC", purpose: "GENERATION_CANDIDATE",
          alignment: { status: "aligned", reason: "Selected arrangement owns timing; not aligned to the requested recording" } }],
      });
      const frozen = freezeGenerationCandidateSet(inventory.records, { ...firewall, requireAlignment: true });
      const arrangement = buildExternalSymbolicArrangement({ candidateSet: frozen, mode: "direct-piano", fallbackEnabled: false, firewall });
      if (arrangement.status !== "symbolic" || !arrangement.canonical?.notes.length) throw new Error(arrangement.fallbackReason || "Native arrangement rejected");
      return { status: "candidate" as const, arrangement, sourceBytes: loaded.bytes, attempts,
        provenance: { beta: true as const, requestedUrl, actualSourceUrl: source.sourceUrl, sourceSha256: source.sourceSha256,
          realizationSha256: sha256Hex(normalized), sourceKind: "verified-native-midi" as const, arrangementTitle: source.arrangementTitle,
          artist: source.artist, title: source.title, timingOwner: "selected-arrangement" as const, containsMelody: source.containsMelody,
          license: source.license, licenseEvidenceUrl: source.licenseEvidenceUrl, verificationEvidenceUrl: source.verificationEvidenceUrl,
          candidateSetDigest: frozen.digest } };
    } catch (error) { attempts.push({ sourceId: source.id, reason: error instanceof Error ? error.message : "Source failed" }); }
  }
  return { status: "review" as const, reason: attempts.length ? "Verified source could not be realized" : "No verified arrangement is indexed for this recording", attempts };
}
