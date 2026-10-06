import { expect,it } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPinnedPlayerAssets, playerReferenceWav } from './player-reference-bank';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('requires explicit permission and local hash-pinned assets without acquisition',()=>{const dir=mkdtempSync(join(tmpdir(),'keyspilli-bank-test-'));try{const module=join(dir,'module.mjs'),asset=join(dir,'sample.ogg'),manifest=join(dir,'assets.json');const code=Buffer.from('export const fixture=true;'),sample=Buffer.from('local fixture');writeFileSync(module,code);writeFileSync(asset,sample);const value={schemaVersion:1,localUsePermission:true,rightsSource:'https://fixture.invalid/rights',moduleVersion:'1.0.0',moduleSha256:hash(code),assets:[{url:'https://fixture.invalid/sample',path:asset,sha256:hash(sample),bytes:sample.length}]};writeFileSync(manifest,JSON.stringify({...value,localUsePermission:false}));expect(()=>readPinnedPlayerAssets(manifest,module)).toThrow(/permission/);writeFileSync(manifest,JSON.stringify(value));expect(readPinnedPlayerAssets(manifest,module).assets.get(value.assets[0]!.url)!.equals(sample)).toBe(true);writeFileSync(asset,'drift');expect(()=>readPinnedPlayerAssets(manifest,module)).toThrow(/hash|bytes/);}finally{rmSync(dir,{recursive:true,force:true});}});
it('preserves stereo Float32 headroom and rejects nonfinite reference samples',()=>{const b=playerReferenceWav([1.5,-1.5]);expect(b.readFloatLE(44)).toBe(1.5);expect(b.readUInt16LE(22)).toBe(2);expect(()=>playerReferenceWav([NaN,0])).toThrow(/nonfinite/);expect(()=>playerReferenceWav([1])).toThrow(/stereo/);});
