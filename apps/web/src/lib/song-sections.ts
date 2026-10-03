import type { Section } from "@keyspilli/midi";
import { inferSongForm, overlaySourceSections, type SongData } from "@keyspilli/player-core";
import sourceMaps from "../../../../catalog/song-sections.json";

interface SectionMap { baseId:string; sourceArtifactHash:string; advancedNotesSha256?:string; playbackTempoBpm:number; sections:readonly Section[] }

/** Form maps are arrangement-specific: a matching title is never enough. */
export function resolveSongSections(song:{baseId:string;category?:string}, data:SongData, sourceArtifactHash?:string, maps:readonly SectionMap[]=sourceMaps.entries as SectionMap[]):Section[] {
  const structuralNotes=data.notes.length ? data.notes : data.chords.flatMap(chord=>chord.notes.map(midi=>({midi,start:chord.beat,dur:chord.durationBeats??1,vel:80})));
  const fallback=inferSongForm(structuralNotes,data.measures,{classical:song.category?.toLowerCase()==="classical"});
  const duration=data.measures.at(-1)?.endBeat??0;
  const authored=data.sections?.filter(section=>section.evidence!=="estimated");
  if(authored?.length)return overlaySourceSections(fallback,authored,duration);
  const notesHash=data.sourceFingerprint?.match(/:notes:([a-f0-9]{64})(?::|$)/)?.[1];
  const matching=maps.find(entry=>entry.baseId===song.baseId && entry.sourceArtifactHash===sourceArtifactHash
    && (!entry.advancedNotesSha256 || entry.advancedNotesSha256===notesHash)
    && Math.abs(entry.playbackTempoBpm-data.tempoBpm)<1e-6);
  return matching ? overlaySourceSections(fallback,matching.sections,duration) : fallback;
}
