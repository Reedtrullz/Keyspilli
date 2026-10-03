import {it,expect} from "vitest";
import {mkdtemp,mkdir,writeFile,rename,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {existsSync} from "node:fs";
import {createLegacyBootstrapManifest} from "../src/artifact-manifest.js";
import {publishBaseArtifact,reconcileBaseArtifact} from "../src/publish.js";

it("recovers each namespace/commit boundary or retains a detected incomplete publication",async()=>{
 const root=await mkdtemp(join(tmpdir(),"keyspilli-durability-")),baseId="bounded-fixture";
 const final=join(root,baseId),old=join(root,`.${baseId}.old`),stage=join(root,`.${baseId}.new`),journal=join(root,`.${baseId}.reconciliation.json`);
 async function tree(path:string,version:string){for(const level of ["a","b","e","m","ve","vb"]){await mkdir(join(path,level),{recursive:true});for(const name of ["notes.json","variant.mid","variant.xml"])await writeFile(join(path,level,name),version);}await writeFile(join(path,"manifest.json"),JSON.stringify(createLegacyBootstrapManifest(baseId,120)));await writeFile(join(path,".publication-id"),version);}
 try{
  for(const boundary of ["journal-written","old-renamed","new-installed","db-committed","damaged-file","ambiguous-token"]){
   for(const path of [final,old,stage,journal])await rm(path,{recursive:true,force:true});
   await tree(final,"old");await tree(stage,"new");await writeFile(journal,JSON.stringify({version:1,operation:"publish",token:"new",requiresCommit:true,recoveryData:{version:"new"}}));
   if(boundary!=="journal-written")await rename(final,old);
   if(["new-installed","db-committed","damaged-file","ambiguous-token"].includes(boundary))await rename(stage,final);
   if(boundary==="damaged-file")await rm(join(final,"e","variant.mid"));
   if(boundary==="ambiguous-token")await writeFile(join(final,".publication-id"),"unknown");
   let committed=boundary==="db-committed",calls=0;
   const commit=()=>{calls++;committed=true;};
   if(["damaged-file","ambiguous-token"].includes(boundary)){
    await expect(reconcileBaseArtifact(baseId,{artifactsRoot:root},commit)).rejects.toThrow();
    expect(calls).toBe(0);expect(existsSync(journal)).toBe(true);expect(await readFile(join(old,"a","notes.json"),"utf8")).toBe("old");
    await expect(publishBaseArtifact(baseId,()=>{}, {artifactsRoot:root})).rejects.toThrow("reconciliation required");
   }else{
    await reconcileBaseArtifact(baseId,{artifactsRoot:root},commit);
    const installed=["new-installed","db-committed"].includes(boundary);
    expect(await readFile(join(final,"a","notes.json"),"utf8")).toBe(installed?"new":"old");
    expect(committed).toBe(installed);expect(calls).toBe(installed?1:0);expect(existsSync(journal)).toBe(false);
   }
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
