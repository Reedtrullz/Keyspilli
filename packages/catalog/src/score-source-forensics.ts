import { readFile, realpath, stat as fsStat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { sha256Hex } from "./fixture-evidence.js";

export const SCORE_SOURCE_FORENSICS_SCHEMA_VERSION = 1 as const;

export type ScoreSourceForensicsStatus = "ok" | "error";
export type ScoreSourceForensicsConfidence = "high" | "medium" | "low";

export interface ScoreSourceForensicsError {
  code:
    | "missing-file"
    | "not-regular-file"
    | "repository-path"
    | "unsafe-path"
    | "oversized-input"
    | "malformed-pdf"
    | "read-failed";
  message: string;
}

export interface ScoreSourceForensicsIdentity {
  bytes: number;
  pages: number | null;
  sha256: string;
  logicalBasename?: string;
}

export interface ScoreSourceForensicsMetadata {
  title: string | null;
  author: string | null;
  composerHints: string[];
  subject: string | null;
  keywords: string[];
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  sourceApplication: string | null;
  sourceIds: string[];
  downloadIdentifiers: string[];
  unknown: Array<{ field: string; value: string }>;
}

export interface ScoreSourceForensicsXmp {
  present: boolean;
  title: string | null;
  creator: string | null;
  creatorTool: string | null;
  createDate: string | null;
  modifyDate: string | null;
  documentId: string | null;
  instanceId: string | null;
}

export interface ScoreSourceForensicsLink {
  kind: "annotation" | "embedded";
  url: string;
}

export interface ScoreSourceForensicsEvidence {
  field: string;
  source: "pdf-info" | "xmp" | "pdf-annotation" | "pdf-structure";
  confidence: ScoreSourceForensicsConfidence;
}

export interface ScoreSourceForensicsReport {
  schemaVersion: typeof SCORE_SOURCE_FORENSICS_SCHEMA_VERSION;
  status: ScoreSourceForensicsStatus;
  identity: ScoreSourceForensicsIdentity | null;
  metadata: ScoreSourceForensicsMetadata;
  xmp: ScoreSourceForensicsXmp;
  links: ScoreSourceForensicsLink[];
  evidence: ScoreSourceForensicsEvidence[];
  errors: ScoreSourceForensicsError[];
}

export interface ScoreSourceForensicsStat {
  size: number;
  isFile(): boolean;
}

export interface ScoreSourceForensicsDependencies {
  /** Read bytes without interpreting or copying the source. */
  readBytes?: (path: string) => Promise<Uint8Array>;
  /** Optional metadata seam for callers that have an authoritative extractor. */
  extractMetadata?: (bytes: Uint8Array) => Partial<ScoreSourceForensicsMetadata> | null;
  /** Optional stat seam; useful for deterministic tests and adapters. */
  stat?: (path: string) => Promise<ScoreSourceForensicsStat>;
  /** Optional realpath seam; the default resolves symlinks before the safety check. */
  realpath?: (path: string) => Promise<string>;
}

export interface ScoreSourceForensicsOptions {
  dependencies?: ScoreSourceForensicsDependencies;
  /** Root whose resolved descendants must never be inspected. */
  repositoryRoot?: string;
  maxBytes?: number;
  includeLogicalBasename?: boolean;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const EMPTY_METADATA: ScoreSourceForensicsMetadata = {
  title: null,
  author: null,
  composerHints: [],
  subject: null,
  keywords: [],
  creator: null,
  producer: null,
  creationDate: null,
  modificationDate: null,
  sourceApplication: null,
  sourceIds: [],
  downloadIdentifiers: [],
  unknown: [],
};
const EMPTY_XMP: ScoreSourceForensicsXmp = {
  present: false,
  title: null,
  creator: null,
  creatorTool: null,
  createDate: null,
  modifyDate: null,
  documentId: null,
  instanceId: null,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cleanText(value: unknown, limit = 240): string | null {
  if (typeof value !== "string") return null;
  const result = value
    .replace(/\\([\\()])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
  if (!result || /(?:^|[\s"'(])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/]|\/|\\)/i.test(result)) return null;
  return result;
}

function cleanIdentifier(value: unknown): string | null {
  const result = cleanText(value, 200);
  if (!result || /(?:password|token|secret|cookie|authorization|bearer)/i.test(result)) return null;
  // Unknown fields can contain source URLs. Keep only a URL's safe origin/path;
  // never serialize userinfo or query/fragment material that may carry secrets.
  if (/[A-Za-z][A-Za-z\d+.-]*:\/\/[^\s"'<>]*@/i.test(result)) return null;
  let invalidUrl = false;
  const redacted = result.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[)\],.;!?]+$/)?.[0] ?? "";
    const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
    const safe = safeUrl(core);
    if (!safe) {
      invalidUrl = true;
      return "";
    }
    return `${safe}${trailing}`;
  });
  return invalidUrl ? null : redacted;
}

function cleanDate(value: unknown): string | null {
  const text = cleanText(value, 80);
  if (!text) return null;
  const pdf = text.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?$/);
  if (pdf) {
    const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00", zone] = pdf;
    const offset = zone && zone !== "Z" ? `${zone.slice(0, 3)}:${zone.slice(-2)}` : "Z";
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().replace(".000Z", "Z");
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().replace(".000Z", "Z");
}

function sortedUnique(values: Iterable<unknown>, cleaner = cleanText): string[] {
  return [...new Set([...values].map((value) => cleaner(value)).filter((value): value is string => Boolean(value)))].sort(compareText);
}

function literalAt(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== "(") return null;
  let depth = 0;
  let escaped = false;
  let value = "";
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (escaped) {
      value += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "(") {
      depth += 1;
      if (depth > 1) value += character;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { value, end: index + 1 };
      value += character;
      continue;
    }
    value += character;
  }
  return null;
}

function infoFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const keys = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];
  for (const key of keys) {
    const match = new RegExp(`/${key}\\s*\\(`).exec(text);
    if (!match || match.index === undefined) continue;
    const literal = literalAt(text, match.index + match[0].length - 1);
    if (literal) fields.set(key, literal.value);
  }
  return fields;
}

function allLiteralFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = /\/([A-Za-z][A-Za-z0-9]*)\s*\(/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const literal = literalAt(text, match.index + match[0].length - 1);
    if (literal && match[1]) fields.set(match[1], literal.value);
  }
  return fields;
}

function tagValue(text: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = text.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  if (direct?.[1]) {
    const nested = direct[1].match(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/i);
    return cleanText((nested?.[1] ?? direct[1]).replace(/<[^>]+>/g, " "));
  }
  return null;
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    // Queries/fragments commonly carry access tokens. Credentials are removed
    // even when a caller supplies an unusual but parseable URL.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parsePdf(bytes: Uint8Array): {
  metadata: ScoreSourceForensicsMetadata;
  xmp: ScoreSourceForensicsXmp;
  links: ScoreSourceForensicsLink[];
  pages: number | null;
  evidence: ScoreSourceForensicsEvidence[];
} | null {
  const text = Buffer.from(bytes).toString("latin1");
  if (!/^%PDF-\d\.\d(?:\r?\n|$)/.test(text) || !/%%EOF\b/.test(text)) return null;
  const fields = infoFields(text);
  const allFields = allLiteralFields(text);
  const title = cleanText(fields.get("Title"));
  const author = cleanText(fields.get("Author"));
  const subject = cleanText(fields.get("Subject"));
  const keywords = sortedUnique((fields.get("Keywords") ?? "").split(/[,;]+/));
  const creator = cleanText(fields.get("Creator"));
  const producer = cleanText(fields.get("Producer"));
  const creationDate = cleanDate(fields.get("CreationDate"));
  const modificationDate = cleanDate(fields.get("ModDate"));
  const xmpSource = Buffer.from(bytes).toString("utf8");
  const xmpText = xmpSource.match(/<\?xpacket[\s\S]*?<\/x:xmpmeta>|<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i)?.[0] ?? "";
  const xmp: ScoreSourceForensicsXmp = {
    present: xmpText.length > 0 || /\/Type\s*\/Metadata\b/i.test(text),
    title: tagValue(xmpText, "dc:title"),
    creator: tagValue(xmpText, "dc:creator"),
    creatorTool: tagValue(xmpText, "xmp:CreatorTool"),
    createDate: cleanDate(tagValue(xmpText, "xmp:CreateDate")),
    modifyDate: cleanDate(tagValue(xmpText, "xmp:ModifyDate")),
    documentId: cleanIdentifier(tagValue(xmpText, "xmpMM:DocumentID")),
    instanceId: cleanIdentifier(tagValue(xmpText, "xmpMM:InstanceID")),
  };
  const sourceIds = sortedUnique([
    tagValue(xmpText, "xmpMM:DocumentID"),
    tagValue(xmpText, "xmpMM:InstanceID"),
    ...[...allFields.entries()]
      .filter(([key]) => /(?:source|document|instance).*(?:id|identifier)|^(?:id|identifier)$/i.test(key))
      .map(([, value]) => value),
  ], cleanIdentifier);
  const downloadIdentifiers = sortedUnique([...allFields.entries()]
    .filter(([key]) => /download.*(?:id|identifier)|(?:id|identifier).*download/i.test(key))
    .map(([, value]) => value), cleanIdentifier);
  const sourceApplication = cleanText(xmp.creatorTool ?? creator ?? producer);
  const composerHints = sortedUnique([author, xmp.creator, subject, ...keywords]);
  const unknown: Array<{ field: string; value: string }> = [];
  for (const [key, value] of allFields) {
    if (!keysKnown.has(key)) {
      const safe = cleanIdentifier(value);
      if (safe) unknown.push({ field: `info.${key.toLowerCase()}`, value: safe });
    }
  }
  const urls = new Map<string, ScoreSourceForensicsLink>();
  const uriPattern = /\/URI\s*(?:\(([^)]*)\)|<([0-9A-Fa-f]+)>)/g;
  for (const match of text.matchAll(uriPattern)) {
    const raw = match[1] ?? (match[2] ? Buffer.from(match[2], "hex").toString("utf8") : "");
    const url = safeUrl(raw);
    if (url) urls.set(url, { kind: "annotation", url });
  }
  const pages = text.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
  const evidence: ScoreSourceForensicsEvidence[] = [];
  if (title) evidence.push({ field: "metadata.title", source: "pdf-info", confidence: "high" });
  if (author) evidence.push({ field: "metadata.author", source: "pdf-info", confidence: "high" });
  if (subject) evidence.push({ field: "metadata.subject", source: "pdf-info", confidence: "medium" });
  if (creator || producer) evidence.push({ field: "metadata.application", source: "pdf-info", confidence: "medium" });
  if (creationDate || modificationDate) evidence.push({ field: "metadata.dates", source: "pdf-info", confidence: "medium" });
  if (xmp.present) evidence.push({ field: "xmp", source: "xmp", confidence: "medium" });
  if (xmp.creatorTool) evidence.push({ field: "xmp.creatorTool", source: "xmp", confidence: "medium" });
  if (sourceIds.length) evidence.push({ field: "xmp.sourceIds", source: "xmp", confidence: "medium" });
  if (urls.size) evidence.push({ field: "links", source: "pdf-annotation", confidence: "medium" });
  if (pages) evidence.push({ field: "pages", source: "pdf-structure", confidence: "high" });
  return {
    metadata: {
      ...EMPTY_METADATA,
      title,
      author,
      composerHints,
      subject,
      keywords,
      creator,
      producer,
      creationDate,
      modificationDate,
      sourceApplication,
      sourceIds,
      downloadIdentifiers,
      unknown,
    },
    xmp,
    links: [...urls.values()].sort((a, b) => compareText(a.url, b.url)),
    pages: pages || null,
    evidence,
  };
}

