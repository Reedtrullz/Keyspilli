import {afterAll,expect,it,vi} from "vitest";
import {existsSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {writeMidi} from "@keyspilli/midi";
const resolver=vi.hoisted(()=>({run:vi.fn()}));
const publication=vi.hoisted(()=>({afterFence:null as null|(()=>Promise<void>),beforeJournalRemoval:null as null|(()=>void)}));
vi.mock("../src/tutorial-route.js",()=>({resolveTutorialLink:resolver.run}));
vi.mock("node:fs/promises",async original=>{
 const actual=await original<typeof import("node:fs/promises")>();
 return {...actual,rm:async(...args:Parameters<typeof actual.rm>)=>{
  if(String(args[0]).endsWith(".reconciliation.json") && publication.beforeJournalRemoval){const hook=publication.beforeJournalRemoval;publication.beforeJournalRemoval=null;hook();}
  return actual.rm(...args);
 },writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{
  await actual.writeFile(...args);
  if(String(args[0]).endsWith("/.publication-id") && publication.afterFence){const hook=publication.afterFence;publication.afterFence=null;await hook();}
 }};
});
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
 if(manifest.status==="valid")expect(manifest.manifest.tempo?.playback.source).toBe("default");
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
it("refuses cancellation after publication commits and keeps the job linked",async()=>{
 const {processJob}=await import("../src/worker.js");
 const {getJob,getSongsByBase}=await import("@keyspilli/catalog");
 const {PATCH}=await import("../../../apps/web/src/app/api/youtube/jobs/[id]/route.js");
 resolver.run.mockResolvedValue(candidate());await queue("cancel-fence");
 let status=0;
 publication.afterFence=async()=>{
  const response=await PATCH(new Request("http://localhost:3000/api/youtube/jobs/cancel-fence",{method:"PATCH",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify({action:"cancel"})}),{params:Promise.resolve({id:"cancel-fence"})});
  status=response.status;
 };
 try{await processJob("cancel-fence");}finally{publication.afterFence=null;}
 expect(status).toBe(409);
 expect(getSongsByBase("preview-cancel-fence")).toHaveLength(6);
 expect(getJob("cancel-fence")).toMatchObject({status:"done",songId:"preview-cancel-fence-e"});
});
it("accepts cancellation before publication and leaves no song",async()=>{
 const {processJob}=await import("../src/worker.js");
 const {getJob,getSongsByBase}=await import("@keyspilli/catalog");
 const {PATCH}=await import("../../../apps/web/src/app/api/youtube/jobs/[id]/route.js");
 await queue("cancel-before");
 resolver.run.mockImplementation(async()=>{
  const response=await PATCH(new Request("http://localhost:3000/api/youtube/jobs/cancel-before",{method:"PATCH",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify({action:"cancel"})}),{params:Promise.resolve({id:"cancel-before"})});
  expect(response.status).toBe(200);
  return candidate();
 });
 await processJob("cancel-before");
 expect(getSongsByBase("preview-cancel-before")).toHaveLength(0);
 expect(getJob("cancel-before")).toMatchObject({status:"error",error:"TUTORIAL_PREVIEW_CANCELLED",songId:null});
});
it("commits the song link before removing the publication journal",async()=>{
 const {processJob}=await import("../src/worker.js");
 const {getJob}=await import("@keyspilli/catalog");
 resolver.run.mockResolvedValue(candidate());await queue("linked-at-commit");
 let atCommit: ReturnType<typeof getJob>;
 publication.beforeJournalRemoval=()=>{atCommit=getJob("linked-at-commit");};
 try{await processJob("linked-at-commit");}finally{publication.beforeJournalRemoval=null;}
 expect(atCommit).toMatchObject({status:"done",songId:"preview-linked-at-commit-e"});
});
it("keeps a recovery-needed publication terminal and replays its job link",async()=>{
 const {processJob}=await import("../src/worker.js");
 const {commitCatalogPublication,getDb,getJob,getSongsByBase,reconcileBaseArtifact}=await import("@keyspilli/catalog");
 resolver.run.mockResolvedValue(candidate());await queue("recovery-needed");
 const trigger="fail_recovery_job_link";
 publication.afterFence=async()=>{getDb().exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF status ON conversion_jobs WHEN NEW.id = 'recovery-needed' AND NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'synthetic job link failure'); END`);};
 try{await processJob("recovery-needed");}finally{publication.afterFence=null;getDb().exec(`DROP TRIGGER IF EXISTS ${trigger}`);}
 expect(getJob("recovery-needed")).toMatchObject({status:"error",songId:null});
 expect(getJob("recovery-needed")?.error).toContain("ARTIFACT_RECONCILIATION_REQUIRED");
 expect(getSongsByBase("preview-recovery-needed")).toHaveLength(0);
 expect(existsSync(join(dir,"artifacts",".preview-recovery-needed.reconciliation.json"))).toBe(true);
 await reconcileBaseArtifact("preview-recovery-needed",{artifactsRoot:join(dir,"artifacts")},commitCatalogPublication);
 expect(getJob("recovery-needed")).toMatchObject({status:"done",songId:"preview-recovery-needed-e"});
 expect(getSongsByBase("preview-recovery-needed")).toHaveLength(6);
});
it("runs the explicit production beta with unverified provenance",async()=>{
 const {processJob}=await import("../src/worker.js");const {getJob,readArrangementManifest}=await import("@keyspilli/catalog");
 resolver.run.mockResolvedValue(candidate());await queue("production-beta");
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("KEYSPILLI_TUTORIAL_BETA","1");
 try{await processJob("production-beta");}finally{vi.stubEnv("NODE_ENV","development");vi.stubEnv("KEYSPILLI_TUTORIAL_BETA","");}
 expect(getJob("production-beta")?.status).toBe("done");
 const manifest=await readArrangementManifest("preview-production-beta");
 expect(manifest.status).toBe("valid");
 if(manifest.status==="valid")expect(manifest.manifest.sourceArrangement).toMatchObject({beta:true,license:"unverified",containsMelody:null});
});
