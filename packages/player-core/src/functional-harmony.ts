import {tryParseChordSymbol} from '@keyspilli/midi';
export interface ConfirmedKeyRegion {startBeat:number;endBeat:number;key:string}
function keyContext(key:string) {
 const symbol=tryParseChordSymbol(key.trim().replace(/\s+major$/i,'').replace(/\s+minor$/i,'m'));
 return symbol && ['major','minor'].includes(symbol.quality)?symbol:null;
}
export function validKeyRegions(regions:unknown,endBeat:number):regions is ConfirmedKeyRegion[] {
 return Array.isArray(regions)&&regions.length<=16&&regions.every((r,i)=>r&&typeof r==='object'&&!Array.isArray(r)
  &&Object.keys(r).sort().join(' ')==='endBeat key startBeat'&&Number.isFinite(r.startBeat)&&r.startBeat>=0&&Number.isFinite(r.endBeat)&&r.endBeat>r.startBeat&&r.endBeat<=endBeat
  &&typeof r.key==='string'&&r.key.length<=32&&!!keyContext(r.key)&&(!i||r.startBeat>=regions[i-1].endBeat));
}
/** Scale degrees relative to an explicitly chosen key, not a claim of harmonic function. */
export function functionalDegree(name:string,key:string|null):{roman:string;nashville:string;chromatic:boolean}|null {
 if(!key||name==='N.C.'||name==='?')return null;
 const tonic=keyContext(key),chord=tryParseChordSymbol(name);if(!tonic||!chord)return null;
 const scale=tonic.quality==='minor'?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11];
 const degree=(pc:number)=>{const distance=(pc-tonic.rootPc+12)%12;let index=scale.indexOf(distance),accidental='';
  if(index<0){index=scale.findIndex(p=>p===distance+1);if(index>=0)accidental='♭';else{index=scale.findIndex(p=>p===distance-1);accidental='♯';}}
  return {index,accidental};};
 const root=degree(chord.rootPc),bass=chord.bassPc===undefined?null:degree(chord.bassPc);
 const lower=['minor','m7','m9','madd9','dim'].includes(chord.quality);
 const quality:Record<string,string>={major:'',minor:'','7':'7',maj7:'maj7',m7:'7',m9:'9',madd9:'add9',dim:'°',aug:'+',sus2:'sus2',sus4:'sus4',add9:'add9','5':'5','6':'6'};
 const numeral=['I','II','III','IV','V','VI','VII'][root.index]!;
 return {roman:`${root.accidental}${lower?numeral.toLowerCase():numeral}${quality[chord.quality]}${bass?`/${bass.accidental}${['I','II','III','IV','V','VI','VII'][bass.index]}`:''}`,
  nashville:`${root.accidental}${root.index+1}${lower?'m':''}${quality[chord.quality]}${bass?`/${bass.accidental}${bass.index+1}`:''}`,chromatic:!!root.accidental||!!bass?.accidental};
}
