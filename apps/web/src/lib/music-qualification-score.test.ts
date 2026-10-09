import { it,expect } from 'vitest';
import { makePlayerInputQualification } from './player-input-qualification.js';
import { scorePlayerQualification, validateQualificationResultBindings } from './music-qualification-score.js';
import { receipt } from './player-review-fixtures.js';
it('unrun cases cannot pass and wrong accepted sets fail',()=>{const answers=makePlayerInputQualification(610672).answers;expect(scorePlayerQualification([],answers).status).toBe('incomplete');const r=scorePlayerQualification([{id:answers[0]!.id,receipt:receipt()}],answers);expect(r.rows[0]!.acceptedWrong).toBe(true);expect(r.productionAdmission).toBe(false);});
it('rejects duplicate and foreign receipts before scoring',()=>{const answers=makePlayerInputQualification(610672).answers;expect(()=>scorePlayerQualification([{id:'foreign',receipt:receipt()}],answers)).toThrow();});

it('an excessive measured RSS fails an otherwise complete screen',()=>{const answers=makePlayerInputQualification(610674).answers;const receipts=answers.map(a=>({id:a.id,receipt:{...receipt(),status:a.group==='refusal'?'uncertain' as const:'matched' as const,historyPitchCandidates:a.group==='refusal'?null:a.expected,resources:{elapsedSeconds:1,peakRssBytes:2147483649}}}));expect(()=>scorePlayerQualification(receipts,answers)).toThrow('unbounded resources');});

it('refuses source, analyzer and capture drift before answer scoring',()=>{const r=receipt(),freeze={analyzerSha256:'d'.repeat(64),referenceBankSha256:'e'.repeat(64),fingerprints:{solver:'a'.repeat(64)}},current={solver:'a'.repeat(64)},rows=[{id:'case',receipt:r}],pins={case:{captureSha256:r.captureSha256,inputSha256:r.inputSha256}};expect(()=>validateQualificationResultBindings(freeze,current,rows,pins)).not.toThrow();expect(()=>validateQualificationResultBindings(freeze,{solver:'b'.repeat(64)},rows,pins)).toThrow('source changed');expect(()=>validateQualificationResultBindings(freeze,current,[{id:'case',receipt:{...r,analyzerSha256:'c'.repeat(64)}}],pins)).toThrow('analyzer/bank');expect(()=>validateQualificationResultBindings(freeze,current,rows,{case:{...pins.case,captureSha256:'c'.repeat(64)}})).toThrow('capture changed');});

it('qualification requires a supported policy binding for matched receipts',()=>{const r=receipt(),freeze={analyzerSha256:'d'.repeat(64),referenceBankSha256:'e'.repeat(64),fingerprints:{solver:'a'.repeat(64)}},current={solver:'a'.repeat(64)},pins={case:{captureSha256:r.captureSha256,inputSha256:r.inputSha256}};expect(()=>validateQualificationResultBindings(freeze,current,[{id:'case',receipt:{...r,support:{...r.support!,status:'ambiguous'}}}],pins)).toThrow(/supported/);expect(()=>validateQualificationResultBindings(freeze,current,[{id:'case',receipt:{...r,support:undefined}}],pins)).toThrow(/supported/);});

it('scores end-to-end batch resources and refuses incomplete resource coverage',()=>{
  const answers=makePlayerInputQualification(610675).answers;
  const receipts=answers.map(a=>({id:a.id,receipt:{...receipt(),status:a.group==='refusal'?'uncertain' as const:'matched' as const,historyPitchCandidates:a.group==='refusal'?null:a.expected,resources:{elapsedSeconds:1,peakRssBytes:1024}}}));
  const cases=answers.map((a,i)=>({id:a.id,status:'complete' as const,wallSeconds:i<4?30:1,peakRssBytes:2048,exitCode:0,requestSha256:'a'.repeat(64),receiptPath:'/fixture/receipt.json',receiptSha256:'b'.repeat(64),error:''}));
  const resources={schemaVersion:1 as const,kind:'keyspilli-player-batch-resources' as const,cases};
  const scored=scorePlayerQualification(receipts,answers,resources);
  expect(scored.p95Seconds).toBe(30);
  expect(scored.peakRssBytes).toBe(2048);
  expect(scored.resourceCoverage).toEqual({cases:72,complete:72});
  expect(()=>scorePlayerQualification(receipts,answers,{...resources,cases:cases.slice(0,71)})).toThrow(/resource inventory/);
});
