"use client";
import {useEffect,useRef,useState} from "react";
import type {inspectLearningLevels} from "../../lib/learning-inspection";
type Receipt={publicationRevision:string|null;levels:ReturnType<typeof inspectLearningLevels>;import:{sourceHash:string|null;sourceKind:string|null;profile:string|null;playbackBpm:number|null;calibrationBpm:number|null;warnings:string[];rights:string;review:string;symbolicIntent:{arrangementIntent:string;selectedParts:{id:string;name:string;role:string}[];study?:{kind:string}}|null;sourceArrangement:{arrangementTitle:string;title:string;sourceKind:string;containsMelody:boolean|null;timingOwner:string}|null}};
export function LearningInspection({songId,revision}:{songId:string;revision:string|null}) {
 const [receipt,setReceipt]=useState<Receipt|null>(null),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{setReceipt(null);setBusy(false);return()=>{active.current?.abort();active.current=null;};},[songId,revision]);
 async function load(){const controller=new AbortController();active.current=controller;setBusy(true);setNotice("");const timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(`/api/songs/${encodeURIComponent(songId)}/learning?revision=${encodeURIComponent(revision??"unpinned")}`,{signal:controller.signal,cache:"no-store"});if(!response.ok)throw Error(response.status===409?"This publication changed. Reload before inspecting it.":"Inspection unavailable.");const result=await response.json() as Receipt;if(active.current===controller)setReceipt(result);}
  catch(error){if(active.current===controller)setNotice(error instanceof Error?error.message:"Inspection unavailable.");}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false);}}
 }
 return <details className="border rounded-xl p-3 my-3 text-sm" aria-label="Arrangement evidence"><summary className="min-h-11 cursor-pointer">Compare levels and inspect this import</summary>
  <p>Stored note measurements describe this arrangement at its published tempo. They do not rate suitability for you or establish teacher, listening or keyboard acceptance.</p>
  <button className="min-h-11 underline" disabled={busy} onClick={()=>void load()}>{busy?"Inspecting…":"Inspect published arrangement"}</button>
  {notice&&<p role="status">{notice}</p>}
  {receipt&&<>
   <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Level comparison table"><table className="w-full text-xs"><caption>Measured public levels · assigned hands only</caption><thead><tr><th scope="col">Level</th><th scope="col">Notes</th><th scope="col">R / L chord span (semitones)</th><th scope="col">R / L attacks per second</th><th scope="col">Rhythmic variety</th></tr></thead><tbody>{receipt.levels.map(level=><tr key={level.difficulty}><th scope="row">{level.difficulty}</th>{level.available?<><td>{level.noteCount} · {level.unassignedNotes} unassigned</td><td>{level.hands.R.maxChordSpan} / {level.hands.L.maxChordSpan}</td><td>{level.hands.R.attacksPerSecond} / {level.hands.L.attacksPerSecond}</td><td>{level.rhythm.distinctDurations} durations · {level.rhythm.distinctOnsetFractions} onset fractions</td></>:<td colSpan={4}>Unavailable</td>}</tr>)}</tbody></table></div>
   {receipt.levels.map(level=>level.available&&<p key={level.difficulty}>{level.difficulty}: {level.comparison?`${level.comparison.changedBarCount} bars contain different attacks or note durations from the preceding level${level.comparison.changedBars.length?` (${level.comparison.changedBars.join(", ")}${level.comparison.truncated?", more omitted":""})`:""}`:"Cross-level passage comparison unavailable."}</p>)}
   <h3 className="font-semibold mt-3">Import receipt</h3>
   <p>Source: {receipt.import.sourceKind??"Unknown"} · Profile: {receipt.import.profile??"Unknown"}</p>
   <p>Calibration: {receipt.import.calibrationBpm??"Unknown"} BPM · stored playback: {receipt.import.playbackBpm??"Unknown"} BPM. Playback uses a constant BPM clock; this is not proof of alignment to the requested recording.</p>
   <p className="break-all">Source SHA-256: {receipt.import.sourceHash??"Unavailable for this legacy artifact"}</p>
   {receipt.import.sourceArrangement&&<p>Requested: {receipt.import.sourceArrangement.title}. Actual arrangement: {receipt.import.sourceArrangement.arrangementTitle} ({receipt.import.sourceArrangement.sourceKind}). Timing belongs to the selected arrangement.</p>}
   {receipt.import.symbolicIntent&&<><p>Owner intent: {receipt.import.symbolicIntent.arrangementIntent}{receipt.import.symbolicIntent.study?` · authored ${receipt.import.symbolicIntent.study.kind} study`:""}</p><ul>{receipt.import.symbolicIntent.selectedParts.map(part=><li key={part.id}>{part.name} · owner-assigned {part.role}</li>)}</ul></>}
   <p>Rights: {receipt.import.rights}. {receipt.import.review}.</p>
   <p>Hands label arrangement lanes; they do not identify your physical hands. Source profiles can quantize, filter or octave-shift material. Clock and source phase are separate contracts.</p>
   {receipt.import.warnings.length?<ul>{receipt.import.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>:<p>No additional transformation warnings were recorded. This does not prove lossless import or verified roles.</p>}
  </>}
 </details>;
}
