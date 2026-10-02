import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AudioEngine } from "../../../packages/player-core/src/audio";
import type { SamplerAudioEngine } from "../../../packages/player-core/src/sampler-audio";

test("offline PCM oracle catches silent buses, held voices, clicks and pedal tails", async ({ page, browser },info) => {
  const root=resolve(__dirname,"../../..");
  const fixture=resolve(__dirname,"fixtures/controlled-piano.ts");
  const bundled=await build({ stdin:{contents:'export { AudioEngine } from "./packages/player-core/src/audio.ts"; export { SamplerAudioEngine } from "./packages/player-core/src/sampler-audio.ts";',resolveDir:root,loader:"ts"},bundle:true,write:false,platform:"browser",format:"iife",globalName:"AudioOracle",plugins:[{
    name:"controlled-pcm",setup(builder) { builder.onResolve({filter:/^smplr$/},()=>({path:fixture,namespace:"controlled-pcm"})); builder.onLoad({filter:/.*/,namespace:"controlled-pcm"},()=>({contents:readFileSync(fixture,"utf8"),loader:"ts"})); },
  }] });
  await page.goto("/"); await page.addScriptTag({content:bundled.outputFiles![0]!.text});
  const metrics=await page.evaluate(async () => {
    const classes=(window as unknown as {AudioOracle:{AudioEngine:typeof AudioEngine;SamplerAudioEngine:typeof SamplerAudioEngine}}).AudioOracle;
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
    const pcm=new Float32Array(right.length*right.numberOfChannels);
    for(let channel=0;channel<right.numberOfChannels;channel++) pcm.set(right.getChannelData(channel),channel*right.length);
    const pcmSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",pcm.buffer)),byte=>byte.toString(16).padStart(2,"0")).join("");
    return {pcmSha256,fixture:"synthetic-sine-PCM-v1",sampleRate:48_000,frames:96_000,
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
  expect(metrics.pcmSha256).toMatch(/^[a-f0-9]{64}$/);
  for(const result of [metrics.released,metrics.cancelled,metrics.sampledReleased,metrics.sampledCancelled]) {expect(result.before).toBeGreaterThan(1e-4);expect(result.after).toBeLessThan(1e-6);}
  expect(metrics.pedalOn).toBeGreaterThan(1e-5);expect(metrics.pedalOff).toBeLessThan(1e-6);
});
