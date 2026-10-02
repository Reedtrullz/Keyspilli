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
  await expect(entry).toContainText('Original: admission unavailable');await expect(entry).toContainText('Chords: admission unavailable');
  await expect(entry).toContainText('listening unknown');await expect(entry).toContainText('keyboard unknown');
  expect((await request.get(`/api/songs/${receipt.songIds[0]}`)).status()).toBe(404);
  await writeFile(policy,'broken policy');await page.getByRole('button',{name:'Refresh musical review'}).click();await expect(page.getByRole('status')).toContainText('Catalog policy must be valid');
 }finally{await writeFile(policy,JSON.stringify({verdicts:{}}));expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
