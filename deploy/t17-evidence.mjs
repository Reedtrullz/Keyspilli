import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

export const EVIDENCE_CAP = 64 * 1024 * 1024;
export const TRACE_CAP = 48 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash rendered PDF bytes after removing only volatile Skia document metadata. */
export function canonicalPdfSha256(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  if (!/^%PDF-\d\.\d(?:\r?\n|$)/.test(text) || !/%%EOF\b/.test(text)) throw new Error("malformed PDF");
  // shortcut: Skia renders content in compressed streams; use an object parser if uncompressed content may contain these keys.
  const canonical = text
    .replace(/\/CreationDate\s*\([^)]*\)/g, "/CreationDate ()")
    .replace(/\/ModDate\s*\([^)]*\)/g, "/ModDate ()")
    .replace(/\/ID\s*\[[^\]]*\]/g, "/ID []")
    .replace(/(<xmp:(?:CreateDate|ModifyDate|MetadataDate)\b[^>]*>)[\s\S]*?(<\/xmp:(?:CreateDate|ModifyDate|MetadataDate)>)/g, "$1$2")
    .replace(/(<xmpMM:(?:DocumentID|InstanceID)\b[^>]*>)[\s\S]*?(<\/xmpMM:(?:DocumentID|InstanceID)>)/g, "$1$2");
  return sha256(Buffer.from(canonical, "latin1"));
}

/** Copy only the metric, receipt and one optional trace into a bounded raw package. */
export function copyBoundedEvidence({ scratch, keep, attachment, trace, cap = EVIDENCE_CAP, traceCap = TRACE_CAP }) {
  mkdirSync(keep, { recursive: true });
  const entries = [];
  const copy = (path, { optional = false, preservePath = false } = {}) => {
    if (!path || !existsSync(path)) return;
    const size = statSync(path).size;
    const name = preservePath ? relative(scratch, path) : basename(path);
    if (!name || isAbsolute(name) || name.startsWith("..")) throw new Error(`evidence path escapes scratch: ${path}`);
    if (size > cap) {
      if (!optional) throw new Error(`required evidence exceeds ${cap} bytes: ${name}`);
      entries.push({ name, bytes: size, omitted: `evidence cap ${cap}` });
      return;
    }
    const bytes = readFileSync(path);
    const target = join(keep, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
    entries.push({ name, bytes: size, sha256: sha256(bytes) });
  };
  copy(join(scratch, "receipt.json"));
  copy(join(scratch, "failure.json"), { optional: true });
  copy(attachment, { preservePath: true });
  if (trace && existsSync(trace)) {
    const size = statSync(trace).size;
    const name = relative(scratch, trace);
    if (!name || isAbsolute(name) || name.startsWith("..")) throw new Error(`evidence path escapes scratch: ${trace}`);
    if (size > traceCap) {
      entries.push({ name, bytes: size, sha256: sha256(readFileSync(trace)), omitted: `trace cap ${traceCap}` });
    } else {
      const bytes = readFileSync(trace);
      const target = join(keep, name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(trace, target);
      entries.push({ name, bytes: size, sha256: sha256(bytes) });
    }
  }
  if (!entries.some(entry => !entry.omitted && (entry.name === "receipt.json" || entry.name === "failure.json"))) throw new Error("no receipt or failure evidence");
  const total = entries.filter(entry => !entry.omitted).reduce((sum, entry) => sum + entry.bytes, 0);
  const manifest = { schema: "keyspilli-task17-evidence-package/v1", cap, traceCap, entries };
  const manifestBytes = Buffer.byteLength(JSON.stringify({ ...manifest, totalBytes: total }, null, 2) + "\n");
  if (total + manifestBytes > cap) throw new Error(`evidence package exceeds ${cap} bytes`);
  manifest.totalBytes = total + manifestBytes;
  writeFileSync(join(keep, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
