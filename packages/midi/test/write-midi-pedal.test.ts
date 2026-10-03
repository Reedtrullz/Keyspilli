import {expect,it} from 'vitest';
import {writeMidi} from '../src/writeMidi.js';
import {parseMidi} from '../src/parse.js';
it('writes explicit bounded CC64 without stretching the physical key interval',()=>{
 const notes=[{midi:60,start:0,dur:1,vel:71}],pedalChanges=[{beat:0,channel:0,value:127},{beat:4,channel:0,value:0}],bytes=writeMidi(notes,{tempoBpm:120,tracks:[{name:'Performed take',notes,channel:0}],pedalChanges});
 expect(parseMidi(bytes).notes.map(n=>[n.midi,n.start,n.dur,n.vel])).toEqual([[60,0,1,71]]);
 const hex=Buffer.from(bytes).toString('hex');expect(hex).toContain('b0407f');expect(hex).toContain('b04000');
 for(const changed of [{beat:NaN,channel:0,value:0},{beat:0,channel:16,value:0},{beat:0,channel:0,value:128}])expect(()=>writeMidi(notes,{tempoBpm:120,pedalChanges:[changed]})).toThrow(/pedal/);
 expect(()=>writeMidi(notes,{tempoBpm:120,pedalChanges:Array.from({length:4097},()=>pedalChanges[0]!)})).toThrow(/pedal/);
});
