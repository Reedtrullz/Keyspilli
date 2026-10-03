import {sourcePedalErrors} from "@keyspilli/midi";
import { createHash, randomUUID } from "node:crypto";
import { buildShortStudyVariants, selectSourceParts, shortStudyKind, validateShortStudySource } from "@keyspilli/midi";
import { parseSymbolicUploadSource } from "./ingest.js";
import type { SymbolicArrangementIntent, SymbolicSourcePartRole, SymbolicUploadIntent } from "./artifact-manifest.js";

export const SYMBOLIC_PREFLIGHT_TTL_MS = 10 * 60_000;
const MAX_PREFLIGHTS = 64;
const MAX_PREFLIGHT_PARTS = 64;
const MAX_PART_ID_LENGTH = 128;
const MAX_SELECTED_PARTS = 64;

export interface SymbolicUploadPreflight {
  preflightId: string;
  sourceHash: string;
  expiresAt: string;
  format: "midi" | "musicxml" | "mxl";
  tempoBpm: number;
  timeSig: [number, number];
  parts: Array<{
    id: string;
    name: string;
    noteCount: number;
    lowMidi: number | null;
    highMidi: number | null;
    startBeat: number | null;
    endBeat: number | null;
    percussion: boolean;
  }>;
  unsupportedControls: string[];
  previewNotes: Array<{ partId: string; midi: number; start: number; dur: number; vel: number }>;
}

export interface SymbolicUploadChoice {
  selectedParts: Array<{ id: string; role: SymbolicSourcePartRole }>;
  arrangementIntent: SymbolicArrangementIntent;
  rightsAttested: boolean;
  ownerAuthoredStudy?: boolean;
}

type StoredPreflight = {
  sourceHash: string;
  expiresAt: number;
  parts: SymbolicUploadPreflight["parts"];
};

const preflights = new Map<string, StoredPreflight>();

function pruneExpired(now = Date.now()): void {
  for (const [id, candidate] of preflights) if (candidate.expiresAt <= now) preflights.delete(id);
}

function safePartName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || "Unnamed part";
}

export function createSymbolicUploadPreflight(buf: Uint8Array, now = Date.now()): SymbolicUploadPreflight {
  pruneExpired(now);
  const { format, parsed } = parseSymbolicUploadSource(buf);
  if (!parsed.notes.length) throw new Error("source contains no pitched notes; percussion-only and empty files cannot be published");
  const sourceParts = parsed.sourceParts ?? [];
  if (sourceParts.length > MAX_PREFLIGHT_PARTS) throw new Error(`source contains more than ${MAX_PREFLIGHT_PARTS} parts; simplify it before review`);
  const partIds = new Set<string>();
  for (const part of sourceParts) {
    if (!part.id.trim() || part.id.length > MAX_PART_ID_LENGTH) throw new Error(`source part id must be 1-${MAX_PART_ID_LENGTH} characters`);
    if (partIds.has(part.id)) throw new Error("source contains duplicate part ids and cannot be selected unambiguously");
    partIds.add(part.id);
  }
  const parts = sourceParts.map((part) => ({
    id: part.id,
    name: safePartName(part.name),
    noteCount: part.noteCount,
    lowMidi: part.lowMidi,
    highMidi: part.highMidi,
    startBeat: part.startBeat,
    endBeat: part.endBeat,
    percussion: part.percussion === true,
  }));
  if (!parts.some((part) => part.noteCount > 0 && !part.percussion)) throw new Error("source contains no selectable pitched part");
  const sourceHash = createHash("sha256").update(buf).digest("hex");
  const preflightId = randomUUID();
  const expiresAt = now + SYMBOLIC_PREFLIGHT_TTL_MS;
  while (preflights.size >= MAX_PREFLIGHTS) preflights.delete(preflights.keys().next().value as string);
  preflights.set(preflightId, { sourceHash, expiresAt, parts });
  const previewCounts = new Map<string, number>();
  const previewNotes = parsed.notes.flatMap((note) => {
    const partId = note.sourceOrigins?.find((origin) => origin.part)?.part;
    if (!partId || (previewCounts.get(partId) ?? 0) >= 8 || previewCounts.size >= 64) return [];
    previewCounts.set(partId, (previewCounts.get(partId) ?? 0) + 1);
    return [{ partId, midi: note.midi, start: note.start, dur: note.dur, vel: note.vel }];
  }).slice(0, 256);
  return {
    preflightId,
    sourceHash,
    expiresAt: new Date(expiresAt).toISOString(),
    format,
    tempoBpm: parsed.tempoBpm,
    timeSig: [...parsed.timeSig],
    parts,
    unsupportedControls: [...(parsed.unsupportedControls ?? []),...(parsed.sourcePedal?sourcePedalErrors(parsed.notes,parsed.sourcePedal).map(e=>`Source CC64: ${e}`):[])],
    previewNotes,
  };
}

