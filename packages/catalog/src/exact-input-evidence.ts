/** Local, read-only byte resolution. No catalog, network, model or approval writes. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertMusic, identityHash, isHash } from "./acoustic-receipt.js";

export type EvidencePurpose = "audit" | "review";
export interface ExactInputPermission {
  basis: "self-authored" | "licensed" | "user-authorized-local" | "unknown";
  scopes: EvidencePurpose[];
  evidence: string;
}
export interface ExactInputLocation { rootId: string; path: string }
export type ExactAssetRole = "source" | "output" | "code" | "config" | "renderer" | "receipt" | "clock" | "metadata";
export interface ExactInputAsset {
  id: string;
  sha256: string;
  bytes: number | null;
  role: ExactAssetRole;
  permission: ExactInputPermission | null;
  locations: ExactInputLocation[];
  snapshots: Array<{ snapshotId: string; member: string }>;
  transformation: { inputs: string[]; code: string; config: string; renderer: string | null } | null;
}
export interface ExactInputRegistry {
  schemaVersion: 1;
  kind: "keyspilli-exact-input-registry";
  assets: ExactInputAsset[];
  snapshots: Array<{ id: string; manifestSha256: string; members: Array<{ path: string; sha256: string }> }>;
}
export type ExactAssetStatus = "available" | "unavailable" | "mismatch" | "ambiguous" | "permission-blocked" | "historical-mismatch";
export interface ExactAssetObservation extends ExactInputLocation { sha256: string | null; bytes: number | null; reason: string | null }
export interface ExactInputAudit {
  schemaVersion: 1;
  kind: "keyspilli-exact-input-audit";
  registrySha256: string;
  purpose: EvidencePurpose;
  assets: Array<{ id: string; sha256: string; status: ExactAssetStatus; observed: ExactAssetObservation[]; reasons: string[] }>;
  reproducible: boolean;
  auditSha256: string;
  providerCalls: 0;
  musicalAcceptance: "not-established";
}
const ID = /^[a-z0-9][a-z0-9-]{0,125}$/;
const MAX_ASSETS = 256, MAX_ASSET_BYTES = 256 * 1024 * 1024, MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export function evidenceObject(value: unknown, label: string): Record<string, unknown> {
  assertMusic(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, max: number): value is string {
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose, to strip or reject them in untrusted text
  return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function id(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function safeRelative(value: unknown): value is string {
  return boundedString(value, 1024) && value.length > 0 && !isAbsolute(value) && !value.includes("\\")
    && !value.includes(":") && value.split("/").every(p => p.length > 0 && p !== "." && p !== "..");
}
export function exactObjectPath(sha256: string): string {
  assertMusic(isHash(sha256), "invalid object SHA-256");
  return `sha256/${sha256.slice(0, 2)}/${sha256}`;
}
export function parseExactInputRegistry(input: unknown): ExactInputRegistry {
  const raw = evidenceObject(input, "registry");
  assertMusic(raw.schemaVersion === 1 && raw.kind === "keyspilli-exact-input-registry", "unsupported exact input registry");
  assertMusic(Array.isArray(raw.assets) && raw.assets.length > 0 && raw.assets.length <= MAX_ASSETS && Array.isArray(raw.snapshots) && raw.snapshots.length <= 32, "bounded nonempty asset/snapshot inventory required");
  const assets = (raw.assets as ExactInputAsset[]).map(a => ({ ...a, permission: a?.permission ?? null })), snapshots = raw.snapshots as ExactInputRegistry["snapshots"];
  const ids = new Set<string>();
  for (const a of assets) {
    assertMusic(a && id(a.id) && !ids.has(a.id), "unique asset IDs required; duplicate asset"); ids.add(a.id);
    assertMusic(isHash(a.sha256) && (a.bytes === null || (Number.isSafeInteger(a.bytes) && a.bytes >= 0 && a.bytes <= MAX_ASSET_BYTES)), "invalid asset byte identity");
    assertMusic(["source", "output", "code", "config", "renderer", "receipt", "clock", "metadata"].includes(a.role), "invalid asset role");
    assertMusic(Array.isArray(a.locations) && a.locations.length <= 8 && new Set(a.locations.map(l => `${l.rootId}:${l.path}`)).size === a.locations.length, "bounded unique locations required");
    for (const l of a.locations) assertMusic(l && id(l.rootId) && safeRelative(l.path), "asset location must use a safe relative path");
    assertMusic(Array.isArray(a.snapshots) && a.snapshots.length <= 32, "bounded snapshot memberships required");
    for (const s of a.snapshots) assertMusic(s && id(s.snapshotId) && safeRelative(s.member), "invalid snapshot membership");
    if (a.permission !== null) {
      const p = a.permission;
      assertMusic(p && ["self-authored", "licensed", "user-authorized-local", "unknown"].includes(p.basis)
        && Array.isArray(p.scopes) && p.scopes.length <= 2 && new Set(p.scopes).size === p.scopes.length
        && p.scopes.every(s => ["audit", "review"].includes(s)) && boundedString(p.evidence, 4096), "invalid permission declaration");
    }
    assertMusic(a.transformation === null || (a.transformation && Array.isArray(a.transformation.inputs)
      && a.transformation.inputs.length > 0 && a.transformation.inputs.length <= 64
      && a.transformation.inputs.every(id) && id(a.transformation.code) && id(a.transformation.config)
      && (a.transformation.renderer === null || id(a.transformation.renderer))), "invalid transformation identity");
  }
  const snapshotIds = new Set<string>();
  for (const s of snapshots) {
    assertMusic(s && id(s.id) && !snapshotIds.has(s.id) && isHash(s.manifestSha256), "unique snapshot identity required"); snapshotIds.add(s.id);
    assertMusic(Array.isArray(s.members) && s.members.length <= 1024 && new Set(s.members.map(m => m.path)).size === s.members.length, "bounded unique snapshot members required");
    for (const m of s.members) assertMusic(m && safeRelative(m.path) && isHash(m.sha256), "invalid historical member pin");
  }
  const byId = new Map(assets.map(a => [a.id, a]));
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(a: ExactInputAsset): void {
    if (visited.has(a.id)) return;
    assertMusic(!visiting.has(a.id), "transformation reference cycle"); visiting.add(a.id);
    const t = a.transformation;
    for (const ref of t ? [...t.inputs, t.code, t.config, ...(t.renderer ? [t.renderer] : [])] : []) {
      assertMusic(byId.has(ref), "unresolved transformation reference"); visit(byId.get(ref)!);
    }
    if (t) assertMusic(byId.get(t.code)?.role === "code" && byId.get(t.config)?.role === "config"
      && (!t.renderer || byId.get(t.renderer)?.role === "renderer"), "transformation code/config/renderer asset roles required");
    visiting.delete(a.id); visited.add(a.id);
  }
  assets.forEach(visit);
  return JSON.parse(JSON.stringify({ schemaVersion: 1, kind: raw.kind, assets, snapshots })) as ExactInputRegistry;
}

export function permitsEvidence(asset: ExactInputAsset, purpose: EvidencePurpose): boolean {
  return !!asset.permission && asset.permission.basis !== "unknown" && asset.permission.evidence.trim().length > 0 && asset.permission.scopes.includes(purpose);
}
type ReadResult = { sha256: string; bytes: number; data?: Buffer };
/** Inspect regular files in bounded chunks, retaining bytes only for an explicit parser. */
async function readLocation(location: ExactInputLocation, roots: Record<string, string>, budget: { remaining: number }, maxBytes: number, retain = false): Promise<ReadResult> {
  const root = roots[location.rootId];
  assertMusic(root && isAbsolute(root), "root-unavailable");
  const actualRoot = await realpath(root), path = await realpath(resolve(actualRoot, location.path));
  const rel = relative(actualRoot, path);
  assertMusic(rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "outside-authorized-root");
  // NONBLOCK prevents a FIFO from hanging before the regular-file check.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    assertMusic(before.isFile() && before.size <= maxBytes && before.size <= budget.remaining, "not-regular-or-byte-budget-exceeded");
    budget.remaining -= before.size;
    const h = createHash("sha256"), chunks: Buffer[] = [], chunk = Buffer.alloc(Math.min(65536, before.size + 1));
    let bytes = 0;
    while (true) {
      const r = await file.read(chunk, 0, Math.min(chunk.length, before.size + 1 - bytes), bytes);
      if (!r.bytesRead) break;
      bytes += r.bytesRead; assertMusic(bytes <= before.size, "bytes-changed-during-read");
      h.update(chunk.subarray(0, r.bytesRead)); if (retain) chunks.push(Buffer.from(chunk.subarray(0, r.bytesRead)));
    }
    const after = await file.stat();
    assertMusic(bytes === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "bytes-changed-during-read");
    return { sha256: h.digest("hex"), bytes, ...(retain ? { data: Buffer.concat(chunks) } : {}) };
  } finally { await file.close(); }
}
function safeReadReason(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e.code) return ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(e.code) ? e.code : "local-read-failed";
  return ["root-unavailable", "outside-authorized-root", "not-regular-or-byte-budget-exceeded", "bytes-changed-during-read"].includes(e.message) ? e.message : "local-read-failed";
}
export async function auditExactInputs(input: unknown, roots: Record<string, string>, purpose: EvidencePurpose,
  limits: { maxAssetBytes?: number; maxTotalBytes?: number } = {}): Promise<ExactInputAudit> {
  const registry = parseExactInputRegistry(input);
  assertMusic(["audit", "review"].includes(purpose), "explicit audit or review purpose required");
  assertMusic(Object.keys(roots).length <= 16 && Object.entries(roots).every(([key, path]) => id(key) && isAbsolute(path)), "bounded absolute local roots required");
  const maxBytes = limits.maxAssetBytes ?? MAX_ASSET_BYTES, total = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  assertMusic(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_ASSET_BYTES && Number.isSafeInteger(total) && total > 0 && total <= MAX_TOTAL_BYTES, "invalid byte budget");
  const budget = { remaining: total }, assets: ExactInputAudit["assets"] = [];
  for (const a of [...registry.assets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const row: ExactInputAudit["assets"][number] = { id: a.id, sha256: a.sha256, status: "unavailable", observed: [], reasons: [] };
    assets.push(row);
    if (!permitsEvidence(a, purpose)) { row.status = "permission-blocked"; row.reasons.push(`Explicit ${purpose} permission and evidence required`); continue; }
    if (a.snapshots.some(m => registry.snapshots.find(s => s.id === m.snapshotId)?.members.find(f => f.path === m.member)?.sha256 !== a.sha256)) {
      row.status = "historical-mismatch"; row.reasons.push("Declared snapshot member differs or is absent; current pin unchanged"); continue;
    }
    for (const l of [...a.locations].sort((a, b) => `${a.rootId}/${a.path}`.localeCompare(`${b.rootId}/${b.path}`))) {
      try { const r = await readLocation(l, roots, budget, maxBytes); row.observed.push({ ...l, sha256: r.sha256, bytes: r.bytes, reason: null }); }
      catch (error) { row.observed.push({ ...l, sha256: null, bytes: null, reason: safeReadReason(error) }); }
    }
    const found = row.observed.filter(o => o.sha256 !== null);
    if (row.observed.some(o => ["outside-authorized-root", "EACCES", "EPERM", "ELOOP"].includes(o.reason ?? ""))) row.status = "permission-blocked";
    else if (new Set(found.map(o => o.sha256)).size > 1) row.status = "ambiguous";
    else if (found.length) row.status = found.every(o => o.sha256 === a.sha256 && (a.bytes === null || o.bytes === a.bytes)) ? "available" : "mismatch";
    row.reasons = row.observed.flatMap(o => o.reason ? [o.reason] : []);
    if (!a.locations.length) row.reasons.push("No authorized local locations supplied");
  }
  const result = { schemaVersion: 1 as const, kind: "keyspilli-exact-input-audit" as const, registrySha256: identityHash(registry), purpose,
    assets, reproducible: assets.every(a => a.status === "available"), providerCalls: 0 as const, musicalAcceptance: "not-established" as const };
  return { ...result, auditSha256: identityHash(result) };
}
export function compareExactInputAudit(previous: ExactInputAudit, current: ExactInputAudit): { status: "unchanged" | "invalidated"; changedAssets: string[] } {
  const valid = (r: ExactInputAudit) => { const { auditSha256, ...rest } = r; return auditSha256 === identityHash(rest); };
  const same = valid(previous) && valid(current) && previous.auditSha256 === current.auditSha256 && current.reproducible;
  const ids = new Set([...previous.assets.map(a => a.id), ...current.assets.map(a => a.id)]);
  return { status: same ? "unchanged" : "invalidated", changedAssets: [...ids].filter(id => identityHash(previous.assets.find(a => a.id === id) ?? null) !== identityHash(current.assets.find(a => a.id === id) ?? null)).sort() };
}
/** Re-read parsed evidence instead of trusting an old availability report. */
export async function readExactAsset(registry: ExactInputRegistry, roots: Record<string, string>, assetId: string, purpose: EvidencePurpose, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
  const a = registry.assets.find(a => a.id === assetId);
  assertMusic(a && permitsEvidence(a, purpose), "asset permission unavailable");
  const single = await auditExactInputs({ ...registry, assets: [{ ...a, transformation: null }] }, roots, purpose);
  const row = single.assets.find(a => a.id === assetId);
  assertMusic(row?.status === "available", `asset ${assetId} is not exact/available`);
  const location = row.observed.find(o => o.sha256 === a.sha256)!;
  const result = await readLocation(location, roots, { remaining: maxBytes }, maxBytes, true);
  assertMusic(result.sha256 === a.sha256 && (a.bytes === null || result.bytes === a.bytes), "asset bytes changed after audit");
  return result.data!;
}

export interface GoldenEvidenceEntry {
  baseId: string; sourceId: string; notesAssetId: string; timelineAssetId: string;
  advancedNotesSha256: string; timelineSha256: string;
  acceptedBackingSha256: string | null; acceptedPlaybackSha256: string | null; acceptedEndBeatExclusive: number | null;
  historical: { status: "unavailable" | "match" | "mismatch"; sha256: string | null; assetId: string | null };
}
export function goldenInputRegistry(corpusValue: unknown, sourceValue: unknown, options: { permission: unknown; historical?: unknown }): { registry: ExactInputRegistry; entries: GoldenEvidenceEntry[] } {
  const corpus = evidenceObject(corpusValue, "golden corpus"), sourceMap = evidenceObject(sourceValue, "source map");
  assertMusic(corpus.schemaVersion === 1 && Array.isArray(corpus.entries) && corpus.entries.length <= 64 && Array.isArray(sourceMap.entries), "invalid golden/source metadata");
  const registry: ExactInputRegistry = { schemaVersion: 1, kind: "keyspilli-exact-input-registry", assets: [], snapshots: [] }, entries: GoldenEvidenceEntry[] = [];
  type HistoricalManifest = { archiveSha256: string; files: Array<{ name: string; bytes: number; sha256: string }> };
  let historical: HistoricalManifest | null = null;
  if (options.historical !== undefined) {
    const h = evidenceObject(options.historical, "historical manifest");
    assertMusic(isHash(h.archiveSha256) && Array.isArray(h.files) && h.files.length <= 1024, "invalid archive manifest");
    historical = h as unknown as HistoricalManifest;
    assertMusic(new Set(historical.files.map(f => f.name)).size === historical.files.length && historical.files.every(f => safeRelative(f.name) && isHash(f.sha256) && Number.isSafeInteger(f.bytes) && f.bytes >= 0), "invalid/ambiguous historical members");
    registry.snapshots.push({ id: `archive-${historical.archiveSha256.slice(0, 16)}`, manifestSha256: identityHash(h), members: historical.files.map(f => ({ path: f.name, sha256: f.sha256 })) });
  }
  const add = (id: string, sha256: string, path: string, rootId: string, bytes: number | null = null): ExactInputAsset => {
    const asset: ExactInputAsset = { id, sha256, bytes, role: "source", permission: options.permission as ExactInputPermission | null,
      locations: [{ rootId, path }], snapshots: [], transformation: null }; registry.assets.push(asset); return asset;
  };
  for (const value of corpus.entries) {
    const e = evidenceObject(value, "golden entry");
    assertMusic(id(e.baseId) && e.baseId.length <= 110 && e.level === "a" && id(e.sourceId) && isHash(e.advancedNotesSha256) && isHash(e.timelineSha256), "invalid golden identity");
    for (const key of ["acceptedBackingSha256", "acceptedPlaybackSha256"]) assertMusic(e[key] === undefined || isHash(e[key]), "invalid existing golden pin");
    assertMusic(e.acceptedEndBeatExclusive === undefined || (typeof e.acceptedEndBeatExclusive === "number" && Number.isFinite(e.acceptedEndBeatExclusive) && e.acceptedEndBeatExclusive > 0), "invalid accepted excerpt extent");
    const maps = (sourceMap.entries as Array<{ baseId: string; sources: Array<{ id: string; artifactPath?: string }> }>).filter(s => s.baseId === e.baseId);
    assertMusic(maps.length === 1 && Array.isArray(maps[0]!.sources), "ambiguous or unavailable source map entry");
    const sources = maps[0]!.sources.filter(s => s.id === e.sourceId);
    assertMusic(sources.length === 1 && safeRelative(sources[0]!.artifactPath), "ambiguous or unavailable source map path");
    const path = `data/artifacts/${e.baseId}/a/notes.json`, notesAssetId = `${e.baseId}-notes`, timelineAssetId = `${e.baseId}-timeline`;
    add(notesAssetId, e.advancedNotesSha256, path, "current"); add(timelineAssetId, e.timelineSha256, sources[0]!.artifactPath!, "current");
    const member = historical?.files.find(f => f.name === path), historicalId = member ? `${e.baseId}-historical` : null;
    if (member && historicalId) add(historicalId, member.sha256, path, "archive", member.bytes).snapshots = [{ snapshotId: registry.snapshots[0]!.id, member: path }];
    entries.push({ baseId: e.baseId, sourceId: e.sourceId, notesAssetId, timelineAssetId, advancedNotesSha256: e.advancedNotesSha256, timelineSha256: e.timelineSha256,
      acceptedBackingSha256: e.acceptedBackingSha256 as string | undefined ?? null, acceptedPlaybackSha256: e.acceptedPlaybackSha256 as string | undefined ?? null,
      acceptedEndBeatExclusive: e.acceptedEndBeatExclusive as number | undefined ?? null,
      historical: { status: !member ? "unavailable" : member.sha256 === e.advancedNotesSha256 ? "match" : "mismatch", sha256: member?.sha256 ?? null, assetId: historicalId } });
  }
  return { registry: parseExactInputRegistry(registry), entries };
}
