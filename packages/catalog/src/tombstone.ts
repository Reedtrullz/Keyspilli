import {createHash,randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {open,lstat,readdir,mkdir,rename,rm} from "node:fs/promises";
import {join,dirname} from "node:path";
import {dataDir} from "./paths.js";
import {artifactPublicationRevision,withBaseArtifactLock} from "./publish.js";
import {getDb,getSongsByBase,deleteBaseRows,invalidateSongReadModel} from "./db.js";

const BASE=/^[a-z0-9][a-z0-9-]{0,119}$/,TOKEN=/^[a-f0-9-]{36}$/;
const MAX_BYTES=128*1024*1024,MAX_TOTAL_BYTES=512*1024*1024,MAX_FILES=2048;
type State="quarantining"|"quarantined"|"restoring"|"restored"|"purging"|"purged";
type FileReceipt={path:string;bytes:number;sha256:string};
interface Tombstone {schemaVersion:1;baseId:string;token:string;state:State;title:string;publicationRevision:string;createdAt:string;expiresAt:string;retentionDays:number;bytes:number;rowsHash:string;paths:string[];files:FileReceipt[]}
const active=(state:State)=>state!=="restored"&&state!=="purged";
async function exists(path:string){try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
async function directory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error("unsafe quarantine directory");}
function rowsHash(baseId:string){return createHash("sha256").update(JSON.stringify(getSongsByBase(baseId).sort((a,b)=>a.id.localeCompare(b.id)).map(({plays:_plays,...row})=>row))).digest("hex");}
function safePath(path:string){return path.length<=600&&path.split('/').every(part=>part!=='.'&&part!=='..'&&/^[A-Za-z0-9_.-]+$/.test(part));}
function read(baseId:string):Tombstone|null{
 const row=getDb().prepare("SELECT token,state,payload FROM catalog_tombstones WHERE base_id=?").get(baseId) as {token:string;state:string;payload:string}|undefined;
 if(!row)return null;if(row.payload.length>1048576)throw new Error("invalid tombstone");const value=JSON.parse(row.payload) as Tombstone;
 if(value.schemaVersion!==1||value.baseId!==baseId||!BASE.test(baseId)||value.token!==row.token||!TOKEN.test(value.token)||value.state!==row.state||!["quarantining","quarantined","restoring","restored","purging","purged"].includes(value.state)
   ||typeof value.title!=="string"||value.title.length>160||! /^[A-Za-z0-9_-]{1,128}$/.test(value.publicationRevision)||! /^[a-f0-9]{64}$/.test(value.rowsHash)
   ||![7,14,30].includes(value.retentionDays)||!Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.expiresAt)!==Date.parse(value.createdAt)+value.retentionDays*86400000
   ||!Array.isArray(value.paths)||value.paths.length>1001||new Set(value.paths).size!==value.paths.length||!value.paths.includes(`artifacts/${baseId}`)
   ||value.paths.some(path=>typeof path!=="string"||!safePath(path)||!(path===`artifacts/${baseId}`||new RegExp(`^uploads/${baseId}\\.(mid|xml|mxl)$`).test(path)||/^transcribed\/[A-Za-z0-9_-]{1,180}$/.test(path)))
   ||!Array.isArray(value.files)||value.files.length>MAX_FILES||!value.files.length||new Set(value.files.map(f=>f.path)).size!==value.files.length
   ||value.files.some(f=>typeof f.path!=="string"||!safePath(f.path)||!value.paths.some(path=>f.path===path||f.path.startsWith(`${path}/`))||!Number.isSafeInteger(f.bytes)||f.bytes<0||! /^[a-f0-9]{64}$/.test(f.sha256))
   ||value.bytes!==value.files.reduce((sum,file)=>sum+file.bytes,0)||value.bytes>MAX_BYTES)throw new Error("invalid tombstone");
 return value;
}
function save(value:Tombstone){const payload=JSON.stringify(value);if(payload.length>1048576)throw new Error("tombstone exceeds bounds");getDb().prepare("INSERT INTO catalog_tombstones(base_id,token,state,payload) VALUES(?,?,?,?) ON CONFLICT(base_id) DO UPDATE SET token=excluded.token,state=excluded.state,payload=excluded.payload").run(value.baseId,value.token,value.state,payload);invalidateSongReadModel();}
function receipt(value:Tombstone){return {schemaVersion:1,baseId:value.baseId,token:value.token,state:value.state,title:value.title,publicationRevision:value.publicationRevision,createdAt:value.createdAt,expiresAt:value.expiresAt,retentionDays:value.retentionDays,bytes:value.bytes};}

