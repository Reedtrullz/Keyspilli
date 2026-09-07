import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,statfs} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {normalizeYoutubeImportUrl} from './youtube-url.js';
import {cleanCatalogTitle,searchYoutubeCandidates,scoreCandidate} from '../../../packages/catalog/src/youtube-discovery.js';
import {parseMidi,buildVariants,validateVariants,writeVariantArtifacts,validateArtifactFiles,PUBLIC_DIFFICULTY_ORDER} from '../../../packages/midi/src/index.js';

// Prefer recording metadata, then explicit Artist - Song titles; channels are not artists.
export function tutorialIdentity(meta: Record<string, unknown>) {
 if (typeof meta.title !== 'string') throw Error('SOURCE_REVIEW_REQUIRED: unresolved song identity');
 const described=typeof meta.description==='string' ? meta.description.match(/learn how to play (.+?) by (.+?) on (?:the )?piano/i) : null;
 if (!meta.artist && described && meta.title.toLowerCase().includes(described[1]!.toLowerCase()) && meta.title.toLowerCase().includes(described[2]!.toLowerCase()))
  return {baseId:'private-proof',title:described[1]!.trim(),artist:described[2]!.trim()};
 const segments=meta.title.split(/\s+[-–—|]\s+/).map(s=>s.trim()).filter(Boolean);
 const artist=typeof meta.artist==='string' && meta.artist.trim() ? meta.artist.trim() : segments.length>1 ? segments[0]!.replace(/\s*\([^()]*\)/g,'').trim() : null;
 if (!artist) throw Error('SOURCE_REVIEW_REQUIRED: unresolved song identity');
 const title=typeof meta.track==='string' && meta.track.trim() ? meta.track.trim() : cleanCatalogTitle(segments.length>1 && segments[0]!.replace(/\s*\([^()]*\)/g,'').trim().toLowerCase()===artist.toLowerCase() ? segments[1]! : meta.title,artist);
 return {baseId:'private-proof',title,artist};
}

export async function resolveTutorialLink(inputUrl: string, outputDirectory: string) {
const run=promisify(execFile);
const url=normalizeYoutubeImportUrl(inputUrl);
const out=resolve(outputDirectory);
await mkdir(out,{recursive:false});
const disk=await statfs(out);if(disk.bavail*disk.bsize<30*1024**3)throw Error('Less than 30GiB free');
const call=async(cmd:string,args:string[],timeout=120000)=>(await run(cmd,args,{timeout,maxBuffer:16*1024**2})).stdout;
const meta=JSON.parse(await call('yt-dlp',['--no-playlist','--skip-download','--dump-json','--',url]));
const target=tutorialIdentity(meta);
const {artist,title}=target;
const discovered=await searchYoutubeCandidates(artist+' '+title+' piano tutorial',12);
const direct=/tutorial|synthesia/i.test(meta.title)?[{videoId:meta.id,url,title:meta.title,uploader:meta.uploader??'',durationSeconds:meta.duration??0,isLive:!!meta.is_live}]:[];
const candidates=[...direct,...discovered.filter(c=>!direct.some(d=>d.videoId===c.videoId))]
 .map(c=>scoreCandidate(c,target,{maxDurationSeconds:600}))
 .filter(c=>c.score>-100 && /tutorial|synthesia/i.test(c.title) && c.title.toLowerCase().includes(artist.toLowerCase().replace(/^the /,'')))
 .sort((a,b)=>Number(b.url===url)-Number(a.url===url)||b.score-a.score||a.videoId.localeCompare(b.videoId)).slice(0,3);
const receipt:any={inputUrl:url,identity:target,identityEvidence:'YouTube metadata and title matching; not independent musical identification',candidates,attempts:[],status:'no-supported-source',sourceRights:'unverified',published:false};
await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2));
for(const c of candidates){
 const dir=join(out,c.videoId);await mkdir(dir);
 try{
  console.log('Trying',c.url,c.title);
  await call('yt-dlp',['--no-playlist','--max-filesize','250M','--match-filters','duration <= 600','-f','bv[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]','--merge-output-format','mp4','-o',join(dir,'video.mp4'),'--',c.url],300000);
  await call(process.env.KEYSPILLI_TUTORIAL_PYTHON ?? resolve('output/tutorial-recovery/venv/bin/python'),[resolve('services/transcribe/src/tutorial_keys.py'),join(dir,'video.mp4'),'--output',join(dir,'extracted.json')],600000);
  const midi=await readFile(join(dir,'extracted.mid'));
  const variants=buildVariants(parseMidi(midi),{title,artist},{arrangementProfile:'source',maxDurBeats:null});
  const issues=validateVariants(variants,{maxDurBeats:null});if(issues.length)throw Error(issues.join(';'));
  for(const v of variants.filter(v=>PUBLIC_DIFFICULTY_ORDER.includes(v.level as any))){
   const files=writeVariantArtifacts(v,title,artist);
   const errors=validateArtifactFiles(v,files);if(errors.length)throw Error(errors.join(';'));
   await writeFile(join(dir,v.level+'.mid'),files.midi);
  }
  receipt.attempts.push({url:c.url,status:'extracted-and-structurally-validated',notes:parseMidi(midi).notes.length});
  receipt.status='local-listening-candidate';receipt.selectedUrl=c.url;receipt.midiPath=join(dir,'extracted.mid');
  break;
 }catch(error){receipt.attempts.push({url:c.url,status:'failed',reason:String(error).slice(-1500)});}
 finally{await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2));}
}
console.log(receipt.status,receipt.midiPath??receipt.attempts);

return receipt;
}
