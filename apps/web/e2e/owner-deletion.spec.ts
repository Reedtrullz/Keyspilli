import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${['C','D','E','F','G','A','B','C'].map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`;
test("owner quarantine requires a chosen policy and exact version; maintenance restores identical bytes",async({page,request})=>{
 const headers={Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"};
 const created=await request.post('/api/uploads?title=Undo%20Fixture&artist=Author',{headers,data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);
 const receipt=await created.json(),id=receipt.songIds.find((id:string)=>id.endsWith('-a')),root=process.env.KEYSPILLI_E2E_SCRATCH_DIR!,path=join(root,'artifacts',receipt.baseId,'a','notes.json'),bytes=await readFile(path);
 try{
  expect((await request.get('/api/catalog/tombstones')).status()).toBe(401);
  expect((await request.post('/api/catalog/tombstones',{headers,data:{action:'quarantine',baseId:receipt.baseId,confirmBaseId:receipt.baseId,expectedRevision:receipt.publicationRevision,retentionDays:14,policyAccepted:false}})).status()).toBe(400);
  await page.goto(`/player/${id}/beginner`);const editor=page.getByRole('group',{name:'Reversible lesson deletion'});await editor.locator('summary').click();
  await editor.getByRole('button',{name:'Preview quarantine'}).click();await expect(editor.getByLabel('Quarantine preview')).toContainText(receipt.publicationRevision);
  await expect(editor.getByRole('button',{name:'Quarantine reviewed lesson'})).toBeDisabled();await editor.getByLabel('Undo retention').selectOption('7');
  await editor.getByRole('checkbox',{name:'I choose this local quarantine and retention policy.'}).check();await editor.getByLabel('Confirm lesson base ID').fill(receipt.baseId);
  await editor.getByRole('button',{name:'Quarantine reviewed lesson'}).click();await expect(editor.getByRole('status')).toContainText('Lesson hidden');
  expect((await request.get(`/api/songs/${id}`)).status()).toBe(404);
  await editor.getByRole('link',{name:'Open quarantine maintenance'}).click();await page.getByRole('button',{name:'Refresh quarantine inventory'}).click();
  const entry=page.getByRole('article',{name:`Tombstone ${receipt.baseId}`});await expect(entry).toContainText('quarantined');await expect(entry.getByRole('button',{name:'Undo lesson removal'})).toBeDisabled();
  await entry.getByLabel('Confirm base ID').fill(receipt.baseId);await expect(entry.getByRole('button',{name:'Permanently purge expired owned files'})).toBeDisabled();
  await entry.getByRole('button',{name:'Undo lesson removal'}).click();await expect(page.getByRole('status')).toContainText('restored');expect(await readFile(path)).toEqual(bytes);
  const restored=await request.get(`/api/songs/${id}`);expect(restored.ok()).toBe(true);expect((await restored.json()).publicationRevision).toBe(receipt.publicationRevision);
 }finally{expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
