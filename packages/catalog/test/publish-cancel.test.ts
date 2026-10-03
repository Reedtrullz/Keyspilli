import {expect,it,vi} from "vitest";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createLegacyBootstrapManifest} from "../src/artifact-manifest.js";
import {publishBaseArtifact} from "../src/publish.js";
const marker=vi.hoisted(()=>({written:undefined as (()=>void)|undefined}));
vi.mock("node:fs/promises",async importOriginal=>{
 const actual=await importOriginal<typeof import("node:fs/promises")>();
 return {...actual,writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{
  await actual.writeFile(...args);
  if(String(args[0]).endsWith("/.publication-id"))marker.written?.();
 }};
});
it("cancels after the asynchronous marker write before creating a journal or replacing accepted bytes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"keyspilli-publication-cancel-"));
 const stage=async(dir:string)=>{
  await mkdir(join(dir,"a"));await writeFile(join(dir,"a/fixture"),"complete");
  await writeFile(join(dir,"manifest.json"),JSON.stringify(createLegacyBootstrapManifest("cancel-fixture",120,"2026-10-03T00:00:00Z")));
 };
 const contract={artifactsRoot:root,requiredLevels:["a"],requiredFiles:["fixture"]};
 try{
  await publishBaseArtifact("cancel-fixture",stage,contract);
  const path=join(root,"cancel-fixture/.publication-id"),before=await readFile(path);
  const controller=new AbortController();marker.written=()=>controller.abort();
  await expect(publishBaseArtifact("cancel-fixture",stage,{...contract,beforeSwap:()=>{if(controller.signal.aborted)throw new Error("canceled");}})).rejects.toThrow("canceled");
  expect(await readFile(path)).toEqual(before);
  expect(existsSync(join(root,".cancel-fixture.reconciliation.json"))).toBe(false);
  expect(existsSync(join(root,".cancel-fixture.new"))).toBe(false);
 }finally{marker.written=undefined;await rm(root,{recursive:true,force:true});}
});
