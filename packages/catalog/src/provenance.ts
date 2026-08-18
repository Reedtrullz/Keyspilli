/**
 * Shared source-identity helpers for catalogue metadata.
 *
 * A song can have several useful source labels at once: a public YouTube
 * video id, a physical seed path, and a database URL.  The labels answer
 * different questions and must not be compared as if they were the same
 * field.  In particular, a seed path is an artifact location, not proof
 * that the musical source changed.
 */

export interface SourceProvenance {
  /** Content/source family, for example `youtube`, `upload`, or `standard`. */
  kind?: string | null;
  acquiredVia?: string | null;
  /** Stable logical source identity. YouTube sources are normalized to `youtube:<id>`. */
  sourceRef?: string | null;
  sourceYoutubeUrl?: string | null;
  /** Optional physical artifact locator kept separate from logical identity. */
  sourceArtifactRef?: string | null;
}

export interface CanonicalSourceIdentity {
  canonicalSourceRef: string | null;
  youtubeVideoId: string | null;
  sourceRef: string | null;
  sourceYoutubeUrl: string | null;
  sourceArtifactRef: string | null;
}

export type ProvenanceDiffSeverity = "warning" | "error";

export interface ProvenanceDiff {
  severity: ProvenanceDiffSeverity;
  code: "missing-identity" | "identity-drift" | "kind-drift" | "acquired-via-drift" | "youtube-url-drift";
  message: string;
  labels: string[];
}

export interface ProvenanceSnapshot {
  label: string;
  provenance?: unknown;
  /** Database rows keep these source fields beside, rather than inside, JSON provenance. */
  contentType?: unknown;
  acquiredVia?: unknown;
  sourceYoutubeUrl?: unknown;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function youtubeId(value: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}

/** Extract a stable video id from the common YouTube URL forms. */
export function extractYoutubeVideoId(value: unknown): string | null {
  const text = stringOrNull(value);
  if (!text) return null;
  const direct = youtubeId(text);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return youtubeId(url.pathname.slice(1).split("/")[0] ?? "");
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
  const queryId = url.searchParams.get("v");
  if (queryId) return youtubeId(queryId);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]!)) {
    return youtubeId(parts[1]!);
  }
  return null;
}

