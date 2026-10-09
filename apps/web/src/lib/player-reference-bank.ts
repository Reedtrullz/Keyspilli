/** Local pinned assets only; this module never fetches or starts a browser. */
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { assertMusic as check, isHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
export interface PlayerAssetManifest {schemaVersion:1;localUsePermission:true;rightsSource:string;moduleVersion:string;moduleSha256:string;assets:Array<{url:string;path:string;sha256:string;bytes:number}>}
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function bounded(path:string,max:number){check(isAbsolute(path),'absolute asset path required');const s=lstatSync(path);check(s.isFile() && !s.isSymbolicLink() && s.size<=max,'bounded regular asset required');return readFileSync(path);}
export function readPinnedPlayerAssets(manifestPath:string,modulePath:string){
 const manifest=JSON.parse(bounded(manifestPath,1024*1024).toString()) as PlayerAssetManifest;
 check(manifest.schemaVersion===1 && manifest.localUsePermission===true && typeof manifest.rightsSource==='string' && manifest.rightsSource.length>0,'explicit local permission and rights source required');
 const module=bounded(modulePath,4*1024*1024);check(isHash(manifest.moduleSha256) && sha(module)===manifest.moduleSha256 && manifest.moduleVersion==='1.0.0','module identity drift');
 check(Array.isArray(manifest.assets) && manifest.assets.length>0 && manifest.assets.length<=1024,'bounded asset inventory required');
 const assets=new Map<string,Buffer>();let bytes=0;
 for(const pin of manifest.assets){check(/^https?:\/\//.test(pin.url) && !assets.has(pin.url) && isHash(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes>0,'invalid/duplicate asset pin');bytes+=pin.bytes;check(bytes<=512*1024*1024,'sample asset inventory exceeds 512MiB');const b=bounded(pin.path,4*1024*1024);check(b.length===pin.bytes && sha(b)===pin.sha256,'asset hash/bytes drift');assets.set(pin.url,b);}
 return {manifest,module,assets};
}
export function playerReferenceWav(values:number[]):Buffer {
 check(values.length>0 && values.length%2===0 && values.length<=4*44100*2,'bounded stereo reference required');
 const b=Buffer.alloc(44+values.length*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(44100*8,28);b.writeUInt16LE(8,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(values.length*4,40);for(let i=0;i<values.length;i++){check(Number.isFinite(values[i]),'nonfinite reference PCM');b.writeFloatLE(values[i]!,44+i*4);}return b;
}
