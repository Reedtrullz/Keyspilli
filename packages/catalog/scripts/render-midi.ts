#!/usr/bin/env node
/**
 * Local-only MIDI-to-WAV renderer.
 *
 * This command is intentionally independent of catalog state and production
 * startup.  It invokes the optional FluidSynth adapter with explicit paths.
 */
import { renderMidiToWav, type MidiRendererOptions } from "../src/midi-renderer.js";

interface CliOptions {
  input: string;
  output: string;
  soundfont?: string;
  executable?: string;
  sampleRate?: number;
  gain?: number;
  targetPeak?: number;
  timeoutMs?: number;
}

function usage(): string {
  return [
    "Usage: render-midi.ts --input FILE --output FILE [options]",
    "  --soundfont FILE       SoundFont path (or KEYSPILLI_SOUNDFONT)",
    "  --executable FILE      FluidSynth executable (or KEYSPILLI_FLUIDSYNTH)",
    "  --sample-rate N        Output sample rate (default 44100)",
    "  --gain N               Fixed FluidSynth gain (default 1)",
    "  --target-peak N        PCM peak target 0..1 (default 0.95)",
    "  --timeout-ms N         Backend timeout (default 600000)",
  ].join("\n");
}

function required(argv: string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function numberValue(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${option} must be finite: ${value}`);
  return parsed;
}

export function parseRenderMidiArgs(argv: readonly string[]): CliOptions {
  let input: string | undefined;
  let output: string | undefined;
  const options: Omit<CliOptions, "input" | "output"> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const option = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = required([...argv], index, option);
      index = next[1];
      return next[0];
    };
    switch (option) {
      case "--input": input = value(); break;
      case "--output": output = value(); break;
      case "--soundfont": options.soundfont = value(); break;
      case "--executable": options.executable = value(); break;
      case "--sample-rate": options.sampleRate = numberValue(value(), option); break;
      case "--gain": options.gain = numberValue(value(), option); break;
      case "--target-peak": options.targetPeak = numberValue(value(), option); break;
      case "--timeout-ms": options.timeoutMs = numberValue(value(), option); break;
      case "--help": case "-h": throw new Error(usage());
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!input || !output) throw new Error("--input and --output are required\n" + usage());
  return { input, output, ...options };
}

export async function runRenderMidi(argv: readonly string[], env?: NodeJS.ProcessEnv): Promise<unknown> {
  const parsed = parseRenderMidiArgs(argv);
  const rendererOptions: MidiRendererOptions = {
    env,
    ...(parsed.executable ? { executable: parsed.executable } : {}),
    ...(parsed.soundfont ? { soundfontPath: parsed.soundfont } : {}),
    ...(parsed.sampleRate !== undefined ? { sampleRate: parsed.sampleRate } : {}),
    ...(parsed.gain !== undefined ? { gain: parsed.gain } : {}),
    ...(parsed.targetPeak !== undefined ? { targetPeak: parsed.targetPeak } : {}),
    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
  };
  return renderMidiToWav({ midiPath: parsed.input, outputPath: parsed.output }, rendererOptions);
}

if (process.argv[1]?.endsWith("render-midi.ts") || process.argv[1]?.endsWith("render-midi.js")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
  } else {
    runRenderMidi(argv).then((result) => {
      const output = result as { wav?: { path?: string; sha256?: string; durationSeconds?: number }; duration?: unknown };
      console.log(JSON.stringify({
        wav: output.wav,
        duration: output.duration,
      }, null, 2));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
  }
}
