/** Self-authored controlled cases only. Answers are separated from fitter requests. */
export function makePlayerInputQualification(seed:number){
 if(!Number.isSafeInteger(seed)||seed<0)throw Error('nonnegative seed required');let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 const pitches=Array.from({length:88},(_,i)=>21+i);for(let i=87;i>0;i--){const j=Math.floor(random()*(i+1));[pitches[i],pitches[j]]=[pitches[j]!,pitches[i]!];}
 const answers:Array<{id:string;group:'core'|'quiet'|'repeat'|'refusal';expected:number[];control:string;events:Array<{midi:number;start:number;dur:number;vel:number;hand:'R'}>}>=[];
 const add=(group:typeof answers[number]['group'],events:typeof answers[number]['events'],control='none')=>{const id=`q-${group}-${String(answers.filter(x=>x.group===group).length).padStart(2,'0')}`;answers.push({id,group,expected:[...new Set(events.map(e=>e.midi))].sort((a,b)=>a-b),control,events:events.sort((a,b)=>a.start-b.start)});};
 for(let i=0;i<32;i++)add('core',Array.from({length:3},(_,j)=>({midi:pitches[(i*3+j)%88]!,start:2*(.13+j*.2),dur:2*(j===2?.15:1),vel:[56,76,112][j]!,hand:'R' as const})));
 for(let i=0;i<16;i++)add('quiet',[{midi:36+i,start:.25,dur:1.8,vel:92,hand:'R'},{midi:64+i,start:.67,dur:1.2,vel:8,hand:'R'}]);
 for(let i=0;i<12;i++)add('repeat',[{midi:40+i*3,start:.14,dur:.18,vel:76,hand:'R'},{midi:40+i*3,start:.72,dur:.3,vel:56,hand:'R'},{midi:63+i,start:1.12,dur:.22,vel:92,hand:'R'}]);
 for(const control of ['silence','below-level','missing-input','stale-identity','unsupported-profile','final-output-domain'])for(let i=0;i<2;i++)add('refusal',control==='silence'?[]:[{midi:60+i,start:.3,dur:1,vel:control==='below-level'?1:76,hand:'R'}],control);
 const fixtures=answers.map(a=>({id:'blind-'+a.id,title:'Self authored Player qualification',data:{notes:a.events,tempoBpm:120,key:'C',timeSig:[4,4],chords:[],measures:[{index:0,startBeat:0,endBeat:8}],sections:[{id:'phrase',label:'Control',startBeat:0,endBeat:8}]}}));
 const captures=Object.fromEntries(answers.map(a=>[a.id,{songId:'blind-'+a.id+'-m',mode:'original',durationMs:1800,capturePreCompressor:true,...(a.control==='silence'?{signalControl:'silence' as const}:a.control==='below-level'?{signalControl:'below-level' as const}:{}),expectedAttackSeconds:a.events.map(e=>e.start/2),expectedAttackSecondsByBus:{voice:a.events.map(e=>e.start/2),backing:[]}}]));return {schemaVersion:1 as const,kind:'controlled-player-input-qualification',seed,answers,bundle:{fixtures,captures}};
}
