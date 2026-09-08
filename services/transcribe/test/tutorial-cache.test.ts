import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {reuseTutorialSnapshot,storeTutorialSnapshot} from '../src/tutorial-cache.js';
let root:string,source:string,target:string;
const identity={videoId:'abcdefghijk',artist:'Artist',title:'Song',durationSeconds:120};
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'keyspilli-cache-'));vi.stubEnv('KEYSPILLI_DATA_DIR',root);
 source=join(root,'transcribed','source');target=join(root,'transcribed','target');
 await mkdir(source,{recursive:true});await mkdir(target);
 const video=Buffer.from('video bytes');
 await writeFile(join(source,'video.mp4'),video);
 await writeFile(join(source,'extracted.mid'),'midi bytes');
 await writeFile(join(source,'extracted.json'),JSON.stringify({sourceSha256:createHash('sha256').update(video).digest('hex')}));
});
afterEach(async()=>{vi.unstubAllEnvs();vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});
it('copies only verified raw symbolic assets from a fresh snapshot',async()=>{
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 expect(await reuseTutorialSnapshot(identity,target)).toBe(true);
 expect((await readdir(target)).sort()).toEqual(['extracted.json','extracted.mid']);
 expect(await readFile(join(target,'extracted.mid'),'utf8')).toBe('midi bytes');
});
it.each(['extracted.mid','extracted.json','video.mp4'])('rejects tampered %s',async file=>{
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 await writeFile(join(source,file),'tampered');
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 expect(await readdir(target)).toEqual([]);
});
it('rejects identity, duration, freshness, and extractor-version mismatches',async()=>{
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 expect(await reuseTutorialSnapshot({...identity,artist:'Other'},target)).toBe(false);
 expect(await reuseTutorialSnapshot({...identity,durationSeconds:121},target)).toBe(false);
 const folder=join(root,'transcribed','.tutorial-cache');const index=join(folder,(await readdir(folder))[0]!);
 const entry=JSON.parse(await readFile(index,'utf8'));
 await writeFile(index,JSON.stringify({...entry,version:'old'}));
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 await writeFile(index,JSON.stringify({...entry,createdAt:Date.now()-25*60*60*1000}));
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
});
it('rejects paths escaping the transcribed root and unconfigured cache',async()=>{
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 const outside=join(root,'outside');await mkdir(outside);await symlink(outside,join(root,'transcribed','escape'));
 expect(await reuseTutorialSnapshot(identity,join(root,'transcribed','escape'))).toBe(false);
 const folder=join(root,'transcribed','.tutorial-cache');const index=join(folder,(await readdir(folder))[0]!);
 const entry=JSON.parse(await readFile(index,'utf8'));
 await writeFile(index,JSON.stringify({...entry,directory:'../outside'}));
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 vi.stubEnv('KEYSPILLI_DATA_DIR','');expect(await storeTutorialSnapshot(identity,source)).toBe(false);
});
it('ignores missing, oversized, malformed indexes and mismatched extraction provenance',async()=>{
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 const folder=join(root,'transcribed','.tutorial-cache');const index=join(folder,(await readdir(folder))[0]!);
 await writeFile(index,'x'.repeat(8193));expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 await writeFile(index,'{');expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 await writeFile(join(source,'extracted.json'),JSON.stringify({sourceSha256:'wrong'}));
 expect(await storeTutorialSnapshot(identity,source)).toBe(false);
});

it('removes only its own partial copy when the second destination already exists',async()=>{
 expect(await storeTutorialSnapshot(identity,source)).toBe(true);
 await writeFile(join(target,'extracted.json'),'existing evidence');
 expect(await reuseTutorialSnapshot(identity,target)).toBe(false);
 expect(await readdir(target)).toEqual(['extracted.json']);
 expect(await readFile(join(target,'extracted.json'),'utf8')).toBe('existing evidence');
});
