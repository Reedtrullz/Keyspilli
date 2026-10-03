import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {parseMidi,parseMusicXmlNotes} from "@keyspilli/midi";
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C","D","E","F","G","A","B","C"].map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join("")}</measure></part></score-partwise>`;
test("active MIDI/XML match the selected player key and timing; stale and arbitrary selections fail",async({page,request})=>{
 const token={Authorization:"Bearer test-token-for-e2e"},created=await request.post("/api/uploads?title=Export%20Fixture&artist=Author",{headers:{...token,"Content-Type":"application/xml"},data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);
 const receipt=await created.json(),id=receipt.songIds.find((value:string)=>value.endsWith("-a")),original=await (await request.get(`/api/song/${id}/export?type=midi&revision=${receipt.publicationRevision}`)).body();
 try{
  await page.addInitScript(()=>localStorage.setItem("keyspilli.prefs.v1",JSON.stringify({soundSource:"synth",hand:"both"})));
  await page.goto(`/player/${id}/beginner`);await page.getByRole("button",{name:"Display",exact:true}).click();
  await page.getByRole("button",{name:"Transpose up",exact:true}).click();await page.getByRole("button",{name:"Transpose up",exact:true}).click();await page.getByRole("button",{name:"Close tools"}).click();
  await page.getByRole("button",{name:"75%",exact:true}).click();
  await page.getByRole("button",{name:"Download sheet music and MIDI"}).click();const dialog=page.getByRole("dialog",{name:"Download sheet music or MIDI"});
  await expect(dialog.getByRole("combobox",{name:"Arrangement"})).toHaveValue("stored");await dialog.getByRole("combobox",{name:"Arrangement"}).selectOption("active");
  let packet:Record<string,unknown>|undefined;page.on("request",req=>{if(req.url().endsWith("/active-export"))packet=req.postDataJSON();});
  const [midDownload]=await Promise.all([page.waitForEvent("download"),dialog.getByRole("button",{name:"Active MIDI",exact:true}).click()]);
  const midi=parseMidi(await readFile((await midDownload.path())!)),source=parseMidi(original);
  expect(midi.notes.map(n=>[n.midi,n.start,n.dur])).toEqual(source.notes.map(n=>[n.midi+2,n.start,n.dur]));expect(midi.tempoBpm).toBeCloseTo(source.tempoBpm*.75,2);expect(midi.keySig).toBe(2);expect(midi.keyMode).toBe(0);
  const [xmlDownload]=await Promise.all([page.waitForEvent("download"),dialog.getByRole("button",{name:"Active MusicXML",exact:true}).click()]);
  const parsed=parseMusicXmlNotes(await readFile((await xmlDownload.path())!,"utf8"));expect(parsed.notes.map(n=>[n.midi,n.start,n.dur])).toEqual(midi.notes.map(n=>[n.midi,n.start,n.dur]));expect(parsed.keySig).toBe(2);expect(parsed.keyMode).toBe(0);
  const [pdfDownload]=await Promise.all([page.waitForEvent("download"),dialog.getByRole("button",{name:"Active Sheet PDF",exact:true}).click()]);
  const pdf=await readFile((await pdfDownload.path())!);expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.length).toBeGreaterThan(1000);
  expect(await (await request.get(`/api/song/${id}/export?type=midi&revision=${receipt.publicationRevision}`)).body()).toEqual(original);
  expect(packet).toBeDefined();expect((await request.post(`/api/song/${id}/active-export`,{data:packet})).status()).toBe(401);
  expect((await request.post(`/api/song/${id}/active-export`,{headers:token,data:{...packet,selection:{...(packet!.selection as object),notes:[]}}})).status()).toBe(400);
  expect((await request.post(`/api/song/${id}/active-export`,{headers:token,data:{...packet,expectedHash:"0".repeat(64)}})).status()).toBe(409);
  expect((await request.post(`/api/song/${id}/active-export`,{headers:token,data:"x".repeat(65537)})).status()).toBe(413);
  const replacement=await request.post(`/api/uploads?mode=replace&expectedRevision=${receipt.publicationRevision}&title=New%20Export`,{headers:{...token,"Content-Type":"application/xml"},data:Buffer.from(xml)});expect(replacement.ok(),await replacement.text()).toBe(true);
  await dialog.getByRole("button",{name:"Active MIDI",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("Publication changed");
 }finally{expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers:token})).ok()).toBe(true);}
});
