"use client";
import {useState} from "react";
import {KEYBOARD_RANGES,noteLabel,validKeyboardRange,type KeyboardRange} from "@keyspilli/player-core";
export function KeyboardRangeControls({value,onChange,disabled=false}:{value:KeyboardRange|null;onChange:(range:KeyboardRange|null)=>void;disabled?:boolean}) {
 const [error,setError]=useState("");
 const preset=value?Object.entries(KEYBOARD_RANGES).find(([,range])=>range.lowMidi===value.lowMidi&&range.highMidi===value.highMidi)?.[0]??"custom":"unknown";
 function update(range:KeyboardRange){if(validKeyboardRange(range)){setError("");onChange(range);}else setError("Lowest key must be at or below the highest key.");}
 return <fieldset disabled={disabled} className="w-full space-y-2 text-sm"><legend className="font-medium">Your physical keyboard</legend>
  <label>Keyboard range<select aria-label="Keyboard range" value={preset} onChange={event=>{setError("");onChange(event.target.value==="unknown"?null:KEYBOARD_RANGES[Number(event.target.value) as 61|76|88]);}}>
   <option value="unknown">Not confirmed</option><option value="61">61 keys · C2–C7</option><option value="76">76 keys · E1–G7</option><option value="88">88 keys · A0–C8</option><option value="custom" disabled>Custom range</option>
  </select></label>
  <div className="flex flex-wrap gap-3">{(["lowMidi","highMidi"] as const).map(key=><label key={key}>{key==="lowMidi"?"Lowest physical key":"Highest physical key"}<select aria-label={key==="lowMidi"?"Lowest physical key":"Highest physical key"} value={value?.[key]??KEYBOARD_RANGES[88][key]} onChange={event=>update({...(value??KEYBOARD_RANGES[88]),[key]:Number(event.target.value)})}>{Array.from({length:128},(_,midi)=><option key={midi} value={midi}>{noteLabel(midi,true)}</option>)}</select></label>)}</div>
  <p className="text-xs text-zinc-600">Confirm your actual lowest and highest keys. Connecting a device does not identify its range.</p>{error&&<p role="alert">{error}</p>}
 </fieldset>;
}
