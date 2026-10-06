/** Explicit reference generation, using only caller-pinned local assets. */
import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { mkdirSync,writeFileSync,statfsSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium,type Browser } from '@playwright/test';
import { readPinnedPlayerAssets,playerReferenceWav } from '../src/lib/player-reference-bank.ts';
const {values:args}=parseArgs({options:{'sample-assets':{type:'string'},module:{type:'string'},output:{type:'string'}}});
if(!args['sample-assets'] || !args.module || !args.output)throw new Error('--sample-assets PINNED.json --module LOCAL.mjs --output NEW_BANK required');
const local=readPinnedPlayerAssets(resolve(args['sample-assets']),resolve(args.module));const output=resolve(args.output);
if(existsSync(output))throw new Error('new output directory required');
const free=statfsSync(resolve('.'));if(Number(free.bavail)*Number(free.bsize)<30*1024**3)throw new Error('disk reserve below30GiB');
mkdirSync(output,{mode:0o700});const references=join(output,'references');mkdirSync(references,{mode:0o700});
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const server=createServer((req,res)=>{if(req.url==='/smplr.mjs'){res.setHeader('Content-Type','text/javascript');res.end(local.module);}else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local reference renderer</title>');}else{res.writeHead(404);res.end();}});
await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});const address=server.address();if(!address || typeof address==='string')throw new Error('missing local address');const origin=`http://127.0.0.1:${address.port}`;
let browser:Browser|undefined;let blocked:string|null=null;
try {
 browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(origin+'/'))return route.continue();const body=local.assets.get(url);if(!body){blocked=url;return route.abort();}return route.fulfill({status:200,contentType:'audio/ogg',body});});
 await context.addInitScript('globalThis.__name = (fn, name) => Object.defineProperty(fn, \"name\", { value: name, configurable: true });');
 const page=await context.newPage();page.setDefaultTimeout(30000);await page.goto(origin);
 await page.evaluate(async ()=>{const dynamicImport=new Function('path','return import(path)');const module=await dynamicImport('/smplr.mjs');const ctx=new OfflineAudioContext(2,4410,44100);let buffers:unknown;const piano=module.SplendidGrandPiano(ctx,{loader:{async load(preset:unknown){buffers=await module.SampleLoader(ctx).load(preset);return buffers;}}});await piano.ready;piano.dispose();(window as any).__playerBank={module,buffers};});
 if(blocked)throw new Error('unregistered asset refused: '+blocked);
 const pins=[];let bytesWritten=0;
 for(const velocity of [32,56,76,92,112])for(let midi=21;midi<=108;midi++){
  const values=await page.evaluate(async ({midi,velocity})=>{const {module,buffers}=(window as any).__playerBank;const ctx=new OfflineAudioContext(2,101430,44100),gain=ctx.createGain();gain.gain.value=.4;gain.connect(ctx.destination);const piano=module.SplendidGrandPiano(ctx,{loader:{load:async()=>buffers},destination:gain,volume:100});await piano.ready;piano.start({note:midi,velocity,time:.05,duration:2.2});const b=await ctx.startRendering();const values:number[]=[];for(let i=0;i<b.length;i++)values.push(b.getChannelData(0)[i]!,b.getChannelData(1)[i]!);piano.dispose();gain.disconnect();return values;},{midi,velocity});
  const b=playerReferenceWav(values),path=join(references,`ref-${midi}-v${velocity}.wav`);bytesWritten+=b.length;if(bytesWritten>4*1024**3)throw new Error('reference bank cap exceeded');writeFileSync(path,b,{flag:'wx'});
  pins.push({midi,velocity,path,sha256:sha(b),encoding:'pcm-f32le',sampleRate:44100,channels:2,frames:values.length/2,referenceAlignmentSeconds:.05});
 }
 const manifest={schemaVersion:1,kind:'keyspilli-player-reference-bank',localUsePermission:true,rightsSource:local.manifest.rightsSource,renderer:{moduleVersion:local.manifest.moduleVersion,moduleSha256:sha(local.module),browserVersion:browser.version()},compressor:{threshold:-24,knee:12,ratio:3,attack:.005,release:.15},sampleAssetPins:local.manifest.assets.map(({path,...pin})=>pin),references:pins,providerCalls:0,networkAcquisitions:0,productionProfileAdmitted:false};
 writeFileSync(join(output,'reference-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({references:pins.length,manifest:join(output,'reference-manifest.json'),networkAcquisitions:0,productionProfileAdmitted:false}));
} finally {if(browser)await browser.close();await new Promise<void>(ok=>server.close(()=>ok()));}
