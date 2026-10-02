import { expect, test } from "@playwright/test";

const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C","D","E","F","G","A","B","C"].map(step=>`<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure></part></score-partwise>`;

test("a repeat file opens the accepted lesson and replacement requires its reviewed revision", async ({page,request})=>{
  const created=await request.post("/api/uploads?title=Accepted%20Fixture&artist=Author",{headers:{Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"},data:Buffer.from(xml)});
  expect(created.ok(),await created.text()).toBe(true);
  const first=await created.json();
  try {
    await page.goto("/uploads");
    await page.getByLabel("Title (optional)").fill("Changed Fixture");
    await page.getByLabel("Artist (optional)").fill("Other Author");
    await page.locator('input[type="file"]').setInputFiles({name:"authored.musicxml",mimeType:"application/xml",buffer:Buffer.from(xml)});
    await page.getByRole("button",{name:"Review file parts",exact:true}).click();
    await page.getByRole("list",{name:"Source parts"}).getByRole("checkbox").check();
    await page.getByLabel("Role for Piano",{exact:true}).selectOption("other");
    await page.getByRole("checkbox",{name:/I created these symbolic bytes/}).check();
    await page.getByRole("button",{name:"Confirm and publish lesson",exact:true}).click();
    await expect(page.getByRole("status")).toContainText("Accepted Fixture by Author already has an accepted lesson");
    await expect(page.getByRole("link",{name:"Open accepted lesson"})).toHaveAttribute("href",`/player/${first.easySongId}`);
    const unchanged=await (await request.get(`/api/songs/${first.easySongId}`)).json();
    expect(unchanged.publicationRevision).toBe(first.publicationRevision);
    const newer=await request.post(`/api/uploads?mode=replace&expectedRevision=${first.publicationRevision}&title=Newer%20Fixture&artist=Author`,{headers:{Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"},data:Buffer.from(xml)});
    expect(newer.ok()).toBe(true); const receipt=await newer.json();
    await page.getByRole("button",{name:"Replace using the details above"}).click();
    await expect(page.getByRole("status").getByRole("alert")).toContainText("accepted lesson changed");
    await expect(page.getByRole("status")).toContainText("Newer Fixture by Author");
    expect((await (await request.get(`/api/songs/${first.easySongId}`)).json()).publicationRevision).toBe(receipt.publicationRevision);
    await page.getByRole("button",{name:"Replace using the details above"}).click();
    await expect(page.getByRole("status")).toContainText("Lesson created");
    const replaced=await (await request.get(`/api/songs/${first.easySongId}`)).json();
    expect(replaced.song.title).toBe("Changed Fixture");expect(replaced.publicationRevision).not.toBe(receipt.publicationRevision);
  } finally {
    expect((await request.delete(`/api/songs/${first.baseId}`,{headers:{Authorization:"Bearer test-token-for-e2e"}})).ok()).toBe(true);
  }
});
