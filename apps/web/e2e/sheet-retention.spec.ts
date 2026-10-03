import {test,expect} from '@playwright/test';
const headers={Authorization:'Bearer test-token-for-e2e','Content-Type':'application/xml'};
const xml='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'+Array.from({length:160},(_,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>':''}${['C','D','E','G'].map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`).join('')+'</part></score-partwise>';
test('worker late replies and forced main-thread fallback retain only the current bounded SVG window',async({browser,request})=>{
 test.setTimeout(120000);
 const created=await request.post('/api/uploads?title=Retention%20Fixture&artist=Fixture',{headers,data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);const receipt=await created.json(),id=receipt.songIds.find((v:string)=>v.endsWith('-a'));
 try{
  for(const renderer of ['worker','main']){
   const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
   await page.addInitScript(renderer=>{
    if(renderer==='main')Object.defineProperty(window,'Worker',{configurable:true,value:class{constructor(){throw new Error('Controlled worker unavailability');}}});
    else {const Original=window.Worker;window.Worker=class extends Original{
     constructor(url:string|URL,options?:WorkerOptions){super(url,options);const native=Object.getOwnPropertyDescriptor(Original.prototype,'onmessage')!;
      Object.defineProperty(this,'onmessage',{configurable:true,set(callback:(e:MessageEvent)=>void){native.set!.call(this,(event:MessageEvent)=>{if(event.data.type==='page'&&event.data.page===2)setTimeout(()=>callback(event),800);else callback(event);});},get(){return native.get!.call(this);}});
     }
    };}
   },renderer);
   await page.goto(`/player/${id}/sheet`);await expect.poll(()=>page.evaluate(()=>(window as unknown as {__sheetReady:boolean}).__sheetReady)).toBe(true);
   const count=await page.evaluate(()=>(window as unknown as {__sheetPageCount:number}).__sheetPageCount);expect(count).toBeGreaterThan(5);
   const last=page.getByRole('group',{name:`Sheet music page ${count} of ${count}`,exact:true});await last.scrollIntoViewIfNeeded();await expect(last.locator(':scope > svg')).toBeVisible();
   await page.waitForTimeout(1000); // specifically let the old delayed page-2 reply arrive
   for(const n of [count,1,count,1]){const group=page.getByRole('group',{name:`Sheet music page ${n} of ${count}`,exact:true});await group.scrollIntoViewIfNeeded();await expect(group.locator(':scope > svg')).toBeVisible();
    const state=await page.evaluate(()=>{const s=window as unknown as {__sheetRenderedPages:number;__sheetRetainedSvgBytes:number;__sheetFallbackSvgBytes:number;__sheetRenderer:string};return {pages:s.__sheetRenderedPages,bytes:s.__sheetRetainedSvgBytes,fallback:s.__sheetFallbackSvgBytes,renderer:s.__sheetRenderer};});
    expect(state.renderer).toBe(renderer);expect(state.pages).toBeLessThanOrEqual(Math.min(count,n+2)-Math.max(1,n-2)+1);expect(state.bytes).toBeLessThanOrEqual(4*1024*1024);expect(state.fallback).toBe(0);
   }
   await context.close();
  }
 }finally{expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
