import type { Note, ParsedMidi, SymbolicSourcePart } from "./types.js";

export function selectSourceParts(parsed: ParsedMidi, partIds: readonly string[]): ParsedMidi {
  if (!partIds.length || new Set(partIds).size !== partIds.length) throw new Error("select at least one unique source part");
  const parts = parsed.sourceParts ?? [];
  const byId = new Map(parts.map((part) => [part.id, part]));
  const selected: SymbolicSourcePart[] = partIds.map((id) => {
    const part = byId.get(id);
    if (!part) throw new Error(`unknown source part: ${id}`);
    if (part.percussion) throw new Error(`percussion part cannot be selected: ${part.name}`);
    if (part.noteCount === 0) throw new Error(`source part has no pitched notes: ${part.name}`);
    return part;
  });
  const selectedIds = new Set(partIds);
  const notes = parsed.notes.flatMap((note): Note[] => {
    const origins = note.sourceOrigins?.filter((origin) => origin.part && selectedIds.has(origin.part));
    return origins?.length ? [{ ...note, sourceOrigins: origins }] : [];
  });
  if (!notes.length) throw new Error("selected source parts contain no pitched notes");
  return {
    ...parsed,
    notes,
    trackNames: selected.map((part) => part.name),
    sourceParts: selected,
    durationBeats: notes.reduce((end, note) => Math.max(end, note.start + note.dur), 0),
  };
}
