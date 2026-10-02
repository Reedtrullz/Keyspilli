import {resolveSourcePedalNotes,validatePlaybackData,type SongData} from "@keyspilli/player-core";

export const OFFLINE_PACK_BYTES=8*1024**2;
export interface OfflinePack {
 version:1;variantId:string;title:string;artist:string;revision:string;sourceFingerprint:string;
 createdAt:string;expiresAt:string;rights:"owner-confirmed-private-use";data:SongData;
 artifacts:{midi:{base64:string;sha256:string};musicxml:{base64:string;sha256:string}};digest:string;
}
const encoder=new TextEncoder();
export async function offlineHash(value:string|Uint8Array):Promise<string>{
 const bytes=typeof value==="string"?encoder.encode(value):value;
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))].map(v=>v.toString(16).padStart(2,"0")).join("");
}
const fields="version variantId title artist revision sourceFingerprint createdAt expiresAt rights data artifacts digest".split(" ");
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
export async function validateOfflinePack(raw:unknown,now=Date.now()):Promise<OfflinePack>{
 if(!object(raw)||Object.keys(raw).sort().join(" ")!==[...fields].sort().join(" ")||encoder.encode(JSON.stringify(raw)).length>OFFLINE_PACK_BYTES)throw Error("Offline pack is invalid or exceeds 8 MiB.");
 const p=raw as unknown as OfflinePack;
 const text=(v:unknown,max:number)=>typeof v==="string"&&v.length>0&&v.length<=max;
 if(p.version!==1||!text(p.variantId,200)||!/^[A-Za-z0-9_-]+$/.test(p.variantId)||!text(p.revision,128)||!/^[A-Za-z0-9_-]+$/.test(p.revision)||!text(p.title,200)||typeof p.artist!=="string"||p.artist.length>200||!text(p.sourceFingerprint,4096)||p.rights!=="owner-confirmed-private-use")throw Error("Offline pack metadata is invalid.");
 const created=Date.parse(p.createdAt),expires=Date.parse(p.expiresAt);
 if(!Number.isFinite(created)||!Number.isFinite(expires)||expires<=created||expires-created>30*86400000||created>now+60000)throw Error("Offline pack dates are invalid.");
 if(now>=expires)throw Error("Offline pack expired. Remove it or prepare a fresh pack online.");
 const d=p.data;
 if(!object(d)||Object.keys(d).some(k=>!["notes","chords","measures","key","tempoBpm","timeSig","timeSigEvents","sourcePedal"].includes(k))||!Array.isArray(d.notes)||!d.notes.length||d.notes.length>4096||!Array.isArray(d.chords)||d.chords.length>2048||!Array.isArray(d.measures)||!d.measures.length||d.measures.length>256||!text(d.key,32)||!Number.isFinite(d.tempoBpm)||d.tempoBpm<20||d.tempoBpm>400||!Array.isArray(d.timeSig)||d.timeSig.length!==2||!Number.isInteger(d.timeSig[0])||d.timeSig[0]<1||d.timeSig[0]>32||![1,2,4,8,16,32].includes(d.timeSig[1])||validatePlaybackData(d).length)throw Error("Offline arrangement is outside the supported bounds.");
 if(d.timeSigEvents!==undefined&&(!Array.isArray(d.timeSigEvents)||d.timeSigEvents.length>512||d.timeSigEvents.some(e=>!object(e)||!Number.isFinite(e.beat)||e.beat<0||!Array.isArray(e.timeSig)||e.timeSig.length!==2||!Number.isInteger(e.timeSig[0])||e.timeSig[0]<1||e.timeSig[0]>32||![1,2,4,8,16,32].includes(e.timeSig[1]))))throw Error("Offline meter declarations are invalid.");
 if(d.measures.some((m,i)=>!object(m)||Object.keys(m).sort().join(" ")!=="endBeat index startBeat"||m.index!==i||m.endBeat>512||i>0&&m.startBeat<d.measures[i-1]!.endBeat))throw Error("Offline measure map is invalid.");
 for(const n of d.notes){
  if(!object(n)||Object.keys(n).some(k=>!["midi","start","dur","vel","hand","sourcePitch","sourceMidiChannel"].includes(k))||!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isInteger(n.vel)||n.vel<0||n.vel>127||(n.hand!==undefined&&n.hand!=="R"&&n.hand!=="L"))throw Error("Offline note is invalid.");
 }
 if(d.chords.some(c=>!object(c)||Object.keys(c).some(k=>!["beat","name","notes","sourceKind","inferred","inferenceType","durationBeats","reviewReason"].includes(k))||!Number.isFinite(c.beat)||c.beat<0||!text(c.name,100)||!Array.isArray(c.notes)||c.notes.length>16||c.notes.some(v=>!Number.isInteger(v)||v<0||v>127)))throw Error("Offline harmony is invalid.");
 const notes=resolveSourcePedalNotes(d,1,0),end=Math.max(...notes.map(n=>n.startSec+(n.soundingDurSec??n.durSec)));
 if(!notes.length||end>240)throw Error("Offline packs support at most four minutes of Original playback.");
 const voices=notes.flatMap(n=>[[n.startSec,1],[n.startSec+(n.soundingDurSec??n.durSec),-1]] as [number,number][]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let held=0;
 if(voices.some(([,delta])=>(held+=delta)>64))throw Error("Offline arrangement exceeds 64 simultaneous voices.");
 if(!object(p.artifacts)||Object.keys(p.artifacts).sort().join(" ")!=="midi musicxml")throw Error("Offline artifact inventory is invalid.");
 for(const item of Object.values(p.artifacts)){
  if(!object(item)||Object.keys(item).sort().join(" ")!=="base64 sha256"||typeof item.base64!=="string"||!item.base64.length||item.base64.length>OFFLINE_PACK_BYTES||item.base64.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)||typeof item.sha256!=="string"||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error("Offline artifact is invalid.");
  const bytes=Uint8Array.from(atob(item.base64),c=>c.charCodeAt(0));if(await offlineHash(bytes)!==item.sha256)throw Error("Offline artifact integrity check failed.");
 }
 const {digest,...body}=p;if(!/^[a-f0-9]{64}$/.test(digest)||await offlineHash(JSON.stringify(body))!==digest)throw Error("Offline pack integrity check failed.");
 return p;
}
export async function readOfflineResponse(response:Response):Promise<OfflinePack>{
 if(!response.ok||!response.body)throw Error("Offline pack unavailable; reload its publication and try again.");
 const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text="";
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>OFFLINE_PACK_BYTES)throw Error("Offline pack exceeds 8 MiB.");text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return await validateOfflinePack(JSON.parse(text));}finally{await reader.cancel().catch(()=>{});}
}
async function storage<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  let abandoned=false;const open=indexedDB.open("keyspilli.offline.v1",1);open.onupgradeneeded=()=>open.result.createObjectStore("pack");open.onerror=()=>reject(Error("Offline storage unavailable."));open.onblocked=()=>{abandoned=true;reject(Error("Close other offline tabs and retry."));};
  open.onsuccess=()=>{const db=open.result;if(abandoned){db.close();return;}let tx:IDBTransaction|null=null;try{tx=db.transaction("pack",mode);const request=action(tx.objectStore("pack"));tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onabort=tx.onerror=()=>{db.close();reject(Error("Offline storage is full or unavailable. The previous pack was retained."));};}catch{tx?.abort();db.close();reject(Error("Offline storage is full or unavailable. The previous pack was retained."));}};
 });
}
export async function loadOfflinePack():Promise<OfflinePack|null>{const raw=await storage<string|undefined>("readonly",store=>store.get("selected"));if(raw===undefined)return null;if(raw.length>OFFLINE_PACK_BYTES)throw Error("Stored pack exceeds 8 MiB.");const value=JSON.parse(raw);if(value&&typeof value.expiresAt==="string"&&Date.now()>=Date.parse(value.expiresAt)){await removeOfflinePack();throw Error("Expired pack removed. Prepare a fresh pack online.");}return validateOfflinePack(value);}
export async function saveOfflinePack(pack:OfflinePack):Promise<void>{await validateOfflinePack(pack);await storage("readwrite",store=>store.put(JSON.stringify(pack),"selected"));notify();}
export async function removeOfflinePack():Promise<void>{await storage("readwrite",store=>store.delete("selected"));notify();}
function notify(){if(typeof BroadcastChannel!=="undefined"){const channel=new BroadcastChannel("keyspilli.offline");channel.postMessage("changed");channel.close();}}
