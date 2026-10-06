/** Explicit local preparation. Reports and comparisons never invoke this function implicitly. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { access,mkdir,open,readFile,writeFile } from 'node:fs/promises';
import { isAbsolute,join } from 'node:path';
import { assertMusic } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { parsePairedPlayerCapture,parsePlayerInputEvidence,validatePlayerSignalBytes,type PairedPlayerCaptureV1,type PlayerInputEvidenceReceiptV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
import { readLocalEvidenceJson } from './local-audio-evidence.js';
import { validateReplay,type ReplaySnapshot } from './music-correspondence.js';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const run=promisify(execFile);
async function boundedSignal(path:string){const f=await open(path,'r');try{const n=await f.stat();assertMusic(n.isFile() && n.size>=44 && n.size<=2*1024*1024,'bounded signal required');const b=Buffer.alloc(n.size+1);let length=0;while(length<b.length){const r=await f.read(b,length,b.length-length,length);if(!r.bytesRead)break;length+=r.bytesRead;}assertMusic(length===n.size,'signal changed during read');return b.subarray(0,length);}finally{await f.close();}}
export async function preparePlayerMusicReview(capture:PairedPlayerCaptureV1,options:{execute:boolean;python:string;referenceManifestPath:string;dictionaryDir:string},output:string):Promise<PlayerInputEvidenceReceiptV1>{
 const c=parsePairedPlayerCapture(capture);assertMusic(isAbsolute(output),'absolute new output required');
 const text=JSON.stringify(c);let bankHash=hash('unavailable reference bank');
 const receipt:PlayerInputEvidenceReceiptV1={schemaVersion:1,kind:'keyspilli-player-input-evidence',captureSha256:hash(text),inputSha256:c.input.sha256,analyzerSha256:hash('unavailable analyzer'),referenceBankSha256:bankHash,fitInterval:{startSeconds:0,endSeconds:1.2},status:'unavailable',historyPitchCandidates:null,rawResidual:null,currentPitchSetEstimate:null,completeness:'unknown',audibility:'not-established',resources:{elapsedSeconds:0,peakRssBytes:0},limitations:['Unexecuted or unavailable bank/analyzer identities use sentinel hashes. Provider calls: 0. History, current keys, completeness, audible perception and musical acceptance remain unknown.']};
 // No input files or executable are accessed for preparation-only mode.
 if(options.execute){for(const pin of [c.input,c.output,c.forwardOutput])validatePlayerSignalBytes(pin,await boundedSignal(pin.path));assertMusic([options.python,options.referenceManifestPath,options.dictionaryDir].every(isAbsolute),'absolute backend paths required');}
 await mkdir(output,{recursive:false});await writeFile(join(output,'capture.json'),text,{flag:'wx'});
 const request={captureManifestPath:join(output,'capture.json'),referenceManifestPath:options.referenceManifestPath,dictionaryDir:options.dictionaryDir};
 await writeFile(join(output,'request.json'),JSON.stringify({request,providerCalls:0,execute:options.execute}),{flag:'wx'});
 if(options.execute){const started=Date.now();try{
  await access(options.python);bankHash=hash(await readFile(options.referenceManifestPath));receipt.referenceBankSha256=bankHash;
  const module=fileURLToPath(new URL('../../../../services/transcribe/src/player_input_evidence.py',import.meta.url));receipt.analyzerSha256=hash(Buffer.concat([await readFile(module),await readFile(fileURLToPath(new URL('../../../../services/transcribe/src/player_history_search.py',import.meta.url)))]));
  await writeFile(join(output,'analyzer-request.json'),JSON.stringify(request),{flag:'wx'});
  const result=await run(options.python,[module,'--request',join(output,'analyzer-request.json'),'--output',join(output,'analysis')],{timeout:120000,maxBuffer:1024*1024,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'},killSignal:'SIGKILL'});
  await writeFile(join(output,'analyzer.log'),result.stdout+result.stderr,{flag:'wx'});
  const r=parsePlayerInputEvidence(await readLocalEvidenceJson(join(output,'analysis/receipt.json')));
  assertMusic(r.captureSha256===receipt.captureSha256 && r.inputSha256===c.input.sha256 && r.referenceBankSha256===bankHash && r.analyzerSha256===receipt.analyzerSha256,'stale analyzer receipt');
  await writeFile(join(output,'receipt.json'),JSON.stringify(r,null,2),{flag:'wx'});return r;
 }catch(error){const e=error as NodeJS.ErrnoException & {killed?:boolean};receipt.status=e.code==='ENOENT'?'unavailable':'failed';receipt.resources.elapsedSeconds=(Date.now()-started)/1000;receipt.limitations=[e.killed?'Analyzer timed out; partial files retained, no accepted history.':`Local analyzer unavailable or failed (${e.code ?? 'validation'}); no accepted history.`,...receipt.limitations];}}
 await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});return parsePlayerInputEvidence(receipt);
}
export function comparePlayerHistory(receipt:PlayerInputEvidenceReceiptV1,snapshot:ReplaySnapshot){
 const r=parsePlayerInputEvidence(receipt),s=validateReplay(snapshot);assertMusic(s.playerCapture?.captureSha256===r.captureSha256 && s.playerCapture.inputSha256===r.inputSha256 && s.playerCapture.clipOffsetSeconds===0,'clip/source frame clock binding required');const expected=[...new Set(s.events.filter(e=>e.onsetSeconds>=r.fitInterval.startSeconds && e.onsetSeconds<r.fitInterval.endSeconds).map(e=>e.midi))].sort((a,b)=>a-b);const candidates=r.historyPitchCandidates ?? [];
 const supportedPitches=expected.filter(p=>candidates.includes(p)),unsupportedExpectedPitches=expected.filter(p=>!candidates.includes(p)),unexpectedCandidates=candidates.filter(p=>!expected.includes(p));
 return {supportedPitches,unsupportedExpectedPitches,unexpectedCandidates,disposition:r.status==='matched' && !unsupportedExpectedPitches.length?'inspect' as const:'uncertain' as const,limitations:['Unqualified diagnostic: a matched fit can include incorrect octave candidates and does not establish pitch presence.','Set correspondence only; missing-note absence remains unknown.','No event timing, held-note presence, releases, audible completeness or source fidelity is established.','Authored events are compared after fitting and never narrow the reference search.']};
}
