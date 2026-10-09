/** Renderer-informed history only. Labels assert provenance; hashes do not authenticate it. */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { assertMusic as check, finiteSeconds, isHash } from './acoustic-receipt.js';
export interface PlayerSignalPinV1 {path:string;sha256:string;encoding:'pcm-f32le'|'pcm-s16le';sampleRate:number;channels:1|2;frames:number}
export interface PairedPlayerCaptureV1 {
 schemaVersion:1;kind:'keyspilli-player-paired-capture';id:string;input:PlayerSignalPinV1;output:PlayerSignalPinV1;forwardOutput:PlayerSignalPinV1;firstSampleContextSeconds:number;
 renderer:{moduleVersion:string;moduleSha256:string;browserVersion:string};
 compressor:{threshold:number;knee:number;ratio:number;attack:number;release:number};sampleAssetPins:Array<{url:string;sha256:string;bytes:number}>;
}
export interface PlayerInputEvidenceReceiptV1 {
 schemaVersion:1;kind:'keyspilli-player-input-evidence';captureSha256:string;inputSha256:string;analyzerSha256:string;referenceBankSha256:string;
 fitInterval:{startSeconds:0;endSeconds:1.2};status:'matched'|'uncertain'|'unavailable'|'failed';support?:{schemaVersion:1;policySha256:string;status:'supported'|'ambiguous'|'not-computed';minimumRemovalMargin:number|null;minimumAlternativeMargin:number|null};historyPitchCandidates:number[]|null;rawResidual:number|null;currentPitchSetEstimate:null;completeness:'unknown';audibility:'not-established';resources:{elapsedSeconds:number;peakRssBytes:number};limitations:string[];
}
const MAX_BYTES=2*1024*1024;
function parseSignal(p:PlayerSignalPinV1,label:string):void {
 check(p && typeof p.path==='string' && isAbsolute(p.path) && isHash(p.sha256),`invalid ${label} path/hash`);
 check(p.sampleRate===44100 && Number.isSafeInteger(p.frames) && p.frames>0 && p.frames<=4*p.sampleRate,`invalid ${label} frames/rate`);
 const input=label!=='output';check(p.encoding===(input?'pcm-f32le':'pcm-s16le') && p.channels===(label==='input'?2:1),`invalid ${label} encoding/channels`);
 check(p.frames*p.channels*(input?4:2)+44<=MAX_BYTES,`oversized ${label}`);
}
export function parsePairedPlayerCapture(value:unknown):PairedPlayerCaptureV1 {
 check(value && typeof value==='object','invalid paired capture');const r=value as PairedPlayerCaptureV1;
 check(r.schemaVersion===1 && r.kind==='keyspilli-player-paired-capture' && typeof r.id==='string' && /^[\w-]{1,120}$/.test(r.id),'unsupported paired capture');
 parseSignal(r.input,'input');parseSignal(r.output,'output');parseSignal(r.forwardOutput,'forward output');
 check(r.input.frames===r.output.frames && r.output.frames===r.forwardOutput.frames,'mismatched signal frames');
 check(finiteSeconds(r.firstSampleContextSeconds),'invalid frame clock');
 check(r.renderer && typeof r.renderer.moduleVersion==='string' && r.renderer.moduleVersion.length>0 && isHash(r.renderer.moduleSha256) && typeof r.renderer.browserVersion==='string' && r.renderer.browserVersion.length>0,'invalid renderer identity');
 const c=r.compressor;check(c && [c.threshold,c.knee,c.ratio,c.attack,c.release].every(Number.isFinite) && c.threshold>=-100 && c.threshold<=0 && c.knee>=0 && c.knee<=40 && c.ratio>=1 && c.ratio<=20 && c.attack>=0 && c.attack<=1 && c.release>=0 && c.release<=1,'invalid compressor profile');
 check(Array.isArray(r.sampleAssetPins) && r.sampleAssetPins.length>0 && r.sampleAssetPins.length<=1024 && r.sampleAssetPins.every(p=>p && typeof p.url==='string' && /^https?:\/\//.test(p.url) && isHash(p.sha256) && Number.isSafeInteger(p.bytes) && p.bytes>0),'invalid sample asset pins');
 return r;
}
export function validatePlayerSignalBytes(pin:PlayerSignalPinV1,b:Buffer):void {
 check(b.length>=44 && b.length<=MAX_BYTES && createHash('sha256').update(b).digest('hex')===pin.sha256,'signal bytes/hash mismatch');
 check(b.toString('ascii',0,4)==='RIFF' && b.readUInt32LE(4)+8===b.length && b.toString('ascii',8,12)==='WAVE','invalid RIFF');
 let fmt:Buffer|undefined,data:Buffer|undefined;
 for(let at=12;at+8<=b.length;){const n=b.readUInt32LE(at+4),end=at+8+n;check(end<=b.length,'truncated WAV chunk');const id=b.toString('ascii',at,at+4);if(id==='fmt '){check(!fmt,'duplicate fmt');fmt=b.subarray(at+8,end);}if(id==='data'){check(!data,'duplicate data');data=b.subarray(at+8,end);}at=end+(n%2);}
 check(fmt && fmt.length>=16 && data,'missing WAV fmt/data');const width=pin.encoding==='pcm-f32le'?4:2;
 check(fmt.readUInt16LE(0)===(width===4?3:1) && fmt.readUInt16LE(2)===pin.channels && fmt.readUInt32LE(4)===pin.sampleRate && fmt.readUInt16LE(14)===width*8 && fmt.readUInt16LE(12)===width*pin.channels && fmt.readUInt32LE(8)===width*pin.channels*pin.sampleRate,'WAV encoding/rate mismatch');
 check(data.length===pin.frames*pin.channels*width,'WAV frames mismatch');
 if(width===4)for(let at=0;at<data.length;at+=4)check(Number.isFinite(data.readFloatLE(at)),'nonfinite Float32 signal');
}
export function parsePlayerInputEvidence(value:unknown):PlayerInputEvidenceReceiptV1 {
 check(value && typeof value==='object','invalid Player input receipt');const r=value as PlayerInputEvidenceReceiptV1;
 check(r.schemaVersion===1 && r.kind==='keyspilli-player-input-evidence' && ['matched','uncertain','unavailable','failed'].includes(r.status),'unsupported Player input receipt');
 check([r.captureSha256,r.inputSha256,r.analyzerSha256,r.referenceBankSha256].every(isHash),'invalid Player receipt identity');
 check(r.fitInterval?.startSeconds===0 && r.fitInterval.endSeconds===1.2,'unsupported history interval');
 check(r.currentPitchSetEstimate===null && r.completeness==='unknown' && r.audibility==='not-established','unsupported acceptance claim');
 check(r.resources && finiteSeconds(r.resources.elapsedSeconds) && Number.isSafeInteger(r.resources.peakRssBytes) && r.resources.peakRssBytes>=0 && r.resources.peakRssBytes<=2*1024**3,'unbounded resources');
 check(Array.isArray(r.limitations) && r.limitations.length>0 && r.limitations.every(s=>typeof s==='string' && s.length>0),'limitations required');
 check(r.rawResidual===null || (finiteSeconds(r.rawResidual) && r.rawResidual<=1),'invalid residual');
 if(r.support!==undefined){
  const s=r.support;
  check(s.schemaVersion===1 && isHash(s.policySha256) && ['supported','ambiguous','not-computed'].includes(s.status),'invalid support receipt');
  for(const margin of [s.minimumRemovalMargin,s.minimumAlternativeMargin])check(margin===null || (finiteSeconds(margin) && margin>=0 && margin<=1),'invalid support margin');
  if(r.status==='matched')check(s.status==='supported','matched receipt requires supported support');
 }
 if(r.status==='matched')check(Array.isArray(r.historyPitchCandidates) && r.historyPitchCandidates.length>0 && r.historyPitchCandidates.length<=8 && r.historyPitchCandidates.every((m,i,a)=>Number.isInteger(m) && m>=21 && m<=108 && (i===0 || m>a[i-1]!)) && r.rawResidual!==null && r.rawResidual<=.05,'invalid accepted history');
 else check(r.historyPitchCandidates===null,'uncertain history must withhold candidates');
 return r;
}
