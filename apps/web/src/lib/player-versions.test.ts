import {beforeEach,afterAll,expect,it} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDb,replaceSongsByBase,type SongRow} from '@keyspilli/catalog';
import {getSongDetail,getSongDetailShell} from './catalog-api';

const root=mkdtempSync(join(tmpdir(),'keyspilli-player-versions-'));
const previous=process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR=root;
const original='version-test-original',b='version-test-b',c='version-test-c',other='version-test-other';
const row=(baseId:string):SongRow=>({id:baseId+'-a',baseId,title:'Same title',artist:'Tester',category:'Pop',difficulty:'advanced',difficultyScore:4,key:'C',tempo:120,style:'pop',mood:'neutral',bassPattern:'block',duration:8,contentType:'youtube',acquiredVia:'youtube',sourceYoutubeUrl:'https://www.youtube.com/watch?v=fixture',hasSheetXml:0,sections:null,plays:0,level:'a',createdAt:'2026-10-11T00:00:00Z'});
async function provenance(baseId:string,label:string,sourceBaseId=original){await writeFile(join(root,'artifacts',baseId,'review-provenance.json'),JSON.stringify({version:label,sourceBaseId}));}
beforeEach(async()=>{
 await rm(join(root,'artifacts'),{recursive:true,force:true});
 await writeFile(join(root,'manifest.json'),JSON.stringify({songs:[]}));
 for(const baseId of [original,b,c,other]){
  replaceSongsByBase(baseId,[row(baseId)]);
  await mkdir(join(root,'artifacts',baseId,'a'),{recursive:true});
  await writeFile(join(root,'artifacts',baseId,'a/notes.json'),JSON.stringify({notes:[{midi:60,start:0,dur:1,vel:80,hand:'R'}],chords:[],measures:[{index:0,startBeat:0,endBeat:16}],tempoBpm:120,timeSig:[4,4],key:'C'}));
 }
 await provenance(b,'B');await provenance(c,'C');
});
afterAll(async()=>{getDb().close();if(previous===undefined)delete process.env.KEYSPILLI_DATA_DIR;else process.env.KEYSPILLI_DATA_DIR=previous;await rm(root,{recursive:true,force:true});});

it('exposes the same explicit Original/B/C family on every member and the lightweight sheet shell',async()=>{
 const expected=[{id:original+'-a',label:'Original'},{id:b+'-a',label:'B'},{id:c+'-a',label:'C'}];
 for(const baseId of [original,b,c]){
  expect((await getSongDetail(baseId+'-a'))?.playerVersions).toEqual(expected);
  expect((await getSongDetailShell(baseId+'-a'))?.playerVersions).toEqual(expected);
 }
});
it('does not associate a same-title, same-video import without the explicit source link',async()=>{
 expect((await getSongDetail(other+'-a'))?.playerVersions??[]).toEqual([]);
 await provenance(other,'D','another-original');
 expect((await getSongDetail(original+'-a'))?.playerVersions?.map(v=>v.label)).toEqual(['Original','B','C']);
});
it('omits hidden candidates instead of exposing owner-only rows',async()=>{
 await writeFile(join(root,'manifest.json'),JSON.stringify({songs:[{id:c,disabled:true}]}));
 expect((await getSongDetail(original+'-a'))?.playerVersions?.map(v=>v.label)).toEqual(['Original','B']);
});
it('ignores corrupt and unsafe review metadata while keeping normal playback available',async()=>{
 await writeFile(join(root,'artifacts',b,'review-provenance.json'),'{');
 await provenance(c,'C','../../private');
 const detail=await getSongDetail(original+'-a');
 expect(detail?.data?.notes).toHaveLength(1);
 expect(detail?.playerVersions??[]).toEqual([]);
});
