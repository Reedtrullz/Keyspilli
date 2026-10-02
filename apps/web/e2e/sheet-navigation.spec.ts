import {test,expect} from "@playwright/test";
const note=(step:string,duration=1)=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><type>${duration===2?'quarter':'eighth'}</type><staff>1</staff></note>`;
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('C',2)}</measure><measure number="1"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>${['C','D','E','F','G','A'].map(step=>note(step,1)).join('')}</measure><measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${['C','C','C'].map(step=>note(step,2)).join('')}</measure>${Array.from({length:96},(_,i)=>`<measure number="${i+3}">${['C','D','E'].map(step=>note(step,2)).join('')}</measure>`).join('')}</part></score-partwise>`;
test("direct sheet stays light, then exact passages seek/loop by keyboard across rendered pages without automatic page turns",async({page,request})=>{
 test.setTimeout(120000);
 const headers={Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"};
 const created=await request.post('/api/uploads?title=Score%20Navigation&artist=Authored',{headers,data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);
 const receipt=await created.json(),id=receipt.songIds.find((value:string)=>value.endsWith('-a'));
 let detailRequests=0;
 page.on('request',req=>{if(new URL(req.url()).pathname===`/api/songs/${id}`)detailRequests++;});
 await page.addInitScript(()=>localStorage.setItem('keyspilli.prefs.v1',JSON.stringify({soundSource:'synth',backgroundMode:'piano',transpose:0})));
 try {
  await page.goto(`/player/${id}/sheet`);await expect.poll(()=>page.evaluate(()=>(window as unknown as {__sheetReady?:boolean}).__sheetReady)).toBe(true);
  expect(detailRequests).toBe(0);await expect(page.getByRole('button',{name:'Focus score passages'})).toHaveCount(0);
  await page.getByRole('button',{name:'Load practice controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Focus score passages'})).toBeVisible({timeout:10000});
  await page.getByRole('button',{name:'Focus score passages'}).click();
  const first=page.locator('g.measure[id="keyspilli-score-0"]');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');const second=page.locator('g.measure[id="keyspilli-score-1"]');await expect(second).toBeFocused();
  await page.keyboard.press('Enter');
  const detail=await (await request.get(`/api/songs/${id}`)).json(),bpm=detail.data.tempoBpm;
  await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Seek',exact:true}).inputValue())).toBeCloseTo(detail.data.measures[1].startBeat*60/bpm,2);
  await page.keyboard.press('Shift+Enter');await expect(page.getByRole('img',{name:'Loop range: bars 2–2',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Highlight playback passage'}).check();await expect(second).toHaveAttribute('aria-current','location');
  await page.getByRole('button',{name:'Focus score passages'}).click();await expect(second).toBeFocused();await page.keyboard.press('End');
  const lastIndex=detail.data.measures.length-1,last=page.locator(`g.measure[id="keyspilli-score-${lastIndex}"]`);await expect(last).toBeFocused();
  const lastPage=Number(await last.locator('xpath=ancestor::*[@data-page]').getAttribute('data-page'));expect(lastPage).toBeGreaterThan(1);
  const scroll=await page.evaluate(()=>window.scrollY);await page.keyboard.press('Enter');await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Seek',exact:true}).inputValue())).toBeCloseTo(detail.data.measures[lastIndex].startBeat*60/bpm,2);
  await expect(last).toHaveAttribute('aria-current','location');expect(await page.evaluate(()=>window.scrollY)).toBeCloseTo(scroll,0);
  expect(detailRequests).toBe(1);
 }finally{if(!page.isClosed())expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
