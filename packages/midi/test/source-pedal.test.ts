import {expect,it} from 'vitest';
import {parseMidi,writeMidi,writeVariantArtifacts,validateArtifactFiles,parseMusicXmlNotes,sourcePedalEnd,sourcePedalErrors,validSourcePedal,buildShortStudyVariants,selectSourceParts,type Variant} from '../src/index.js';
const notes=[{midi:60,start:0,dur:1,vel:71,hand:'R' as const,sourceMidiChannel:2},{midi:60,start:.5,dur:2,vel:80,hand:'L' as const,sourceMidiChannel:3},{midi:60,start:2,dur:1,vel:90,hand:'R' as const,sourceMidiChannel:2}];
const sourcePedal={version:1 as const,endBeat:6,provenance:'midi-file' as const,changes:[{beat:0,channel:2,value:127,source:'midi:0'},{beat:4,channel:2,value:0,source:'midi:0'},{beat:5,channel:3,value:127,source:'midi:1'}]};
const variant:Variant={level:'advanced',difficultyScore:4.6,notes,chords:[],bassPattern:'none',key:'C',tempoBpm:120,timeSig:[4,4],measures:[{index:0,startBeat:0,endBeat:4},{index:1,startBeat:4,endBeat:8}],sourcePedal};
it('retains source CC64 and channel identities through both artifacts without changing key releases',()=>{
 const original=structuredClone(variant),artifacts=writeVariantArtifacts(variant,'Pedal study','Owner');expect(validateArtifactFiles(variant,artifacts)).toEqual([]);expect(variant).toEqual(original);
 for(const parsed of [parseMidi(artifacts.midi),parseMusicXmlNotes(artifacts.xml)]){expect(parsed.sourcePedal?.endBeat).toBe(6);expect(parsed.notes.map(n=>[n.start,n.dur,n.sourceMidiChannel])).toEqual([[0,1,2],[.5,2,3],[2,1,2]]);expect(parsed.notes.map(n=>sourcePedalEnd(n,parsed.sourcePedal!))).toEqual([4,2.5,4]);}
 const changed=artifacts.xml.replace('&quot;value&quot;:127','&quot;value&quot;:0');expect(validateArtifactFiles(variant,{...artifacts,xml:changed}).join(' ')).toContain('pedal events differ');
 const midi=writeMidi(notes,{tempoBpm:120,sourcePedal:{...sourcePedal,changes:sourcePedal.changes.slice(1)}});expect(validateArtifactFiles(variant,{...artifacts,midi}).join(' ')).toContain('pedal events differ');
});
it('keeps missing-up resonance bounded by file end, rejects ambiguous ordering and documents omitted foreign directions',()=>{
 const bytes=writeMidi([notes[0]!],{tempoBpm:120,sourcePedal:{...sourcePedal,changes:sourcePedal.changes.slice(0,1)}}),parsed=parseMidi(bytes);expect(parsed.notes[0]!.dur).toBe(1);expect(selectSourceParts(parsed,[parsed.sourceParts![0]!.id]).durationBeats).toBe(6);expect(sourcePedalEnd(parsed.notes[0]!,parsed.sourcePedal!)).toBe(6);
 expect(sourcePedalErrors(notes,{...sourcePedal,changes:[{...sourcePedal.changes[0]!,beat:1}]}).join(' ')).toContain('coincides');
 expect(sourcePedalErrors([...notes,{...notes[0]!,start:.2}],sourcePedal).join(' ')).toContain('Overlapping');
 expect(validSourcePedal({...sourcePedal,changes:[sourcePedal.changes[0]!,{...sourcePedal.changes[0]!,value:0,source:'midi:1'}]})).toBe(false);
 expect(validSourcePedal({...sourcePedal,changes:Array(4097).fill(sourcePedal.changes[0])})).toBe(false);
 const xml=writeVariantArtifacts({...variant,sourcePedal:undefined},'Plain','Owner').xml.replace('<part id="P1">','<part id="P1"><direction><direction-type><pedal type="start"/></direction-type></direction>');expect(parseMusicXmlNotes(xml).unsupportedControls).toContain('MusicXML pedal directions without a channel-bound controller timeline');
});
it('integrates source tempo changes for pedal and key clocks together in exact short studies',()=>{
 const parsed=parseMidi(writeVariantArtifacts({...variant,notes:[{...notes[0]!,dur:3}]},'Study','Owner').midi);parsed.tempoEvents=[{tick:0,beat:0,microsecondsPerQuarter:500000,bpm:120},{tick:960,beat:2,microsecondsPerQuarter:1000000,bpm:60}];
 const variants=buildShortStudyVariants(parsed,{title:'Study',artist:'Owner',key:'C'});expect(variants.length).toBeGreaterThan(0);for(const v of variants){expect(v.sourcePedal?.endBeat).toBe(10);expect(v.sourcePedal?.changes[1]!.beat).toBe(6);expect(v.notes[0]!.dur).toBe(4);expect(validateArtifactFiles(v,writeVariantArtifacts(v,'Study','Owner'))).toEqual([]);}
});
