import {expect,it} from 'vitest';
import {functionalDegree,validKeyRegions} from '../src/functional-harmony.js';
it('keeps borrowed/slash degrees derived and keys explicit across bounded modulation regions',()=>{
 expect(functionalDegree('C/E','C')).toEqual({roman:'I/III',nashville:'1/3',chromatic:false});
 expect(functionalDegree('Bb','C')).toEqual({roman:'♭VII',nashville:'♭7',chromatic:true});
 expect(functionalDegree('C','A minor')?.roman).toBe('III');expect(functionalDegree('Bm7','D')?.roman).toBe('vi7');
 for(const key of [null,'unknown','C7'])expect(functionalDegree('C',key)).toBeNull();
 for(const chord of ['N.C.','?','unsupported'])expect(functionalDegree(chord,'C')).toBeNull();
 const regions=[{startBeat:0,endBeat:4,key:'C'},{startBeat:4,endBeat:8,key:'D'}];expect(validKeyRegions(regions,8)).toBe(true);
 expect(functionalDegree('D',regions[0]!.key)?.roman).toBe('II');expect(functionalDegree('D',regions[1]!.key)?.roman).toBe('I');
 expect(validKeyRegions([{...regions[0],endBeat:5},regions[1]],8)).toBe(false);expect(validKeyRegions([{...regions[0],key:'unknown'}],8)).toBe(false);
});
