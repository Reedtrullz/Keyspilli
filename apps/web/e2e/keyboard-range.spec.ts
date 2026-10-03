import {expect,test} from "@playwright/test";
const xml=`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C","D","E","F","G","A","B","C"].map(step=>`<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure></part></score-partwise>`;
test("a confirmed physical range warns before practice and retains every graded target",async({page,request})=>{
 const response=await request.post("/api/uploads?title=Range%20Fixture&artist=Authored%20Test",{headers:{Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"},data:Buffer.from(xml)});
 expect(response.ok(),await response.text()).toBe(true);const receipt=await response.json();const id=receipt.songIds.find((value:string)=>value.endsWith("-a"));
 try {
  await page.addInitScript(()=>{
   localStorage.setItem("keyspilli.prefs.v1",JSON.stringify({soundSource:"synth",hand:"both"}));
   const input={id:"range-fixture",name:"Controlled MIDI Fixture",state:"connected",onmidimessage:null};
   Object.defineProperty(navigator,"requestMIDIAccess",{value:async()=>({inputs:new Map([[input.id,input]]),onstatechange:null}),configurable:true});
  });
  await page.goto(`/player/${id}/falling`);
  await page.getByRole("button",{name:"Display",exact:true}).click();
  await page.getByLabel("Keyboard range",{exact:true}).selectOption("61");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("keyspilli.prefs.v1")!).physicalKeyboard)).toEqual({lowMidi:36,highMidi:96});
  await page.getByLabel("Lowest physical key",{exact:true}).selectOption("12");
  await page.getByLabel("Highest physical key",{exact:true}).selectOption("12");
  await page.getByRole("button",{name:"Close tools"}).click();
  await page.getByRole("button",{name:"Input",exact:true}).click();
  await page.getByRole("button",{name:"Connect MIDI",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Input settings"}).getByText("MIDI connected",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close tools"}).click();
  await page.getByRole("button",{name:"Practice",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Set up practice"});
  await dialog.getByLabel("Input",{exact:true}).selectOption("midi");
  await dialog.getByLabel("Passage",{exact:true}).selectOption("beginning");
  await expect(dialog.getByLabel("Practice target reachability")).toContainText("8 onset targets · 8 inside the piano view · 0 outside the view · 8 outside your confirmed physical range");
  const start=dialog.getByRole("button",{name:"Start practice",exact:true});await expect(start).toBeDisabled();
  await dialog.getByRole("checkbox",{name:/I reviewed these unreachable targets/}).check();
  await expect(start).toBeEnabled();await dialog.getByLabel("Count-in",{exact:true}).selectOption("0");await start.click();
  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("interrupted");
  const run=await page.evaluate(()=>JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0]);
  expect(run.context.physicalKeyboard).toEqual({lowMidi:12,highMidi:12});expect(run.context.rangeAcknowledged).toBe(true);
 } finally {expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers:{Authorization:"Bearer test-token-for-e2e"}})).ok()).toBe(true);}
});
