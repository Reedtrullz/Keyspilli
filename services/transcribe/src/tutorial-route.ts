import { reuseTutorialSnapshot, storeTutorialSnapshot } from './tutorial-cache.js';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,statfs} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {sanitizeProcessError} from './errors.js';
import {normalizeYoutubeImportUrl,ytNetworkFlags} from './youtube-url.js';
import {cleanCatalogTitle,parseYtDlpSearchOutput,scoreCandidate} from '../../../packages/catalog/src/youtube-discovery.js';
import {parseMidi,buildVariants,validateVariants,writeVariantArtifacts,validateArtifactFiles,PUBLIC_DIFFICULTY_ORDER} from '../../../packages/midi/src/index.js';

// Prefer recording metadata, then explicit Artist - Song titles; channels are not artists.
export function tutorialIdentity(meta: Record<string, unknown>) {
 if (typeof meta.title !== 'string') throw Error('SOURCE_REVIEW_REQUIRED: unresolved song identity');
 // Recording editions are metadata, while other parenthetical song text remains meaningful.
 const track=typeof meta.track==='string' ? meta.track.trim().replace(/\s*[([](?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?[)\]]$/i,'').trim() : '';
 const described=typeof meta.description==='string' ? meta.description.match(/learn how to play (.+?) by (.+?) on (?:the )?piano/i) : null;
 if (!meta.artist && described && meta.title.toLowerCase().includes(described[1]!.toLowerCase()) && meta.title.toLowerCase().includes(described[2]!.toLowerCase()))
  return {baseId:'private-proof',title:described[1]!.trim(),artist:described[2]!.trim()};
 const quoted=meta.title.match(/^(.+?)\s+["“](.+?)["”](?:\s*[,–—-]|$)/);
 if (!meta.artist && quoted) return {baseId:'private-proof',artist:quoted[1]!.trim(),title:quoted[2]!.trim()};
 const segments=meta.title.split(/\s+(?:[-–—]|\|+)\s+|:\s+/).map(s=>s.trim()).filter(Boolean);
 // Reversed official titles need supporting metadata; never infer an artist from a channel alone.
 const artistEvidence = [meta.artist, ...(meta.artist ? [] : [meta.channel,meta.uploader])];
 const namedArtist = segments.find(segment=>artistEvidence.some(value=>typeof value==='string' &&
  [segment,...segment.split(/\s+\/\s+/)].some(credit=>credit.toLowerCase()===value.trim().toLowerCase())));
 if(typeof namedArtist==='string' && segments.length>1){
  const artist=namedArtist.trim();
  const songSegments=segments.filter(segment=>segment.toLowerCase()!==artist.toLowerCase());
  if(songSegments.length)return {baseId:'private-proof',artist,title:track ? track : cleanCatalogTitle(songSegments[0]!,artist)};
 }
 const artist=typeof meta.artist==='string' && meta.artist.trim() ? meta.artist.trim() : segments.length>1 ? segments[0]!.replace(/\s*\([^()]*\)/g,'').trim() : null;
 if (!artist) throw Error('SOURCE_REVIEW_REQUIRED: unresolved song identity');
 const title=track ? track : cleanCatalogTitle(segments.length>1 && segments[0]!.replace(/\s*\([^()]*\)/g,'').trim().toLowerCase()===artist.toLowerCase() ? segments[1]! : meta.title,artist);
 return {baseId:'private-proof',title,artist};
}

/** Require full title/artist phrases, not a few shared substrings. */
export function matchesTutorialIdentity(candidateTitle:string,target:{artist:string;title:string}) {
 const words=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const excerptMarkers=candidateTitle.match(/\b(?:excerpt|snippet|chorus only|intro only|short version|part\s+\d+)\b/gi) ?? [];
 if(excerptMarkers.some(marker=>!words(target.title).includes(words(marker))))return false;
 const hay=' '+words(candidateTitle)+' ';
 const artist=target.artist.replace(/^the /i,'');
 // Explicit collaboration markers permit reordered credits, but every full name is required.
 // Do not split band names on commas, ampersands, or 'and'.
 const artists=artist.split(/\s+(?:with|feat\.?|ft\.?|featuring|\/)\s+/i);
 const artistMatches=(name:string)=>[name,name.replace(/\//g,'')].map(words).some(phrase=>!!phrase && hay.includes(' '+phrase+' '));
 const title=words(cleanCatalogTitle(target.title,target.artist));
 return (artistMatches(artist) || artists.length>1 && artists.every(artistMatches)) && !!title && hay.includes(' '+title+' ');
}
export function compareTutorialCandidates(a:ReturnType<typeof scoreCandidate>,b:ReturnType<typeof scoreCandidate>,requestedUrl:string,snapshots:ReadonlySet<string>=new Set()) {
 const visual=(title:string)=>Number(/tutorial|synthesia/i.test(title));
 return Number(b.url===requestedUrl)-Number(a.url===requestedUrl) || Number(snapshots.has(b.videoId))-Number(snapshots.has(a.videoId)) || visual(b.title)-visual(a.title) || b.score-a.score || a.videoId.localeCompare(b.videoId);
}
const tutorialSignal=/tutorial|synthesia|piano sheet music|piano (?:cover|transcription|arrangement)/i;

export interface TutorialHooks {
 signal?: AbortSignal;
 checkActive?: () => void;
 onProgress?: (stage: string) => void;
}

const failureMessages = [
 'unresolved song identity',
 'insufficient free disk space; at least 30GiB required',
 'insufficient free disk space; 31GiB required before downloading',
 'tutorial operation cancelled',
 'tutorial operation timed out',
 'tutorial output limit exceeded',
 'tutorial subprocess failed',
];
export function tutorialFailure(error: unknown) {
 const message=error instanceof Error ? error.message : '';
 const reason=failureMessages.map(value=>'SOURCE_REVIEW_REQUIRED: '+value).find(value=>value===message)
  ?? 'SOURCE_REVIEW_REQUIRED: tutorial resolution failed';
 const diagnostic=error && typeof error==='object' && 'privateDiagnostic' in error && typeof error.privateDiagnostic==='string' ? error.privateDiagnostic : undefined;
 return {reason,...(diagnostic ? {privateDiagnostic:diagnostic} : {})};
}
function privateDiagnostic(stderr:string) {
 return sanitizeProcessError({stderr}).message
  .replace(/(Bearer\s+)[^\s'"<>]+/gi,'$1[redacted]')
  .replace(/((?:token|api[_-]?key|password|secret|authorization|cookie)\s*[=:]\s*)[^\s&,;'"<>]+/gi,'$1[redacted]')
  .slice(-2048);
}
function checkTutorialActive(hooks:TutorialHooks) {
 try{hooks.signal?.throwIfAborted();hooks.checkActive?.();}
 catch{throw Error('SOURCE_REVIEW_REQUIRED: tutorial operation cancelled');}
}

// Kill the process group: yt-dlp may own ffmpeg children.
export async function runTutorialProcess(cmd: string, args: string[], timeout: number, hooks: TutorialHooks = {}): Promise<string> {
 checkTutorialActive(hooks);
 return new Promise((resolve, reject) => {
  let stopped = "";
  const child = spawn(cmd,args,{detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];let bytes=0;let stderr='';
  child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString('utf8')).slice(0,16384);});
  child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16*1024**2)stop("tutorial output limit exceeded");else chunks.push(chunk);});
  const finish=(failed:boolean)=>{
   clearInterval(poll); clearTimeout(deadline); hooks.signal?.removeEventListener('abort',cancel);
   if(stopped || failed) reject(Object.assign(Error('SOURCE_REVIEW_REQUIRED: '+(stopped || 'tutorial subprocess failed')),{privateDiagnostic:privateDiagnostic(stderr)}));
   else resolve(Buffer.concat(chunks).toString('utf8'));
  };
  child.once('error',()=>finish(true));child.once('close',code=>finish(code!==0));
  const stop=(reason:string)=>{stopped ||= reason;try{if(child.pid && process.platform !== 'win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}};
  const cancel=()=>stop('tutorial operation cancelled');
  const poll=setInterval(()=>{try{hooks.checkActive?.();}catch{cancel();}},500);
  const deadline=setTimeout(()=>stop('tutorial operation timed out'),timeout);
  hooks.signal?.addEventListener('abort',cancel,{once:true});
  if(hooks.signal?.aborted)cancel();
 });
}

export async function resolveTutorialLink(inputUrl: string, outputDirectory: string, hooks: TutorialHooks = {}) {
const url=normalizeYoutubeImportUrl(inputUrl);
const out=resolve(outputDirectory);
await mkdir(out,{recursive:false});
const receipt:any={inputUrl:url,attempts:[],status:'resolving',sourceRights:'unverified',published:false};
const save=()=>writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2));
await save();
const deadline=Date.now()+18*60*1000;
const boundedHooks={...hooks,checkActive:()=>{checkTutorialActive(hooks);if(Date.now()>deadline)throw Error('tutorial deadline exceeded');}};
const active=()=>checkTutorialActive(boundedHooks);
const progress=(stage:string)=>{active();hooks.onProgress?.(stage);};
try{
progress('identifying');
const disk=await statfs(out);if(disk.bavail*disk.bsize<30*1024**3)throw Error('SOURCE_REVIEW_REQUIRED: insufficient free disk space; at least 30GiB required');
const call=(cmd:string,args:string[],timeout=120000)=>runTutorialProcess(cmd,cmd === "yt-dlp" ? [...ytNetworkFlags(), ...args] : args,Math.min(timeout,Math.max(1,deadline-Date.now())),boundedHooks);
const meta=JSON.parse(await call('yt-dlp',['--no-playlist','--skip-download','--dump-json','--',url]));
const target=tutorialIdentity(meta);
const {artist,title}=target;
progress('searching');
const discovered: ReturnType<typeof parseYtDlpSearchOutput>=[];
// Preserve the recording metadata search terms while displaying the canonical song title.
const searchTitle=typeof meta.track==='string' && meta.track.trim() ? meta.track.trim() : title;
for(const query of [artist+' '+searchTitle+' piano tutorial',artist+' '+searchTitle+' piano synthesia']) {
 const found=parseYtDlpSearchOutput(await call('yt-dlp',['--flat-playlist','--dump-json','--no-warnings','--quiet','ytsearch12:'+query],60000));
 for(const candidate of found)if(!discovered.some(c=>c.videoId===candidate.videoId))discovered.push(candidate);
}
const direct=/^[\w-]{11}$/.test(meta.id) && tutorialSignal.test(meta.title)?[{videoId:meta.id,url,title:meta.title,uploader:meta.uploader??'',durationSeconds:meta.duration??0,isLive:!!meta.is_live}]:[];
const candidates=[...direct,...discovered.filter(c=>!direct.some(d=>d.videoId===c.videoId))]
 .map(c=>{
  const ranked=scoreCandidate(c,target,{maxDurationSeconds:600});
  // The shared audio-cover ranker penalizes tutorials; this route needs visual tutorials.
  if(/tutorial|synthesia/i.test(c.title)){ranked.score+=40;ranked.reasons.push('visual tutorial preferred');}
  return ranked;
 })
 .filter(c=>c.score>-100 && !/reaction|mashup|remix|nightcore|sped up|slowed/i.test(c.title) && tutorialSignal.test(c.title) && matchesTutorialIdentity(c.title,target));
const snapshots=new Set<string>();
for(const c of candidates){
 active();
 if(await reuseTutorialSnapshot({videoId:c.videoId,artist,title,durationSeconds:c.durationSeconds}))snapshots.add(c.videoId);
}
candidates.sort((a,b)=>compareTutorialCandidates(a,b,url,snapshots)).splice(6);
Object.assign(receipt,{identity:target,identityEvidence:'YouTube metadata and title matching; not independent musical identification',candidates,status:'no-supported-source'});
await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2));
for(const c of candidates){
 const dir=join(out,c.videoId);await mkdir(dir);
 try{
  const snapshotIdentity={videoId:c.videoId,artist,title,durationSeconds:c.durationSeconds};
  const cached=await reuseTutorialSnapshot(snapshotIdentity,dir);
  active();
  if(!cached){
  const available=await statfs(out);
  // Reserve space for separate video/audio streams and ffmpeg's merged output.
  if(available.bavail*available.bsize<31*1024**3)throw Error('SOURCE_REVIEW_REQUIRED: insufficient free disk space; 31GiB required before downloading');
  progress('downloading');
  await call('yt-dlp',['--no-playlist','--max-filesize','250M','--match-filters','duration <= 600','-f','bv[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]','--merge-output-format','mp4','-o',join(dir,'video.mp4'),'--',c.url],300000);
  progress('extracting');
  await call(process.env.KEYSPILLI_TUTORIAL_PYTHON ?? resolve('output/tutorial-recovery/venv/bin/python'),[resolve('services/transcribe/src/tutorial_keys.py'),join(dir,'video.mp4'),'--output',join(dir,'extracted.json')],600000);
  }
  progress('validating');
  const midi=await readFile(join(dir,'extracted.mid'));
  const variants=buildVariants(parseMidi(midi),{title,artist},{arrangementProfile:'source',maxDurBeats:null});
  const issues=validateVariants(variants,{maxDurBeats:null});if(issues.length)throw Error(issues.join(';'));
  for(const v of variants.filter(v=>PUBLIC_DIFFICULTY_ORDER.includes(v.level as any))){
   const files=writeVariantArtifacts(v,title,artist);
   const errors=validateArtifactFiles(v,files);if(errors.length)throw Error(errors.join(';'));
   await writeFile(join(dir,v.level+'.mid'),files.midi);
  }
  active();
  if(!cached)await storeTutorialSnapshot(snapshotIdentity,dir);
  receipt.attempts.push({url:c.url,status:'extracted-and-structurally-validated',sourceBytes:cached?'cached snapshot':'fresh download',notes:parseMidi(midi).notes.length});
  receipt.status='local-listening-candidate';receipt.selectedUrl=c.url;receipt.midiPath=join(dir,'extracted.mid');
  break;
 }catch(error){receipt.attempts.push({url:c.url,status:'failed',...tutorialFailure(error)});active();}
 finally{await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2));}
}
active();
}catch(error){Object.assign(receipt,{status:'failed'},tutorialFailure(error));await save();throw Error(receipt.reason);}

return receipt;
}
