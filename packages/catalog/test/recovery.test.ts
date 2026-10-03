import {it,expect} from "vitest";
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {existsSync} from "node:fs";
import {catalogRecoveryInventory} from "../src/recovery.js";
import {reconcileBaseArtifact,readRecoveryDocument,withBaseArtifactLock} from "../src/publish.js";
it("recovery inventory redacts journals, fences changed snapshots, preserves refused commits and replays exact completion receipts",async()=>{
 const root=await mkdtemp(join(tmpdir(),"keyspilli-recovery-")),baseId="owned-fixture",journal=join(root,`.${baseId}.reconciliation.json`),final=join(root,baseId);
 const bytes=JSON.stringify({version:1,operation:"delete",recoveryData:{privateUrl:"https://private.invalid/secret",source:"private source"}}),sha=createHash("sha256").update(bytes).digest("hex");
 try{
  await mkdir(final);await writeFile(join(final,"owned.txt"),"synthetic");await writeFile(journal,bytes);await writeFile(join(root,".malformed-fixture.reconciliation.json"),"invalid private body");
  const inventory=await catalogRecoveryInventory(root);expect(inventory.entries).toHaveLength(2);expect(JSON.stringify(inventory)).not.toMatch(/private.invalid|private source|invalid private body/);expect(inventory.entries.find(e=>e.baseId===baseId)).toMatchObject({state:"reviewable",operation:"delete",journalSha256:sha,installed:true});
  await expect(reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:"0".repeat(64)},()=>{})).rejects.toThrow("snapshot changed");expect(await readFile(join(final,"owned.txt"),"utf8")).toBe("synthetic");
  await withBaseArtifactLock(baseId,{artifactsRoot:root},async()=>{await expect(reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:sha},()=>{})).rejects.toThrow("already locked");});
  await expect(reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:sha},()=>{throw new Error("DB unavailable");})).rejects.toThrow("DB unavailable");expect(existsSync(journal)).toBe(true);
  let commits=0;const receipt=await reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:sha},()=>{commits++;});expect(receipt).toMatchObject({baseId,journalSha256:sha,disposition:"deleted"});expect(existsSync(journal)).toBe(false);expect(commits).toBe(1);
  expect(await reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:sha},()=>{commits++;})).toEqual(receipt);expect(commits).toBe(1);
  await writeFile(journal,bytes+" ");await expect(reconcileBaseArtifact(baseId,{artifactsRoot:root,expectedJournalSha256:sha},()=>{})).rejects.toThrow("snapshot changed");expect(existsSync(journal)).toBe(true);
  await writeFile(join(root,"large"),"x".repeat(20));await expect(readRecoveryDocument(join(root,"large"),10)).rejects.toThrow("bounds");await symlink(join(root,"large"),join(root,"linked"));await expect(readRecoveryDocument(join(root,"linked"))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
