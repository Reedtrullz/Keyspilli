import { assertMusic } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { parsePlayerInputEvidence,type PlayerInputEvidenceReceiptV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
export interface QualificationAnswer {id:string;group:'core'|'quiet'|'repeat'|'refusal';expected:number[];control:string}
export interface QualificationResources {schemaVersion:1;kind:'keyspilli-player-batch-resources';cases:Array<{id:string;status:'complete'|'failed'|'timeout';wallSeconds:number;peakRssBytes:number;exitCode:number;requestSha256:string;receiptPath:string|null;receiptSha256:string|null;error:string}>}
export function validateQualificationResources(value:unknown):asserts value is QualificationResources{
 assertMusic(value&&typeof value==='object','resource inventory required');const r=value as QualificationResources;
 assertMusic(r.schemaVersion===1&&r.kind==='keyspilli-player-batch-resources'&&Array.isArray(r.cases),'resource inventory required');
 for(const row of r.cases){assertMusic(row&&typeof row.id==='string'&&['complete','failed','timeout'].includes(row.status)&&Number.isFinite(row.wallSeconds)&&row.wallSeconds>=0&&Number.isSafeInteger(row.peakRssBytes)&&row.peakRssBytes>=0&&row.peakRssBytes<=2*1024**3,'unbounded resources');}
}
export function scorePlayerQualification(receipts:Array<{id:string;receipt:PlayerInputEvidenceReceiptV1}>,answers:QualificationAnswer[],resources?:QualificationResources){
 assertMusic(answers.length===72 && new Set(answers.map(x=>x.id)).size===72,'complete72-case answer inventory required');assertMusic(new Set(receipts.map(x=>x.id)).size===receipts.length,'duplicate analyzer result');
 let resourceById=new Map<string,QualificationResources['cases'][number]>();let resourceCoverage:{cases:number;complete:number}|undefined;
 if(resources){
  validateQualificationResources(resources);
  assertMusic(resources.cases.length===answers.length && new Set(resources.cases.map(x=>x.id)).size===resources.cases.length && resources.cases.every(x=>answers.some(a=>a.id===x.id)),'resource inventory must cover every qualification case');
  resourceById=new Map(resources.cases.map(x=>[x.id,x]));
  for(const row of resources.cases){assertMusic(row.status==='complete'||row.status==='failed'||row.status==='timeout','invalid resource status');assertMusic(Number.isFinite(row.wallSeconds)&&row.wallSeconds>=0&&Number.isSafeInteger(row.peakRssBytes)&&row.peakRssBytes>=0&&row.peakRssBytes<=2*1024**3,'unbounded resources');}
  resourceCoverage={cases:resources.cases.length,complete:resources.cases.filter(x=>x.status==='complete').length};
 }
 const byId=new Map(receipts.map(x=>[x.id,parsePlayerInputEvidence(x.receipt)]));assertMusic(receipts.every(x=>answers.some(a=>a.id===x.id)),'foreign result');
 const rows=answers.map(a=>{const r=byId.get(a.id),resource=resourceById.get(a.id),accepted=r?.status==='matched',exact=accepted && JSON.stringify(r.historyPitchCandidates)===JSON.stringify(a.expected);return {id:a.id,group:a.group,status:resource&&resource.status!=='complete'?'incomplete':r?.status??'not-run',exact:!!exact,acceptedWrong:!!accepted && (!exact || a.group==='refusal'),refused:a.group==='refusal' && !!r && r.status!=='matched',elapsedSeconds:resource?.status==='complete'?resource.wallSeconds:r?.resources.elapsedSeconds??null,peakRssBytes:resource?.peakRssBytes??r?.resources.peakRssBytes??null};});
 const counts=Object.fromEntries(['core','quiet','repeat','refusal'].map(group=>[group,{cases:rows.filter(r=>r.group===group).length,exact:rows.filter(r=>r.group===group&&r.exact).length,refused:rows.filter(r=>r.group===group&&r.refused).length}]));
 const durations=rows.filter(r=>r.group!=='refusal' && r.status!=='incomplete' && r.elapsedSeconds!==null).map(r=>r.elapsedSeconds!).sort((a,b)=>a-b),p95=durations.length?durations[Math.ceil(.95*durations.length)-1]!:null;
 const peakRssBytes=rows.reduce((peak,row)=>Math.max(peak,row.peakRssBytes??0),0);
 const allCovered=rows.every(r=>r.status!=='not-run'&&r.status!=='incomplete') && (!resources || resourceCoverage!.complete===resources.cases.length);const passed=allCovered && counts.core!.cases===32 && counts.core!.exact>=30 && counts.quiet!.cases===16 && counts.quiet!.exact>=14 && counts.repeat!.cases===12 && counts.repeat!.exact>=10 && counts.refusal!.cases===12 && counts.refusal!.refused===12 && !rows.some(r=>r.acceptedWrong) && p95!==null && p95<=20;
 return {schemaVersion:1,kind:'keyspilli-player-input-qualification-score',status:passed?'passed-controlled-input-screen':allCovered?'failed':'incomplete',rows,counts,p95Seconds:p95,peakRssBytes,resourceCoverage,productionAdmission:false,currentKeys:'unknown',completeness:'unknown',musicalAcceptance:'not-established',providerCalls:0};
}

/** Validate audio-only result identities before evaluator answers are opened. */
export function validateQualificationResultBindings(freeze:{analyzerSha256:string;referenceBankSha256:string;fingerprints:Record<string,string>},currentFingerprints:Record<string,string>,results:Array<{id:string;receipt:PlayerInputEvidenceReceiptV1}>,captures:Record<string,{captureSha256:string;inputSha256:string}>){
 assertMusic(JSON.stringify(Object.keys(freeze.fingerprints).sort())===JSON.stringify(Object.keys(currentFingerprints).sort()),'qualification source inventory changed');
 for(const [path,digest] of Object.entries(freeze.fingerprints))assertMusic(digest===currentFingerprints[path],'qualification source changed');
 for(const row of results){const pin=captures[row.id];assertMusic(pin,'missing qualification capture binding');assertMusic(row.receipt.analyzerSha256===freeze.analyzerSha256 && row.receipt.referenceBankSha256===freeze.referenceBankSha256,'qualification analyzer/bank changed');assertMusic(row.receipt.captureSha256===pin.captureSha256,'qualification capture changed');if(row.receipt.status==='matched'){assertMusic(row.receipt.inputSha256===pin.inputSha256,'qualification input changed');assertMusic(row.receipt.support?.status==='supported','qualification requires supported policy binding');}}
}

export const PLAYER_QUALIFICATION_FILES = [
 'services/transcribe/src/player_input_evidence.py','services/transcribe/src/player_history_search.py',
 'services/transcribe/src/player_pitch_support.py',
 'services/transcribe/src/player_input_batch.py',
 'apps/web/src/lib/player-input-qualification.ts','apps/web/src/lib/music-qualification-score.ts',
 'apps/web/scripts/build-player-input-qualification.mts','apps/web/scripts/evaluate-player-input-qualification.mts',
 'apps/web/e2e/player-audio-capture.ts','apps/web/e2e/music-review-capture.spec.ts','apps/web/playwright.music-review.config.ts',
];
