import { assertMusic } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { parsePlayerInputEvidence,type PlayerInputEvidenceReceiptV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
export interface QualificationAnswer {id:string;group:'core'|'quiet'|'repeat'|'refusal';expected:number[];control:string}
export function scorePlayerQualification(receipts:Array<{id:string;receipt:PlayerInputEvidenceReceiptV1}>,answers:QualificationAnswer[]){
 assertMusic(answers.length===72 && new Set(answers.map(x=>x.id)).size===72,'complete72-case answer inventory required');assertMusic(new Set(receipts.map(x=>x.id)).size===receipts.length,'duplicate analyzer result');
 const byId=new Map(receipts.map(x=>[x.id,parsePlayerInputEvidence(x.receipt)]));assertMusic(receipts.every(x=>answers.some(a=>a.id===x.id)),'foreign result');
 const rows=answers.map(a=>{const r=byId.get(a.id),accepted=r?.status==='matched',exact=accepted && JSON.stringify(r.historyPitchCandidates)===JSON.stringify(a.expected);return {id:a.id,group:a.group,status:r?.status??'not-run',exact:!!exact,acceptedWrong:!!accepted && (!exact || a.group==='refusal'),refused:a.group==='refusal' && !!r && r.status!=='matched',elapsedSeconds:r?.resources.elapsedSeconds??null,peakRssBytes:r?.resources.peakRssBytes??null};});
 const counts=Object.fromEntries(['core','quiet','repeat','refusal'].map(group=>[group,{cases:rows.filter(r=>r.group===group).length,exact:rows.filter(r=>r.group===group&&r.exact).length,refused:rows.filter(r=>r.group===group&&r.refused).length}]));
 const durations=rows.filter(r=>r.group!=='refusal' && r.elapsedSeconds!==null).map(r=>r.elapsedSeconds!).sort((a,b)=>a-b),p95=durations.length?durations[Math.ceil(.95*durations.length)-1]!:null;
 const allCovered=rows.every(r=>r.status!=='not-run');const passed=allCovered && counts.core!.cases===32 && counts.core!.exact>=30 && counts.quiet!.cases===16 && counts.quiet!.exact>=14 && counts.repeat!.cases===12 && counts.repeat!.exact>=10 && counts.refusal!.cases===12 && counts.refusal!.refused===12 && !rows.some(r=>r.acceptedWrong) && p95!==null && p95<=20;
 return {schemaVersion:1,kind:'keyspilli-player-input-qualification-score',status:passed?'passed-controlled-input-screen':allCovered?'failed':'incomplete',rows,counts,p95Seconds:p95,productionAdmission:false,currentKeys:'unknown',completeness:'unknown',musicalAcceptance:'not-established',providerCalls:0};
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
 'apps/web/src/lib/player-input-qualification.ts','apps/web/src/lib/music-qualification-score.ts',
 'apps/web/scripts/build-player-input-qualification.mts','apps/web/scripts/evaluate-player-input-qualification.mts',
 'apps/web/e2e/player-audio-capture.ts','apps/web/e2e/music-review-capture.spec.ts','apps/web/playwright.music-review.config.ts',
];
