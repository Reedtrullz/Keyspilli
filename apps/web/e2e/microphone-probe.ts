import { build } from "esbuild";
import { createServer } from "node:http";
import { join } from "node:path";

export interface MicrophoneProbeSnapshot {
  mounted: boolean;
  tracks: MediaStreamTrackState[];
  contexts: AudioContextState[];
  pitches: number[];
  disconnects: number;
}

declare global {
  interface Window {
    __keyspilliPlayerMicrophone: {
      snapshot(): {tracks: MediaStreamTrackState[]; contexts: AudioContextState[]};
      dispose(): Promise<void>;
    };
    __keyspilliMicrophoneProbe: {
      holdPermission: boolean;
      unmountOnContext: boolean;
      requestDone: Promise<void>;
      releasePermission(): void;
      endTrack(): void;
      snapshot(): MicrophoneProbeSnapshot;
      dispose(): Promise<void>;
    };
  }
}

export function installSyntheticPlayerMicrophone() {
  const NativeContext = window.AudioContext;
  const streams: MediaStream[] = [];
  const contexts: AudioContext[] = [];
  const feeds: {context: AudioContext; oscillator: OscillatorNode}[] = [];
  let openingCapture = false;
  window.__keyspilliPlayerMicrophone = {
    snapshot: () => ({tracks: streams.flatMap(stream => stream.getTracks().map(track => track.readyState)), contexts: contexts.map(context => context.state)}),
    async dispose() {
      streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      for (const context of contexts) if (context.state !== "closed") await context.close();
      for (const feed of feeds) { feed.oscillator.stop(); if (feed.context.state !== "closed") await feed.context.close(); }
    },
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new NativeContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 440;
    oscillator.connect(destination); oscillator.start();
    feeds.push({context, oscillator}); streams.push(destination.stream);
    await context.resume();
    openingCapture = true;
    return destination.stream;
  };
  window.AudioContext = class extends NativeContext {
    constructor(options?: AudioContextOptions) {
      super(options);
      if (openingCapture) { contexts.push(this); openingCapture = false; }
    }
  };
}

export async function createMicrophoneProbe() {
  const fixture = `
    import {createElement, useEffect} from "react";
    import {createRoot} from "react-dom/client";
    import {useMicrophoneInput} from "./useMicrophoneInput";
    const NativeContext = window.AudioContext;
    const streams = [], contexts = [], feeds = [], pitches = [], permissions = [];
    let mounted = false, disconnects = 0;
    const control = window.__keyspilliMicrophoneProbe = {
      holdPermission: false, unmountOnContext: false, requestDone: Promise.resolve(),
      releasePermission() { permissions.splice(0).forEach(resolve => resolve()); },
      endTrack() { streams.at(-1)?.getTracks()[0]?.dispatchEvent(new Event("ended")); },
      snapshot() { return {mounted, tracks: streams.flatMap(stream => stream.getTracks().map(track => track.readyState)), contexts: contexts.map(context => context.state), pitches: [...pitches], disconnects}; },
      async dispose() {
        control.releasePermission(); owner.unmount(); await control.requestDone;
        streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
        for (const context of contexts) if (context.state !== "closed") await context.close();
        for (const {context, oscillator} of feeds) { oscillator.stop(); if (context.state !== "closed") await context.close(); }
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new NativeContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start();
      feeds.push({context, oscillator}); streams.push(destination.stream);
      await context.resume();
      if (control.holdPermission) await new Promise(resolve => permissions.push(resolve));
      return destination.stream;
    };
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); contexts.push(this); if (control.unmountOnContext) queueMicrotask(() => owner.unmount()); }
    };
    function Probe() {
      const mic = useMicrophoneInput({onPitch: midi => pitches.push(midi), onDisconnected: () => disconnects++});
      useEffect(() => { mounted = true; return () => { mounted = false; }; }, []);
      return createElement("main", null,
        createElement("button", {disabled: mic.micPending || mic.micReady, onClick: () => { control.requestDone = mic.enableMicrophone(); }}, "Enable synthetic microphone"),
        createElement("button", {onClick: mic.releaseMicrophone}, "Release microphone"),
        createElement("button", {onClick: () => owner.unmount()}, "Unmount microphone owner"),
        createElement("output", {"aria-label": "Capture status"}, (mic.micReady ? "Ready" : mic.micPending ? "Pending" : mic.micError || "Stopped") + " | " + mic.micSignal));
    }
    const owner = createRoot(document.getElementById("root"));
    owner.render(createElement(Probe));
  `;
  const result = await build({ stdin: { contents: fixture, resolveDir: join(__dirname, "../src/components/player"), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
  const script = result.outputFiles[0];
  if (!script) throw new Error("Microphone probe bundle was not generated");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/probe.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/probe.js" ? script.contents : '<!doctype html><div id="root"></div><script src="/probe.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Microphone probe did not bind a local port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
