import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile, unlink, open } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, isAbsolute } from "node:path";
import {
  parseAcousticReceipt,
  type AcousticReceipt,
  type AnalyzerIdentity,
  identityHash,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
export interface AnalyzerRequest {
  audioPin: AcousticReceipt["audio"] & { path: string };
  analyzerIdentity: AnalyzerIdentity;
  model: "basic-pitch" | "transkun" | "hft";
  timeoutSeconds: 120;
}
export interface AnalyzerOptions {
  enabled: boolean;
  python: string;
  workDir: string;
  signal?: AbortSignal;
  run?: (
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<unknown>;
}
export function terminalAnalyzerReceipt(
  request: AnalyzerRequest,
  status: "failed" | "unavailable",
  reason: string,
): AcousticReceipt {
  return {
    schemaVersion: 1,
    kind: "keyspilli-acoustic-receipt",
    status,
    audio: request.audioPin,
    analyzer: request.analyzerIdentity,
    notes: [],
    rejectedRows: 0,
    metadata: { tempoBpm: null, key: null, meter: null, origin: "unknown" },
    resources: { elapsedSeconds: 0, peakRssBytes: null },
    limitations: [reason],
  };
}
/** Exactly one child, hard kill on deadline, exclusive outputs, no failure cache. */
export async function runAcousticAnalyzer(
  request: AnalyzerRequest,
  options: AnalyzerOptions,
): Promise<AcousticReceipt> {
  if (!options.enabled)
    return parseAcousticReceipt(
      terminalAnalyzerReceipt(
        request,
        "unavailable",
        "Execution disabled; no model invocation",
      ),
    );
  let input: string | undefined, output: string | undefined;
  try {
    if (
      !["basic-pitch", "transkun", "hft"].includes(request.model) ||
      request.timeoutSeconds !== 120
    )
      throw new Error("unsupported analyzer request");
    if (
      !isAbsolute(request.audioPin.path) ||
      !isAbsolute(options.workDir) ||
      !isAbsolute(options.python)
    )
      throw new Error("absolute owned paths required");
    const handle = await open(request.audioPin.path, "r");
    const bytes = await (async () => {
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
          throw new Error("oversized or non-file audio");
        const buffer = Buffer.alloc(stat.size);
        const result = await handle.read(buffer, 0, buffer.length, 0);
        const after = await handle.stat();
        if (
          result.bytesRead !== buffer.length ||
          after.size !== stat.size ||
          after.mtimeMs !== stat.mtimeMs
        )
          throw new Error("audio changed during read");
        return buffer;
      } finally {
        await handle.close();
      }
    })();
    if (
      bytes.length > 2 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !==
        request.audioPin.sha256
    )
      throw new Error("changed or oversized audio");
    await mkdir(options.workDir, { recursive: true });
    const id = randomUUID();
    input = join(options.workDir, id + ".request.json");
    output = join(options.workDir, id + ".receipt.json");
    await writeFile(input, JSON.stringify(request), { flag: "wx" });
    const script = fileURLToPath(
      new URL("./music_analyzer.py", import.meta.url),
    );
    const run =
      options.run ??
      (async (command, args, timeoutMs) => {
        await promisify(execFile)(command, [...args], {
          timeout: timeoutMs,
          signal: options.signal,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
        }).catch((error: { code?: number; killed?: boolean }) => {
          if (error.killed || error.code !== 1) throw error;
        });
        return JSON.parse(await readFile(output!, "utf8")) as unknown;
      });
    const result = parseAcousticReceipt(
      await run(
        options.python,
        [script, "--request", input, "--output", output],
        120000,
      ),
    );
    if (
      result.audio.sha256 !== request.audioPin.sha256 ||
      identityHash(result.analyzer) !== identityHash(request.analyzerIdentity)
    )
      throw new Error("stale analyzer receipt");
    return result;
  } catch (error) {
    return parseAcousticReceipt(
      terminalAnalyzerReceipt(
        request,
        "failed",
        error instanceof Error ? error.message : "Analyzer failed",
      ),
    );
  } finally {
    if (input)
      await unlink(input).catch(
        () => {},
      ); /* Keep the terminal output as durable run evidence. */
  }
}
