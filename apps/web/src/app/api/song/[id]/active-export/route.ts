import {NextRequest,NextResponse} from "next/server";
import {keySignature,validateArtifactFiles,writeMidi,writeMusicXml} from "@keyspilli/midi";
import {getSongDetailForExport,PublicationRevisionConflictError} from "@/lib/catalog-api";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {readJsonObject} from "@/lib/bounded-body";
import {ActiveExportUnsupportedError,activeExportDigest,activeExportSourceFingerprint,activeExportVariant,resolveActiveExport,validActiveExportSelection} from "@/components/player/active-arrangement-export";
import {renderPdfResponse} from "@/lib/pdf-export";
export const dynamic="force-dynamic";
export const maxDuration=120;
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const auth=checkMutationAuth(req);if(auth)return auth;
 const parsed=await readJsonObject(req,65536);if(parsed.response)return parsed.response;
 const b=parsed.body,{id}=await params;
 if(Object.keys(b).sort().join(" ")!=="expectedHash revision selection sourceFingerprint type"
  ||(b.revision!==null&&(typeof b.revision!=="string"||b.revision.length>128))||typeof b.sourceFingerprint!=="string"||b.sourceFingerprint.length>4096
  ||typeof b.expectedHash!=="string"||! /^[a-f0-9]{64}$/.test(b.expectedHash)||!["midi","musicxml","pdf"].includes(b.type as string)||!validActiveExportSelection(b.selection))return NextResponse.json({error:"A bounded, publication-bound active selection is required."},{status:400});
 try {
  const revision=b.revision,selection=b.selection,sourceFingerprint=b.sourceFingerprint;
  const detail=await getSongDetailForExport(id,revision);if(!detail?.data)return NextResponse.json({error:"Arrangement unavailable."},{status:404});
  const data=selection.backgroundMode==="chord"?detail.chordData??detail.data:detail.data;
  if(selection.backgroundMode==="chord"&&detail.chordUnavailableReason)return NextResponse.json({error:detail.chordUnavailableReason},{status:422});
  if(await activeExportSourceFingerprint(data)!==sourceFingerprint)return NextResponse.json({error:"The selected source changed; reload before exporting.",code:"ACTIVE_SELECTION_CONFLICT"},{status:409});
  const variant=activeExportVariant(data,resolveActiveExport(data,selection),selection),hash=await activeExportDigest(variant);
  if(hash!==b.expectedHash)return NextResponse.json({error:"The active arrangement differs from its canonical source selection; reload and retry.",code:"ACTIVE_SELECTION_CONFLICT"},{status:409});
  const sig=keySignature(variant.key),xml=writeMusicXml(variant,detail.song.title,detail.song.artist,{chordWords:true});
  const midi=writeMidi(variant.notes,{sourcePedal:variant.sourcePedal,measures:variant.measures,tempoBpm:variant.tempoBpm,timeSig:variant.timeSig,timeSigEvents:variant.timeSigEvents,keySig:sig.fifths,keyMode:sig.mode,chordMarkers:variant.chords,tracks:[{name:"Right Hand",notes:variant.notes.filter(n=>n.hand!=="L")},{name:"Left Hand",notes:variant.notes.filter(n=>n.hand==="L")}]});
  const issues=validateArtifactFiles(variant,{midi,xml});if(issues.length)return NextResponse.json({error:"This active arrangement cannot be represented faithfully in the supported symbolic formats.",issues:issues.slice(0,8)},{status:422});
  // Null pins mean legacy, not unrestricted: compare a fresh canonical selection
  // as well as the publication marker. Bypass React's request-local memoization.
  const verifyCurrent=async()=>{
   const latest=await getSongDetailForExport(id,revision);
   const current=selection.backgroundMode==="chord"?latest?.chordData??latest?.data:latest?.data;
   if(!latest||!current||(selection.backgroundMode==="chord"&&latest.chordUnavailableReason)
    ||await activeExportSourceFingerprint(current)!==sourceFingerprint||latest.song.title!==detail.song.title||latest.song.artist!==detail.song.artist
    ||await activeExportDigest(activeExportVariant(current,resolveActiveExport(current,selection),selection))!==hash)throw new PublicationRevisionConflictError();
  };
  if(b.type==="pdf"){
   if(detail.song.hasSheetXml!==1)return NextResponse.json({error:"Active PDF unavailable for this source."},{status:422});
   const response=await renderPdfResponse(req,id,"classic",detail,{xml,title:`${detail.song.title} — ${detail.song.artist} · Active arrangement · ${variant.key} · ${variant.tempoBpm} BPM`,hash});
   if(response.ok)await verifyCurrent();
   return response;
  }
  await verifyCurrent();
  return new NextResponse(b.type==="midi"?new Uint8Array(midi):xml,{headers:{"Content-Type":b.type==="midi"?"audio/midi":"application/vnd.recordare.musicxml+xml","Content-Disposition":`attachment; filename="${detail.song.id}-active.${b.type==="midi"?"mid":"musicxml"}"`,"Cache-Control":"no-store","X-Publication-Revision":revision??"unpinned","X-Active-Arrangement-SHA256":hash}});
 }catch(error){
  if(error instanceof PublicationRevisionConflictError)return NextResponse.json({error:"Publication changed; reload and retry.",code:"PUBLICATION_REVISION_CONFLICT"},{status:409});
  return NextResponse.json({error:error instanceof ActiveExportUnsupportedError?error.message:"Active export unavailable."},{status:422});
 }
}
