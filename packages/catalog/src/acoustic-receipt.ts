/** Raw seconds, never normalized MIDI container defaults. No inference imports. */
import {createHash} from 'node:crypto';
export interface AnalyzerIdentity {id:string;version:string;checkpointSha256:string;codeSha256:string;frontendSha256:string;configSha256:string;runtime:string;device:string;precision:string;config:Record<string,unknown>}
export interface AcousticNote {id:string;midi:number;onsetSeconds:number;keyOffsetSeconds:number|null;soundingOffsetSeconds:number|null;confidence:number|null}
export interface AcousticReceipt {schemaVersion:1;kind:'keyspilli-acoustic-receipt';status:'ok'|'unavailable'|'failed';audio:{sha256:string;durationSeconds:number;sampleRate:number;channels:number;frames:number;derivativeSha256:string|null};analyzer:AnalyzerIdentity;notes:AcousticNote[];rejectedRows:number;metadata:{tempoBpm:number|null;key:string|null;meter:[number,number]|null;origin:'unknown'|'measured'|'container-default'};resources:{elapsedSeconds:number;peakRssBytes:number|null};limitations:string[]}
export function stableIdentity(value:unknown):string {if(Array.isArray(value))return '['+value.map(stableIdentity).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableIdentity(v)).join(',')+'}';if(typeof value==='number'&&!Number.isFinite(value))throw new Error('nonfinite identity');const text=JSON.stringify(value);if(text===undefined)throw new Error('non-JSON identity');return text;}
export const identityHash=(value:unknown)=>createHash('sha256').update(stableIdentity(value)).digest('hex');
export function acousticCacheKey(identity:AnalyzerIdentity):string{return 'acoustic-v1:'+identityHash(identity);}
export function assertMusic(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
export const finiteSeconds=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export const isHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function parseAcousticReceipt(value:unknown):AcousticReceipt {
 assertMusic(value&&typeof value==='object','receipt must be an object');const r=value as AcousticReceipt;
 assertMusic(r.schemaVersion===1&&r.kind==='keyspilli-acoustic-receipt'&&['ok','unavailable','failed'].includes(r.status),'unsupported acoustic receipt');
 assertMusic(r.audio&&isHash(r.audio.sha256)&&finiteSeconds(r.audio.durationSeconds)&&r.audio.durationSeconds>0&&r.audio.durationSeconds<=30,'invalid audio pin');
 assertMusic(Number.isInteger(r.audio.sampleRate)&&r.audio.sampleRate>=8000&&r.audio.sampleRate<=48000&&[1,2].includes(r.audio.channels)&&Number.isSafeInteger(r.audio.frames)&&r.audio.frames>0&&Math.abs(r.audio.frames/r.audio.sampleRate-r.audio.durationSeconds)<1e-8,'invalid audio clock');
 assertMusic(r.audio.derivativeSha256===null||isHash(r.audio.derivativeSha256),'invalid derivative identity');
 assertMusic(r.analyzer&&['id','version','runtime','device','precision'].every(k=>typeof r.analyzer[k as keyof AnalyzerIdentity]==='string'&&String(r.analyzer[k as keyof AnalyzerIdentity]).length>0),'missing analyzer identity');
 assertMusic(['checkpointSha256','codeSha256','frontendSha256','configSha256'].every(k=>isHash(r.analyzer[k as keyof AnalyzerIdentity])),'missing analyzer digests');
 assertMusic(r.analyzer.config&&typeof r.analyzer.config==='object'&&!Array.isArray(r.analyzer.config),'invalid analyzer config');stableIdentity(r.analyzer);
 assertMusic(Array.isArray(r.notes)&&r.notes.length<=20000&&(r.status==='ok'||r.notes.length===0),'invalid note inventory');const ids=new Set<string>();
 for(const n of r.notes){assertMusic(n&&typeof n.id==='string'&&n.id.length>0&&!ids.has(n.id),'duplicate or missing note ID');ids.add(n.id);assertMusic(Number.isInteger(n.midi)&&n.midi>=0&&n.midi<=127&&finiteSeconds(n.onsetSeconds)&&n.onsetSeconds<r.audio.durationSeconds,'invalid raw note');for(const offset of [n.keyOffsetSeconds,n.soundingOffsetSeconds])assertMusic(offset===null||(finiteSeconds(offset)&&offset>=n.onsetSeconds&&offset<=r.audio.durationSeconds),'invalid offset');assertMusic(n.confidence===null||(finiteSeconds(n.confidence)&&n.confidence<=1),'invalid confidence');}
 assertMusic(Number.isSafeInteger(r.rejectedRows)&&r.rejectedRows>=0,'invalid rejected rows');
 assertMusic(r.metadata&&['unknown','measured','container-default'].includes(r.metadata.origin),'missing metadata origin');
 assertMusic(r.metadata.tempoBpm===null||(finiteSeconds(r.metadata.tempoBpm)&&r.metadata.tempoBpm>0),'invalid tempo');assertMusic(r.metadata.key===null||typeof r.metadata.key==='string','invalid key');assertMusic(r.metadata.meter===null||(Array.isArray(r.metadata.meter)&&r.metadata.meter.length===2&&r.metadata.meter.every(x=>Number.isInteger(x)&&x>0)),'invalid meter');
 assertMusic(r.metadata.origin!=='unknown'||(r.metadata.tempoBpm===null&&r.metadata.key===null&&r.metadata.meter===null),'unknown metadata must remain unknown');
 assertMusic(r.resources&&finiteSeconds(r.resources.elapsedSeconds)&&(r.resources.peakRssBytes===null||finiteSeconds(r.resources.peakRssBytes)),'invalid resource receipt');assertMusic(Array.isArray(r.limitations)&&r.limitations.every(x=>typeof x==='string'),'invalid limitations');
 return JSON.parse(JSON.stringify(r)) as AcousticReceipt;
}
