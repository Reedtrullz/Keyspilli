import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { MidiTakeRecorder,replayTakeNotes,performedNotes } from "../../../packages/player-core/src/midi-take";
import type { rhythmPlan } from "../../../packages/player-core/src/rhythm";
import type { PlaybackEngine } from "../../../packages/player-core/src/engine";
import type { resolveTimedNotes, resolveSourcePedalNotes, selectHandNotes } from "../../../packages/player-core/src/timeline";
import type { AudioEngine } from "../../../packages/player-core/src/audio";
import type { SamplerAudioEngine } from "../../../packages/player-core/src/sampler-audio";

test("offline PCM oracle catches silent buses, held voices, clicks and pedal tails", async ({ page, browser },info) => {
  const root=resolve(__dirname,"../../..");
  const fixture=resolve(__dirname,"fixtures/controlled-piano.ts");
  const bundled=await build({ stdin:{contents:'export { MidiTakeRecorder,replayTakeNotes,performedNotes } from "./packages/player-core/src/midi-take.ts"; export { rhythmPlan } from "./packages/player-core/src/rhythm.ts"; export { PlaybackEngine } from "./packages/player-core/src/engine.ts"; export { resolveTimedNotes, resolveSourcePedalNotes, selectHandNotes } from "./packages/player-core/src/timeline.ts"; export { AudioEngine } from "./packages/player-core/src/audio.ts"; export { SamplerAudioEngine } from "./packages/player-core/src/sampler-audio.ts";',resolveDir:root,loader:"ts"},bundle:true,write:false,platform:"browser",format:"iife",globalName:"AudioOracle",plugins:[{
    name:"controlled-pcm",setup(builder) { builder.onResolve({filter:/^smplr$/},()=>({path:fixture,namespace:"controlled-pcm"})); builder.onLoad({filter:/.*/,namespace:"controlled-pcm"},()=>({contents:readFileSync(fixture,"utf8"),loader:"ts"})); },
  }] });
  await page.goto("/"); await page.addScriptTag({content:bundled.outputFiles![0]!.text});
  const metrics=await page.evaluate(async () => {
    const classes=(window as unknown as {AudioOracle:{MidiTakeRecorder:typeof MidiTakeRecorder;replayTakeNotes:typeof replayTakeNotes;performedNotes:typeof performedNotes;rhythmPlan:typeof rhythmPlan;PlaybackEngine:typeof PlaybackEngine;resolveTimedNotes:typeof resolveTimedNotes;resolveSourcePedalNotes:typeof resolveSourcePedalNotes;selectHandNotes:typeof selectHandNotes;AudioEngine:typeof AudioEngine;SamplerAudioEngine:typeof SamplerAudioEngine}}).AudioOracle;
    const NativeOffline=window.OfflineAudioContext;
    // Real offline graph; ensure() resume is a no-op until our explicit render/resume boundary.
    window.AudioContext=class extends NativeOffline { constructor() {super(2,96_000,48_000);} resume() {return Promise.resolve();} } as unknown as typeof AudioContext;
    const rms=(buffer:AudioBuffer,start:number,end:number,channel=0)=>{ const data=buffer.getChannelData(channel); let sum=0; for(let i=Math.floor(start*48_000);i<end*48_000;i++) sum+=data[i]!**2; return Math.sqrt(sum/((end-start)*48_000)); };
    const note=(hand:"R"|"L",fromInput=false)=>({midi:hand==="R"?60:48,hand,startSec:0,durSec:.3,vel:100,fromInput});
    async function routed(sampled:boolean,voice:number,piano:number) {
      const engine=sampled?new classes.SamplerAudioEngine():new classes.AudioEngine(); engine.setGains(voice,piano); engine.sustainPedal=false;
      const context=engine.ensure() as unknown as OfflineAudioContext;
      if (sampled) {await new Promise(resolve=>setTimeout(resolve,0)); (engine as SamplerAudioEngine).prepareTimbre();}
      engine.noteOn(note("R"),.25); engine.noteOn(note("L"),.9);
      const buffer=await context.startRendering(); engine.dispose(); return buffer;
    }
    const right=await routed(false,1,0), rightAgain=await routed(false,1,0), left=await routed(false,0,1), sampled=await routed(true,0,1), silent=await routed(false,0,0);
    let difference=0,channelDifference=0;
    for(let i=0;i<right.length;i++) { difference=Math.max(difference,Math.abs(right.getChannelData(0)[i]!-rightAgain.getChannelData(0)[i]!)); channelDifference=Math.max(channelDifference,Math.abs(right.getChannelData(0)[i]!-right.getChannelData(1)[i]!)); }
    async function release(cancel:boolean,sample=false) {
      const engine=sample?new classes.SamplerAudioEngine():new classes.AudioEngine(),context=engine.ensure() as unknown as OfflineAudioContext;
      if(sample) {await new Promise(resolve=>setTimeout(resolve,0)); (engine as SamplerAudioEngine).prepareTimbre();}
      engine.sustainPedal=sample; engine.noteOn({...note("R",true),durSec:1},.1);
      if(cancel) engine.metronomeClick(0,.7);
      const atRelease=context.suspend(.35), rendering=context.startRendering(); await atRelease;
      if(cancel) engine.cancelAll(); else engine.noteOff(60);
      await NativeOffline.prototype.resume.call(context); const buffer=await rendering; engine.dispose();
      return {before:rms(buffer,.14,.3),after:rms(buffer,.55,1.4)};
    }
    async function pedal(enabled:boolean) { const engine=new classes.AudioEngine(); engine.sustainPedal=enabled; const context=engine.ensure() as unknown as OfflineAudioContext;
      engine.noteOn({...note("R"),durSec:.5},.2); const buffer=await context.startRendering(); engine.dispose(); return rms(buffer,.73,.79); }
    async function support(enabled:boolean) {
      const audio=new classes.AudioEngine();
      const source=[{...note("R"),startSec:.1},{...note("L"),startSec:.1,midi:60}];
      const audible=classes.selectHandNotes(source,"L",enabled),targets=classes.selectHandNotes(source,"L");
      const engine=new classes.PlaybackEngine(audio,audible,2,{tempoBpm:120,timeSig:[4,4]}, {voiceGain:1,pianoGain:0,sustainPedal:false,speed:1,transpose:0,hand:"L",backgroundMode:"piano"} as import("../../../packages/player-core/src/types").PlayerSettings,[],targets);
      engine.start();const context=audio.ensure() as unknown as OfflineAudioContext;const buffer=await context.startRendering();engine.stop();audio.dispose();return rms(buffer,.15,.3);
    }
    async function expression(policy:"source"|"meter-accents") {
      const audio=new classes.AudioEngine();audio.setGains(1,0);audio.sustainPedal=false;
      const song={notes:[{midi:60,start:0,dur:.5,vel:80,hand:"R" as const}],chords:[],measures:[{index:0,startBeat:0,endBeat:3}],key:"C",tempoBpm:120,timeSig:[3,4] as [number,number],sourceTiming:{timeSig:[3,4] as const,measureStartBeat:0,provenance:"source-measure-boundary" as const,sourceFingerprint:"authored-pcm-fixture"}};
      const timed=classes.resolveTimedNotes(song,1,0,policy),context=audio.ensure() as unknown as OfflineAudioContext;
      audio.noteOn(timed[0]!, .25);const buffer=await context.startRendering();audio.dispose();return {velocity:timed[0]!.vel,rms:rms(buffer,.29,.4),sourceVelocity:song.notes[0]!.vel};
    }
    async function rhythm() {
      const data={key:"C",tempoBpm:120,timeSig:[6,8] as [number,number],chords:[],notes:[{midi:60,start:0,dur:1,vel:80},{midi:64,start:0,dur:1,vel:80},{midi:60,start:1.5,dur:.5,vel:80}],measures:[{index:0,startBeat:0,endBeat:3}],sourceTiming:{timeSig:[6,8] as const,measureStartBeat:0,sourceFingerprint:"rhythm-pcm-fixture",provenance:"source-measure-boundary" as const}};
      const plan=classes.rhythmPlan(data,0,3,1),engine=new classes.AudioEngine(),context=engine.ensure() as unknown as OfflineAudioContext;
      for(const cue of plan.cues)engine.metronomeClick(cue.accent?0:1,.2+cue.timeSec);
      const buffer=await context.startRendering();engine.dispose();return {beats:plan.cues.map(c=>c.beat),first:rms(buffer,.205,.235),second:rms(buffer,.955,.985),between:rms(buffer,.68,.73)};
    }
    async function performedTake(cancel=false){
      const recorder=new classes.MidiTakeRecorder({target:{baseId:"pcm-take",variantId:"pcm-take-a",fingerprint:"sha256:"+"a".repeat(64)},revision:"pcm-revision",startBeat:0,endBeat:4,bpm:120,speed:1,transpose:0,device:"pcm-midi",channel:0,targets:[{midi:60,startSec:.2,durSec:.3,vel:80}]},0);
      const event=(sec:number,velocity:number)=>({timestampMs:sec*1000,velocity,timingSource:"event" as const,deviceId:"pcm-midi",channel:0});
      recorder.capture("on","midi:pcm-midi:0:60",60,event(.2,80));recorder.capture("pedal","midi:pcm-midi:0:",64,event(.25,127));recorder.capture("off","midi:pcm-midi:0:60",60,event(.5,0));recorder.capture("pedal","midi:pcm-midi:0:",64,event(1,0));recorder.capture("on","midi:pcm-midi:0:64",64,event(1.1,80));recorder.capture("off","midi:pcm-midi:0:64",64,event(1.3,0));
      const take=recorder.finish(1400),notes=classes.performedNotes(take),replay=classes.replayTakeNotes(take),engine=new classes.AudioEngine();engine.sustainPedal=false;const context=engine.ensure() as unknown as OfflineAudioContext;
      for(const note of replay)engine.noteOn(note,note.startSec);
      const boundary=cancel?context.suspend(.45):null,rendering=context.startRendering();if(boundary){await boundary;engine.cancelAll();await NativeOffline.prototype.resume.call(context);}const buffer=await rendering;engine.dispose();
      return {keyDuration:notes[0]!.durSec,soundingEnd:notes[0]!.soundingEndSec,pedalRms:rms(buffer,.58,.68),futureRms:rms(buffer,1.13,1.2),tailRms:rms(buffer,1.6,1.9)};
    }
    async function sourcePedal(seek=0,stop=false,loop=false,sampled=false){
      const data={key:"C",tempoBpm:60,timeSig:[4,4] as [number,number],chords:[],measures:[{index:0,startBeat:0,endBeat:1.4}],notes:[{midi:60,start:.2,dur:.3,vel:80,hand:"R" as const,sourceMidiChannel:2},{midi:48,start:.2,dur:.3,vel:80,hand:"L" as const,sourceMidiChannel:3}],sourcePedal:{version:1 as const,endBeat:1.4,provenance:"midi-file" as const,changes:[{beat:0,channel:2,value:127,source:"midi:0"},{beat:1,channel:2,value:0,source:"midi:0"}]}};
      const notes=classes.resolveSourcePedalNotes(data,1,0),audio=sampled?new classes.SamplerAudioEngine():new classes.AudioEngine(),context=audio.ensure() as unknown as OfflineAudioContext;
      if(sampled){await new Promise(r=>setTimeout(r,0));(audio as SamplerAudioEngine).prepareTimbre();}
      const engine=new classes.PlaybackEngine(audio,notes,1.4,data,{voiceGain:1,pianoGain:0,sustainPedal:true,speed:1,transpose:0,hand:"both",backgroundMode:"piano"} as import("../../../packages/player-core/src/types").PlayerSettings,[],classes.resolveTimedNotes(data,1,0));
      if(loop)engine.setLoop({startSec:.6,endSec:.8});engine.seek(seek);engine.start();if(!seek)engine.tick(.2);
      const boundary=stop?context.suspend(.2):null,rendering=context.startRendering();if(boundary){await boundary;engine.stop();await NativeOffline.prototype.resume.call(context);}const buffer=await rendering;engine.stop();audio.dispose();
      return {physical:notes[0]!.durSec,sounding:notes[0]!.soundingDurSec,early:rms(buffer,.05,.15),ring:rms(buffer,.72,.8),late:rms(buffer,.55,.65),silence:rms(buffer,1.35,1.7),afterStop:rms(buffer,.35,.45)};
    }
    const pcm=new Float32Array(right.length*right.numberOfChannels);
    for(let channel=0;channel<right.numberOfChannels;channel++) pcm.set(right.getChannelData(channel),channel*right.length);
    const pcmSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",pcm.buffer)),byte=>byte.toString(16).padStart(2,"0")).join("");
    return {sourcePedal:await sourcePedal(),sourcePedalSeek:await sourcePedal(.6),sourcePedalPause:await sourcePedal(.6,true),sourcePedalLoop:await sourcePedal(.6,false,true),sourcePedalSampled:await sourcePedal(0,false,false,true),performedTake:await performedTake(),cancelledTake:await performedTake(true),rhythmCues:await rhythm(),sourceExpression:await expression("source"),accentExpression:await expression("meter-accents"),supportOn:await support(true),supportOff:await support(false),pcmSha256,fixture:"synthetic-sine-PCM-v1",sampleRate:48_000,frames:96_000,
      right:rms(right,.27,.47),rightMutedLeft:rms(right,.92,1.12),left:rms(left,.92,1.12),leftMutedRight:rms(left,.27,.47),
      sampledLeft:rms(sampled,.92,1.12),sampledMutedRight:rms(sampled,.27,.47),silent:rms(silent,0,2),onsetSilence:rms(right,.01,.2),tailSilence:rms(right,1.5,1.9),
      difference,channelDifference,released:await release(false),cancelled:await release(true),sampledReleased:await release(false,true),sampledCancelled:await release(true,true),pedalOn:await pedal(true),pedalOff:await pedal(false)};
  });
  const report=info.outputPath("audio-oracle.json");
  writeFileSync(report,JSON.stringify({schemaVersion:1,graphSha256:createHash("sha256").update(bundled.outputFiles![0]!.text).digest("hex"),fixtureSha256:createHash("sha256").update(readFileSync(fixture)).digest("hex"),engines:"player-core AudioEngine/SamplerAudioEngine 0.1.0",browser:browser.version(),tolerance:{silenceRms:1e-6,determinism:2**-22},metrics},null,2));
  await info.attach("audio-oracle.json",{path:report,contentType:"application/json"});
  for(const value of [metrics.right,metrics.left,metrics.sampledLeft]) {expect(value).toBeGreaterThan(1e-4);expect(value).toBeLessThan(.5);}
  for(const value of [metrics.rightMutedLeft,metrics.leftMutedRight,metrics.sampledMutedRight,metrics.silent,metrics.onsetSilence,metrics.tailSilence]) expect(value).toBeLessThan(1e-6);
  // Two Float32 ulps near unity cover browser graph rounding; silence thresholds stay strict.
  expect(metrics.difference).toBeLessThan(2**-22);expect(metrics.channelDifference).toBeLessThan(2**-22);
  for(const pedal of [metrics.sourcePedal,metrics.sourcePedalSampled]){expect(pedal.physical).toBeCloseTo(.3);expect(pedal.sounding).toBeCloseTo(.8);expect(pedal.ring).toBeGreaterThan(1e-5);expect(pedal.silence).toBeLessThan(1e-6);}
  expect(metrics.sourcePedalSeek.early).toBeGreaterThan(1e-5);expect(metrics.sourcePedalSeek.late).toBeLessThan(1e-6);expect(metrics.sourcePedalPause.afterStop).toBeLessThan(1e-6);expect(metrics.sourcePedalLoop.afterStop).toBeLessThan(1e-6);
  expect(metrics.performedTake.keyDuration).toBeCloseTo(.3,9);expect(metrics.performedTake.soundingEnd).toBe(1);expect(metrics.performedTake.pedalRms).toBeGreaterThan(1e-4);expect(metrics.performedTake.futureRms).toBeGreaterThan(1e-4);expect(metrics.performedTake.tailRms).toBeLessThan(1e-6);expect(metrics.cancelledTake.pedalRms).toBeLessThan(1e-6);expect(metrics.cancelledTake.futureRms).toBeLessThan(1e-6);
  expect(metrics.rhythmCues.beats).toEqual([0,1.5]);expect(metrics.rhythmCues.first).toBeGreaterThan(1e-4);expect(metrics.rhythmCues.second).toBeGreaterThan(1e-4);expect(metrics.rhythmCues.between).toBeLessThan(1e-6);
  expect(metrics.supportOn).toBeGreaterThan(1e-4);expect(metrics.supportOff).toBeLessThan(1e-6);
  // Velocity also changes filtering and enters a compressor; require a measurable increase, not a linear ratio.
  expect(metrics.sourceExpression.velocity).toBe(80);expect(metrics.accentExpression.velocity).toBe(92);expect(metrics.accentExpression.sourceVelocity).toBe(80);expect(metrics.accentExpression.rms).toBeGreaterThan(metrics.sourceExpression.rms*1.05);
  expect(metrics.pcmSha256).toMatch(/^[a-f0-9]{64}$/);
  for(const result of [metrics.released,metrics.cancelled,metrics.sampledReleased,metrics.sampledCancelled]) {expect(result.before).toBeGreaterThan(1e-4);expect(result.after).toBeLessThan(1e-6);}
  expect(metrics.pedalOn).toBeGreaterThan(1e-5);expect(metrics.pedalOff).toBeLessThan(1e-6);
});
