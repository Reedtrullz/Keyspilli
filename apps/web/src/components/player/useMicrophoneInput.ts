import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitch } from "@keyspilli/player-core";
import { microphonePitchEdge } from "./microphone-pitch";

export const MIC_SIGNAL_UNKNOWN = "Unknown signal quality";

interface CaptureStream {
  getTracks(): Array<{
    stop(): void;
    addEventListener(type: "ended", listener: () => void, options: { once: true }): void;
  }>;
}

interface CaptureAnalyser {
  fftSize: number;
  getFloatTimeDomainData(buffer: Float32Array<ArrayBuffer>): void;
}

/** Browser capabilities used by the capture loop; injectable for tests. */
export interface MicrophoneCaptureEnvironment<Stream extends CaptureStream = MediaStream, Analyser extends CaptureAnalyser = AnalyserNode> {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<Stream>;
  createAudioContext: () => {
    sampleRate: number;
    close(): Promise<void>;
    createAnalyser(): Analyser;
    createMediaStreamSource(stream: Stream): { connect(destination: Analyser): void };
  };
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

function browserEnvironment(): MicrophoneCaptureEnvironment {
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    getUserMedia: mediaDevices?.getUserMedia ? (constraints) => mediaDevices.getUserMedia(constraints) : undefined,
    createAudioContext: () => new AudioContext(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}

export interface MicrophoneCaptureOptions<Stream extends CaptureStream = MediaStream, Analyser extends CaptureAnalyser = AnalyserNode> {
  /** False once a newer request (or a release) has superseded this one. */
  isCurrent: () => boolean;
  /** Coarse signal-quality label, throttled to every 250 ms. */
  onSignal: (label: string) => void;
  /** A new monophonic pitch onset (debounced by microphonePitchEdge). */
  onPitch: (midi: number) => void;
  /** An audio track ended (device unplugged or permission revoked). */
  onEnded: () => void;
  environment?: MicrophoneCaptureEnvironment<Stream, Analyser>;
}

/**
 * Open the microphone and run the pitch-detection loop.
 *
 * Resolves to a cleanup function, or null when the request was superseded
 * while permission was pending (the stream is stopped immediately). Rejects
 * after releasing any partially opened stream/context.
 */
export async function startMicrophoneCapture<Stream extends CaptureStream = MediaStream, Analyser extends CaptureAnalyser = AnalyserNode>(
  options: MicrophoneCaptureOptions<Stream, Analyser>,
): Promise<(() => void) | null> {
  return options.environment
    ? captureWithEnvironment(options, options.environment)
    : captureWithEnvironment(options, browserEnvironment());
}

async function captureWithEnvironment<Stream extends CaptureStream, Analyser extends CaptureAnalyser>(
  options: Pick<MicrophoneCaptureOptions, "isCurrent" | "onSignal" | "onPitch" | "onEnded">,
  env: MicrophoneCaptureEnvironment<Stream, Analyser>,
): Promise<(() => void) | null> {
  let stream: Stream | null = null;
  let ctx: ReturnType<typeof env.createAudioContext> | null = null;
  try {
    if (!env.getUserMedia) throw new Error("This browser does not support microphone capture.");
    stream = await env.getUserMedia({ audio: true });
    if (!options.isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return null; }
    const context = env.createAudioContext();
    ctx = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let raf = 0;
    let lastMidi: number | null = null;
    let lastFire = 0;
    let lastSignalUpdate = 0;
    const tick = () => {
      if (!options.isCurrent()) return;
      analyser.getFloatTimeDomainData(buffer);
      const midi = detectPitch(buffer, context.sampleRate);
      const now = env.now();
      if (now - lastSignalUpdate >= 250) {
        lastSignalUpdate = now;
        const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
        options.onSignal(rms < 0.01 ? "Quiet / no reliable pitch" : midi === null ? "Signal present; pitch unresolved" : "Single pitch detected (beta)");
      }
      const edge = microphonePitchEdge(midi, lastMidi, now - lastFire);
      lastMidi = edge.lastMidi;
      if (edge.fire && midi !== null) {
        lastFire = now;
        options.onPitch(midi);
      }
      raf = env.requestFrame(tick);
    };
    const opened = stream;
    const cleanup = () => {
      env.cancelFrame(raf);
      opened.getTracks().forEach((track) => track.stop());
      void context.close();
    };
    opened.getTracks().forEach((track) => track.addEventListener("ended", () => {
      if (!options.isCurrent()) return;
      options.onEnded();
    }, { once: true }));
    raf = env.requestFrame(tick);
    return cleanup;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    void ctx?.close();
    throw error;
  }
}

export interface MicrophoneInputHandlers {
  /** Called for each detected pitch onset while the microphone is open. */
  onPitch: (midi: number) => void;
  /** Called after the hook has released a microphone whose track ended. */
  onDisconnected: () => void;
}

/**
 * Microphone input state for the player: permission/pending/ready/error
 * flags, a signal-quality label, and enable/release actions. Each enable
 * call gets a request id so a release or a newer request cancels a pending
 * permission prompt and stops a running loop.
 */
export function useMicrophoneInput(handlers: MicrophoneInputHandlers) {
  const micCleanupRef = useRef<(() => void) | null>(null);
  const micRequestRef = useRef(0);
  const [micReady, setMicReady] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [micError, setMicError] = useState("");
  const [micSignal, setMicSignal] = useState(MIC_SIGNAL_UNKNOWN);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const releaseMicrophone = useCallback(() => {
    micRequestRef.current++;
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    setMicReady(false);
    setMicPending(false);
  }, []);

  const enableMicrophone = useCallback(async () => {
    if (micPending || micReady) return;
    const request = ++micRequestRef.current;
    const isCurrent = () => request === micRequestRef.current;
    setMicPending(true);
    setMicError("");
    try {
      const cleanup = await startMicrophoneCapture({
        isCurrent,
        onSignal: setMicSignal,
        onPitch: (midi) => handlersRef.current.onPitch(midi),
        onEnded: () => {
          releaseMicrophone();
          setMicError("Microphone disconnected.");
          handlersRef.current.onDisconnected();
        },
      });
      if (!cleanup) return;
      if (!isCurrent()) { cleanup(); return; }
      micCleanupRef.current = cleanup;
      setMicReady(true);
    } catch (error) {
      if (isCurrent()) setMicError(`Microphone unavailable: ${error instanceof Error ? error.message : "permission denied"}`);
    } finally {
      if (isCurrent()) setMicPending(false);
    }
  }, [micPending, micReady, releaseMicrophone]);

  useEffect(() => {
    const counter = micRequestRef;
    const owner = micCleanupRef;
    return () => {
      counter.current++;
      owner.current?.();
      owner.current = null;
    };
  }, []);

  return { micReady, micPending, micError, micSignal, setMicError, enableMicrophone, releaseMicrophone };
}
