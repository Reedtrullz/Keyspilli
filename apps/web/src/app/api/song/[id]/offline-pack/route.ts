import {NextResponse} from "next/server";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {readJsonObject} from "@/lib/bounded-body";
import {getSongDetail,getArtifactFile,PublicationRevisionConflictError} from "@/lib/catalog-api";
import {offlineHash,validateOfflinePack,type OfflinePack} from "@/lib/offline-pack";
export const dynamic="force-dynamic";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const auth=checkMutationAuth(req);if(auth)return auth;
 const input=await readJsonObject(req,1024);if(input.response)return input.response;
 const b=input.body;if(Object.keys(b).sort().join(" ")!=="days revision rightsConfirmed"||b.rightsConfirmed!==true||![1,7,30].includes(b.days as number)||typeof b.revision!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(b.revision))return NextResponse.json({error:"Confirm private offline rights, expiry and a pinned publication."},{status:400});
 try{
  const {id}=await params,detail=await getSongDetail(id,b.revision);if(!detail?.data)return NextResponse.json({error:"Original arrangement unavailable."},{status:404});
  const midi=await getArtifactFile(id,"variant.mid",b.revision),xml=await getArtifactFile(id,"variant.xml",b.revision);if(!midi||!xml)throw Error("Both Original artifacts are required.");
  const source=detail.data;
  const notes=source.notes.map(n=>({midi:n.midi,start:n.start,dur:n.dur,vel:n.vel,...(n.hand?{hand:n.hand}:{}),...(n.sourcePitch?{sourcePitch:n.sourcePitch}:{}),...(n.sourceMidiChannel!==undefined?{sourceMidiChannel:n.sourceMidiChannel}:{})}));
  const chords=source.chords.map(c=>({beat:c.beat,name:c.name,notes:c.notes,...(c.sourceKind?{sourceKind:c.sourceKind}:{}),...(c.inferred!==undefined?{inferred:c.inferred}:{}),...(c.inferenceType?{inferenceType:c.inferenceType}:{}),...(c.durationBeats!==undefined?{durationBeats:c.durationBeats}:{})}));
  const data={notes,chords,measures:source.measures.map(m=>({index:m.index,startBeat:m.startBeat,endBeat:m.endBeat})),key:source.key,tempoBpm:source.tempoBpm,timeSig:source.timeSig,...(source.timeSigEvents?{timeSigEvents:source.timeSigEvents}:{}),...(source.sourcePedal?{sourcePedal:source.sourcePedal}:{})};
  const now=Date.now(),body:Omit<OfflinePack,"digest">={version:1,variantId:id,title:detail.song.title,artist:detail.song.artist,revision:b.revision,sourceFingerprint:source.sourceFingerprint??await offlineHash(JSON.stringify(source)),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+(b.days as number)*86400000).toISOString(),rights:"owner-confirmed-private-use",data,artifacts:{midi:{base64:midi.toString("base64"),sha256:await offlineHash(midi)},musicxml:{base64:xml.toString("base64"),sha256:await offlineHash(xml)}}};
  const pack=await validateOfflinePack({...body,digest:await offlineHash(JSON.stringify(body))});await getSongDetail(id,b.revision);
  return NextResponse.json(pack,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof PublicationRevisionConflictError?"Publication changed; reload before preparing a pack.":error instanceof Error&&/^Offline (?:pack|arrangement|note|harmony|artifact|meter|measure)/.test(error.message)?error.message:"Offline pack unavailable or outside its supported bounds. Nothing was saved."},{status:error instanceof PublicationRevisionConflictError?409:422,headers:{"Cache-Control":"no-store"}});}
}
