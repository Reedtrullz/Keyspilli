import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

export type PlayerCapture = {
  wav: Buffer;
  sha256: string;
  durationSeconds: number;
  sampleRate: number;
  firstSampleContextSeconds: number;
  recorderClock: "audio-worklet-frame";
  sourceClockOffsetSeconds: number;
  sourceClockOffsetsSeconds: Partial<Record<"voice" | "backing", number>>;
  rms: number;
  peak: number;
  samplerStarts: Array<{ when: number; rate: number; bufferLength: number; bus: "voice" | "backing" | "unknown"; contextId: number; contextTime: number }>;
  expectedAttackSecondsByBus?: { voice: number[]; backing: number[] };
  sampleAssets: Array<{ url: string; sha256: string; bytes: number }>;
};

type ProbeWindow = Window & {
  __playerCaptureStart: () => Promise<void>;
  __playerCaptureStop: () => Promise<{
    wav: number[];
    sampleRate: number;
    rms: number;
    peak: number;
    samplerStarts: Array<{ when: number; rate: number; bufferLength: number; bus: "voice" | "backing" | "unknown"; contextId: number; contextTime: number; startedAt: number; stack: string }>;
    oscillatorStarts: number;
    firstSampleContextSeconds: number;
  }>;
};
const probedPages = new WeakSet<Page>();
const preferenceInitPages = new WeakSet<Page>();