/** Bounded regular files only. Opened inode hashes bind owned bytes before any move. */
async function scan(root:string,paths:readonly string[]):Promise<FileReceipt[]>{
 const files:FileReceipt[]=[];let bytes=0,entries=0;
 async function visit(path:string,depth:number){
  if(!safePath(path)||depth>8||++entries>4096)throw new Error("quarantine workload exceeds bounds");
  const absolute=join(root,path),info=await lstat(absolute);
  if(info.isSymbolicLink())throw new Error("quarantine refuses symlinks");
  if(info.isDirectory()){const children=await readdir(absolute);if(children.length+entries>4096)throw new Error("quarantine workload exceeds bounds");for(const child of children.sort())await visit(`${path}/${child}`,depth+1);return;}
  if(!info.isFile()||files.length>=MAX_FILES||(bytes+=info.size)>MAX_BYTES)throw new Error("quarantine byte/file budget exceeded");
  const file=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=await file.stat();if(!before.isFile()||before.size!==info.size||before.ino!==info.ino)throw new Error("owned bytes changed");
   const hash=createHash("sha256"),buffer=Buffer.alloc(65536);let count=0;
   while(true){const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;count+=read.bytesRead;if(count>info.size)throw new Error("owned bytes changed");hash.update(buffer.subarray(0,read.bytesRead));}
   const after=await file.stat();if(count!==info.size||after.mtimeMs!==before.mtimeMs||after.size!==before.size)throw new Error("owned bytes changed");files.push({path,bytes:count,sha256:hash.digest("hex")});
  }finally{await file.close();}
 }
 for(const path of paths)await visit(path,0);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function sameFiles(expected:readonly FileReceipt[],actual:readonly FileReceipt[],allowMissing=false){const map=new Map(expected.map(file=>[file.path,file]));if(!allowMissing&&expected.length!==actual.length)throw new Error("owned bytes changed");for(const file of actual){const old=map.get(file.path);if(!old||old.bytes!==file.bytes||old.sha256!==file.sha256)throw new Error("owned bytes changed");}}
