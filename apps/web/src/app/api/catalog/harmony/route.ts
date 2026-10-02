import {NextResponse} from "next/server";
import {getDb,getSongsByBase,quarantinedBaseIds} from "@keyspilli/catalog";
import {withStablePublication,loadSongArtifact,PublicationRevisionConflictError} from "@/lib/catalog-api";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {readJsonObject} from "@/lib/bounded-body";
import {buildHarmonyCandidate} from "@/lib/harmony-candidate";
export const dynamic="force-dynamic";
async function source(id:string,revision:string){
 const row=getDb().prepare("SELECT base_id FROM songs WHERE id=?").get(id) as {base_id:string}|undefined;if(!row||quarantinedBaseIds().has(row.base_id))throw new Error("Original source unavailable.");
 return (await withStablePublication(row.base_id,revision,async()=>{const song=getSongsByBase(row.base_id).find(song=>song.id===id);if(!song)throw new Error("Original source unavailable.");const loaded=await loadSongArtifact(song);if(loaded.artifact.status!=="valid"||!loaded.data?.sourceFingerprint||loaded.data.notes.length>20000||loaded.data.measures.length>2048)throw new Error("Exact bounded Original source unavailable.");return {song,data:loaded.data};})).value;
}
function valid(id:unknown,revision:unknown):id is string{return typeof id==="string"&&/^[a-z0-9][a-z0-9-]{0,125}$/.test(id)&&typeof revision==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(revision);}
function failure(error:unknown){return NextResponse.json({error:error instanceof PublicationRevisionConflictError?"This publication changed. Reload before reviewing harmony.":"Harmony preview refused. Review the supported symbols, voicing, spans and current source."},{status:error instanceof PublicationRevisionConflictError?409:422});}
export async function GET(req:Request){const auth=checkMutationAuth(req);if(auth)return auth;const query=new URL(req.url).searchParams,id=query.get("id"),revision=query.get("revision");if(!valid(id,revision))return NextResponse.json({error:"Choose an exact variant and publication."},{status:400});
 try{const {song,data}=await source(id,revision!);return NextResponse.json({id,baseId:song.baseId,title:song.title,sourceFingerprint:data.sourceFingerprint,publicationRevision:revision,tempoBpm:data.tempoBpm,key:data.key,durationBeats:Math.max(...data.measures.map(m=>m.endBeat),...data.notes.map(n=>n.start+n.dur)),notes:data.notes.map(({midi,start,dur,vel,hand})=>({midi,start,dur,vel,...(hand?{hand}:{})}))},{headers:{"Cache-Control":"no-store"}});}catch(error){return failure(error);}
}
export async function POST(req:Request){const auth=checkMutationAuth(req);if(auth)return auth;const parsed=await readJsonObject(req);if(parsed.response)return parsed.response;const body=parsed.body;
 if(Object.keys(body).sort().join(" ")!=="events id revision sourceFingerprint"||!valid(body.id,body.revision)||typeof body.sourceFingerprint!=="string"||body.sourceFingerprint.length>1024)return NextResponse.json({error:"Choose an exact bounded source and harmony draft."},{status:400});
 try{const {song,data}=await source(body.id,body.revision as string);if(data.sourceFingerprint!==body.sourceFingerprint)throw new PublicationRevisionConflictError();const result=buildHarmonyCandidate(data,{id:song.id,baseId:song.baseId,title:song.title,artist:song.artist,revision:body.revision as string},body.events);return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});}catch(error){return failure(error);}
}