/** PCM tap on the final Player AudioContext output. No MediaRecorder codec path. */
export async function installPlayerPcmProbe(page: Page): Promise<void> {
  if (probedPages.has(page)) return;
  probedPages.add(page);
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    const nativeConnect = AudioNode.prototype.connect;
    const nativeStart = AudioBufferSourceNode.prototype.start;
    const nativeOscillatorStart = OscillatorNode.prototype.start;
    const edges = new WeakMap<AudioNode, Set<AudioNode>>();
    let context: AudioContext | null = null;
    let chunks: Float32Array[] = [];
    let startedAt = 0;
    let sources: Array<{ when: number; rate: number; bufferLength: number; bus: "voice" | "backing" | "unknown"; contextId: number; contextTime: number; startedAt: number; stack: string }> = [];
    let oscillatorStarts = 0;
    let processor: AudioWorkletNode | null = null;
    let recorderReady: Promise<void> | null = null;
    let firstSampleContextSeconds = NaN;
    let stopRecorder: (() => void) | null = null;
    const finals = new Set<AudioNode>();
    const probeContexts = new WeakSet<AudioContext>();
    const contextIds = new WeakMap<AudioContext, number>();
    let nextContextId = 0;

    (AudioBufferSourceNode.prototype as unknown as { start: typeof AudioBufferSourceNode.prototype.start }).start = function (this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
      if (probeContexts.has(this.context as AudioContext) && this.buffer) {
        const when = Number.isFinite(args[0]) ? Number(args[0]) : this.context.currentTime;
        const sourceContext = this.context as AudioContext;
        sources.push({ when, rate: this.playbackRate.value, bufferLength: this.buffer.length, bus: routeBus(this),
          contextId: contextIds.get(sourceContext) ?? -1, contextTime: sourceContext.currentTime,
          startedAt: startedAt, stack: new Error().stack?.split("\\n").slice(0, 6).join(" | ") ?? "" });
      }
      return Reflect.apply(nativeStart, this, args);
    };
    (OscillatorNode.prototype as unknown as { start: typeof OscillatorNode.prototype.start }).start = function (this: OscillatorNode, ...args: [number?]) {
      if (probeContexts.has(this.context as AudioContext)) oscillatorStarts++;
      return Reflect.apply(nativeOscillatorStart, this, args);
    };

    class CapturedAudioContext extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        context = this;
        contextIds.set(this, ++nextContextId);
        const capturedContext = this;
        const code = `class Capture extends AudioWorkletProcessor {
          constructor(){super();this.active=false;this.samples=[];this.firstFrame=null;
            this.port.onmessage=e=>{if(e.data==='start'){this.active=true;this.samples=[];this.firstFrame=null;}
              if(e.data==='stop'){this.flush();this.active=false;this.port.postMessage({stopped:true});}};}
          flush(){if(this.samples.length){const samples=Float32Array.from(this.samples);this.port.postMessage({samples,firstFrame:this.firstFrame},[samples.buffer]);this.samples=[];this.firstFrame=null;}}
          process(inputs){if(!this.active)return true;const channels=inputs[0];if(!channels||!channels.length)return true;
            if(this.firstFrame===null)this.firstFrame=currentFrame;
            const frames=channels[0].length;for(let i=0;i<frames;i++){let sum=0;for(const c of channels)sum+=c[i];this.samples.push(sum/channels.length);}
            if(this.samples.length>=4096)this.flush();return true;}
        } registerProcessor('keyspilli-frame-capture',Capture);`;
        const url = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
        recorderReady = this.audioWorklet.addModule(url).then(() => {
          URL.revokeObjectURL(url);
          const tap = new AudioWorkletNode(capturedContext,'keyspilli-frame-capture');
          tap.port.onmessage = event => {
            if(event.data.stopped){stopRecorder?.();stopRecorder=null;return;}
            if(!chunks)return;
            if(!Number.isFinite(firstSampleContextSeconds))firstSampleContextSeconds=event.data.firstFrame/capturedContext.sampleRate;
            chunks.push(event.data.samples);
          };
          const mute=capturedContext.createGain();mute.gain.value=0;
          Reflect.apply(nativeConnect,tap,[mute]);Reflect.apply(nativeConnect,mute,[capturedContext.destination]);
          processor=tap;
          for(const node of finals)if(node.context===capturedContext)Reflect.apply(nativeConnect,node,[tap]);
        });
        probeContexts.add(this);
      }
    }
    function routeBus(source: AudioNode): "voice" | "backing" | "unknown" {
      const visited = new Set<AudioNode>();
      const queue = [source];
      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current instanceof GainNode) {
          const outgoing = edges.get(current) ?? new Set<AudioNode>();
          for (const master of outgoing) {
            if (!(master instanceof GainNode)) continue;
            const masterOut = edges.get(master) ?? new Set<AudioNode>();
            if (![...masterOut].some(node => node instanceof DynamicsCompressorNode)) continue;
            const gain = current.gain.value;
            if (Math.abs(gain - 1) < 0.001) return "voice";
            if (Math.abs(gain - 0.4) < 0.001) return "backing";
          }
        }
        for (const next of edges.get(current) ?? []) queue.push(next);
      }
      return "unknown";
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: CapturedAudioContext });

    (AudioNode.prototype as unknown as { connect: typeof AudioNode.prototype.connect }).connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...args: unknown[]) {
      const result = Reflect.apply(nativeConnect, this, [destination, ...args]);
      if (destination instanceof AudioNode) {
        const destinations = edges.get(this) ?? new Set<AudioNode>();
        destinations.add(destination);
        edges.set(this, destinations);
      }
      if (context && destination === context.destination && this.context === context && this !== processor) {
        finals.add(this);
        if(processor)try { Reflect.apply(nativeConnect, this, [processor]); } catch { /* only final compatible nodes can feed the tap */ }
      }
      return result;
    };

    const toWav = (samples: Float32Array, rate: number): number[] => {
      const pcm = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(pcm);
      const write = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
      write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data");
      view.setUint32(40, samples.length * 2, true);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]!));
        view.setInt16(44 + i * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
      }
      return [...new Uint8Array(pcm)];
    };

    const exposed = window as unknown as ProbeWindow;
    exposed.__playerCaptureStart = async () => {
      if (!context || !recorderReady) throw new Error("Player has not created its Web Audio context");
      await context.resume();
      await recorderReady;
      chunks = [];
      sources = [];
      oscillatorStarts = 0;
      startedAt = context.currentTime;
      firstSampleContextSeconds = NaN;
      processor!.port.postMessage("start");
    };
    (window as unknown as {__playerCaptureClockControl:()=>number}).__playerCaptureClockControl=()=>{
      if(!context||!processor)throw new Error('No recorder context');
      const buffer=context.createBuffer(1,128,context.sampleRate);buffer.getChannelData(0)[0]=0.5;
      const source=context.createBufferSource();source.buffer=buffer;
      Reflect.apply(nativeConnect,source,[processor]);const when=context.currentTime+0.2;
      Reflect.apply(nativeStart,source,[when]);return when;
    };
    exposed.__playerCaptureStop = async () => {
      if (!context || !chunks) throw new Error("No Player PCM capture is active");
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{stopRecorder=null;reject(new Error('Recorder flush timed out'));},3000);
        stopRecorder=()=>{clearTimeout(timeout);resolve();};processor!.port.postMessage('stop');
      });
      if(!Number.isFinite(firstSampleContextSeconds))throw new Error('No recorder frame clock');
      const count = chunks.reduce((total, part) => total + part.length, 0);
      const samples = new Float32Array(count);
      let cursor = 0;
      for (const part of chunks) { samples.set(part, cursor); cursor += part.length; }
      let sum = 0; let peak = 0;
      for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      const captured = { wav: toWav(samples, context.sampleRate), sampleRate: context.sampleRate, firstSampleContextSeconds,
        rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak,
        samplerStarts: sources.map(source => ({ ...source, when: Number((source.when - firstSampleContextSeconds).toFixed(5)), startedAt: Number(source.startedAt.toFixed(5)), contextTime: Number(source.contextTime.toFixed(5)) })), oscillatorStarts };
      chunks = null as unknown as Float32Array[];
      return captured;
    };
  });
}

