#!/usr/bin/env node
/** Offline chart-to-arrangement candidate alignment. Never writes the catalog. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { chordPitchClasses, parseChordSymbol, parseMidi, type MeasureInfo, type Note, type Section } from "@keyspilli/midi";
import type { ExtractedChart } from "./extract-ug-sections.js";

export interface HarmonyMeasure extends MeasureInfo {
  vector: number[];
  bass: number[];
  density: number;
  soundingPitchClasses: number[];
  lowestPitchClass: number | null;
}
interface Path { cost: number; ends: number[] }
export interface Landmark {
  label: string;
  startBar: number;
  endBar: number; // exclusive, zero based
  basis: string;
}
export interface AlignmentResult {
  phraseBars: 4 | 8;
  sections: Section[];
  publishableSections: Section[];
  boundaryGaps: (number | null)[];
  totalCost: number;
  ambiguityGap: number | null;
  confidenceScore: number;
  publishable: boolean;
  alternatives: { totalCost: number; boundaries: number[] }[];
  phrases: { startBeat: number; endBeat: number; vector: number[]; density: number }[];
  landmarks: { label: string; matched: boolean; basis: string; sectionId: string | null }[];
  sectionScores: {sectionId:string;confidenceScore:number;startGap:number|null;endGap:number|null}[];
  rationale: string[];
}
const pc = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;

// These chart spellings are only needed for offline comparison; extending
// them here does not change the playback chord parser or voicing contract.
function alignmentHarmony(name: string, transpose: number): {tones:Set<number>;root:number} {
  const extension = name.match(/^([A-Ga-g](?:#|b|♯|♭)?)(m7b5|dim7|7sus4|\(b5\))(\/[A-Ga-g](?:#|b|♯|♭)?)?$/);
  if (!extension) {
    const parsed = parseChordSymbol(name, {transpose});
    return {tones:new Set(chordPitchClasses(parsed)),root:parsed.bassPc??parsed.rootPc};
  }
  const parsed = parseChordSymbol(extension[1]! + (extension[3]??""), {transpose});
  const intervals:Record<string,number[]> = {m7b5:[0,3,6,10],dim7:[0,3,6,9],"7sus4":[0,5,7,10],"(b5)":[0,4,6]};
  const tones = new Set(intervals[extension[2]!]!.map(interval=>pc(parsed.rootPc+interval)));
  if (parsed.bassPc!==undefined) tones.add(parsed.bassPc);
  return {tones,root:parsed.bassPc??parsed.rootPc};
}

/** Same onset, upper-register and density features as inferSongForm; bass is
 * the lowest simultaneous onset, not an asserted instrument/hand identity. */
export function analyzeArrangement(notes: readonly Note[], measures: readonly MeasureInfo[]): HarmonyMeasure[] {
  if (!measures.length || measures.length > 512) throw new Error("Expected 1-512 measures");
  let previousEnd = -Infinity;
  for (const bar of measures) {
    if (!Number.isFinite(bar.startBeat) || !Number.isFinite(bar.endBeat) || bar.startBeat < 0 || bar.endBeat <= bar.startBeat ||
      (previousEnd !== -Infinity && Math.abs(bar.startBeat - previousEnd) > 1e-6)) throw new Error("Invalid or noncontiguous measure clock");
    previousEnd = bar.endBeat;
  }
  if (notes.some(n => !Number.isFinite(n.start) || n.start < 0 || !Number.isFinite(n.dur) || n.dur <= 0 || !Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127)) {
    throw new Error("Invalid note onset or MIDI pitch");
  }
  const ordered = notes.slice().sort((a, b) => a.start - b.start || a.midi - b.midi);
  let cursor = 0;
  return measures.map(bar => {
    const vector = Array<number>(24).fill(0), bass = Array<number>(12).fill(0);
    let count = 0, lastOnset = -Infinity;
    while (cursor < ordered.length && ordered[cursor]!.start < bar.startBeat) cursor++;
    while (cursor < ordered.length && ordered[cursor]!.start < bar.endBeat) {
      const note = ordered[cursor++]!, pitch = pc(note.midi);
      vector[pitch]!++;
      if (note.hand !== "L" && note.midi >= 60) vector[12 + pitch]!++;
      if (Math.abs(note.start - lastOnset) > 1e-6) { bass[pitch]!++; lastOnset = note.start; }
      count++;
    }
    const sounding = ordered.filter(n => n.start < bar.endBeat && n.start + n.dur > bar.startBeat);
    return { ...bar, vector, bass, density: count / (bar.endBeat - bar.startBeat),
      soundingPitchClasses: [...new Set(sounding.map(n => pc(n.midi)))],
      lowestPitchClass: sounding.length ? pc(Math.min(...sounding.map(n => n.midi))) : null,
    };
  });
}
function sectionType(label: string): Section["type"] {
  if (/pre[- ]?chorus/i.test(label)) return "pre-chorus";
  if (/chorus|refrain/i.test(label)) return "chorus";
  if (/verse/i.test(label)) return "verse";
  if (/bridge/i.test(label)) return "bridge";
  if (/intro|opening/i.test(label)) return "intro";
  if (/outro|coda|ending/i.test(label)) return "outro";
  if (/solo|instrumental|interlude|break/i.test(label)) return "interlude";
  return "custom";
}

