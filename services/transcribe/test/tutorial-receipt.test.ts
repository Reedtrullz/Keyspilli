import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
vi.mock('node:fs/promises',async importOriginal=>({
 ...await importOriginal<typeof import('node:fs/promises')>(),
 statfs:async()=>({bavail:1,bsize:4096}),
}));
import {resolveTutorialLink} from '../src/tutorial-route.js';
it('preserves low-storage classification in the private receipt and public error',async()=>{
 const root=await mkdtemp(join(tmpdir(),'keyspilli-receipt-'));
 try{
  const out=join(root,'attempt');
  await expect(resolveTutorialLink('https://youtu.be/abcdefghijk',out)).rejects.toThrow('insufficient free disk space');
  const receipt=JSON.parse(await readFile(join(out,'receipt.json'),'utf8'));
  expect(receipt.status).toBe('failed');expect(receipt.reason).toContain('insufficient free disk space');
 }finally{await rm(root,{recursive:true,force:true});}
});
