import { createHash } from "node:crypto";

export const UPSTREAM_ATTRIBUTION_MANIFEST_SCHEMA_VERSION = 1 as const;
const SHA256 = /^[0-9a-f]{64}$/i;
const ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const MODALITIES = ["di", "amp", "midi"] as const;
const MODALITY = new Set<string>(MODALITIES);

export type UpstreamModalityKind = typeof MODALITIES[number];
export type UpstreamModalityStatus = "available" | "unavailable";

export interface UpstreamAttributionModality {
  kind: UpstreamModalityKind;
  status: UpstreamModalityStatus;
  sha256?: string;
  sourceUrl?: string;
  reason?: string;
}

export interface UpstreamAttributionItem {
  id: string;
  performance: string[];
  modalities: UpstreamAttributionModality[];
}

export interface UpstreamAttributionManifest {
  schemaVersion: 1;
  dataset: {
    name: "Guitar-TECHS";
    version: string;
    license: { spdx: "CC-BY-4.0"; url: string };
  };
  items: UpstreamAttributionItem[];
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/.test(value)) throw new Error(`${name} must be a non-empty safe string`);
  const result = value.trim();
  if (pattern && !pattern.test(result)) throw new Error(`${name} has an invalid format`);
  return result;
}

function normalizeModality(value: unknown, name: string): UpstreamAttributionModality {
  const row = object(value, name);
  const kind = text(row.kind, `${name}.kind`);
  if (!MODALITY.has(kind)) throw new Error(`${name}.kind is unsupported`);
  const status = row.status;
  if (status !== "available" && status !== "unavailable") throw new Error(`${name}.status is invalid`);
  const result: UpstreamAttributionModality = { kind: kind as UpstreamModalityKind, status };
  if (row.sourceUrl !== undefined) {
    const sourceUrl = text(row.sourceUrl, `${name}.sourceUrl`);
    if (!/^https?:\/\/[^\s]+$/i.test(sourceUrl)) throw new Error(`${name}.sourceUrl must be an https URL`);
    result.sourceUrl = sourceUrl;
  }
  if (status === "available") {
    const sha256 = text(row.sha256, `${name}.sha256`).toLowerCase();
    if (!SHA256.test(sha256)) throw new Error(`${name}.sha256 must be a sha256 hash`);
    result.sha256 = sha256;
  } else {
    result.reason = text(row.reason, `${name}.reason`);
  }
  return result;
}

export function normalizeUpstreamAttributionManifest(value: unknown): UpstreamAttributionManifest {
  const row = object(value, "manifest");
  if (row.schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1");
  const dataset = object(row.dataset, "manifest.dataset");
  if (dataset.name !== "Guitar-TECHS") throw new Error("manifest.dataset.name must be Guitar-TECHS");
  const license = object(dataset.license, "manifest.dataset.license");
  if (license.spdx !== "CC-BY-4.0") throw new Error("manifest.dataset.license.spdx must be CC-BY-4.0");
  const items = row.items;
  if (!Array.isArray(items) || items.length === 0) throw new Error("manifest.items must be non-empty");
  const seen = new Set<string>();
  const normalized = items.map((value, index) => {
    const item = object(value, `manifest.items[${index}]`);
    const id = text(item.id, `manifest.items[${index}].id`, ID);
    if (seen.has(id)) throw new Error(`duplicate item id: ${id}`);
    seen.add(id);
    if (!Array.isArray(item.performance) || item.performance.length === 0) throw new Error(`${id}.performance is required`);
    const performance = item.performance.map((label, labelIndex) => text(label, `${id}.performance[${labelIndex}]`));
    const modalities = item.modalities;
    if (!Array.isArray(modalities) || modalities.length === 0) throw new Error(`${id}.modalities is required`);
    const kinds = new Set<string>();
    const normalizedModalities = modalities.map((modality, modalityIndex) => {
      const result = normalizeModality(modality, `${id}.modalities[${modalityIndex}]`);
      if (kinds.has(result.kind)) throw new Error(`${id} has duplicate modality: ${result.kind}`);
      kinds.add(result.kind);
      return result;
    }).sort((a, b) => a.kind.localeCompare(b.kind));
    return { id, performance: [...new Set(performance)].sort(), modalities: normalizedModalities };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    dataset: {
      name: "Guitar-TECHS",
      version: text(dataset.version, "manifest.dataset.version"),
      license: { spdx: "CC-BY-4.0", url: text(license.url, "manifest.dataset.license.url") },
    },
    items: normalized,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalUpstreamManifest(value: UpstreamAttributionManifest): string {
  return `${stable(normalizeUpstreamAttributionManifest(value))}\n`;
}

export function upstreamManifestSha256(value: UpstreamAttributionManifest): string {
  return createHash("sha256").update(canonicalUpstreamManifest(value)).digest("hex");
}
