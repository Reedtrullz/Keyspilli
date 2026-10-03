import {NextResponse} from "next/server";
import {getSongDetail,PublicationRevisionConflictError} from "@/lib/catalog-api";
import {projectPublicSongRows} from "@keyspilli/catalog";
import {inspectLearningLevels} from "@/lib/learning-inspection";
export const dynamic="force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params,value=new URL(req.url).searchParams.get("revision");
 if(value===null)return NextResponse.json({error:"A publication revision is required."},{status:400});
 try{
  const detail=await getSongDetail(id,value==="unpinned"?null:value);
  if(!detail)return NextResponse.json({error:"not found"},{status:404});
  // Four public levels only; lazy inspection keeps the sheet entry lightweight.
  const rows=projectPublicSongRows(detail.variants).slice(0,4),levels=[];
  for(const row of rows){const loaded= row.id===id?detail:await getSongDetail(row.id,detail.publicationRevision);levels.push({difficulty:row.difficulty,data:loaded?.data??null});}
  const manifest=detail.artifact.manifest,data=detail.data as (typeof detail.data & {warnings?:unknown});
  const warnings=Array.isArray(data?.warnings)?data.warnings.filter((warning:unknown):warning is string=>typeof warning==="string").slice(0,20).map((warning:string)=>warning.slice(0,500)):[];
  return NextResponse.json({publicationRevision:detail.publicationRevision,levels:inspectLearningLevels(levels),import:{sourceHash:manifest?.sourceArtifactHash??null,sourceKind:manifest?.source?.kind??null,profile:manifest?.arrangementProfile??null,playbackBpm:manifest?.tempo.playback.bpm??null,calibrationBpm:manifest?.tempo.calibration.bpm??null,warnings,symbolicIntent:manifest?.symbolicIntent??null,rights:manifest?.symbolicIntent?.rightsAttested?"Owner attested authorized use":detail.sourceArrangement?.license??"Unknown",review:"No musical acceptance inferred from generation",sourceArrangement:detail.sourceArrangement?{arrangementTitle:detail.sourceArrangement.arrangementTitle,title:detail.sourceArrangement.title,sourceKind:detail.sourceArrangement.sourceKind,containsMelody:detail.sourceArrangement.containsMelody,timingOwner:detail.sourceArrangement.timingOwner}:null}}, {headers:{"Cache-Control":"no-store"}});
 }catch(error){if(error instanceof PublicationRevisionConflictError)return NextResponse.json({error:error.message,code:"PUBLICATION_REVISION_CONFLICT"},{status:409});throw error;}
}