const keysKnown = new Set(["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]);

function mergeMetadata(base: ScoreSourceForensicsMetadata, extracted: Partial<ScoreSourceForensicsMetadata> | null | undefined): ScoreSourceForensicsMetadata {
  if (!extracted) return base;
  const pickText = (key: keyof ScoreSourceForensicsMetadata): string | null => {
    if (!(key in extracted)) return base[key] as string | null;
    return cleanText(extracted[key]);
  };
  return {
    ...base,
    title: pickText("title"),
    author: pickText("author"),
    subject: pickText("subject"),
    creator: pickText("creator"),
    producer: pickText("producer"),
    creationDate: cleanDate(extracted.creationDate ?? base.creationDate),
    modificationDate: cleanDate(extracted.modificationDate ?? base.modificationDate),
    sourceApplication: pickText("sourceApplication"),
    composerHints: sortedUnique(extracted.composerHints ?? base.composerHints),
    keywords: sortedUnique(extracted.keywords ?? base.keywords),
    sourceIds: sortedUnique(extracted.sourceIds ?? base.sourceIds, cleanIdentifier),
    downloadIdentifiers: sortedUnique(extracted.downloadIdentifiers ?? base.downloadIdentifiers, cleanIdentifier),
    unknown: (extracted.unknown ?? base.unknown).filter((item) => cleanIdentifier(item?.field) && cleanIdentifier(item?.value))
      .map((item) => ({ field: cleanIdentifier(item.field)!, value: cleanIdentifier(item.value)! }))
      .sort((a, b) => compareText(a.field, b.field) || compareText(a.value, b.value)),
  };
}

function pathWithin(path: string, root: string): boolean {
  const child = resolve(path);
  const parent = resolve(root).replace(/[\\/]$/, "");
  return child === parent || child.startsWith(`${parent}/`);
}

function error(code: ScoreSourceForensicsError["code"], message: string): ScoreSourceForensicsError {
  return { code, message };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function scoreSourceForensicsJson(report: ScoreSourceForensicsReport): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

function emptyReport(errors: ScoreSourceForensicsError[]): ScoreSourceForensicsReport {
  return {
    schemaVersion: SCORE_SOURCE_FORENSICS_SCHEMA_VERSION,
    status: "error",
    identity: null,
    metadata: { ...EMPTY_METADATA, composerHints: [], keywords: [], sourceIds: [], downloadIdentifiers: [], unknown: [] },
    xmp: { ...EMPTY_XMP },
    links: [],
    evidence: [],
    errors,
  };
}

/** Inspect one caller-supplied local PDF without copying or network access. */
export async function inspectScoreSourceForensics(
  pdfPath: string,
  options: ScoreSourceForensicsOptions = {},
): Promise<ScoreSourceForensicsReport> {
  const dependencies = options.dependencies ?? {};
  if (typeof pdfPath !== "string" || !pdfPath || !isAbsolute(pdfPath) || /[\u0000\r\n]/.test(pdfPath)) {
    return emptyReport([error("unsafe-path", "PDF path must be an absolute path without NUL or newline characters")]);
  }
  const maximum = Number.isFinite(options.maxBytes) && options.maxBytes! > 0 ? options.maxBytes! : DEFAULT_MAX_BYTES;
  let physicalPath = pdfPath;
  let bytes: Uint8Array;
  if (dependencies.readBytes) {
    // Synthetic readers may not have a real file to resolve, but when an
    // adapter supplies a realpath seam it must be authoritative for the
    // repository safety boundary.
    if (dependencies.realpath) {
      try {
        physicalPath = await dependencies.realpath(pdfPath);
      } catch {
        return emptyReport([error("missing-file", "PDF file does not exist")]);
      }
    }
    if (pathWithin(physicalPath, options.repositoryRoot ?? process.cwd())) {
      return emptyReport([error("repository-path", "PDF realpath is inside the repository")]);
    }
    try {
      if (dependencies.stat) {
        const details = await dependencies.stat(pdfPath);
        if (!details.isFile()) return emptyReport([error("not-regular-file", "PDF is not a regular file")]);
        if (details.size > maximum) return emptyReport([error("oversized-input", "PDF exceeds the local size limit")]);
      }
      bytes = await dependencies.readBytes(pdfPath);
    } catch {
      return emptyReport([error("read-failed", "PDF could not be read")]);
    }
  } else {
    try {
      physicalPath = await (dependencies.realpath ?? realpath)(pdfPath);
    } catch {
      return emptyReport([error("missing-file", "PDF file does not exist")]);
    }
    if (pathWithin(physicalPath, options.repositoryRoot ?? process.cwd())) {
      return emptyReport([error("repository-path", "PDF realpath is inside the repository")]);
    }
    let details: ScoreSourceForensicsStat;
    try {
      details = await (dependencies.stat ?? fsStat)(physicalPath) as ScoreSourceForensicsStat;
    } catch {
      return emptyReport([error("missing-file", "PDF file does not exist")]);
    }
    if (!details.isFile()) return emptyReport([error("not-regular-file", "PDF is not a regular file")]);
    if (details.size > maximum) return emptyReport([error("oversized-input", "PDF exceeds the local size limit")]);
    try {
      bytes = await (dependencies.readBytes ?? readFile)(physicalPath);
    } catch {
      return emptyReport([error("read-failed", "PDF could not be read")]);
    }
  }
  if (bytes.byteLength > maximum) return emptyReport([error("oversized-input", "PDF exceeds the local size limit")]);
  const parsed = parsePdf(bytes);
  if (!parsed) return emptyReport([error("malformed-pdf", "Input is not a well-formed PDF")]);
  let extractedMetadata: Partial<ScoreSourceForensicsMetadata> | null = null;
  try {
    extractedMetadata = dependencies.extractMetadata?.(bytes) ?? null;
  } catch {
    extractedMetadata = null;
  }
  const metadata = mergeMetadata(parsed.metadata, extractedMetadata);
  return {
    schemaVersion: SCORE_SOURCE_FORENSICS_SCHEMA_VERSION,
    status: "ok",
    identity: {
      bytes: bytes.byteLength,
      pages: parsed.pages,
      sha256: sha256Hex(bytes),
      ...(options.includeLogicalBasename ? { logicalBasename: basename(physicalPath) } : {}),
    },
    metadata,
    xmp: parsed.xmp,
    links: parsed.links,
    evidence: parsed.evidence,
    errors: [],
  };
}

/** Short alias for callers that prefer noun-first naming. */
export const scoreSourceForensics = inspectScoreSourceForensics;

export type ScoreSourceForensicsResult = ScoreSourceForensicsReport;
