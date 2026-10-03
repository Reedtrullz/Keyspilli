import {test,expect} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${['C','D','E','F','G','A','B','C'].map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`;
test("owner review inspects excluded versions privately without re-enabling lessons",async({page,request})=>{
 const headers={Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"};
 const created=await request.post('/api/uploads?title=Review%20Fixture&artist=Author',{headers,data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);
 const receipt=await created.json(),root=process.env.KEYSPILLI_E2E_SCRATCH_DIR!,policy=join(root,'learner-review.json');
 try{
  await writeFile(policy,JSON.stringify({verdicts:{[receipt.baseId]:{blocked:true}}}));
  expect((await request.get(`/api/songs/${receipt.songIds[0]}`)).status()).toBe(404);
  expect((await request.get('/api/catalog/review')).status()).toBe(401);
  expect((await request.get('/api/catalog/review?after=..',{headers})).status()).toBe(400);
  await page.goto('/maintenance');const review=page.getByRole('region',{name:'Owner musical review'});
  await expect(page.getByRole('button',{name:'Refresh musical review'})).toBeVisible();
  // Explicit owner API cursor lets the fixture appear independently of the seeded library pages.
  await page.route('**/api/catalog/review?after=',route=>route.continue({url:`http://127.0.0.1:3128/api/catalog/review?after=upload`}));
  await page.getByRole('button',{name:'Refresh musical review'}).click();
  const entry=page.getByRole('article',{name:`Review ${receipt.baseId}`});await expect(entry).toContainText('Excluded from learner catalog');
  await expect(entry).toContainText(receipt.publicationRevision);await entry.locator('summary').first().click();
  await expect(entry).toContainText('Original: pending');await expect(entry).toContainText('Chords: pending');
  await expect(entry).toContainText('listening pending');await expect(entry).toContainText('keyboard pending');
  const inventory=await (await request.get('/api/catalog/review?after=upload',{headers})).json();
  const current=inventory.entries.find((item:{baseId:string})=>item.baseId===receipt.baseId),output=current.variants[0].decisions[0];
  const evidence=[{id:'synthetic-browser-attestation',sha256:'c'.repeat(64)}];
  const reviewReceipt={schemaVersion:1,kind:'musical-review-receipt',...output.identity,reviewer:{id:'fixture-owner',role:'owner',independent:false},reviewedAt:'2026-10-03T11:00:00Z',coverage:[{startBeat:0,endBeat:Math.min(2,output.endBeat)}],decision:'accepted',rationale:'Synthetic transport test only; no real musical approval.',checks:{source:{result:'passed',evidence},listening:{result:'passed',evidence},keyboard:{result:'pending',evidence:[]}}};
  expect((await request.post('/api/catalog/review',{data:reviewReceipt})).status()).toBe(401);
  expect((await request.post('/api/catalog/review',{headers,data:{...reviewReceipt,playbackSha256:'0'.repeat(64)}})).status()).toBe(422);
  expect((await request.post('/api/catalog/review',{headers,data:{...reviewReceipt,accepted:true}})).status()).toBe(422);
  await page.getByLabel('Completed review receipt JSON').fill(JSON.stringify(reviewReceipt));await page.getByRole('button',{name:'Import exact review receipt'}).click();await expect(page.getByRole('status')).toContainText('Receipt stored');
  await page.getByRole('button',{name:'Refresh musical review'}).click();await entry.locator('summary').first().click();await expect(entry).toContainText('Original: partial');await expect(entry).toContainText('Chords: pending');
  await expect(entry).toContainText('1 current / 0 stale receipts');
  const duplicate=await request.post('/api/catalog/review',{headers,data:reviewReceipt});expect(duplicate.ok(),await duplicate.text()).toBe(true);
  await writeFile(join(root,'artifacts',receipt.baseId,'.publication-id'),'changed-review-version');
  expect((await request.post('/api/catalog/review',{headers,data:reviewReceipt})).status()).toBe(409);
  await page.getByRole('button',{name:'Refresh musical review'}).click();await entry.locator('summary').first().click();await expect(entry).toContainText('Original: pending');await expect(entry).toContainText('0 current / 1 stale receipts');
  expect((await request.get(`/api/songs/${receipt.songIds[0]}`)).status()).toBe(404);
  await writeFile(policy,'broken policy');await page.getByRole('button',{name:'Refresh musical review'}).click();await expect(page.getByRole('status')).toContainText('Catalog policy must be valid');
 }finally{await writeFile(policy,JSON.stringify({verdicts:{}}));expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
