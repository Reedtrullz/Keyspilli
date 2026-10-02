import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseMidi} from '../../../packages/midi/src/parse';
import {parseMusicXmlNotes} from '../../../packages/midi/src/parseXml';
const headers={Authorization:'Bearer test-token-for-e2e','Content-Type':'application/xml'};
const note=(step:string,chord=false)=>`<note>${chord?'<chord/>':''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`;
const head='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">',tail='</part></score-partwise>',attributes='<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
test('a finite repeat imports and exports exact canonical attacks with occurrence maps and navigates unfolded score',async({page,request})=>{
 const xml=head+[['C','D','E','F'],['G','A','B','C'],['D','E','F','G']].map((steps,i)=>`<measure number="${i+1}">${i===0?attributes+'<barline location="left"><repeat direction="forward"/></barline>':''}${steps.map(s=>note(s)).join('')}${i===1?'<barline location="right"><repeat direction="backward" times="2"/></barline>':''}</measure>`).join('')+tail;
 const r=await request.post('/api/uploads?title=Finite%20Repeat&artist=Fixture',{headers,data:Buffer.from(xml)});expect(r.ok(),await r.text()).toBe(true);const receipt=await r.json(),id=receipt.songIds.find((id:string)=>id.endsWith('-a'));
 try{
  const detail=await(await request.get(`/api/songs/${id}`)).json();expect(detail.data.measures.map((m:{sourceMeasureIndex:number;sourceOccurrence:number})=>[m.sourceMeasureIndex,m.sourceOccurrence])).toEqual([[0,1],[1,1],[0,2],[1,2],[2,1]]);
  const shape=(notes:{midi:number;start:number;dur:number}[])=>notes.map(n=>[n.midi,n.start,n.dur]);
  const midi=await request.get(`/api/song/${id}/export?type=midi&revision=${receipt.publicationRevision}`),exportedXml=await request.get(`/api/song/${id}/export?type=musicxml&revision=${receipt.publicationRevision}`);
  const parsedMidi=parseMidi(await midi.body()),parsedXml=parseMusicXmlNotes(await exportedXml.text());expect(shape(parsedMidi.notes)).toEqual(shape(detail.data.notes));expect(shape(parsedXml.notes)).toEqual(shape(detail.data.notes));expect(parsedMidi.notationMeasures).toEqual(detail.data.measures);expect(parsedXml.notationMeasures).toEqual(detail.data.measures);
  await page.addInitScript(()=>localStorage.setItem('keyspilli.prefs.v1',JSON.stringify({soundSource:'synth',backgroundMode:'piano',transpose:0})));
  await page.goto(`/player/${id}/sheet`);await page.getByRole('button',{name:'Load practice controls',exact:true}).click();await page.getByRole('button',{name:'Focus score passages'}).click();await expect(page.locator('g.measure[id="keyspilli-score-0"]')).toBeFocused();await page.keyboard.press('End');await expect(page.locator('g.measure[id="keyspilli-score-4"]')).toBeFocused();await page.keyboard.press('Enter');await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Seek',exact:true}).inputValue())).toBeCloseTo(16*60/detail.data.tempoBpm,2);
 }finally{if(!page.isClosed())expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
test('derived harmony keeps keys explicit and physical held shapes reject separate taps without altering the target',async({page,request})=>{
 const xml=head+Array.from({length:4},(_,i)=>`<measure number="${i+1}">${i===0?attributes:''}${Array.from({length:4},()=>note('C')+note('E',true)+note('G',true)).join('')}</measure>`).join('')+tail;
 const r=await request.post('/api/uploads?title=Exercise%20Fixture&artist=Fixture',{headers,data:Buffer.from(xml)});expect(r.ok(),await r.text()).toBe(true);const receipt=await r.json(),id=receipt.songIds.find((id:string)=>id.endsWith('-a')),path=join(process.env.KEYSPILLI_E2E_SCRATCH_DIR!,'artifacts',receipt.baseId,'a','notes.json'),before=await readFile(path);
 try{
  await page.addInitScript(()=>{
   localStorage.setItem('keyspilli.prefs.v1',JSON.stringify({soundSource:'synth',backgroundMode:'piano',transpose:0}));
   const input={id:'shape-test',name:'Controlled shape MIDI',state:'connected',onmidimessage:null as ((event:{data:Uint8Array;timeStamp:number})=>void)|null};
   Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>({inputs:new Map([[input.id,input]]),onstatechange:null}),configurable:true});
   (window as unknown as {__shape:(pitch:number,on:boolean)=>void}).__shape=(pitch,on)=>input.onmidimessage?.({data:new Uint8Array([on?0x90:0x80,pitch,on?80:0]),timeStamp:performance.now()});
  });
  await page.goto(`/player/${id}/leadsheet`);const harmony=page.getByLabel('Derived harmony degrees');await harmony.locator('summary').click();await expect(harmony).toContainText('Unknown degree');await harmony.getByLabel('Key you confirm').fill('C major');await harmony.getByRole('button',{name:'Confirm key region'}).click();await expect(harmony).toContainText('Derived I');await harmony.getByRole('button',{name:'Remove key region 1'}).click();await expect(harmony).toContainText('Unknown degree');
  await page.getByRole('button',{name:'Input',exact:true}).click();await page.getByRole('button',{name:'Connect MIDI',exact:true}).click();await page.getByRole('combobox',{name:'MIDI device',exact:true}).selectOption('shape-test');await page.getByRole('combobox',{name:'MIDI channel',exact:true}).selectOption('0');await page.getByRole('button',{name:'Close tools'}).click();
  await page.getByRole('button',{name:'Practice',exact:true}).click();await page.getByRole('dialog',{name:'Set up practice'}).getByRole('button',{name:'Chord practice',exact:true}).click();
  const panel=page.getByRole('region',{name:'Chord practice',exact:true});await panel.getByLabel('Chord exercise').selectOption('held');await panel.getByLabel('Shape input').selectOption('midi');await panel.getByRole('checkbox',{name:/I choose these exact/}).check();await panel.getByRole('button',{name:'Start chosen chord exercise'}).click();
  const texts=await panel.getByLabel('Target notes').innerText(),pcs:Record<string,number>={C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11},pitches=[...texts.matchAll(/([A-G]#?)(-?\d+)/g)].map(m=>12*(Number(m[2])+1)+pcs[m[1]!]!);expect(pitches.length).toBeGreaterThan(0);
  await page.evaluate(async pitches=>{const send=(window as unknown as {__shape:(pitch:number,on:boolean)=>void}).__shape;for(const pitch of pitches){send(pitch,true);await new Promise(r=>setTimeout(r,30));send(pitch,false);}await new Promise(r=>setTimeout(r,600));},pitches);await expect(panel).toContainText('Held shapes: 0');
  await page.evaluate(pitches=>{const send=(window as unknown as {__shape:(pitch:number,on:boolean)=>void}).__shape;for(const pitch of pitches)send(pitch,true);},pitches);await expect(panel).toContainText('Held shapes: 1');await page.evaluate(pitches=>{const send=(window as unknown as {__shape:(pitch:number,on:boolean)=>void}).__shape;for(const pitch of pitches)send(pitch,false);},pitches);
  expect(await readFile(path)).toEqual(before);
 }finally{if(!page.isClosed())expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
