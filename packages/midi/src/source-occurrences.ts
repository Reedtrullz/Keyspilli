import type {MeasureInfo} from './types.js';
export const SOURCE_OCCURRENCES = 'keyspilli-source-measures-v1';
/** A bounded provenance map, never evidence of authorship or musical acceptance. */
export function readSourceOccurrences(text:string):MeasureInfo[] {
 if(text.length>262144)throw new Error('source occurrence map exceeds bounds');
 const rows:unknown=JSON.parse(text);
 if(!Array.isArray(rows)||!rows.length||rows.length>2048)throw new Error('invalid source occurrence map');
 let end=0;const seen=new Map<number,number>();
 const measures=rows.map((row,index)=>{
  if(!Array.isArray(row)||row.length!==4)throw new Error('invalid source occurrence map');
  const [sourceMeasureIndex,sourceOccurrence,startBeat,endBeat]=row;
  if(!Number.isInteger(sourceMeasureIndex)||sourceMeasureIndex<0||sourceMeasureIndex>=2048||![1,2].includes(sourceOccurrence)
   ||sourceOccurrence!==(seen.get(sourceMeasureIndex)??0)+1||!Number.isFinite(startBeat)||Math.abs(startBeat-end)>1e-9||!Number.isFinite(endBeat)||endBeat<=startBeat||endBeat>4096)throw new Error('invalid source occurrence map');
  seen.set(sourceMeasureIndex,sourceOccurrence);end=endBeat;
  return {index,sourceMeasureIndex,sourceOccurrence:sourceOccurrence as 1|2,startBeat,endBeat};
 });
 const second=measures.findIndex(m=>m.sourceOccurrence===2);
 if(second<1 || measures.length<second*2)throw new Error('unsupported source occurrence order');
 for(let i=0;i<measures.length;i++){
  const expected=i<second?i:i-second;
  const pass=i<second||i>=second*2?1:2;
  const m=measures[i]!;
  if(m.sourceMeasureIndex!==expected||m.sourceOccurrence!==pass || pass===2&&Math.abs((m.endBeat-m.startBeat)-(measures[expected]!.endBeat-measures[expected]!.startBeat))>1e-9)throw new Error('unsupported source occurrence order');
 }
 return measures;
}
export function writeSourceOccurrences(measures:readonly MeasureInfo[]):string|null {
 if(!measures.some(m=>m.sourceOccurrence!==undefined||m.sourceMeasureIndex!==undefined))return null;
 const text=JSON.stringify(measures.map(m=>[m.sourceMeasureIndex,m.sourceOccurrence,m.startBeat,m.endBeat]));readSourceOccurrences(text);return text;
}
