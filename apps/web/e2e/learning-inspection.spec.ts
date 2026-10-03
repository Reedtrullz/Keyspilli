import {test,expect} from "@playwright/test";
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${Array.from({length:8},()=>'<note><pitch><step>C</step><octave>0</octave></pitch><duration>1</duration></note>').join("")}</measure></part></score-partwise>`;
test("published inspection is lazy, revision-bound and exposes recorded transformation limits",async({page,request})=>{
 const uploaded=await request.post("/api/uploads?title=Inspection%20Fixture&artist=Authored%20Test",{headers:{Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"},data:Buffer.from(xml)});
 expect(uploaded.ok(),await uploaded.text()).toBe(true);const receipt=await uploaded.json(),id=receipt.songIds.find((id:string)=>id.endsWith("-a"));
 try{
  let inspected=0;page.on("request",request=>{if(request.url().includes("/learning?"))inspected++;});
  await page.goto(`/player/${id}/beginner`);
  expect(inspected).toBe(0);
  const panel=page.locator('details[aria-label="Arrangement evidence"]');await panel.locator(":scope > summary").click();
  await panel.getByRole("button",{name:"Inspect published arrangement",exact:true}).click();
  await expect(panel.getByRole("table")).toBeVisible();
  await expect(panel.getByRole("table").locator("tbody tr")).toHaveCount(4);
  await expect(panel).toContainText("octave-normalized");
  await expect(panel).toContainText("constant BPM clock");
  await expect(panel).toContainText("Rights: Unknown");
  await expect(panel).toContainText("No musical acceptance inferred from generation");
  const detail=await (await request.get(`/api/songs/${id}`)).json();
  expect((await request.get(`/api/songs/${id}/learning`)).status()).toBe(400);
  expect((await request.get(`/api/songs/${id}/learning?revision=stale-inspection`)).status()).toBe(409);
  const response=await request.get(`/api/songs/${id}/learning?revision=${encodeURIComponent(detail.publicationRevision)}`);expect(response.ok()).toBe(true);
  const evidence=await response.json();expect(evidence.publicationRevision).toBe(detail.publicationRevision);expect(evidence.import.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.levels.map((level:{difficulty:string})=>level.difficulty)).toEqual(["beginner","easy","medium","advanced"]);
 }finally{expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers:{Authorization:"Bearer test-token-for-e2e"}})).ok()).toBe(true);}
});