export async function capturePlayerClip(page: Page, options: {
  songId: string; mode: "original" | "chords"; durationMs: number; expectedAttackSeconds: number[];
  expectedAttackSecondsByBus?: { voice: number[]; backing: number[] };
}): Promise<PlayerCapture> {
  const assets: PlayerCapture["sampleAssets"] = [];
  const assetPromises: Promise<void>[] = [];
  page.on("response", (response) => {
    if (!/\.(?:ogg|m4a|mp3|wav)(?:\?|$)/i.test(response.url())) return;
    assetPromises.push((async () => {
      const body = await response.body();
      assets.push({ url: response.url(), sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length });
    })());
  });
  if (!preferenceInitPages.has(page)) {
    preferenceInitPages.add(page);
    await page.addInitScript(() => {
      const mode = new URL(location.href).searchParams.get("__playerCorpusMode");
      if (mode !== "original" && mode !== "chords") return;
      const value = { soundSource: "sampled", backgroundMode: mode === "chords" ? "chord" : "piano",
        accompanimentStyle: "bass-chords", hand: "both", metronome: false, sustainPedal: true,
        voiceGain: 1, pianoGain: 0.4, speed: 1, transpose: 0 };
      localStorage.setItem("keyspilli.prefs.v1", JSON.stringify(value));
    });
  }
  await installPlayerPcmProbe(page);
  await page.goto(`/player/${options.songId}?__playerCorpusMode=${options.mode}`);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  // Main eagerly warms the same Player sampler. Wait for its readiness state before starting,
  // so neither hand begins in fallback or queues note starts while the second bus loads.
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  await Promise.all(assetPromises);
  await openPlayerTool(page, "Sound");
  const soundDialog = page.getByRole("dialog", { name: "Sound settings", exact: true });
  await expect(soundDialog.getByRole("status")).toContainText("Samples: ready");
  await expect(soundDialog.getByRole("status")).toContainText("Current sound: sampled piano");
  await expect(soundDialog.getByRole("radio", { name: "Original arrangement", exact: true }))
    .toHaveAttribute("aria-checked", options.mode === "original" ? "true" : "false");
  await expect(soundDialog.getByRole("radio", { name: "Chord mode", exact: true }))
    .toHaveAttribute("aria-checked", options.mode === "chords" ? "true" : "false");
  await soundDialog.getByRole("button", { name: "Close tools", exact: true }).click();
  // Let settings restoration, sample-ready callbacks, and the Player's
  // derived timeline effects settle before measuring its first transport run.
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await page.evaluate(async () => (window as unknown as ProbeWindow).__playerCaptureStart());
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(options.durationMs);
  if (await page.getByRole("button", { name: "Pause", exact: true }).isVisible()) await page.getByRole("button", { name: "Pause", exact: true }).click();
  const result = await page.evaluate(() => (window as unknown as ProbeWindow).__playerCaptureStop());
  await Promise.all(assetPromises);
  page.removeAllListeners("response");
  const wav = Buffer.from(result.wav);
  const hash = createHash("sha256").update(wav).digest("hex");
  const durationSeconds = (wav.length - 44) / (result.sampleRate * 2);
  if (!result.samplerStarts.length) throw new Error("No sampled buffer starts were observed");
  if (result.oscillatorStarts !== 0) throw new Error(`Sampled Player used oscillator fallback (${result.oscillatorStarts} oscillator starts)`);
  const expectedByBus = options.expectedAttackSecondsByBus;
  const sourceClockOffsetsSeconds: Partial<Record<"voice" | "backing", number>> = {};
  if (expectedByBus) {
    const allowedBuses = new Set(["voice", "backing"]);
    const unknownBusStarts = result.samplerStarts.filter(source => !allowedBuses.has(source.bus));
    if (unknownBusStarts.length) throw new Error(`Player sampler starts used unknown buses: ${JSON.stringify(unknownBusStarts)}`);
    for (const bus of ["voice", "backing"] as const) {
      const expectedBus = [...new Set(expectedByBus[bus].map(value => Number(value.toFixed(3))))];
      const actualBus = result.samplerStarts.filter(source => source.bus === bus).map(source => source.when).sort((a, b) => a - b);
      if (!expectedBus.length) {
        if (actualBus.length) throw new Error(`Player ${bus} onset-group mismatch: expected no sampled starts, observed ${actualBus.length}`);
        continue;
      }
      // Velocity-layer buffer starts at the same scheduled instant form one attack group.
      const actualGroups: number[] = [];
      for (const time of actualBus) {
        if (!actualGroups.length || time - actualGroups.at(-1)! > 0.025) actualGroups.push(time);
      }
      if (actualGroups.length !== expectedBus.length) {
        const diagnostic = result.samplerStarts.filter(source => source.bus === bus).map(source => ({
          when: Number(source.when.toFixed(3)), contextId: source.contextId, contextTime: source.contextTime,
          bufferLength: source.bufferLength, rate: source.rate, stack: source.stack,
        }));
        const allStarts = result.samplerStarts.map(source => ({ bus: source.bus, when: Number(source.when.toFixed(3)), contextId: source.contextId, contextTime: source.contextTime, startedAt: source.startedAt }));
        throw new Error(`Player ${bus} onset-group count mismatch: expected ${expectedBus.map(t => t.toFixed(3)).join(",")}; observed ${actualGroups.map(t => t.toFixed(3)).join(",")}; all=${JSON.stringify(allStarts)}; raw=${JSON.stringify(diagnostic)}`);
      }
      const offset = actualGroups[0]! - expectedBus[0]!;
      sourceClockOffsetsSeconds[bus] = Number(offset.toFixed(5));
      if (Math.abs(offset) > 0.15) throw new Error(`Player ${bus} initial capture offset ${offset.toFixed(3)}s exceeds 150ms`);
      for (let i = 0; i < expectedBus.length; i++) {
        const residual = actualGroups[i]! - offset - expectedBus[i]!;
        if (Math.abs(residual) > 0.15) {
          throw new Error(`Player ${bus} source onset ${expectedBus[i]}s differs by ${residual.toFixed(3)}s after ${offset.toFixed(3)}s capture offset; observed ${actualGroups.map(t => t.toFixed(3)).join(",")}`);
        }
      }
    }
  }
  const uniqueAssets = [...new Map(assets.map(asset => [`${asset.url}|${asset.sha256}`, asset])).values()];
  if (uniqueAssets.length === 0) throw new Error("No sampled-piano asset responses were recorded");
  if (result.rms < 0.0002 || result.peak > 0.999) throw new Error(`Player PCM failed signal/clipping checks (rms=${result.rms}, peak=${result.peak})`);
  const firstExpected = Object.values(expectedByBus ?? {}).flat().sort((a, b) => a - b)[0];
  const firstActual = result.samplerStarts.map(source => source.when).sort((a, b) => a - b)[0];
  const sourceClockOffsetSeconds = firstExpected !== undefined && firstActual !== undefined
    ? Number((firstActual - firstExpected).toFixed(5)) : 0;
  return { wav, sha256: hash, durationSeconds, sampleRate: result.sampleRate, firstSampleContextSeconds: result.firstSampleContextSeconds, recorderClock: "audio-worklet-frame", sourceClockOffsetSeconds, sourceClockOffsetsSeconds, rms: result.rms,
    peak: result.peak, samplerStarts: result.samplerStarts.map(({ when, rate, bufferLength, bus, contextId, contextTime }) => ({ when, rate, bufferLength, bus, contextId, contextTime })), sampleAssets: uniqueAssets };
}

export function savePlayerCapture(path: string, capture: PlayerCapture): void {
  writeFileSync(path, capture.wav, { flag: "wx" });
}
