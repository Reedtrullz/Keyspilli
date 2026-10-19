import { build } from "esbuild";
import { createServer } from "node:http";
import { join } from "node:path";

interface TransportSnapshot {
  mounted: boolean;
  song: number;
  time: number;
  playing: boolean;
  timeRef: number;
  playingRef: boolean;
  seekVersion: number;
  engineTime: number | null;
  enginePlaying: boolean;
  loop: { startSec: number; endSec: number } | null;
  loopBeats: { startBeat: number; endBeat: number } | null;
  audio: { starts: number; active: number; disposed: boolean }[];
}

declare global {
  interface Window {
    __keyspilliTransportProbe: {
      snapshot(): TransportSnapshot;
      tick(seconds: number): void;
      unmount(): void;
    };
    __keyspilliOwnerAudio: { snapshot(): { epoch: string; states: AudioContextState[]; starts: number } };
  }
}

export function installOwnerAudioProbe() {
  const NativeContext = window.AudioContext;
  const contexts: AudioContext[] = [];
  const epoch = crypto.randomUUID();
  let starts = 0;
  window.__keyspilliOwnerAudio = {snapshot: () => ({epoch, states: contexts.map(context => context.state), starts})};
  window.AudioContext = class extends NativeContext {
    constructor(options?: AudioContextOptions) {super(options); contexts.push(this);}
  };
  for (const Source of [OscillatorNode, AudioBufferSourceNode]) {
    const start = Source.prototype.start;
    Object.defineProperty(Source.prototype, "start", {configurable: true, value: function(this: AudioScheduledSourceNode, ...args: number[]) {
      starts++;
      return Reflect.apply(start, this, args);
    }});
  }
}

export async function createTransportProbe() {
  const fixture = `
    import React, {useEffect, useRef, useState} from "react";
    import {createRoot} from "react-dom/client";
    import {PlaybackEngine, DEFAULT_SETTINGS} from "@keyspilli/player-core";
    import {useLoopRegion, usePlayerTransport} from "./usePlayerTransport";
    const audioOwners = [];
    let current = null, read = () => ({mounted: false});
    const owner = createRoot(document.getElementById("root"));
    window.__keyspilliTransportProbe = {
      snapshot: () => ({...read(), audio: audioOwners.map(audio => ({starts: audio.starts, active: audio.active, disposed: audio.disposed}))}),
      tick: seconds => current?.tick(seconds),
      unmount: () => owner.unmount(),
    };
    function Probe({song}) {
      const engineRef = useRef(null);
      const transport = usePlayerTransport(engineRef);
      const [tempo, setTempo] = useState(120), [speed, setSpeed] = useState(1);
      const [ready, setReady] = useState(false);
      const loops = useLoopRegion(tempo, speed);
      read = () => ({mounted: ready, song, time: transport.timeStore.get(), playing: transport.playing,
        timeRef: transport.timeRef.current, playingRef: transport.playingRef.current,
        seekVersion: transport.seekVersion, engineTime: engineRef.current?.time ?? null,
        enginePlaying: engineRef.current?.playing ?? false, loop: loops.loop, loopBeats: loops.loopBeats});
      useEffect(() => {
        const audio = {starts: 0, active: 0, disposed: false, sustainPedal: false,
          ensure() {}, noteOn() {if (this.disposed) throw Error("Scheduling after disposal"); this.starts++; this.active++;},
          noteOff() {}, metronomeClick() {}, playChord() {}, setGains() {},
          cancelAll() {this.active = 0;}, dispose() {this.cancelAll(); this.disposed = true;}};
        audioOwners.push(audio);
        const notes = Array.from({length: 64}, (_, index) => ({midi: 60 + index % 5, startSec: index * .5, durSec: .25, vel: 80}));
        const engine = new PlaybackEngine(audio, notes, 32, {tempoBpm: 120, timeSig: [4, 4]}, {...DEFAULT_SETTINGS});
        engine.onChange = snapshot => {transport.timeRef.current = snapshot.time; transport.playingRef.current = snapshot.playing;};
        engineRef.current = engine; current = engine; setReady(true);
        return () => {engine.stop(); const last = read(); engine.onChange = null; engineRef.current = null; current = null; audio.dispose(); read = () => ({...last, mounted: false, engineTime: null, enginePlaying: false});};
      }, []);
      useEffect(() => {engineRef.current?.setLoop(loops.loop);}, [loops.loop]);
      const seek = seconds => {engineRef.current?.seek(seconds); transport.setSeekVersion(value => value + 1); transport.syncTransportState();};
      const button = (label, onClick) => <button onClick={onClick}>{label}</button>;
      return <main><output aria-label="Transport state">{ready ? "Ready" : "Loading"}: {transport.playing ? "Playing" : "Stopped"}</output>
        {button("Play engine", () => {engineRef.current?.start(); transport.syncTransportState();})}
        {button("Stop engine", () => {engineRef.current?.stop(); transport.syncTransportState();})}
        {button("Seek to three seconds", () => seek(3))}
        {button("Loop beats four to eight", () => loops.setLoopBeats({startBeat: 4, endBeat: 8}))}
        {button("Tempo ninety", () => setTempo(90))}
        {button("Half speed", () => setSpeed(.5))}
        {button("Seek near loop end", () => seek(loops.loop.endSec - .25))}
      </main>;
    }
    function Songs() {
      const [song, setSong] = useState(0);
      return <><button onClick={() => setSong(value => value + 1)}>Switch song</button><Probe key={song} song={song}/></>;
    }
    owner.render(<Songs/>);
  `;
  const result = await build({ stdin: { contents: fixture, resolveDir: join(__dirname, "../src/components/player"), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
  const script = result.outputFiles[0];
  if (!script) throw Error("Transport fixture bundle missing");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/probe.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/probe.js" ? script.contents : '<!doctype html><div id="root"></div><script src="/probe.js"></script>');
  });
  await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Transport fixture did not bind loopback");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
