import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "@keyspilli/catalog";

export type AccessStatus = "pending" | "approved" | "declined";

export interface AccessRecord {
  /** Numeric GitHub account id; stable across renames. */
  id: string;
  login: string;
  name: string;
  message: string;
  status: AccessStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export class AccessError extends Error {}

export const MAX_MESSAGE_LENGTH = 280;
// shortcut: one JSON file read and written synchronously by a single Node process; move to SQLite beyond a few hundred accounts.
const MAX_RECORDS = 500;

function storePath(): string {
  return join(dataDir(), "access", "requests.json");
}

let cache: { path: string; stamp: string; records: AccessRecord[] } | undefined;

function isRecord(value: unknown): value is AccessRecord {
  const r = value as Partial<AccessRecord> | null;
  return (
    typeof r === "object" && r !== null &&
    typeof r.id === "string" && /^\d{1,20}$/.test(r.id) &&
    typeof r.login === "string" && typeof r.name === "string" && typeof r.message === "string" &&
    (r.status === "pending" || r.status === "approved" || r.status === "declined") &&
    typeof r.requestedAt === "string"
  );
}

/** Throws when the file exists but is unreadable, so a corrupt store is never overwritten. */
function load(): AccessRecord[] {
  const path = storePath();
  let stamp: string;
  try {
    const stat = statSync(path);
    stamp = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return [];
  }
  if (cache && cache.path === path && cache.stamp === stamp) return cache.records;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new AccessError("access store is malformed");
  cache = { path, stamp, records: parsed };
  return parsed;
}

function save(records: AccessRecord[]): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
  cache = undefined;
}

export function getAccessRecord(id: string): AccessRecord | undefined {
  return load().find((record) => record.id === id);
}

/** Newest request first. */
export function listAccessRecords(): AccessRecord[] {
  return [...load()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function requestAccess(input: { id: string; login?: string | null; name?: string | null; message?: string | null }): AccessRecord {
  if (!/^\d{1,20}$/.test(input.id)) throw new AccessError("invalid GitHub id");
  const records = load();
  const existing = records.find((record) => record.id === input.id);
  if (existing) return existing;
  if (records.length >= MAX_RECORDS) throw new AccessError("access requests are closed");
  const login = /^[A-Za-z0-9-]{1,39}$/.test(input.login ?? "") ? (input.login as string) : "unknown";
  const record: AccessRecord = {
    id: input.id,
    login,
    name: (input.name ?? "").trim().slice(0, 100),
    message: (input.message ?? "").trim().slice(0, MAX_MESSAGE_LENGTH),
    status: "pending",
    requestedAt: new Date().toISOString(),
  };
  save([...records, record]);
  return record;
}

export function decideAccess(id: string, status: "approved" | "declined", decidedBy: string): AccessRecord {
  const records = load();
  const record = records.find((entry) => entry.id === id);
  if (!record) throw new AccessError("no such request");
  const updated: AccessRecord = { ...record, status, decidedAt: new Date().toISOString(), decidedBy };
  save(records.map((entry) => (entry.id === id ? updated : entry)));
  return updated;
}