/** Score each measure against the section's chord set; the ordered DP assigns
 * whole phrases, not individual chords. Costs sum eight-bar-equivalent means,
 * so an alternative's gap is in assignment-cost units (not a probability). */
export function alignChartSections(chart: ExtractedChart, bars: readonly HarmonyMeasure[], options: {
  transpose?: number; landmarks?: readonly Landmark[]; phraseBars?: 4 | 8;
} = {}): AlignmentResult {
  if (!bars.length || bars.length > 512) throw new Error("Expected 1-512 measures");
  const phraseBars = options.phraseBars ?? 8;
  if (phraseBars !== 4 && phraseBars !== 8) throw new Error("Expected a four- or eight-bar phrase grid");
  const phraseCount = Math.ceil(bars.length / phraseBars), sectionCount = chart.sections.length;
  if (phraseCount > 64) throw new Error("Alignment exceeds the bounded 64 phrases");
  if (chart.source !== "ultimate-guitar" || !Number.isInteger(chart.tabId) || chart.tabId! <= 0) throw new Error("Invalid chart identity");
  if (chart.sections.length > 32) throw new Error("Chart exceeds the bounded 32-section alignment limit");
  if (!sectionCount || sectionCount > phraseCount) throw new Error(`Chart has more sections than ${phraseBars}-bar phrases or is empty`);
  const transpose = options.transpose ?? 0;
  if (!Number.isInteger(transpose) || Math.abs(transpose) > 11) throw new Error("Invalid chart transpose");
  const chords = chart.sections.map(section => {
    if (!section.label.trim() || /^Section\s+\d+$/i.test(section.label.trim())) throw new Error("Expected a named chart section");
    if (!section.chords.length) throw new Error(`No chords in ${section.label}`);
    return [...new Set(section.chords)].map(name => alignmentHarmony(name, transpose));
  });
  const phrases = Array.from({ length: phraseCount }, (_, index) => {
    const run = bars.slice(index * phraseBars, (index + 1) * phraseBars), vector = Array<number>(24).fill(0);
    for (const bar of run) for (let i = 0; i < 24; i++) vector[i]! += bar.vector[i]!;
    const startBeat = run[0]!.startBeat, endBeat = run.at(-1)!.endBeat;
    return { startBeat, endBeat, vector, density: vector.slice(0, 12).reduce((a,b)=>a+b,0) / (endBeat-startBeat) };
  });
  const prefixes = chords.map(set => {
    const prefix = [0];
    for (const bar of bars) {
      const sounding = new Set(bar.soundingPitchClasses);
      const cost = sounding.size ? Math.min(1, ...set.map(chord => {
        const overlap = [...sounding].filter(tone => chord.tones.has(tone)).length;
        const union = new Set([...sounding, ...chord.tones]).size;
        return 1 - overlap/union + (bar.lowestPitchClass === chord.root ? 0 : .30);
      })) : .35;
      // A four-bar mean weighs half an eight-bar mean; keep the 0.15 gap
      // threshold in the existing units. Partial tails keep that grid weight.
      const runBars = Math.min(phraseBars, bars.length - Math.floor((prefix.length-1)/phraseBars)*phraseBars);
      prefix.push(prefix.at(-1)! + cost/runBars * phraseBars/8);
    }
    return prefix;
  });
  function solve(exclude?: { boundary: number; phrase: number }): Path[] {
    const dp: Path[][][] = Array.from({length:sectionCount+1},()=>Array.from({length:phraseCount+1},()=>[]));
    dp[0]![0] = [{ cost: 0, ends: [] }];
    for (let section = 1; section <= sectionCount; section++) {
      for (let end = section; end <= phraseCount - (sectionCount-section); end++) {
        if (exclude?.boundary === section && exclude.phrase === end) continue;
        const candidates: Path[] = [];
        for (let start = section - 1; start < end; start++) {
          const lo = start*phraseBars, hi = Math.min(end*phraseBars,bars.length), prefix = prefixes[section-1]!;
          const cost = prefix[hi]! - prefix[lo]!;
          for (const previous of dp[section-1]![start]!) candidates.push({cost:previous.cost+cost,ends:[...previous.ends,end]});
        }
        candidates.sort((a,b)=>a.cost-b.cost || a.ends.join(",").localeCompare(b.ends.join(",")));
        dp[section]![end] = candidates.slice(0, 2);
      }
    }
    return dp[sectionCount]![phraseCount]!;
  }
  const solutions = solve(), best = solutions[0]!;
  if (!best) throw new Error("No complete ordered phrase assignment");
  // Re-solve globally with each chosen boundary forbidden. Unlike sampling
  // only a few paths, this proves separation for every interior boundary.
  const boundaryAlternatives = best.ends.slice(0,-1).map((phrase,index)=>solve({boundary:index+1,phrase})[0]);
  const boundaryGaps = [null, ...boundaryAlternatives.map(path=>path?Math.max(0,path.cost-best.cost):0), null];
  const gap = solutions[1] ? Math.max(0,solutions[1].cost-best.cost) : null;
  let start = 0;
  const sections: Section[] = best.ends.map((end,index) => {
    const section = {id:`chart-section-${index+1}`,label:chart.sections[index]!.label,type:sectionType(chart.sections[index]!.label),
      startBeat:phrases[start]!.startBeat,endBeat:phrases[end-1]!.endBeat,evidence:"chart" as const};
    start = end; return section;
  });
  const landmarks = (options.landmarks ?? []).map(landmark => {
    const valid = Number.isInteger(landmark.startBar) && Number.isInteger(landmark.endBar) && landmark.endBar > landmark.startBar &&
      landmark.startBar >= 0 && landmark.endBar <= bars.length && typeof landmark.basis === "string" && Boolean(landmark.basis.trim());
    const section = valid ? sections.find(s=>s.label===landmark.label && s.startBeat===bars[landmark.startBar]?.startBeat && s.endBeat===bars[landmark.endBar-1]?.endBeat) : undefined;
    return {label:landmark.label,basis:landmark.basis,matched:Boolean(section),sectionId:section?.id??null};
  });
  const fit = Math.max(0, 1-best.cost/(phraseCount*phraseBars/8));
  const fullConfidence = fit * (gap === null ? 0 : Math.min(1,gap/.15));
  const publishableSections = sections.filter((section,index)=>{
    const before = boundaryGaps[index], after = boundaryGaps[index+1];
    const lo = (index===0?0:best.ends[index-1]!)*phraseBars, hi = Math.min(best.ends[index]!*phraseBars,bars.length);
    const fit = 1-(prefixes[index]![hi]!-prefixes[index]![lo]!)/((best.ends[index]!-(index===0?0:best.ends[index-1]!))*phraseBars/8);
    return gap !== null && (before === null || before! >= .15) && (after === null || after! >= .15) && fit >= .35 &&
      landmarks.some(l=>l.matched && l.sectionId===section.id) && landmarks.every(l=>l.matched);
  });
  const sectionScores = sections.map((section,index)=>{
    const before = boundaryGaps[index], after = boundaryGaps[index+1];
    const lo = (index===0?0:best.ends[index-1]!)*phraseBars, hi = Math.min(best.ends[index]!*phraseBars,bars.length);
    const fit = Math.max(0,1-(prefixes[index]![hi]!-prefixes[index]![lo]!)/((best.ends[index]!-(index===0?0:best.ends[index-1]!))*phraseBars/8));
    const separation = gap===null ? 0 : Math.min(1,Math.min(before??Infinity,after??Infinity)/.15);
    return {sectionId:section.id,confidenceScore:fit*separation,startGap:before!,endGap:after!};
  });
  const confidenceScore = publishableSections.length ? Math.min(...sectionScores.filter(s=>publishableSections.some(p=>p.id===s.sectionId)).map(s=>s.confidenceScore)) : fullConfidence;
  const publishable = publishableSections.length > 0;
  const alternativePaths = [...solutions.slice(1),...boundaryAlternatives.filter((p):p is Path=>Boolean(p))];
  const unique = [...new Map(alternativePaths.map(p=>[p.ends.join(","),p])).values()].sort((a,b)=>a.cost-b.cost);
  return {phraseBars,sections,publishableSections,boundaryGaps,sectionScores,totalCost:best.cost,ambiguityGap:gap,confidenceScore,publishable,phrases,landmarks,
    alternatives:unique.map(p=>({totalCost:p.cost,boundaries:[0,...p.ends].map(i=>i===phraseCount?bars.at(-1)!.endBeat:phrases[i]!.startBeat)})),
    rationale:[`${phraseCount} ${phraseBars}-bar phrases; ${sectionCount} ordered nonempty section runs; total cost ${best.cost.toFixed(6)}.`,
      `Next-best gap ${gap===null?"unavailable":gap.toFixed(6)}; ambiguity threshold 0.15 eight-bar-equivalent assignment-cost units.`,
      `Chart transpose ${transpose} semitones; confidence ${confidenceScore.toFixed(4)} is uncalibrated algorithmic separation, not musical acceptance.`,
      `${landmarks.filter(l=>l.matched).length}/${landmarks.length} independent landmarks match; ${publishable?"candidate eligible for review":"keep estimate-only"}.`],
  };
}

