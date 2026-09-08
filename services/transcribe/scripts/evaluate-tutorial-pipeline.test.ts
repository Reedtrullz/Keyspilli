import {test,expect} from 'vitest';
import {score,noteHash,retryAfterMs,matchesIdentity,selectSources,verifyCandidate} from './evaluate-tutorial-pipeline.js';
test('only the full frozen held-out cohort can pass; musical acceptance stays pending',()=>{
 const rows=Array.from({length:10},(_,i)=>({id:String(i),status:i<8?'structural-candidate':'failed'}));
 const cohort={split:'heldout',frozenHeldoutIds:rows.map(r=>r.id),manifestVerified:true,candidateVerified:true};
 expect(score(rows,10,cohort)).toEqual({completed:8,denominator:10,attempted:10,unattempted:0,failed:2,invalidPublications:0,releaseGate:true,musicalAcceptance:'pending-listening',usable:false});
 expect(score(rows.slice(0,8),10,cohort).releaseGate).toBe(false);
 expect(score(rows.map(r=>({...r,status:'structural-candidate'})),10).releaseGate).toBe(false);
 expect(score(rows,10,{...cohort,manifestVerified:false}).releaseGate).toBe(false);
 expect(score(rows.map(r=>({...r,id:'wrong'})),10,cohort).releaseGate).toBe(false);
 expect(score([{status:'done'},{status:'failed'}],10).completed).toBe(0);
 expect(()=>noteHash(new Uint8Array())).toThrow();
 expect(retryAfterMs('60')).toBe(60000);
 expect(()=>retryAfterMs('3600')).toThrow();
 expect(retryAfterMs('Tue, 08 Sep 2026 00:01:00 GMT',Date.parse('2026-09-08T00:00:00Z'))).toBe(60000);
});

test('identity comparison rejects wrong songs and artists, tolerating punctuation only',()=>{
 expect(matchesIdentity({artist:"Guns N' Roses",title:"Sweet Child O' Mine"},{expectedArtist:'Guns N Roses',expectedTitle:'Sweet Child O Mine'})).toBe(true);
 expect(matchesIdentity({artist:'Nirvana',title:'Come As You Are'},{expectedArtist:'Nirvana',expectedTitle:'Smells Like Teen Spirit'})).toBe(false);
});

test('targeted development reruns and sealed full heldout selection',()=>{
 const sources=[{id:'dev',split:'development'},...Array.from({length:10},(_,i)=>({id:'sealed'+i,split:'heldout'}))];
 expect(selectSources(sources,'ids=dev','development').map(s=>s.id)).toEqual(['dev']);
 expect(()=>selectSources(sources,'ids=sealed0','development')).toThrow();
 expect(()=>selectSources(sources,'ids=sealed0','heldout')).toThrow();
 expect(()=>selectSources(sources,'9','heldout')).toThrow();
 expect(selectSources(sources,'10','heldout')).toHaveLength(10);
 expect(()=>verifyCandidate({a:'old'},{a:'new'})).toThrow();
 expect(()=>verifyCandidate({a:'old'},{a:'old',b:'added'})).toThrow();
 expect(()=>verifyCandidate({a:'old'},{a:'old'})).not.toThrow();
 expect(score([],20)).toMatchObject({attempted:0,unattempted:20,failed:0,releaseGate:false});
 const rows=Array.from({length:10},(_,i)=>({id:String(i),status:'structural-candidate'}));
 expect(score(rows,10,{split:'heldout',manifestVerified:true,frozenHeldoutIds:rows.map(r=>r.id),candidateVerified:false}).releaseGate).toBe(false);
});

test('eight candidates cannot pass when another input published the wrong identity',()=>{
 const rows=Array.from({length:10},(_,i)=>({id:String(i),status:i<8?'structural-candidate':'failed',failureCode:i===8?'WRONG_IDENTITY':'JOB_FAILED'}));
 const cohort={split:'heldout',frozenHeldoutIds:rows.map(r=>r.id),manifestVerified:true,candidateVerified:true};
 expect(score(rows,10,cohort)).toMatchObject({completed:8,invalidPublications:1,releaseGate:false});
 expect(score(rows.map(r=>({...r,failureCode:'OTHER',invalidPublication:r.id==='8'})),10,cohort).releaseGate).toBe(false);
});
