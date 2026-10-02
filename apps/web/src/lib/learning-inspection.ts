import {measurePlayability} from "@keyspilli/midi";
import {playbackMeasures,measureIndexAtBeat,type SongData} from "@keyspilli/player-core";

export function inspectLearningLevels(levels:readonly {difficulty:string;data:SongData|null}[]) {
 let previous: {bars:ReturnType<typeof playbackMeasures>;signatures:string[]}|null=null;
 return levels.map(({difficulty,data})=>{
  if(!data){previous=null;return {difficulty,available:false as const};}
  const metrics=measurePlayability(data.notes,data.tempoBpm),bars=playbackMeasures(data);
  const buckets=bars.map(()=>[] as string[]);
  for(const note of data.notes){const index=measureIndexAtBeat(note.start,bars);buckets[index]?.push(JSON.stringify([note.start,note.dur,note.midi,note.hand??null]));}
  const signatures=buckets.map(bucket=>bucket.sort().join("|"));
  const comparable=previous&&JSON.stringify(previous.bars)===JSON.stringify(bars);
  const changed=comparable?signatures.flatMap((signature,index)=>signature!==previous!.signatures[index]?[index+1]:[]):null;
  previous={bars,signatures};
  const hand=(key:"R"|"L")=>({onsets:metrics.hands[key].onsetCount,maxChordSpan:metrics.hands[key].maxChordSpanSemitones,maxSoundingSpan:metrics.hands[key].maxSoundingSpanSemitones,attacksPerSecond:metrics.hands[key].attacksPerSecond});
  return {difficulty,available:true as const,noteCount:metrics.noteCount,unassignedNotes:data.notes.filter(n=>!n.hand).length,hands:{R:hand("R"),L:hand("L")},
   rhythm:{distinctDurations:new Set(data.notes.map(n=>Number(n.dur.toFixed(6)))).size,distinctOnsetFractions:new Set(data.notes.map(n=>Number((n.start%1).toFixed(6)))).size},
   comparison:changed?{changedBarCount:changed.length,changedBars:changed.slice(0,24),truncated:changed.length>24}:null};
 });
}