/** Return the canonical public URL while retaining the original URL elsewhere. */
export function canonicalYoutubeUrl(value: unknown): string | null {
  const id = extractYoutubeVideoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function sourceRefYoutubeId(value: string | null): string | null {
  if (!value) return null;
  const prefix = value.match(/^youtube:(.+)$/i)?.[1]?.trim();
  if (!prefix || /^youtube-job:/i.test(prefix)) return null;
  return youtubeId(prefix);
}

/**
 * Canonicalize one logical source reference. A URL wins over a stale seed
 * filename, because the URL carries the stable public identity. Unknown
 * non-YouTube references remain intact for legacy and upload sources.
 */
export function canonicalSourceRef(sourceRef: unknown, sourceYoutubeUrl?: unknown): string | null {
  const ref = stringOrNull(sourceRef);
  const fromUrl = extractYoutubeVideoId(sourceYoutubeUrl);
  if (fromUrl) return `youtube:${fromUrl}`;
  const fromRef = sourceRefYoutubeId(ref);
  if (fromRef) return `youtube:${fromRef}`;
  if (ref?.toLowerCase().startsWith("youtube:")) return ref;
  return ref;
}

function isPhysicalSourceRef(value: string | null): boolean {
  return value !== null && /^(?:seed|upload|reconstructed-upload|stored-advanced|manifest):/i.test(value);
}

/**
 * Normalize source metadata without discarding the raw physical locator.
 * The returned `sourceRef` is safe to compare across DB/manifest/API layers.
 */
export function canonicalizeSourceProvenance(value: unknown, defaults: SourceProvenance = {}): SourceProvenance {
  const raw = record(value) ?? {};
  const sourceRef = stringOrNull(raw.sourceRef ?? defaults.sourceRef);
  const sourceYoutubeUrl = stringOrNull(raw.sourceYoutubeUrl ?? defaults.sourceYoutubeUrl);
  const canonicalRef = canonicalSourceRef(sourceRef, sourceYoutubeUrl);
  const suppliedArtifactRef = stringOrNull(raw.sourceArtifactRef ?? defaults.sourceArtifactRef);
  const sourceArtifactRef = suppliedArtifactRef ?? (isPhysicalSourceRef(sourceRef) && sourceRef !== canonicalRef ? sourceRef : null);
  const kind = stringOrNull(raw.kind ?? defaults.kind);
  const acquiredVia = stringOrNull(raw.acquiredVia ?? defaults.acquiredVia);
  return {
    ...(kind === null ? {} : { kind }),
    ...(acquiredVia === null ? {} : { acquiredVia }),
    sourceRef: canonicalRef,
    sourceYoutubeUrl,
    ...(sourceArtifactRef === null ? {} : { sourceArtifactRef }),
  };
}

export function canonicalSourceIdentity(value: unknown, defaults: SourceProvenance = {}): CanonicalSourceIdentity {
  const normalized = canonicalizeSourceProvenance(value, defaults);
  return {
    canonicalSourceRef: normalized.sourceRef ?? null,
    youtubeVideoId: extractYoutubeVideoId(normalized.sourceYoutubeUrl) ?? sourceRefYoutubeId(normalized.sourceRef ?? null),
    sourceRef: normalized.sourceRef ?? null,
    sourceYoutubeUrl: normalized.sourceYoutubeUrl ?? null,
    sourceArtifactRef: normalized.sourceArtifactRef ?? null,
  };
}

/** Compare logical source identities while ignoring URL formatting and seed paths. */
export function sourceIdentitiesAgree(left: unknown, right: unknown): boolean {
  const a = canonicalSourceIdentity(left);
  const b = canonicalSourceIdentity(right);
  if (a.youtubeVideoId || b.youtubeVideoId) return a.youtubeVideoId !== null && a.youtubeVideoId === b.youtubeVideoId;
  return a.canonicalSourceRef !== null && a.canonicalSourceRef === b.canonicalSourceRef;
}

function normalizedField(value: unknown): string | null {
  return stringOrNull(value)?.toLowerCase() ?? null;
}

/**
 * Compare source metadata snapshots from the DB, manifest, notes.json, or an
 * API projection. Missing identity is a warning; an explicitly conflicting
 * identity is an error. This is deliberately a metadata comparison: it does
 * not claim that equal provenance proves equal musical bytes.
 */
export function compareProvenanceSnapshots(snapshots: readonly ProvenanceSnapshot[]): ProvenanceDiff[] {
  const normalized = snapshots.map((snapshot) => {
    const raw = record(snapshot.provenance) ?? {};
    const provenance = canonicalizeSourceProvenance(raw, {
      kind: stringOrNull(snapshot.contentType),
      acquiredVia: stringOrNull(snapshot.acquiredVia),
      sourceYoutubeUrl: stringOrNull(snapshot.sourceYoutubeUrl),
    });
    return {
      ...snapshot,
      provenance,
      identity: canonicalSourceIdentity(provenance),
    };
  });
  const diffs: ProvenanceDiff[] = [];
  const knownIdentity = normalized.filter((snapshot) => snapshot.identity.canonicalSourceRef !== null);
  const first = knownIdentity[0];
  // If every layer is legacy/anonymous there is no cross-layer claim to make.
  // Once one layer carries an identity, however, a missing mirror is useful
  // migration evidence rather than something to silently ignore.
  if (first) for (const snapshot of normalized) {
    if (snapshot.identity.canonicalSourceRef === null) {
      diffs.push({
        severity: "warning",
        code: "missing-identity",
        message: `${snapshot.label}: source identity is missing`,
        labels: [snapshot.label],
      });
    }
  }
  if (first) {
    for (const snapshot of knownIdentity.slice(1)) {
      if (!sourceIdentitiesAgree(first.provenance, snapshot.provenance)) {
        // A legacy sidecar may expose only `seed:<file>` while the DB/API has
        // the public YouTube id. That is metadata migration evidence, not
        // proof that the musical bytes changed. Fail closed only when both
        // sides carry logical identities that explicitly disagree.
        const physicalLocatorOnly = isPhysicalSourceRef(first.identity.sourceRef)
          || isPhysicalSourceRef(snapshot.identity.sourceRef);
        diffs.push({
          severity: physicalLocatorOnly ? "warning" : "error",
          code: "identity-drift",
          message: physicalLocatorOnly
            ? `source locator differs without proving musical content drift: ${first.label}=${first.identity.canonicalSourceRef}, ${snapshot.label}=${snapshot.identity.canonicalSourceRef}`
            : `source identity drift: ${first.label}=${first.identity.canonicalSourceRef}, ${snapshot.label}=${snapshot.identity.canonicalSourceRef}`,
          labels: [first.label, snapshot.label],
        });
      }
    }
  }
  for (const [field, code, description] of [
    ["kind", "kind-drift", "content kind"],
    ["acquiredVia", "acquired-via-drift", "acquired_via"],
  ] as const) {
    const values = normalized
      .map((snapshot) => ({ label: snapshot.label, value: normalizedField(snapshot.provenance[field]) }))
      .filter((item): item is { label: string; value: string } => item.value !== null);
    const value = values[0];
    if (value && values.some((item) => item.value !== value.value)) {
      const conflicting = values.find((item) => item.value !== value.value)!;
      diffs.push({
        severity: "error",
        code,
        message: `${description} provenance drift: ${value.label}=${value.value}, ${conflicting.label}=${conflicting.value}`,
        labels: [value.label, conflicting.label],
      });
    }
  }
  const urls = normalized
    .map((snapshot) => ({ label: snapshot.label, id: snapshot.identity.youtubeVideoId, url: snapshot.identity.sourceYoutubeUrl }))
    .filter((item): item is { label: string; id: string | null; url: string | null } => item.id !== null || item.url !== null);
  const firstUrl = urls[0];
  if (firstUrl && urls.some((item) => {
    if (firstUrl.id && item.id) return firstUrl.id !== item.id;
    return firstUrl.url !== item.url;
  })) {
    const conflicting = urls.find((item) => {
      if (firstUrl.id && item.id) return firstUrl.id !== item.id;
      return firstUrl.url !== item.url;
    })!;
    diffs.push({
      severity: "error",
      code: "youtube-url-drift",
      message: `YouTube URL provenance drift: ${firstUrl.label}=${firstUrl.url ?? firstUrl.id}, ${conflicting.label}=${conflicting.url ?? conflicting.id}`,
      labels: [firstUrl.label, conflicting.label],
    });
  }
  return diffs;
}

/** Validate event-level origin against the source that owns a timeline. */
export function sourceKindMismatch(sourceKind: string, eventKinds: readonly string[]): string[] {
  const issues: string[] = [];
  const unique = [...new Set(eventKinds)];
  if (sourceKind === "chart" && unique.some((kind) => kind === "generated")) {
    issues.push(`chart source contains generated events (${unique.join(", ")})`);
  }
  if (sourceKind === "midi-derived" && unique.some((kind) => kind === "authored")) {
    issues.push(`midi-derived source contains authored events (${unique.join(", ")})`);
  }
  return issues;
}
