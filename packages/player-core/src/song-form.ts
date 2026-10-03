import type { MeasureInfo, Note, Section } from "@keyspilli/midi";

interface Phrase {
  startBeat: number;
  endBeat: number;
  vector: number[];
  density: number;
  family: number;
}

const estimated = " · estimated";
function similarity(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : aa === bb ? 1 : 0;
}

/** Musical repetition estimates form; it does not establish lyric/recording truth.
 * Work in real bar coordinates (including pickups), bounded to 256 phrases.
 * Analyse the canonical arrangement once, then share its labels across levels.
 */
export function inferSongForm(notes: readonly Note[], measures: readonly MeasureInfo[], options: { classical?: boolean } = {}): Section[] {
  const bars = measures.filter(m => Number.isFinite(m.startBeat) && Number.isFinite(m.endBeat) && m.startBeat >= 0 && m.endBeat > m.startBeat);
  if (!bars.length) return [];
  const ordered = notes.filter(n => Number.isFinite(n.start) && Number.isFinite(n.midi)).slice().sort((a,b) => a.start-b.start);
  const phraseBars = Math.max(8, Math.ceil(bars.length / 256 / 4) * 4);
  const phrases: Phrase[] = [];
  let noteIndex = 0;
  for (let index = 0; index < bars.length; index += phraseBars) {
    const startBeat = bars[index]!.startBeat, endBeat = bars[Math.min(bars.length-1,index+phraseBars-1)]!.endBeat;
    // Separate upper-register distribution from all-note distribution; neither
    // track identity nor highest pitch is treated as verified vocal melody.
    const vector = Array(24).fill(0) as number[];
    let count = 0;
    while (noteIndex < ordered.length && ordered[noteIndex]!.start < startBeat) noteIndex++;
    while (noteIndex < ordered.length && ordered[noteIndex]!.start < endBeat) {
      const note = ordered[noteIndex++]!, pc = ((Math.round(note.midi)%12)+12)%12;
      vector[pc] = vector[pc]! + 1;
      if (note.hand !== "L" && note.midi >= 60) vector[12+pc] = vector[12+pc]! + 1;
      count++;
    }
    phrases.push({startBeat,endBeat,vector,density:count/(endBeat-startBeat),family:-1});
  }
  const families: Phrase[] = [];
  for (const phrase of phrases) {
    const family = families.findIndex(reference => similarity(reference.vector,phrase.vector) >= .94
      && (Math.max(reference.density,phrase.density) === 0 || Math.min(reference.density,phrase.density)/Math.max(reference.density,phrase.density) >= .55));
    phrase.family = family < 0 ? families.push(phrase)-1 : family;
  }
  const occurrences = families.map((_,family)=>phrases.map((p,index)=>p.family===family?index:-1).filter(index=>index>=0));
  const recurring = occurrences.map((positions,family)=>({positions,family})).filter(entry=>entry.positions.some((p,index)=>index>0 && p-entry.positions[index-1]!>1));
  // When two themes recur, the later contrasting theme is the better chorus
  // candidate. Density alone would often call a busy opening verse a chorus.
  const contrasts=recurring.filter(entry=>entry.family!==phrases[0]!.family);
  const chorus = families.length > 1 ? (contrasts.length?contrasts:recurring).sort((a,b)=>families[b.family]!.density-families[a.family]!.density || b.positions.length-a.positions.length)[0]?.family : undefined;
  const counts = new Map<string,number>();
  const results: Section[] = [];
  const meanDensity = phrases.reduce((sum,p)=>sum+p.density,0)/phrases.length;
  for (const [index, phrase] of phrases.entries()) {
    let type: NonNullable<Section["type"]> = "custom";
    let name: string;
    if (families.length === 1) name = options.classical ? "Main theme" : "Main section";
    else if (options.classical) {
      const theme = `Theme ${String.fromCharCode(65+phrase.family%26)}${phrase.family>=26?Math.floor(phrase.family/26)+1:""}`;
      const returned = occurrences[phrase.family]!.some(p=>p<index);
      name = theme + (returned ? " return" : "");
    } else if (index===0 && phrase.density<meanDensity*.6 && occurrences[phrase.family]!.length===1) { type="intro"; name="Intro"; }
    else if (index===phrases.length-1 && phrase.density<meanDensity*.5 && occurrences[phrase.family]!.length===1) { type="outro"; name="Outro"; }
    else if (chorus!==undefined) {
      if (phrase.family===chorus) { type="chorus"; name="Chorus"; }
      else if (occurrences[phrase.family]!.length===1 && phrases.slice(0,index).some(p=>p.family===chorus) && phrases.slice(index+1).some(p=>p.family===chorus)) { type="bridge"; name="Bridge"; }
      else { type="verse"; name="Verse"; }
    } else {
      // No evidence of alternating recurring form: describe position instead
      // of manufacturing a chorus from density alone.
      name = index===0 ? "Opening" : index===phrases.length-1 ? "Closing" : "Main passage";
    }
    const previous = results.at(-1);
    if (previous && phrases[index-1]!.family===phrase.family && previous.type===type) {
      previous.endBeat=phrase.endBeat;
      continue;
    }
    const count=(counts.get(name)??0)+1; counts.set(name,count);
    const numbered=type==="verse" || type==="chorus" || count>1;
    results.push({id:`form-${index+1}`,label:name+(numbered?` ${count}`:"")+estimated,startBeat:phrase.startBeat,endBeat:phrase.endBeat,type,evidence:"estimated"});
  }
  return results;
}

/** Overlay only bounded, nonoverlapping source spans, keeping unknown gaps
 * estimated. A malformed map must not break playback or silently replace form.
 */
export function overlaySourceSections(fallback: readonly Section[], source: readonly Section[], durationBeats: number): Section[] {
  if (!source.length || source.length>512 || !Number.isFinite(durationBeats) || durationBeats<=0) return [...fallback];
  if(source.some(s=>!s || typeof s!=="object")) return [...fallback];
  const sorted=[...source].sort((a,b)=>a.startBeat-b.startBeat);
  const ids=new Set<string>();
  for(const [index,s] of sorted.entries()) {
    if(!s || typeof s!=="object" || typeof s.id!=="string" || !s.id || ids.has(s.id) || typeof s.label!=="string" || !s.label.trim() || s.label.length>160
      || !Number.isFinite(s.startBeat) || !Number.isFinite(s.endBeat) || s.startBeat<0 || s.endBeat<=s.startBeat
      || (index>0 && s.startBeat<sorted[index-1]!.endBeat)) return [...fallback];
    ids.add(s.id);
  }
  const result:Section[]=[];
  let cursor=0;
  const fill=(end:number)=>{
    for(const s of fallback) {
      const startBeat=Math.max(cursor,s.startBeat),endBeat=Math.min(end,s.endBeat);
      if(endBeat>startBeat) result.push({...s,id:`${s.id}-gap-${result.length}`,startBeat,endBeat});
    }
  };
  for(const s of sorted) {
    if(s.startBeat>=durationBeats)break;
    if(s.startBeat>cursor) {
      if(cursor===0) result.push({id:"source-lead-in",label:"Lead-in · estimated",startBeat:0,endBeat:s.startBeat,type:"intro",evidence:"estimated"});
      else fill(s.startBeat);
    }
    result.push({...s,endBeat:Math.min(s.endBeat,durationBeats)});
    cursor=Math.min(s.endBeat,durationBeats);
  }
  if(cursor<durationBeats)fill(durationBeats);
  return result.length?result:[...fallback];
}
