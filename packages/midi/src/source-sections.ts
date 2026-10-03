import type { Section } from "./types.js";

/** Accept form labels, not arbitrary copyright, instrument or tempo text. */
export function sourceSectionType(label: string): Section["type"] | null {
  const text=label.trim().replace(/:$/," ").trim();
  if(!/^(?:(?:intro|outro)(?:duction|\s+riff)?|verse|chorus|pre[- ]chorus|post[- ]chorus|bridge|interlude|(?:guitar|piano|organ)\s+solo|solo|refrain|coda|theme\s+[a-z]|section\s+[a-z])(?:\s+\d+[a-z]?)?$/i.test(text))return null;
  if(/^pre[- ]chorus/i.test(text))return "pre-chorus";
  if(/^(?:chorus|refrain)/i.test(text))return "chorus";
  if(/^verse/i.test(text))return "verse";
  if(/^bridge/i.test(text))return "bridge";
  if(/^intro/i.test(text))return "intro";
  if(/^(?:outro|coda)/i.test(text))return "outro";
  if(/solo|interlude/i.test(text))return "interlude";
  return "custom";
}

export function sectionsFromMarkers(markers: readonly {beat:number;label:string}[], durationBeats:number): Section[] {
  if(markers.length>4096 || !Number.isFinite(durationBeats) || durationBeats<=0)return [];
  const selected=markers.filter(m=>Number.isFinite(m.beat) && m.beat>=0 && m.beat<durationBeats && m.label.length<=160 && sourceSectionType(m.label)!==null)
    .sort((a,b)=>a.beat-b.beat || a.label.localeCompare(b.label));
  const unique=selected.filter((m,index)=>index===0 || m.beat!==selected[index-1]!.beat);
  // Conflicting labels at the same beat across tracks are not form evidence.
  const unambiguous=unique.filter(m=>!selected.some(other=>other.beat===m.beat && other.label!==m.label));
  return unambiguous.map((m,index)=>({id:`source-section-${index+1}`,label:m.label.trim().replace(/:$/," ").trim(),type:sourceSectionType(m.label)!,startBeat:m.beat,endBeat:unambiguous[index+1]?.beat??durationBeats,evidence:"source"}));
}
