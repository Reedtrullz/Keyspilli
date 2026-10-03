import {test,expect} from "@playwright/test";
import {mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
test("owner recovery is explicit, redacted, stale-fenced and receipt-idempotent",async({page,request})=>{
 const directory=process.env.KEYSPILLI_E2E_SCRATCH_DIR!;expect(directory).toContain("keyspilli-web-e2e-");const root=join(directory,"artifacts"),baseId="owner-recovery-fixture",journal=join(root,`.${baseId}.reconciliation.json`),token={Authorization:"Bearer test-token-for-e2e"};
 const bytes=JSON.stringify({version:1,operation:"delete",requiresCommit:true,recoveryData:{baseId,jobIds:[]},sourceUrl:"https://private.invalid/media"});
 await mkdir(join(root,baseId),{recursive:true});await writeFile(join(root,baseId,"synthetic.txt"),"owned fixture");await writeFile(journal,bytes);
 try{
  expect((await request.get("/api/catalog/recovery")).status()).toBe(401);await page.goto("/maintenance");const panel=page.getByRole("region",{name:"Catalog recovery"});
  await panel.getByRole("button",{name:"Refresh recovery inventory"}).click();const entry=panel.getByRole("article",{name:`Recovery for ${baseId}`});await expect(entry).toContainText("delete · reviewable");await expect(panel).not.toContainText("private.invalid");
  const reconcile=entry.getByRole("button",{name:"Reconcile reviewed delete"});await expect(reconcile).toBeDisabled();await entry.getByLabel("Confirm base ID").fill(baseId);await writeFile(journal,bytes+" ");await reconcile.click();await expect(panel.getByRole("status")).toContainText("changed after review");expect(await readFile(join(root,baseId,"synthetic.txt"),"utf8")).toBe("owned fixture");
  await panel.getByRole("button",{name:"Refresh recovery inventory"}).click();await expect(entry.getByLabel("Confirm base ID")).toHaveValue("");await entry.getByLabel("Confirm base ID").fill(baseId);
  await reconcile.click();await expect(panel.getByLabel("Recovery receipt")).toContainText("deleted");
  const hash=createHash("sha256").update(bytes+" ").digest("hex"),body={baseId,confirmBaseId:baseId,expectedJournalSha256:hash};
  const replay=await request.post("/api/catalog/recovery",{headers:token,data:body});expect(replay.ok(),await replay.text()).toBe(true);expect((await replay.json()).receipt.journalSha256).toBe(hash);
  expect((await request.post("/api/catalog/recovery",{headers:token,data:{...body,baseId:"../../outside"}})).status()).toBe(400);
  await panel.getByRole("button",{name:"Refresh recovery inventory"}).click();await expect(panel).toContainText("No recorded publication recovery is pending.");
 }finally{for(const path of [journal,join(root,baseId),join(root,`.${baseId}.recovery-receipt.json`)])await rm(path,{recursive:true,force:true});}
});
