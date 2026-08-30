/**
 * Deterministic, local-only MusicXML adapter for the OMR consensus layer.
 *
 * This intentionally does not use the MIDI parser.  The MIDI parser is a
 * useful playback representation, but it discards the score structure which
 * is important when comparing OMR engines: parts, measure numbers, pages,
 * systems, voices, ties, and tuplets.  The small XML reader below is enough
 * for the score-partwise subset emitted by Audiveris and common notation
 * programs.  It is namespace-tolerant and does not resolve external entities
 * or fetch anything.
 */

import { unzipSync } from "fflate";
import type {
  OmrEventInput,
  OmrPartInput,
  OmrRole,
  OmrScoreInput,
  OmrTieInput,
} from "./omr-consensus.js";

export const OMR_MUSICXML_ADAPTER_VERSION = "omr-musicxml-v1" as const;

export class OmrMusicXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmrMusicXmlError";
  }
}

export interface OmrMusicXmlParseOptions {
  /** Explicit part role overrides keyed by MusicXML part id. */
  partRoles?: Readonly<Record<string, OmrRole | null | undefined>>;
  /** Explicit staff role overrides keyed as `${partId}:${staffNumber}`. */
  staffRoles?: Readonly<Record<string, OmrRole | null | undefined>>;
  /** Role used when no name/override provides a useful classification. */
  defaultRole?: OmrRole | null;
}

export interface OmrMusicXmlParseResult {
  score: OmrScoreInput;
  format: "musicxml" | "mxl";
  rootFile: string | null;
  warnings: string[];
}

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

interface RawMeasure {
  id: string;
  number: string;
  page: number | null;
  system: number | null;
  durationBeats: number;
  timeSignature: [number, number] | null;
  keySignature: number | null;
  implicit: boolean;
  events: OmrEventInput[];
  rests: Array<{ onset: number; duration: number }>;
  staves: number[];
  voices: string[];
  tieIn: boolean;
  tieOut: boolean;
  tupletCount: number;
}

interface RawPart {
  id: string;
  name: string | null;
  role: OmrRole | null;
  measures: RawMeasure[];
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROLE_NAMES: Record<OmrRole, readonly string[]> = {
  melody: ["lead", "melody", "vocal", "voice", "solo", "soprano", "alto", "tenor"],
  harmony: ["harmony", "harmonic", "chord", "accompaniment", "piano", "guitar", "bass", "strings"],
  rhythm: ["rhythm", "drum", "percussion", "beat", "groove"],
};
const EPS = 1e-9;
const MAX_MXL_ENTRIES = 200;
const MAX_MXL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // MusicXML attributes are simple quoted values.  Ignore malformed/unquoted
  // attributes rather than trying to interpret arbitrary markup as a value.
  const attrRe = /([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source))) attrs[localName(match[1]!)] = decodeXml(match[3]!);
  return attrs;
}