function main(): void {
  const [chartFile, midiFile, notesFile, baseId, sourceUrl, identityFile, landmarkFile, transposeText, phraseBarsText] = process.argv.slice(2);
  if (!chartFile || !midiFile || !notesFile || !baseId || !sourceUrl || !identityFile) throw new Error("Usage: align-chart-sections <chart.json> <seed.mid> <notes.json> <baseId> <chart-url> <identity.json> [landmarks.json] [transpose] [phraseBars]");
  const phraseBars = phraseBarsText===undefined?8:Number(phraseBarsText);
  if (phraseBars!==4 && phraseBars!==8) throw new Error("Expected a four- or eight-bar phrase grid");
  if (!/^https:\/\/tabs\.ultimate-guitar\.com\/tab\//.test(sourceUrl) || !/^[a-z0-9-]+$/.test(baseId)) throw new Error("Invalid base id or chart URL");
  const midiBytes = readFileSync(midiFile), parsed = parseMidi(midiBytes);
  if (!parsed.notes.length) throw new Error("Seed MIDI has no pitched notes");
  const chartBytes = readFileSync(chartFile), notesBytes = readFileSync(notesFile);
  const chart = JSON.parse(chartBytes.toString()) as ExtractedChart;
  const data = JSON.parse(notesBytes.toString()) as {notes:Note[];measures:MeasureInfo[];tempoBpm:number;provenance?:{sourceRef?:string}};
  if (!Number.isFinite(data.tempoBpm) || data.tempoBpm <= 0) throw new Error("Invalid playback tempo");
  const sha = (bytes:Buffer) => createHash("sha256").update(bytes).digest("hex");
  const identityBytes=readFileSync(identityFile);
  const identity=JSON.parse(identityBytes.toString()) as {
    baseId:string;sourceArtifactHash:string;notesSha256:string;chartSha256:string;chartUrl:string;
    playbackTempoBpm:number;sourceRef:string;notesOrigin:"production"|"local";
  };
  if (identity.baseId!==baseId || identity.sourceArtifactHash!==sha(midiBytes) || identity.sourceRef!==`seed:${basename(midiFile)}` ||
    !["production","local"].includes(identity.notesOrigin)) throw new Error("Seed/base identity receipt mismatch");
  if (identity.notesSha256!==sha(notesBytes) || identity.playbackTempoBpm!==data.tempoBpm || data.provenance?.sourceRef!==identity.sourceRef) {
    throw new Error("Notes identity receipt mismatch");
  }
  const urlTabId=sourceUrl.match(/-([0-9]+)$/)?.[1];
  if (identity.chartSha256!==sha(chartBytes) || identity.chartUrl!==sourceUrl || chart.source!=="ultimate-guitar" ||
    !urlTabId || chart.tabId!==Number(urlTabId)) throw new Error("Chart identity receipt mismatch");
  const result = alignChartSections(chart, analyzeArrangement(data.notes,data.measures), {
    landmarks:landmarkFile?JSON.parse(readFileSync(landmarkFile,"utf8")) as Landmark[]:[],
    transpose:transposeText===undefined?0:Number(transposeText),
    phraseBars,
  });
  const candidate = {baseId,sourceArtifactHash:sha(midiBytes),playbackTempoBpm:data.tempoBpm,sourceFile:basename(midiFile),
    ...(identity.notesOrigin==="production"?{advancedNotesSha256:sha(notesBytes)}:{}),
    provenance:`Labels from ${sourceUrl}; boundaries aligned to arrangement harmony. Not timed source markers, recording timestamps, or an official artist form annotation. Not auditioned; no musical acceptance established.`,
    alignment:{strategy:phraseBars===4?"ordered-four-bar-harmony-v1":"ordered-eight-bar-harmony-v1",phraseBars,confidenceScore:result.confidenceScore,totalCost:result.totalCost,
      ambiguityGap:result.ambiguityGap,boundaryGaps:result.boundaryGaps,chartSha256:sha(chartBytes),alignmentNotesSha256:sha(notesBytes),identityReceiptSha256:sha(identityBytes),notesOrigin:identity.notesOrigin,sectionScores:result.sectionScores,transpose:transposeText===undefined?0:Number(transposeText),landmarks:result.landmarks},
    sections:result.publishableSections};
  process.stderr.write(result.rationale.join("\n")+"\n");
  process.stdout.write(JSON.stringify({candidate,...result},null,2)+"\n");
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { main(); } catch(error) { process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`); process.exitCode=1; }
}
