import { describe, expect, it } from "vitest";
import { buildVariants, midiBeatToNativeSeconds, parseMidi, writeVariantArtifacts, type ParsedMidi } from "../src/index.js";

const mapped = (delayed = false): ParsedMidi => ({
  format: 1, division: 960, tempoBpm: 120, tempoMetaPresent: true,
  tempoEvents: [
    ...(!delayed ? [{tick: 0, beat: 0, microsecondsPerQuarter: 500000, bpm: 120}] : []),
    {tick: 3840, beat: 4, microsecondsPerQuarter: 1000000, bpm: 60},
    {tick: 7680, beat: 8, microsecondsPerQuarter: 400000, bpm: 150},
  ],
  timeSig: [4,4], keySig: 0, keyMode: 0, trackNames: ['piano'], durationBeats: 10,
  notes: [
    {midi:60,start:1,dur:.5,vel:80,hand:'R'},
    {midi:64,start:3.5,dur:1,vel:80,hand:'R'},
    {midi:67,start:5,dur:.5,vel:80,hand:'R'},
    {midi:65,start:6,dur:.75,vel:80,hand:'R'},
    {midi:62,start:8.625,dur:.625,vel:80,hand:'R'},
  ],
});

function constantClock(source: ParsedMidi): ParsedMidi {
  const beat = (value:number) => midiBeatToNativeSeconds(source,value)*2;
  return {...source,tempoEvents:undefined,durationBeats:beat(source.durationBeats),
    notes:source.notes.map(note=>({...note,start:beat(note.start),dur:beat(note.start+note.dur)-beat(note.start)}))};
}

describe('source tempo normalization',()=>{
  for (const delayed of [false,true]) it(`reduces mapped and constant-clock sources identically (delayed first tempo: ${delayed})`,()=>{
    const source=mapped(delayed); const original=structuredClone(source);
    const flat=constantClock(source);
    const options={arrangementProfile:'source' as const,maxDurBeats:null};
    const actual=buildVariants(source,{title:'Clock test',artist:'Synthetic'},options);
    expect(actual).toEqual(buildVariants(flat,{title:'Clock test',artist:'Synthetic'},options));
    expect(source).toEqual(original);
    // These events sit on the reduction grid: serialization itself must add
    // under 1ms drift. General off-grid quantization remains an intentional edit.
    const advanced=actual.find(v=>v.level==='advanced')!;
    const parsed=parseMidi(writeVariantArtifacts(advanced,'Clock test','Synthetic').midi);
    expect(parsed.notes.length).toBe(source.notes.length);
    for(const note of source.notes){
      const output=parsed.notes.find(n=>n.midi===note.midi)!;
      expect(Math.abs(midiBeatToNativeSeconds(parsed,output.start)-midiBeatToNativeSeconds(source,note.start))).toBeLessThanOrEqual(.001);
      expect(Math.abs(midiBeatToNativeSeconds(parsed,output.start+output.dur)-midiBeatToNativeSeconds(source,note.start+note.dur))).toBeLessThanOrEqual(.001);
    }
  });

  it('normalizes supplied chord endpoints and keeps explicit tempo overrides as playback changes',()=>{
    const source=mapped();const flat=constantClock(source);
    const chords=[{beat:3.5,durationBeats:1,name:'C',notes:[60,64,67]}];
    const options={arrangementProfile:'source' as const,maxDurBeats:null,chords};
    const meta={title:'Clock test',artist:'Synthetic',tempo:90};
    expect(buildVariants(source,meta,options)).toEqual(buildVariants(flat,meta,{
      ...options,chords:[{...chords[0]!,beat:3.5,durationBeats:1.5}],
    }));
    expect(chords[0]!.durationBeats).toBe(1);
  });
});
