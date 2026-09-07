import {afterAll,expect,it,vi} from "vitest";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {writeMidi} from "@keyspilli/midi";
const resolver=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("../src/tutorial-route.js",()=>({resolveTutorialLink:resolver.run}));
const dir=mkdtempSync(join(tmpdir(),"keyspilli-tutorial-worker-"));
vi.stubEnv("KEYSPILLI_DATA_DIR",dir);
vi.stubEnv("KEYSPILLI_TUTORIAL_PREVIEW","1");
vi.stubEnv("NODE_ENV","development");
afterAll(()=>{vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
async function queue(id:string){
 const {insertJob}=await import("@keyspilli/catalog");
 insertJob({id,youtubeUrl:"https://www.youtube.com/watch?v=abcdefghijk",status:"queued",songId:null,error:null,createdAt:new Date().toISOString(),finishedAt:null});
}
function candidate(){
 const midiPath=join(dir,"fixture.mid");
 writeFileSync(midiPath,writeMidi(Array.from({length:32},(_,i)=>({midi:64+i%4,start:i*2,dur:1,vel:80,hand:"R" as const})),{tempoBpm:120}));
 writeFileSync(join(dir,"fixture.json"),JSON.stringify({sourceSha256:"a".repeat(64)}));
 return {status:"local-listening-candidate",midiPath,selectedUrl:"https://www.youtube.com/watch?v=lmnopqrstuv",
  identity:{artist:"Fixture",title:"Piano"},candidates:[{url:"https://www.youtube.com/watch?v=lmnopqrstuv",title:"Fixture Piano Tutorial"}]};
}
it("does not run unverified tutorial preview in production",async()=>{
 const {processJob}=await import("../src/worker.js");const {getJob}=await import("@keyspilli/catalog");
 await queue("production-denied");vi.stubEnv("NODE_ENV","production");
 try{await processJob("production-denied");}finally{vi.stubEnv("NODE_ENV","development");}
 expect(getJob("production-denied")?.status).toBe("error");expect(resolver.run).not.toHaveBeenCalled();
});
it("runs queued preview through ingest with honest source provenance",async()=>{
 const {processJob}=await import("../src/worker.js");const {getJob,getSongsByBase,readArrangementManifest}=await import("@keyspilli/catalog");
 resolver.run.mockResolvedValue(candidate());await queue("preview-success");await processJob("preview-success");
 expect(getJob("preview-success")?.status).toBe("done");
 expect(getSongsByBase("preview-preview-success")).toHaveLength(6);
 const manifest=await readArrangementManifest("preview-preview-success");
 expect(manifest.status).toBe("valid");
 if(manifest.status==="valid")expect(manifest.manifest.sourceArrangement).toMatchObject({sourceKind:"tutorial-preview",license:"unverified",containsMelody:null});
});
it("does not ingest an unsupported tutorial",async()=>{
 const {processJob}=await import("../src/worker.js");const {getJob,getSongsByBase}=await import("@keyspilli/catalog");
 resolver.run.mockResolvedValue({status:"no-supported-source"});await queue("unsupported");await processJob("unsupported");
 expect(getJob("unsupported")?.status).toBe("error");expect(getSongsByBase("preview-unsupported")).toHaveLength(0);
});
it("cannot recreate a cancelled job's song",async()=>{
 const {processJob}=await import("../src/worker.js");const {getDb,getSongsByBase}=await import("@keyspilli/catalog");
 resolver.run.mockImplementation(async()=>{getDb().prepare("DELETE FROM conversion_jobs WHERE id = ?").run("cancelled");return candidate();});
 await queue("cancelled");await processJob("cancelled");expect(getSongsByBase("preview-cancelled")).toHaveLength(0);
});
