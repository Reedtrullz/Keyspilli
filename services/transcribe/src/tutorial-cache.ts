import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,realpath,rename,stat,writeFile,unlink} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';

export interface TutorialSnapshotIdentity {
 videoId:string;
 artist:string;
 title:string;
 durationSeconds:number;
}
const MAX_AGE=24*60*60*1000;
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function confined(root:string,path:string) {
 const full=await realpath(path);const rel=relative(root,full);
 if(!rel || rel==='..' || rel.startsWith('..'+sep) || rel.startsWith(sep))throw Error('outside transcribed directory');
 return full;
}
async function digest(path:string,limit:number) {
 if((await stat(path)).size>limit)throw Error('oversized snapshot asset');
 const hash=createHash('sha256');let size=0;
 for await(const chunk of createReadStream(path)){size+=chunk.length;if(size>limit)throw Error('oversized snapshot asset');hash.update(chunk);}
 return hash.digest('hex');
}
async function context(identity:TutorialSnapshotIdentity) {
 if(!process.env.KEYSPILLI_DATA_DIR || !/^[\w-]{11}$/.test(identity.videoId) || !Number.isFinite(identity.durationSeconds))throw Error('cache unavailable');
 const data=await realpath(process.env.KEYSPILLI_DATA_DIR);
 const root=await confined(data,join(data,'transcribed'));
 const version=sha(Buffer.concat(await Promise.all([
  readFile(new URL('./tutorial_keys.py',import.meta.url)),readFile(new URL('./tutorial_timing.py',import.meta.url)),
  readFile(new URL('../requirements-tutorial.txt',import.meta.url)),
 ])));
 return {root,version,key:identity.videoId+'-'+version+'.json'};
}
async function assets(root:string,directory:string) {
 const midi=await confined(root,join(directory,'extracted.mid'));
 const json=await confined(root,join(directory,'extracted.json'));
 const video=await confined(root,join(directory,'video.mp4'));
 const [midiHash,jsonHash,videoHash]=await Promise.all([digest(midi,16*1024**2),digest(json,16*1024**2),digest(video,512*1024**2)]);
 const metadata=JSON.parse(await readFile(json,'utf8'));
 if(metadata.sourceSha256!==videoHash)throw Error('source hash mismatch');
 return {midi,json,midiHash,jsonHash,videoHash};
}

/** Reuse a verified local snapshot, never a claim that current remote bytes match. */
export async function reuseTutorialSnapshot(identity:TutorialSnapshotIdentity,destination:string):Promise<boolean> {
 try{
  const {root,version,key}=await context(identity);
  const index=await confined(root,join(root,'.tutorial-cache',key));
  if((await stat(index)).size>8192)return false;
  const entry=JSON.parse(await readFile(index,'utf8'));
  const age=Date.now()-entry.createdAt;
  if(!Number.isFinite(age)||age<0||age>MAX_AGE||entry.version!==version||!entry.identity||entry.identity.videoId!==identity.videoId||entry.identity.artist!==identity.artist||entry.identity.title!==identity.title||entry.identity.durationSeconds!==identity.durationSeconds)return false;
  if(typeof entry.directory!=='string')return false;
  const source=await confined(root,join(root,entry.directory));
  const target=await confined(root,destination);
  const checked=await assets(root,source);
  if(checked.midiHash!==entry.midiHash||checked.jsonHash!==entry.jsonHash||checked.videoHash!==entry.videoHash)return false;
  // Hash the exact bytes copied as well, so a concurrent asset replacement fails closed.
  const [midi,json]=await Promise.all([readFile(checked.midi),readFile(checked.json)]);
  if(sha(midi)!==entry.midiHash||sha(json)!==entry.jsonHash)return false;
  await writeFile(join(target,'extracted.mid'),midi,{flag:'wx'});
  try {
   await writeFile(join(target,'extracted.json'),json,{flag:'wx'});
  } catch (error) {
   // The first exclusive write belongs to this attempt; preserve any pre-existing JSON.
   await unlink(join(target,'extracted.mid'));
   throw error;
  }
  return true;
 }catch{return false;}
}

/** Call only after fresh extraction and artifact validation; retain source assets in place. */
export async function storeTutorialSnapshot(identity:TutorialSnapshotIdentity,directory:string):Promise<boolean> {
 let temporary:string|undefined;
 try{
  const {root,version,key}=await context(identity);
  const source=await confined(root,directory);
  const checked=await assets(root,source);
  const folder=join(root,'.tutorial-cache');await mkdir(folder,{recursive:true});
  const cache=await confined(root,folder);
  const entry={identity,version,createdAt:Date.now(),directory:relative(root,source),midiHash:checked.midiHash,jsonHash:checked.jsonHash,videoHash:checked.videoHash};
  const serialized=JSON.stringify(entry);if(Buffer.byteLength(serialized)>8192)return false;
  temporary=join(cache,randomUUID()+'.tmp');
  await writeFile(temporary,serialized,{flag:'wx',mode:0o600});
  await rename(temporary,join(cache,key));temporary=undefined;
  return true;
 }catch{return false;}
 finally{if(temporary)await unlink(temporary).catch(()=>{});}
}