/** Parse XML without DTD/entity resolution or network access. */
function parseXml(xml: string): XmlNode {
  if (typeof xml !== "string" || !xml.trim()) throw new OmrMusicXmlError("MusicXML input is empty");
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) {
      stack[stack.length - 1]!.text += decodeXml(xml.slice(cursor));
      break;
    }
    if (open > cursor) stack[stack.length - 1]!.text += decodeXml(xml.slice(cursor, open));
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) throw new OmrMusicXmlError("unterminated XML comment");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) throw new OmrMusicXmlError("unterminated XML CDATA");
      stack[stack.length - 1]!.text += xml.slice(open + 9, end);
      cursor = end + 3;
      continue;
    }
    let end = open + 1;
    let quote = "";
    for (; end < xml.length; end += 1) {
      const char = xml[end]!;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    if (end >= xml.length) throw new OmrMusicXmlError("unterminated XML tag");
    const raw = xml.slice(open + 1, end).trim();
    cursor = end + 1;
    if (!raw || raw.startsWith("?") || raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      const closing = localName(raw.slice(1).trim());
      if (stack.length <= 1 || localName(stack[stack.length - 1]!.name) !== closing) {
        throw new OmrMusicXmlError(`mismatched closing XML tag: ${closing}`);
      }
      stack.pop();
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const nameMatch = body.match(/^(\S+)/);
    if (!nameMatch) continue;
    const node: XmlNode = {
      name: nameMatch[1]!,
      attrs: parseAttributes(body.slice(nameMatch[0].length)),
      children: [],
      text: "",
    };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new OmrMusicXmlError("unclosed XML element");
  return root;
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  const wanted = localName(name);
  return node.children.find((candidate) => localName(candidate.name) === wanted);
}

function children(node: XmlNode, name: string): XmlNode[] {
  const wanted = localName(name);
  return node.children.filter((candidate) => localName(candidate.name) === wanted);
}

function textOf(node: XmlNode | undefined): string {
  if (!node) return "";
  return node.text.trim();
}

function numberOf(node: XmlNode | undefined): number | null {
  if (!node) return null;
  const value = Number(textOf(node));
  return Number.isFinite(value) ? value : null;
}

function integerOf(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function roleFromName(name: string | null | undefined, fallback: OmrRole | null = null): OmrRole | null {
  if (!name) return fallback;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const words = new Set(normalized.split(/\s+/).filter(Boolean));
  for (const role of ["melody", "rhythm", "harmony"] as const) {
    if (ROLE_NAMES[role].some((token) => words.has(token) || normalized.includes(token))) return role;
  }
  return fallback;
}

function roleFor(partId: string, partName: string | null, options: OmrMusicXmlParseOptions): OmrRole | null {
  if (options.partRoles && Object.prototype.hasOwnProperty.call(options.partRoles, partId)) return options.partRoles[partId] ?? null;
  return roleFromName(partName, options.defaultRole ?? null);
}

function roleForStaff(partId: string, staff: number | null, partRole: OmrRole | null, options: OmrMusicXmlParseOptions): OmrRole | null {
  if (staff !== null && options.staffRoles) {
    const key = `${partId}:${staff}`;
    if (Object.prototype.hasOwnProperty.call(options.staffRoles, key)) return options.staffRoles[key] ?? null;
  }
  return partRole;
}

function parseTie(note: XmlNode): OmrTieInput | undefined {
  const flags = { start: false, stop: false, continue: false };
  const add = (value: string | undefined): void => {
    if (value === "start") flags.start = true;
    else if (value === "stop") flags.stop = true;
    else if (value === "continue") flags.continue = true;
  };
  for (const tie of children(note, "tie")) add(tie.attrs.type);
  const notations = child(note, "notations");
  for (const tied of children(notations ?? { name: "", attrs: {}, children: [], text: "" }, "tied")) add(tied.attrs.type);
  return flags.start || flags.stop || flags.continue ? flags : undefined;
}

function hasTuplet(note: XmlNode): boolean {
  if (child(note, "time-modification")) return true;
  const notations = child(note, "notations");
  return children(notations ?? { name: "", attrs: {}, children: [], text: "" }, "tuplet").length > 0;
}

function midiForPitch(note: XmlNode): { midi: number; accidental: string | null } | null {
  const pitch = child(note, "pitch");
  if (!pitch) return null;
  const step = textOf(child(pitch, "step")).toUpperCase();
  const octave = numberOf(child(pitch, "octave"));
  const alter = numberOf(child(pitch, "alter")) ?? 0;
  if (!(step in STEP_PC) || octave === null || !Number.isInteger(octave) || !Number.isFinite(alter)) return null;
  const midi = 12 * (octave + 1) + STEP_PC[step]! + alter;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
  const accidental = textOf(child(note, "accidental")) || null;
  return { midi, accidental };
}

function parsePartList(root: XmlNode): Map<string, { name: string | null; role: OmrRole | null }> {
  const result = new Map<string, { name: string | null; role: OmrRole | null }>();
  const partList = child(root, "part-list");
  for (const scorePart of children(partList ?? { name: "", attrs: {}, children: [], text: "" }, "score-part")) {
    const id = scorePart.attrs.id;
    if (!id) continue;
    const name = textOf(child(scorePart, "part-name")) || textOf(child(scorePart, "part-abbreviation")) || null;
    const instrumentName = textOf(child(child(scorePart, "score-instrument") ?? { name: "", attrs: {}, children: [], text: "" }, "instrument-name"));
    const displayName = name || instrumentName || null;
    result.set(id, { name: displayName, role: roleFromName(displayName) });
  }
  return result;
}

function parseTempo(direction: XmlNode): number | null {
  const sound = child(direction, "sound");
  const soundTempo = sound?.attrs.tempo === undefined ? null : Number(sound.attrs.tempo);
  if (positive(soundTempo)) return soundTempo;
  const metronome = child(child(direction, "direction-type") ?? { name: "", attrs: {}, children: [], text: "" }, "metronome");
  const perMinute = numberOf(child(metronome ?? { name: "", attrs: {}, children: [], text: "" }, "per-minute"));
  return positive(perMinute) ? perMinute : null;
}

function parseRawPart(
  part: XmlNode,
  partName: string | null,
  partRole: OmrRole | null,
  options: OmrMusicXmlParseOptions,
  warnings: string[],
): RawPart {
  const id = part.attrs.id || `P${Math.max(1, part.name.length)}`;
  const rawMeasures: RawMeasure[] = [];
  let divisions = 1;
  let timeSignature: [number, number] | null = null;
  let keySignature: number | null = null;
  let page: number | null = null;
  let system: number | null = null;
  const sourceMeasures = children(part, "measure");
  for (let measureIndex = 0; measureIndex < sourceMeasures.length; measureIndex += 1) {
    const source = sourceMeasures[measureIndex]!;
    const number = source.attrs.number || String(measureIndex + 1);
    const implicit = /^(yes|true|1)$/i.test(source.attrs.implicit ?? "") || number === "0";
    const explicitPage = integerOf(source.attrs.page);
    const explicitSystem = integerOf(source.attrs.system);
    if (explicitPage !== null && explicitPage > 0) page = explicitPage;
    if (explicitSystem !== null && explicitSystem > 0) system = explicitSystem;
    let cursor = 0;
    let cursorMax = 0;
    let lastNoteStart = 0;
    const events: OmrEventInput[] = [];
    const rests: Array<{ onset: number; duration: number }> = [];
    const staffSet = new Set<number>();
    const voiceSet = new Set<string>();
    let tupletCount = 0;
    for (const element of source.children) {
      const name = localName(element.name);
      if (name === "attributes") {
        const nextDivisions = numberOf(child(element, "divisions"));
        if (nextDivisions !== null && Number.isInteger(nextDivisions) && nextDivisions > 0) divisions = nextDivisions;
        const time = child(element, "time");
        const beats = integerOf(textOf(child(time ?? { name: "", attrs: {}, children: [], text: "" }, "beats")));
        const beatType = integerOf(textOf(child(time ?? { name: "", attrs: {}, children: [], text: "" }, "beat-type")));
        if (beats !== null && beats > 0 && beatType !== null && beatType > 0) timeSignature = [beats, beatType];
        const fifths = integerOf(textOf(child(child(element, "key") ?? { name: "", attrs: {}, children: [], text: "" }, "fifths")));
        if (fifths !== null) keySignature = fifths;
      } else if (name === "print") {
        const printPage = integerOf(element.attrs["page-number"]);
        if (printPage !== null && printPage > 0) page = printPage;
        if (/^(yes|true|1)$/i.test(element.attrs["new-system"] ?? "")) system = system === null ? 1 : system + 1;
      } else if (name === "backup" || name === "forward") {
        const durationDivisions = numberOf(child(element, "duration"));
        const delta = durationDivisions === null ? 0 : durationDivisions / divisions;
        cursor = name === "backup" ? Math.max(0, cursor - delta) : cursor + delta;
        cursorMax = Math.max(cursorMax, cursor);
      } else if (name === "note") {
        const durationDivisions = numberOf(child(element, "duration"));
        const duration = durationDivisions === null ? 0 : durationDivisions / divisions;
        if (!positive(duration)) {
          if (!child(element, "grace")) warnings.push(`dropped non-positive note duration in ${id}:${number}`);
          continue;
        }
        const chord = child(element, "chord") !== undefined;
        const onset = chord ? lastNoteStart : cursor;
        if (!chord) {
          lastNoteStart = cursor;
          cursor += duration;
          cursorMax = Math.max(cursorMax, cursor);
        }
        const staff = integerOf(textOf(child(element, "staff")));
        const voice = textOf(child(element, "voice")) || null;
        if (staff !== null && staff > 0) staffSet.add(staff);
        if (voice !== null) voiceSet.add(voice);
        const tuplet = hasTuplet(element);
        if (tuplet) tupletCount += 1;
        const rest = child(element, "rest") !== undefined;
        if (rest) {
          rests.push({ onset: rounded(onset), duration: rounded(duration) });
          continue;
        }
        const pitch = midiForPitch(element);
        if (!pitch) {
          warnings.push(`dropped note without a pitched <pitch> in ${id}:${number}`);
          continue;
        }
        const role = roleForStaff(id, staff, partRole, options);
        const event: OmrEventInput = {
          onset: rounded(onset),
          duration: rounded(duration),
          pitch: pitch.midi,
          accidental: pitch.accidental,
          staff: staff !== null && staff > 0 ? staff : undefined,
          voice: voice ?? undefined,
          role: role ?? undefined,
          tie: parseTie(element),
          tuplet,
        };
        events.push(event);
      }
    }
    const nominal = timeSignature ? (timeSignature[0] * 4) / timeSignature[1] : 4;
    const actualEnd = Math.max(cursorMax, ...events.map((event) => event.onset + event.duration), ...rests.map((rest) => rest.onset + rest.duration), 0);
    const durationBeats = rounded(implicit ? Math.max(actualEnd, nominal > 0 && actualEnd <= EPS ? nominal : 0) : Math.max(nominal, actualEnd));
    const tieIn = events.some((event) => {
      const tie = event.tie;
      return Boolean(tie && (typeof tie === "object" ? tie.stop || tie.continue : tie === "stop" || tie === "continue"));
    });
    const tieOut = events.some((event) => {
      const tie = event.tie;
      return Boolean(tie && (typeof tie === "object" ? tie.start || tie.continue : tie === "start" || tie === "continue"));
    });
    rawMeasures.push({
      id: `${id}:m${measureIndex + 1}`,
      number,
      page,
      system,
      durationBeats,
      timeSignature,
      keySignature,
      implicit,
      events,
      rests,
      staves: [...staffSet].sort((a, b) => a - b),
      voices: [...voiceSet].sort(stableCompare),
      tieIn,
      tieOut,
      tupletCount,
    });
  }
  return { id, name: partName, role: partRole, measures: rawMeasures };
}

function parseScorePartwise(root: XmlNode, options: OmrMusicXmlParseOptions): OmrMusicXmlParseResult {
  const partInfo = parsePartList(root);
  const warnings: string[] = [];
  const sourceParts = children(root, "part");
  if (!sourceParts.length) throw new OmrMusicXmlError("MusicXML contains no score-partwise parts");
  const rawParts: RawPart[] = [];
  let tempoBpm: number | null = null;
  for (const part of sourceParts) {
    const id = part.attrs.id || `P${rawParts.length + 1}`;
    const info = partInfo.get(id);
    const name = info?.name ?? null;
    const role = roleFor(id, name, options);
    // A tempo direction can occur in any part.  Scan the first available one
    // in document order, which is stable and matches conventional notation.
    if (tempoBpm === null) {
      for (const measure of children(part, "measure")) {
        for (const direction of children(measure, "direction")) {
          const tempo = parseTempo(direction);
          if (tempo !== null) {
            tempoBpm = tempo;
            break;
          }
        }
        if (tempoBpm !== null) break;
      }
    }
    rawParts.push(parseRawPart({ ...part, attrs: { ...part.attrs, id } }, name, role, options, warnings));
  }
  const maxMeasures = Math.max(...rawParts.map((part) => part.measures.length), 0);
  const globalDurations: number[] = [];
  for (let index = 0; index < maxMeasures; index += 1) {
    globalDurations[index] = Math.max(...rawParts.map((part) => part.measures[index]?.durationBeats ?? 0), 0);
    if (!positive(globalDurations[index]!)) globalDurations[index] = 4;
  }
  const globalStarts: number[] = [];
  let globalCursor = 0;
  for (const duration of globalDurations) {
    globalStarts.push(rounded(globalCursor));
    globalCursor += duration;
  }
  const parts: OmrPartInput[] = rawParts.map((part) => ({
    id: part.id,
    name: part.name,
    role: part.role ?? undefined,
    measures: part.measures.map((measure, index) => ({
      id: measure.id,
      number: measure.number,
      page: measure.page ?? undefined,
      system: measure.system ?? undefined,
      startBeat: globalStarts[index] ?? 0,
      // Keep the source measure's duration for partial/pickup measures while
      // all parts share the same absolute start grid.
      durationBeats: measure.durationBeats,
      timeSignature: measure.timeSignature,
      keySignature: measure.keySignature,
      implicit: measure.implicit,
      staves: measure.staves.map((number) => ({
        number,
        role: roleForStaff(part.id, number, part.role, options) ?? undefined,
        voices: [],
        events: [],
      })),
      voices: measure.voices.map((id) => ({ id, role: part.role ?? undefined })),
      events: measure.events,
      rests: measure.rests,
      tieIn: measure.tieIn,
      tieOut: measure.tieOut,
      tupletCount: measure.tupletCount,
    })),
  }));
  const firstTime = rawParts.flatMap((part) => part.measures).find((measure) => measure.timeSignature)?.timeSignature ?? null;
  const firstKey = rawParts.flatMap((part) => part.measures).find((measure) => measure.keySignature !== null)?.keySignature ?? null;
  const title = textOf(child(root, "movement-title")) || textOf(child(child(root, "work") ?? { name: "", attrs: {}, children: [], text: "" }, "work-title")) || undefined;
  const score: OmrScoreInput = {
    title,
    tempoBpm: tempoBpm ?? undefined,
    timeSignature: firstTime,
    keySignature: firstKey,
    parts,
    metadata: {
      adapter: OMR_MUSICXML_ADAPTER_VERSION,
      format: "musicxml",
      partCount: parts.length,
      measureCount: maxMeasures,
      warnings: [...warnings],
    },
  };
  return { score, format: "musicxml", rootFile: null, warnings };
}

function decodeBytes(bytes: Uint8Array): string {
  // MusicXML is UTF-8 in current OMR exports.  TextDecoder replaces malformed
  // sequences deterministically; XML validation below will still fail closed
  // for structurally invalid input.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function assertMxlZipSafe(bytes: Uint8Array): void {
  // Read the central directory before inflation so a malformed archive cannot
  // allocate an unbounded amount of memory through fflate.
  if (bytes.length < 22) throw new OmrMusicXmlError("invalid MXL archive: truncated ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOfCentralDirectory = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= scanStart; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOfCentralDirectory = index;
      break;
    }
  }
  if (endOfCentralDirectory < 0) throw new OmrMusicXmlError("invalid MXL archive: missing central directory");
  const entries = view.getUint16(endOfCentralDirectory + 10, true);
  const centralDirectorySize = view.getUint32(endOfCentralDirectory + 12, true);
  const centralDirectoryOffset = view.getUint32(endOfCentralDirectory + 16, true);
  if (entries === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new OmrMusicXmlError("invalid MXL archive: ZIP64 is not supported");
  }
  if (entries > MAX_MXL_ENTRIES || centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new OmrMusicXmlError(`invalid MXL archive: too many entries or invalid central directory`);
  }
  let offset = centralDirectoryOffset;
  let uncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > centralDirectoryOffset + centralDirectorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw new OmrMusicXmlError("invalid MXL archive: malformed central directory");
    }
    uncompressed += view.getUint32(offset + 24, true);
    if (uncompressed > MAX_MXL_UNCOMPRESSED_BYTES) {
      throw new OmrMusicXmlError("invalid MXL archive: uncompressed content exceeds safety limit");
    }
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

function xmlFromMxl(bytes: Uint8Array): { xml: string; rootFile: string | null } {
  assertMxlZipSafe(bytes);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new OmrMusicXmlError(`invalid MXL archive: ${(error as Error).message}`);
  }
  const names = Object.keys(files).sort(stableCompare);
  let rootFile: string | null = null;
  const container = files["META-INF/container.xml"];
  if (container) {
    const containerXml = decodeBytes(container);
    const match = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (match?.[1] && files[decodeXml(match[1])]) rootFile = decodeXml(match[1]);
  }
  rootFile ??= names.find((name) => /\.musicxml$/i.test(name)) ?? null;
  rootFile ??= names.find((name) => /\.xml$/i.test(name) && !/^META-INF\//i.test(name)) ?? null;
  if (!rootFile || !files[rootFile]) throw new OmrMusicXmlError("MXL archive contains no MusicXML rootfile");
  if (rootFile.startsWith("/") || rootFile.split("/").includes("..")) {
    throw new OmrMusicXmlError("MXL archive rootfile must be a relative path");
  }
  return { xml: decodeBytes(files[rootFile]!), rootFile };
}

/** Parse a MusicXML string into the OMR consensus representation. */
export function parseOmrMusicXml(xml: string, options: OmrMusicXmlParseOptions = {}): OmrMusicXmlParseResult {
  const root = parseXml(xml).children.find((node) => localName(node.name) === "score-partwise");
  if (!root) throw new OmrMusicXmlError("only score-partwise MusicXML is supported");
  return parseScorePartwise(root, options);
}

/** Parse raw MusicXML bytes or an MXL archive. */
export function parseOmrMusicXmlBytes(input: Uint8Array | ArrayBuffer, options: OmrMusicXmlParseOptions = {}): OmrMusicXmlParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isZip(bytes)) {
    const extracted = xmlFromMxl(bytes);
    const result = parseOmrMusicXml(extracted.xml, options);
    result.format = "mxl";
    result.rootFile = extracted.rootFile;
    result.score.metadata = {
      ...(result.score.metadata && typeof result.score.metadata === "object" ? result.score.metadata : {}),
      format: "mxl",
      rootFile: extracted.rootFile,
    };
    return result;
  }
  return parseOmrMusicXml(decodeBytes(bytes), options);
}

/** Compatibility alias used by corpus adapters. */
export const parseMusicXmlForOmr = parseOmrMusicXml;
export const parseMusicXmlBytesForOmr = parseOmrMusicXmlBytes;
