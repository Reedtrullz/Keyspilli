/** Serial HTTP evaluation with sealed cohort and candidate-code receipts. */
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, statfs, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseMidi} from '../../../packages/midi/src/parse.js';
export const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export function noteHash(bytes: Uint8Array) {
 const notes=parseMidi(bytes).notes;
 if(!notes.length) throw Error('empty MIDI');
 return {notes:notes.length,noteEventsSha256:hash(JSON.stringify(notes))};
}
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const candidatePaths=['services/transcribe/src','packages/midi/src','packages/catalog/src','apps/web/src/app/api','apps/web/src/lib',
 'services/transcribe/requirements-tutorial.txt','services/transcribe/Dockerfile.tutorial',
 'services/transcribe/scripts/evaluate-tutorial-pipeline.ts','package.json','package-lock.json','services/transcribe/package.json'];
export async function candidateHashes() {
 const files:string[]=[];
 const walk=async(path:string)=>{
  for(const entry of await readdir(resolve(repoRoot,path),{withFileTypes:true})) {
   if(entry.name==='__pycache__') continue;
   const child=path+'/'+entry.name;
   if(entry.isDirectory()) await walk(child);
   else if(entry.isFile()) files.push(child);
   else throw Error('CANDIDATE_UNSUPPORTED_FILE: '+child);
  }
 };
 for(const path of candidatePaths) if(path.includes('.')) files.push(path);else await walk(path);
 const result:Record<string,string>={};
 for(const path of files.sort()) result[path]=hash(await readFile(resolve(repoRoot,path)));
 return result;
}
export function verifyCandidate(expected:Record<string,string>, actual:Record<string,string>) {
 if(JSON.stringify(expected)!==JSON.stringify(actual)) throw Error('CANDIDATE_CHANGED: code file set or hashes differ');
}
export function selectSources(sources:any[], selector:string, split:string) {
 if(!['development','heldout'].includes(split)) throw Error('unknown split');
 const cohort=sources.filter(s=>s.split===split);
 if(split==='heldout') {
  if(selector!=='10' || cohort.length!==10 || new Set(cohort.map(s=>s.id)).size!==10) throw Error('HELDOUT_SEALED: exactly all ten required');
  return cohort;
 }
 if(selector.startsWith('ids=')) {
  const ids=selector.slice(4).split(',');
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!cohort.some(s=>s.id===id))) throw Error('invalid development IDs');
  return ids.map(id=>cohort.find(s=>s.id===id));
 }
 const limit=Number(selector);if(!Number.isInteger(limit)||limit<1||limit>20) throw Error('limit must be 1..20 or ids=01,02');
 return cohort.slice(0,limit);
}
export function score(rows: {id?:string,status:string,attempted?:boolean,invalidPublication?:boolean,failureCode?:string}[], denominator:number,
 cohort: {split:string,frozenHeldoutIds:string[],manifestVerified:boolean,candidateVerified?:boolean}={split:'development',frozenHeldoutIds:[],manifestVerified:false}) {
 const completed=rows.filter(r=>r.status==='structural-candidate').length;
 const ids=new Set(rows.map(r=>r.id));
 const fullHeldout=cohort.split==='heldout' && cohort.manifestVerified && cohort.candidateVerified===true && denominator===10 && rows.length===10 &&
  cohort.frozenHeldoutIds.length===10 && new Set(cohort.frozenHeldoutIds).size===10 && ids.size===10 && cohort.frozenHeldoutIds.every(id=>ids.has(id));
 const attempted=rows.filter(r=>r.attempted!==false).length;
 const invalidPublications=rows.filter(r=>r.invalidPublication || r.failureCode==='WRONG_IDENTITY').length;
 return {completed,denominator,attempted,unattempted:denominator-attempted,failed:rows.filter(r=>r.status==='failed').length,invalidPublications,releaseGate:fullHeldout && completed>=8 && invalidPublications===0,
  musicalAcceptance:'pending-listening',usable:false};
}
export function retryAfterMs(value:string|null, now=Date.now()) {
 const delay=value && /^\d+$/.test(value) ? Number(value)*1000 : value ? Date.parse(value)-now : 30000;
 if(!Number.isFinite(delay)||delay<0||delay>120000) throw Error('RATE_LIMIT: retry delay outside 2-minute budget');
 return Math.max(1000,delay);
}
export function matchesIdentity(actual: {title?:string;artist?:string}, expected: {expectedTitle:string;expectedArtist:string}) {
 const normalize=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/^the /,'').replace(/[^a-z0-9]/g,'');
 return typeof actual.title==='string' && typeof actual.artist==='string' && normalize(actual.title)===normalize(expected.expectedTitle) && normalize(actual.artist)===normalize(expected.expectedArtist);
}
export async function main() {
 const [originArg, outputArg, limitArg='1', split='development',candidatePath]=process.argv.slice(2);
 if(originArg==='--freeze-candidate') {
  if(!outputArg) throw Error('candidate artifact path required');
  const manifest=await readFile(new URL('../../../docs/research/keyspilli-evidence/tutorial-evaluation-manifest.json',import.meta.url));
  const seal=(await readFile(new URL('../../../docs/research/keyspilli-evidence/tutorial-evaluation-manifest.sha256',import.meta.url),'utf8')).split(/\s/)[0];
  if(hash(manifest)!==seal) throw Error('MANIFEST_CHANGED');
  await writeFile(resolve(outputArg),JSON.stringify({version:1,createdAt:new Date().toISOString(),manifestSha256:seal,files:await candidateHashes()},null,2)+'\n',{flag:'wx'});return;
 }
 if(!originArg || !outputArg) throw Error('Usage: tsx evaluate-tutorial-pipeline.ts LOCAL_ORIGIN NEW_OUTPUT_DIR [limit|ids=01,02] [development|heldout] [CANDIDATE_FREEZE.json]');
 if(split==='heldout' && !candidatePath) throw Error('HELDOUT_SEALED: candidate freeze artifact required');
 const origin=new URL(originArg);
 if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.protocol!=='http:') throw Error('local isolated preview required');
 const manifestBytes=await readFile(new URL('../../../docs/research/keyspilli-evidence/tutorial-evaluation-manifest.json',import.meta.url));
 const frozenHash=(await readFile(new URL('../../../docs/research/keyspilli-evidence/tutorial-evaluation-manifest.sha256',import.meta.url),'utf8')).split(/\s/)[0];
 if(hash(manifestBytes)!==frozenHash) throw Error('MANIFEST_CHANGED: frozen hash mismatch');
 const manifest=JSON.parse(manifestBytes.toString());
 const selected=selectSources(manifest.sources,limitArg,split);
 const candidateBytes=candidatePath?await readFile(resolve(candidatePath)):null;
 const candidate=candidateBytes?JSON.parse(candidateBytes.toString()):null;
 const checkCandidate=async()=>{
  if(!candidate) return;
  if(candidate.version!==1||candidate.manifestSha256!==frozenHash||!candidate.files) throw Error('CANDIDATE_INVALID');
  verifyCandidate(candidate.files,await candidateHashes());
 };
 await checkCandidate();
 const out=resolve(outputArg); await mkdir(out,{recursive:false});
 const rows:any[]=[];
 const receipt:any={startedAt:new Date().toISOString(),origin:origin.origin,manifestSha256:hash(manifestBytes),split,cohortSize:manifest.sources.filter((s:any)=>s.split===split).length,selectedCount:selected.length,selectedIds:selected.map((s:any)=>s.id),rows,musicalAcceptance:'pending-listening',heldoutExecuted:false,candidateFreezeSha256:candidateBytes?hash(candidateBytes):null,candidateBeforeVerified:!!candidate,verificationScope:'Local source hashes only; operator must start preview and worker from this checkout. Does not attest deployed runtime.'};
 const save=()=>writeFile(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2));
 const request=async(path:string,init:RequestInit={})=>{
  const retryDeadline=Date.now()+120000;
  for(let attempt=0;attempt<4;attempt++) {
   const response=await fetch(new URL(path,origin),{...init,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',...(process.env.KEYSPILLI_API_TOKEN?{authorization:`Bearer ${process.env.KEYSPILLI_API_TOKEN}`}:{})}});
   if(response.status===429 && attempt<3) {
    const delay=retryAfterMs(response.headers.get('retry-after'));
    if(Date.now()+delay>retryDeadline) throw Error('RATE_LIMIT: 2-minute retry budget exhausted');
    (receipt.rateLimitRetries??=[]).push({path,attempt:attempt+1,delayMs:delay});await save();
    await response.body?.cancel();
    const until=Date.now()+delay;
    while(Date.now()<until) await new Promise(r=>setTimeout(r,Math.min(30000,until-Date.now())));
    continue;
   }
   if(!response.ok) throw Error(`HTTP ${response.status} ${path}`); return response;
  }
  throw Error('RATE_LIMIT: retries exhausted');
 };
 await save();
 for(const source of selected) {
  const row:any={id:source.id,url:source.url,status:'pending',attempted:false,startedAt:new Date().toISOString(),exports:[]};rows.push(row);await save();
  let safeToContinue=false;
  try {
   await checkCandidate();
   const disk=await statfs('/System/Volumes/Data'); if(disk.bavail*disk.bsize<30*1024**3) throw Error('DISK_GUARD: below 30GiB');
   row.attempted=true;
   if(split==='heldout') receipt.heldoutExecuted=true;
   await save();
   const submitted=await (await request('/api/youtube/import',{method:'POST',body:JSON.stringify({url:source.url})})).json();
   if(typeof submitted.jobId!=='string') throw Error('missing jobId');row.jobId=submitted.jobId;await save();
   const deadline=Date.now()+20*60*1000;
   let job:any;
   while(Date.now()<deadline) {
    job=await(await request('/api/youtube/status/'+encodeURIComponent(row.jobId))).json();
    row.jobStatus=job.status;row.jobError=typeof job.error==='string'?job.error.slice(0,2000):null;await save();
    if(job.status==='done') {safeToContinue=true;break;}
    if(job.status==='error' || job.status==='failed') {safeToContinue=true;throw Error('terminal job status: '+job.status);}
    if(!['queued','processing'].includes(job.status)) throw Error(`terminal job status: ${job.status}`);
    await new Promise(r=>setTimeout(r,2000));
   }
   if(job?.status!=='done') throw Error('TIMEOUT: job may still be running; stop batch');
   if(typeof job.songId!=='string'||!job.songId.endsWith('-e')) throw Error('missing easy variant songId');
   row.songId=job.songId;
   const detail=await(await request('/api/songs/'+encodeURIComponent(job.songId))).json();
   row.resolvedIdentity={title:detail.song?.title,artist:detail.song?.artist};
   row.selectedSource=detail.sourceArrangement?.actualSourceUrl;
   if(!matchesIdentity(row.resolvedIdentity,source)) {row.invalidPublication=true;throw Error('WRONG_IDENTITY: generated song metadata does not match frozen source');}
   for(const suffix of ['b','e','m','a']) {
    const songId=job.songId.slice(0,-1)+suffix;
    const bytes=new Uint8Array(await(await request('/api/song/'+encodeURIComponent(songId)+'/export?type=midi')).arrayBuffer());
    if(bytes.length>8*1024**2) throw Error('export exceeds 8MiB');
    const metrics=noteHash(bytes);await writeFile(resolve(out,source.id+'-'+suffix+'.mid'),bytes);
    row.exports.push({songId,bytes:bytes.length,sha256:hash(bytes),...metrics});
   }
   row.status='structural-candidate';
  } catch(error) {row.status='failed';row.error=String(error);row.failureCode=row.error.match(/(?:Error: )?([A-Z][A-Z_]+):/)?.[1] ?? (row.jobStatus==='error'||row.jobStatus==='failed'?'JOB_FAILED':'EVALUATION_FAILED');}
  try {await checkCandidate();} catch(error) {row.status='failed';row.error=String(error);row.failureCode='CANDIDATE_CHANGED';safeToContinue=false;receipt.candidateChanged=true;}
  row.finishedAt=new Date().toISOString(); await save();
  // A timeout/transport failure can leave an active worker: never overlap another job.
  if(row.status==='failed' && !safeToContinue) {receipt.stoppedEarly=true;break;}
 }
 try {await checkCandidate();receipt.candidateAfterVerified=!!candidate;} catch(error) {receipt.candidateChanged=true;receipt.candidateAfterVerified=false;receipt.candidateError=String(error);}
 receipt.unattemptedIds=selected.filter(s=>!rows.some(r=>r.id===s.id && r.attempted)).map(s=>s.id);
 receipt.summary=score(rows,selected.length,{split,frozenHeldoutIds:manifest.sources.filter((s:any)=>s.split==='heldout').map((s:any)=>s.id),manifestVerified:true,candidateVerified:receipt.candidateBeforeVerified && receipt.candidateAfterVerified && !receipt.candidateChanged});receipt.finishedAt=new Date().toISOString();await save();
 if(receipt.candidateChanged||rows.length!==selected.length||rows.some(r=>r.status!=='structural-candidate')) process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
