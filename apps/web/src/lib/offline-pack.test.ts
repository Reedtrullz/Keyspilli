import {expect,it} from "vitest";
import {offlineHash,validateOfflinePack,readOfflineResponse,type OfflinePack} from "./offline-pack";
it("accepts a bounded snapshot and rejects tampering, expiry, unsafe data and streamed size overflow",async()=>{
 const text=btoa("original bytes"),bytes=new TextEncoder().encode("original bytes");
 const body:Omit<OfflinePack,"digest">={version:1,variantId:"study-a",title:"Private study",artist:"Owner",revision:"rev1",sourceFingerprint:"source1",createdAt:"2026-10-02T00:00:00Z",expiresAt:"2026-10-03T00:00:00Z",rights:"owner-confirmed-private-use",data:{notes:[{midi:60,start:0,dur:1,vel:90,hand:"R"}],chords:[],measures:[{index:0,startBeat:0,endBeat:4}],key:"C",tempoBpm:120,timeSig:[4,4]},artifacts:{midi:{base64:text,sha256:await offlineHash(bytes)},musicxml:{base64:text,sha256:await offlineHash(bytes)}}};
 const pack={...body,digest:await offlineHash(JSON.stringify(body))},now=Date.parse("2026-10-02T01:00:00Z");expect(await validateOfflinePack(pack,now)).toEqual(pack);
 await expect(validateOfflinePack({...pack,title:"changed"},now)).rejects.toThrow("integrity");
 await expect(validateOfflinePack({...pack,artifacts:{...pack.artifacts,midi:{...pack.artifacts.midi,base64:btoa("different bytes")}}},now)).rejects.toThrow("integrity");
 await expect(validateOfflinePack(pack,Date.parse(pack.expiresAt))).rejects.toThrow("expired");
 await expect(validateOfflinePack({...pack,data:{...pack.data,timeSigEvents:{} as never}},now)).rejects.toThrow("meter");
 await expect(validateOfflinePack({...pack,data:{...pack.data,notes:[{midi:128,start:0,dur:1,vel:90}]}},now)).rejects.toThrow("note");
 await expect(validateOfflinePack({...pack,data:{...pack.data,notes:[{midi:60,start:0,dur:600,vel:90}]}},now)).rejects.toThrow("four minutes");
 await expect(validateOfflinePack({...pack,credentials:"private"},now)).rejects.toThrow("invalid");
 await expect(readOfflineResponse(new Response(new Uint8Array(8*1024**2+1)))).rejects.toThrow("8 MiB");
});
