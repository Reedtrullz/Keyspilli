import {afterAll,expect,it} from "vitest";
import {mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {writeMidi} from "@keyspilli/midi";
import {getDb,getSong,getSongsByBase,insertJob,removeSongsByBase,replaceSongsByBase} from "../src/db.js";
import {ingestSource} from "../src/ingest.js";
import {previewQuarantine,quarantineBase,operateTombstone,tombstoneInventory} from "../src/tombstone.js";
const old=process.env.KEYSPILLI_DATA_DIR,root=mkdtempSync(join(tmpdir(),"keyspilli-tombstone-"));process.env.KEYSPILLI_DATA_DIR=root;
afterAll(()=>{getDb().close();rmSync(root,{recursive:true,force:true});if(old===undefined)delete process.env.KEYSPILLI_DATA_DIR;else process.env.KEYSPILLI_DATA_DIR=old;});
const source=writeMidi(Array.from({length:16},(_,i)=>({midi:60+i%7,start:i,dur:1,vel:80})),{tempoBpm:120});
async function fixture(baseId:string){expect((await ingestSource({baseId,buf:source,title:baseId,artist:"Test",contentType:"upload"})).error).toBeUndefined();return previewQuarantine(baseId);}
it("quarantines exact owned bytes, hides every public read, preserves rows, blocks writers and restores without resurrecting jobs",async()=>{
 const baseId="trash-test",preview=await fixture(baseId),rows=getSongsByBase(baseId),xml=readFileSync(join(root,"artifacts",baseId,"a","variant.xml"));
 writeFileSync(join(root,"uploads","unrelated.mid"),"unrelated");
 await expect(quarantineBase(baseId,"stale",14)).rejects.toThrow(/changed/);
 const receipt=await quarantineBase(baseId,preview.publicationRevision!,14);
 expect(receipt.state).toBe("quarantined");
 expect(()=>removeSongsByBase(baseId)).toThrow(/quarantined/);expect(()=>replaceSongsByBase(baseId,rows)).toThrow(/quarantined/);expect(()=>getDb().prepare("UPDATE songs SET title='changed' WHERE base_id=?").run(baseId)).toThrow(/quarantined/);
 const fixtureRepo=join(root,"fixture-repo");mkdirSync(join(fixtureRepo,"catalog"),{recursive:true});mkdirSync(join(fixtureRepo,"packages"));writeFileSync(join(fixtureRepo,"catalog","manifest.json"),JSON.stringify({songs:[{id:baseId,disabled:true}]}));
 const pipeline=resolve(import.meta.dirname,"../scripts/pipeline.ts");expect(execFileSync(process.execPath,["--import",import.meta.resolve("tsx"),pipeline],{cwd:fixtureRepo,env:process.env,timeout:10000,maxBuffer:16384}).toString()).toContain("quarantined, rows and owned bytes retained");
 expect(getSongsByBase(baseId)).toEqual(rows);
expect(getSong(`${baseId}-a`)).toBeUndefined();expect(getSongsByBase(baseId)).toEqual(rows);
 expect(existsSync(join(root,"uploads",`${baseId}.mid`))).toBe(false);expect(readFileSync(join(root,"uploads","unrelated.mid"),"utf8")).toBe("unrelated");
 expect((await ingestSource({baseId,buf:source,title:"Overwrite",artist:"Test",contentType:"upload"})).error).toMatch(/quarantin/);
 await expect(operateTombstone(baseId,"wrong-token","undo")).rejects.toThrow(/changed/);
 await operateTombstone(baseId,receipt.token,"undo");expect(getSong(`${baseId}-a`)).toBeDefined();expect(getSongsByBase(baseId)).toEqual(rows);
 expect(readFileSync(join(root,"artifacts",baseId,"a","variant.xml"))).toEqual(xml);expect(new Uint8Array(readFileSync(join(root,"uploads",`${baseId}.mid`)))).toEqual(source);
});
it("retains a hidden restartable intent across a storage failure, refuses active jobs and gates expired undo/manual purge",async()=>{
 const baseId="trash-retry",preview=await fixture(baseId);
 insertJob({id:"trash-active",youtubeUrl:"https://www.youtube.com/watch?v=abcdefghijk",status:"queued",songId:`${baseId}-a`,error:null,createdAt:new Date().toISOString(),finishedAt:null});
 await expect(quarantineBase(baseId,preview.publicationRevision!,7)).rejects.toThrow(/active job/);getDb().prepare("UPDATE conversion_jobs SET status='done' WHERE id=?").run("trash-active");
 rmSync(join(root,"quarantine"),{recursive:true,force:true});writeFileSync(join(root,"quarantine"),"storage obstacle");await expect(quarantineBase(baseId,preview.publicationRevision!,7)).rejects.toThrow();expect(getSong(`${baseId}-a`)).toBeUndefined();
 const receipt=(await tombstoneInventory()).find(t=>t.baseId===baseId)!;expect(receipt.state).toBe("quarantining");rmSync(join(root,"quarantine"));
 const moduleUrl=pathToFileURL(resolve(import.meta.dirname,"../src/tombstone.ts")).href;
 const child=execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",`import {operateTombstone} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await operateTombstone(${JSON.stringify(baseId)},${JSON.stringify(receipt.token)},"finish")));`],{env:process.env,timeout:10000,maxBuffer:16384});
 expect(JSON.parse(child.toString()).state).toBe("quarantined");expect((await tombstoneInventory()).find(t=>t.baseId===baseId)!.state).toBe("quarantined");
 await expect(operateTombstone(baseId,receipt.token,"purge")).rejects.toThrow(/expiry/);
 const saved=getDb().prepare("SELECT payload FROM catalog_tombstones WHERE base_id=?").get(baseId) as {payload:string};const data=JSON.parse(saved.payload);data.createdAt="2000-01-01T00:00:00.000Z";data.expiresAt="2000-01-08T00:00:00.000Z";getDb().prepare("UPDATE catalog_tombstones SET payload=? WHERE base_id=?").run(JSON.stringify(data),baseId);
 await expect(operateTombstone(baseId,receipt.token,"undo")).rejects.toThrow(/expired/);await operateTombstone(baseId,receipt.token,"purge");expect(getSongsByBase(baseId)).toHaveLength(0);expect((await tombstoneInventory()).find(t=>t.baseId===baseId)!.state).toBe("purged");
});

it("resumes a partially restored tree without overwriting a collision or exposing a mixed publication",async()=>{
 const baseId="trash-partial",preview=await fixture(baseId),original=readFileSync(join(root,"uploads",`${baseId}.mid`));
 const receipt=await quarantineBase(baseId,preview.publicationRevision!,7);
 writeFileSync(join(root,"uploads",`${baseId}.mid`),"newer collision");
 await expect(operateTombstone(baseId,receipt.token,"undo")).rejects.toThrow(/collision/);
 expect(existsSync(join(root,"artifacts",baseId))).toBe(true);expect(getSong(`${baseId}-a`)).toBeUndefined();expect(readFileSync(join(root,"uploads",`${baseId}.mid`),"utf8")).toBe("newer collision");
 expect(tombstoneInventory().find(t=>t.baseId===baseId)!.state).toBe("restoring");
 rmSync(join(root,"uploads",`${baseId}.mid`));await operateTombstone(baseId,receipt.token,"undo");expect(getSong(`${baseId}-a`)).toBeDefined();expect(readFileSync(join(root,"uploads",`${baseId}.mid`))).toEqual(original);
});

it("refuses a legacy filename that also belongs to another registered job",async()=>{
 const baseId="trash-prefix",preview=await fixture(baseId),dir=join(root,"transcribed");mkdirSync(dir,{recursive:true});
 for(const [id,songId] of [["shared-prefix",`${baseId}-a`],["shared-prefix-other","unrelated-a"]] as const)insertJob({id,youtubeUrl:"https://www.youtube.com/watch?v=abcdefghijk",status:"done",songId,error:null,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString()});
 const path=join(dir,"shared-prefix-other-notes.mid");writeFileSync(path,"another job");
 await expect(quarantineBase(baseId,preview.publicationRevision!,7)).rejects.toThrow(/ambiguous owned/);
 expect(readFileSync(path,"utf8")).toBe("another job");expect(getSong(`${baseId}-a`)).toBeDefined();
});