function lock<T>(baseId:string,action:()=>Promise<T>){return withBaseArtifactLock(baseId,{artifactsRoot:join(dataDir(),"artifacts"),allowTombstone:true},action);}
async function activeJobs(baseId:string){if(getDb().prepare("SELECT 1 FROM conversion_jobs WHERE status IN ('queued','processing') AND (song_id=? OR song_id IN (SELECT id FROM songs WHERE base_id=?))").get(baseId,baseId))throw new Error("base has an active job");}
async function plan(baseId:string){
 if(!BASE.test(baseId))throw new Error("invalid base ID");if(active(read(baseId)?.state??"restored"))throw new Error("base is quarantined");
 await activeJobs(baseId);const rows=getSongsByBase(baseId);if(!rows.length||rows.length>16)throw new Error("base is unavailable");
 for(const suffix of ["reconciliation.json","new","old"])if(await exists(join(dataDir(),"artifacts",`.${baseId}.${suffix}`)))throw new Error("publication recovery required");
 const revision=await artifactPublicationRevision(baseId,join(dataDir(),"artifacts"));if(!revision)throw new Error("current publication pin required");
 const paths=[`artifacts/${baseId}`];await directory(join(dataDir(),"artifacts"));
 for(const name of ["uploads","transcribed"]){const root=join(dataDir(),name);if(!await exists(root))continue;await directory(root);const names=await readdir(root);if(names.length>10000)throw new Error("owned source inventory exceeds bounds");
  if(name==="uploads"){for(const file of names.filter(file=>file.startsWith(`${baseId}.`))){if(!["mid","xml","mxl"].some(ext=>file===`${baseId}.${ext}`))throw new Error("ambiguous owned upload");paths.push(`${name}/${file}`);}}
  else{const jobs=(getDb().prepare("SELECT id FROM conversion_jobs WHERE song_id=? OR song_id IN (SELECT id FROM songs WHERE base_id=?)").all(baseId,baseId) as {id:string}[]).map(row=>row.id);if(jobs.length>1000||jobs.some(id=>! /^[A-Za-z0-9_-]{1,120}$/.test(id)))throw new Error("owned job inventory exceeds bounds");
   const registered=(getDb().prepare("SELECT id FROM conversion_jobs LIMIT 10001").all() as {id:string}[]).map(row=>row.id);
   if(registered.length>10000)throw new Error("owned job inventory exceeds bounds");
   for(const file of names.filter(file=>jobs.some(id=>file===id||file.startsWith(`${id}-`)))){
    if(registered.some(id=>!jobs.includes(id)&&(file===id||file.startsWith(`${id}-`))))throw new Error("ambiguous owned transcription");
    paths.push(`${name}/${file}`);
   }}
 }
 if(paths.length>1001)throw new Error("owned source inventory exceeds bounds");const files=await scan(dataDir(),paths),bytes=files.reduce((sum,file)=>sum+file.bytes,0);
 return {baseId,title:rows[0]!.title.slice(0,160),publicationRevision:revision,paths,files,bytes,rowsHash:rowsHash(baseId)};
}
export function previewQuarantine(baseId:string){return lock(baseId,async()=>{const value=await plan(baseId);return {baseId:value.baseId,title:value.title,publicationRevision:value.publicationRevision,bytes:value.bytes};});}
export function tombstoneInventory(){const rows=getDb().prepare("SELECT base_id FROM catalog_tombstones ORDER BY base_id LIMIT 101").all() as {base_id:string}[];if(rows.length>100)throw new Error("tombstone inventory exceeds bounds");return rows.map(row=>receipt(read(row.base_id)!));}
export function quarantineBase(baseId:string,expectedRevision:string,retentionDays:number){return lock(baseId,async()=>{
 if(![7,14,30].includes(retentionDays))throw new Error("choose a supported retention policy");
 const value=await plan(baseId);if(value.publicationRevision!==expectedRevision)throw new Error("publication changed");
 const now=Date.now(),record:Tombstone={...value,schemaVersion:1,token:randomUUID(),state:"quarantining",createdAt:new Date(now).toISOString(),expiresAt:new Date(now+retentionDays*86400000).toISOString(),retentionDays};
 getDb().transaction(()=>{
  const inventory=tombstoneInventory(),retained=inventory.filter(item=>active(item.state));
  if(retained.length>=20||inventory.length>=100||retained.reduce((sum,item)=>sum+item.bytes,0)+value.bytes>MAX_TOTAL_BYTES)throw new Error("quarantine storage budget exceeded");
  save(record);
 }).immediate();return operate(record,"finish");
});}
export function operateTombstone(baseId:string,token:string,action:"finish"|"undo"|"purge"){return lock(baseId,async()=>{const value=read(baseId);if(!value||value.token!==token)throw new Error("tombstone changed");return operate(value,action);});}
async function operate(value:Tombstone,action:"finish"|"undo"|"purge"){
 const root=dataDir(),quarantine=join(root,"quarantine"),target=join(quarantine,`${value.baseId}-${value.token}`);
 if(rowsHash(value.baseId)!==value.rowsHash&&value.state!=="purged")throw new Error("catalog rows changed");
 await activeJobs(value.baseId);
 if(action==="finish"&&value.state==="quarantined"||action==="undo"&&value.state==="restored"||action==="purge"&&value.state==="purged")return receipt(value);
 if(action==="finish"&&value.state!=="quarantining"||action==="undo"&&!["quarantined","restoring"].includes(value.state)||action==="purge"&&!["quarantined","purging"].includes(value.state))throw new Error("tombstone state requires the recorded recovery action");
 if(action==="undo"&&value.state!=="restoring"&&Date.now()>=Date.parse(value.expiresAt))throw new Error("undo has expired");
 if(action==="purge"&&value.state!=="purging"&&Date.now()<Date.parse(value.expiresAt))throw new Error("purge requires expiry");
 if(!await exists(quarantine))await mkdir(quarantine);await directory(quarantine);
 if(action==="finish"){if(!await exists(target))await mkdir(target);await directory(target);}
 else if(await exists(target)){await directory(target);const paths=(await readdir(target)).sort();sameFiles(value.files,await scan(target,paths),value.state==="purging"||value.state==="restoring");}
 else if(value.state!=="purging"&&value.state!=="restoring")throw new Error("quarantine bytes are missing");
 if(action!=="finish"){value.state=action==="undo"?"restoring":"purging";save(value);}
 if(action==="purge"){
  for(const path of value.paths)if(await exists(join(root,path)))throw new Error("newer owned path prevents purge");
  await rm(target,{recursive:true,force:true});getDb().transaction(()=>{
   // Removing the guard and rows is one atomic transaction; no other writer can interleave.
   getDb().prepare("DELETE FROM catalog_tombstones WHERE base_id=? AND token=?").run(value.baseId,value.token);
   deleteBaseRows(value.baseId);value.state="purged";save(value);
  }).immediate();return receipt(value);
 }
 for(const path of value.paths){
  const original=join(root,path),saved=join(target,path),from=action==="finish"?original:saved,to=action==="finish"?saved:original;
  await directory(join(root,path.split('/')[0]!));
  const sourceExists=await exists(from),destinationExists=await exists(to);if(sourceExists&&destinationExists||!sourceExists&&!destinationExists)throw new Error("owned path collision or missing bytes");
  const expected=value.files.filter(file=>file.path===path||file.path.startsWith(`${path}/`));
  sameFiles(expected,await scan(sourceExists?(action==="finish"?root:target):(action==="finish"?target:root),[path]));
  if(sourceExists){await mkdir(dirname(to),{recursive:true});await rename(from,to);}
 }
 if(action==="finish"){sameFiles(value.files,await scan(target,(await readdir(target)).sort()));value.state="quarantined";}
 else{sameFiles(value.files,await scan(root,value.paths));if(await artifactPublicationRevision(value.baseId,join(root,"artifacts"))!==value.publicationRevision)throw new Error("restored publication changed");await rm(target,{recursive:true,force:true});value.state="restored";}
 save(value);return receipt(value);
}
