import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createServer} from "node:http";
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${['C','D','E','F','G','A','B','C'].map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`;
test("offline document retains framing protection after service-worker caching", async ({page, context, baseURL}) => {
 if (!baseURL) throw Error("The maintained app base URL is required");
 const frameErrors:string[]=[];
 page.on("console", message => {if(message.type()==="error")frameErrors.push(message.text());});
 const server=createServer((_request,response)=>{response.writeHead(200,{"Content-Type":"text/html"});response.end(`<iframe src="${baseURL}/offline/index.html"></iframe>`);});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
 const address=server.address();
 if(!address||typeof address==="string")throw Error("No loopback fixture address");
 const parent=`http://127.0.0.1:${address.port}`;
 const assertBlocked=async()=>{
  frameErrors.length=0;
  await page.goto(parent);
  await expect.poll(()=>frameErrors.some(message=>/frame-ancestors|X-Frame-Options/i.test(message))).toBe(true);
  expect(page.frames().some(frame=>frame.url()===`${baseURL}/offline/index.html`)).toBe(false);
 };
 const install=await context.newPage();
 try{
  await assertBlocked();
  await install.goto("/offline/index.html");
  await install.evaluate(async()=>{
   await navigator.serviceWorker.register("/offline/sw.js",{scope:"/offline/"});
   await navigator.serviceWorker.ready;
   if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener("controllerchange",()=>resolve(),{once:true}));
  });
  const cached=await install.evaluate(async()=>{
   const key=(await caches.keys()).find(key=>key.startsWith("keyspilli.offline.shell."));
   if(!key)throw Error("No installed shell cache");
   const response=await(await caches.open(key)).match("/offline/index.html");
   if(!response)throw Error("No cached document");
   return Object.fromEntries(response.headers);
  });
  expect(cached["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(cached["x-frame-options"]).toBe("DENY");
  expect(cached["x-content-type-options"]).toBe("nosniff");
  expect(cached["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  await assertBlocked();
 }finally{await install.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test("one opted-in pack opens and practices offline; lock, staleness, quota refusal and removal stay explicit",async({page,context,request})=>{
 const headers={Authorization:"Bearer test-token-for-e2e","Content-Type":"application/xml"},created=await request.post("/api/uploads?title=Offline%20Fixture&artist=Owner",{headers,data:Buffer.from(xml)});expect(created.ok(),await created.text()).toBe(true);const receipt=await created.json(),id=receipt.songIds.find((v:string)=>v.endsWith("-a")),path=join(process.env.KEYSPILLI_E2E_SCRATCH_DIR!,"artifacts",receipt.baseId,"a","notes.json"),before=await readFile(path);
 try{
  await page.goto(`/player/${id}/beginner`);const control=page.getByLabel("Private offline pack");await control.locator(":scope > summary").click();await expect(control.getByRole("button",{name:"Save selected Original offline"})).toBeDisabled();await control.getByRole("checkbox",{name:/I have permission/}).check();await control.getByRole("button",{name:"Save selected Original offline"}).click();await expect(control.getByRole("status")).toContainText("Selected Original saved");
  const detail=await (await request.get(`/api/songs/${id}`)).json();expect((await request.post(`/api/song/${id}/offline-pack`,{headers:{Authorization:headers.Authorization},data:{revision:"stale",rightsConfirmed:true,days:7}})).status()).toBe(409);expect((await request.post(`/api/song/${id}/offline-pack`,{headers:{Authorization:headers.Authorization},data:{revision:detail.publicationRevision,rightsConfirmed:false,days:7}})).status()).toBe(400);
  const read=()=>page.evaluate(()=>new Promise<string>((resolve,reject)=>{const open=indexedDB.open("keyspilli.offline.v1",1);open.onsuccess=()=>{const db=open.result,tx=db.transaction("pack","readonly"),get=tx.objectStore("pack").get("selected");tx.oncomplete=()=>{db.close();resolve(get.result);};tx.onabort=()=>reject(Error("read failed"));};}));const stored=await read();expect(JSON.parse(stored)).toMatchObject({variantId:id,revision:detail.publicationRevision,rights:"owner-confirmed-private-use"});
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="pack")throw new DOMException("full","QuotaExceededError");return original.apply(this,args);};});await control.getByRole("button",{name:"Save selected Original offline"}).click();await expect(control.getByRole("status")).toContainText("full or unavailable");expect(await read()).toBe(stored);
  await control.getByRole("link",{name:"Open offline player"}).click();await expect(page.getByRole("button",{name:"Unlock private pack on this device"})).toBeVisible();await expect(page.getByRole("heading",{name:"Offline Fixture — Owner"})).toHaveCount(0);
  const keys=await page.evaluate(async()=>{const names=await caches.keys();return Promise.all(names.filter(n=>n.startsWith("keyspilli.offline.shell.")).map(async n=>{const cache=await caches.open(n);return(await cache.keys()).map(r=>new URL(r.url).pathname);}));});expect(keys).toHaveLength(1);expect(keys[0]).toHaveLength(3);expect(keys[0]!.every(p=>p.startsWith("/offline/"))).toBe(true);
  await context.setOffline(true);await page.reload();await page.getByRole("button",{name:"Unlock private pack on this device"}).click();await expect(page.getByRole("heading",{name:"Offline Fixture — Owner"})).toBeVisible();await page.getByRole("button",{name:"Check current publication online"}).click();await expect(page.getByRole("status").first()).toContainText("current publication is unknown");
  await page.getByRole("button",{name:"Practice stored notes with computer keys"}).click();await expect(page.getByLabel("Offline note-letter practice")).toBeFocused();const status=page.getByRole("status").last();for(const [pitch,key] of [["C4","a"],["D4","s"],["E4","d"],["F4","f"],["G4","g"],["A4","h"],["B4","j"],["C4","a"]]){await expect(status).toContainText(pitch!);await page.keyboard.press(key!);}await expect(page.getByLabel("Offline practice result")).toContainText("100% onset accuracy");
  await page.getByRole("button",{name:"Play stored Original"}).click();await expect(status).toHaveText("Playing stored Original");await page.getByRole("button",{name:"Lock pack",exact:true}).click();await expect(page.getByLabel("Offline note-letter practice")).toHaveCount(0);await page.getByRole("button",{name:"Unlock private pack on this device"}).click();await expect(status).toHaveText("Stopped");
  await context.setOffline(false);expect((await request.patch(`/api/songs/${id}`,{headers:{Authorization:headers.Authorization},data:{title:"Revised offline fixture",expectedRevision:detail.publicationRevision}})).ok()).toBe(true);await page.getByRole("button",{name:"Check current publication online"}).click();await expect(page.getByRole("status").first()).toContainText("stale");
  await page.getByRole("button",{name:"Remove pack",exact:true}).click();await expect(page.getByRole("button",{name:"Unlock private pack on this device"})).toHaveCount(0);await context.setOffline(true);await page.reload();await expect(page.getByRole("status")).toContainText("No selected pack");expect(await read()).toBeUndefined();expect(await readFile(path)).toEqual(before);
  const put=async(raw:string)=>page.evaluate(raw=>new Promise<void>((resolve,reject)=>{const open=indexedDB.open("keyspilli.offline.v1",1);open.onsuccess=()=>{const db=open.result,tx=db.transaction("pack","readwrite");tx.objectStore("pack").put(raw,"selected");tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(Error("write failed"));};}),raw);
  const expired=await page.evaluate(async stored=>{const {digest,...body}=JSON.parse(stored),now=Date.now();body.createdAt=new Date(now-2000).toISOString();body.expiresAt=new Date(now-1000).toISOString();const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(body))))].map(v=>v.toString(16).padStart(2,"0")).join("");return JSON.stringify({...body,digest:hash});},stored);await put(expired);await page.reload();await expect(page.getByRole("button",{name:"Unlock private pack on this device"})).toHaveCount(0);await expect.poll(read).toBeUndefined();
  await put(stored);await page.reload();await expect(page.getByRole("button",{name:"Unlock private pack on this device"})).toBeVisible();const other=await context.newPage();await other.goto("/offline/index.html");await other.getByRole("button",{name:"Unlock private pack on this device"}).click();await expect(other.getByRole("heading",{name:"Offline Fixture — Owner"})).toBeVisible();await page.getByRole("button",{name:"Remove pack",exact:true}).click();await expect(other.getByLabel("Offline note-letter practice")).toHaveCount(0);await expect(other.getByRole("status")).toContainText("No selected pack");await other.close();
 }finally{await context.setOffline(false);expect((await request.delete(`/api/songs/${receipt.baseId}`,{headers})).ok()).toBe(true);}
});