export function confirmSymbolicUploadChoice(
  preflightId: string,
  buf: Uint8Array,
  choice: SymbolicUploadChoice,
  now = Date.now(),
): SymbolicUploadIntent {
  pruneExpired(now);
  const candidate = preflights.get(preflightId);
  if (!candidate || candidate.expiresAt <= now) throw new Error("symbolic preflight expired; review the file again");
  const sourceHash = createHash("sha256").update(buf).digest("hex");
  if (sourceHash !== candidate.sourceHash) throw new Error("uploaded bytes changed after symbolic preflight");
  if (choice.rightsAttested !== true) throw new Error("confirm that you are authorized to upload and use these source bytes");
  if (choice.arrangementIntent !== "original" && choice.arrangementIntent !== "backing-only-chords") throw new Error("choose Original or backing-only Chords intent");
  if (choice.ownerAuthoredStudy === true && choice.arrangementIntent !== "original") throw new Error("an owner-authored short study requires Original arrangement intent");
  if (!Array.isArray(choice.selectedParts) || choice.selectedParts.length < 1 || choice.selectedParts.length > MAX_SELECTED_PARTS) {
    throw new Error(`select 1-${MAX_SELECTED_PARTS} source parts`);
  }
  if (choice.arrangementIntent === "backing-only-chords"
    && choice.selectedParts.some((part) => part?.role !== "harmony" && part?.role !== "bass")) {
    throw new Error("backing-only Chords accepts only owner-identified harmony or bass parts; source roles do not establish physical hands");
  }
  if (choice.selectedParts.some((part) => !part || typeof part !== "object"
    || typeof part.id !== "string" || typeof part.role !== "string")) {
    throw new Error("each selected source part must include its id and an explicit role");
  }
  if (new Set(choice.selectedParts.map((part) => part.id)).size !== choice.selectedParts.length) throw new Error("source part selection contains duplicates");
  if (choice.ownerAuthoredStudy !== undefined && typeof choice.ownerAuthoredStudy !== "boolean") throw new Error("study intent must be an explicit boolean choice");
  const partsById = new Map(candidate.parts.map((part) => [part.id, part]));
  const selectedParts = choice.selectedParts.map(({ id, role }) => {
    const part = partsById.get(id);
    if (!part) throw new Error(`source part was not present in this preflight: ${id}`);
    if (part.percussion) throw new Error(`percussion part cannot be selected: ${part.name}`);
    if (part.noteCount < 1) throw new Error(`source part has no pitched notes: ${part.name}`);
    if (!new Set(["melody", "harmony", "bass", "other"]).has(role)) throw new Error(`choose a role for ${part.name}`);
    return { id: part.id, name: part.name, role };
  });
  const { parsed } = parseSymbolicUploadSource(buf);
  const selected = selectSourceParts(parsed, selectedParts.map((part) => part.id));
  const intent: SymbolicUploadIntent = {
    schemaVersion: 1,
    sourceHash,
    rightsAttested: true,
    arrangementIntent: choice.arrangementIntent,
    selectedParts,
  };
  if (choice.ownerAuthoredStudy === true) {
    const errors = validateShortStudySource(selected.notes);
    const kind = shortStudyKind(selected.notes);
    if (errors.length || !kind) throw new Error(errors.join("; ") || "select an exact one-note, triad, or four-note study");
    const availableLevels = buildShortStudyVariants(selected, { title: "Study", artist: "Owner" }, { maxDurBeats: null })
      .map((variant) => variant.level)
      .filter((level): level is "beginner" | "easy" | "medium" | "advanced" =>
        level === "beginner" || level === "easy" || level === "medium" || level === "advanced");
    intent.study = { ownerAuthored: true, profile: "source", kind, noteCount: selected.notes.length as 1 | 3 | 4, availableLevels };
  }
  preflights.delete(preflightId);
  return intent;
}
