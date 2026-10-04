import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runner = new URL("../../scripts/review-song-audio.mts", import.meta.url).pathname;
const execFileAsync = promisify(execFileCallback);

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function toneWav(frequency: number): Buffer {
  const sampleRate = 44_100;
  const sampleCount = sampleRate;
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 12_000), i * 2);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  return wav;
}

async function makeLocalRun() {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-evidence-v2-"));
  const filePin = async (name: string, bytes: Uint8Array = Buffer.from(name)) => {
    const path = join(root, name);
    await writeFile(path, bytes);
    return { path, sha256: hash(bytes) };
  };
  const source = await filePin("source.mid");
  const referenceAsset = await filePin("reference-full.wav");
  const originalAsset = await filePin("original-full.wav");
  const chordsAsset = await filePin("chords-full.wav");
  const originalSnapshot = await filePin("original-snapshot.json");
  const chordsSnapshot = await filePin("chords-snapshot.json");
  const originalNotes = await filePin("original-notes.mid");
  const chordsNotes = await filePin("chords-notes.mid");
  const bank = await filePin("test-bank.sf2");
  const referenceWav = toneWav(440);
  const originalWav = toneWav(660);
  const chordsWav = toneWav(330);
  const reference = await filePin("reference.wav", referenceWav);
  const original = await filePin("original.wav", originalWav);
  const chords = await filePin("chords.wav", chordsWav);
  const alignmentOriginal = await filePin("alignment-original.json");
  const alignmentChords = await filePin("alignment-chords.json");
  const replay = (mode: "original" | "chords", asset: typeof originalAsset, snapshot: typeof originalSnapshot, notes: typeof originalNotes) => ({
    difficulty: "medium", resolvedVariantId: `${mode}-medium-v1`, asset: { ...asset, durationSeconds: 1 },
    replaySnapshot: snapshot, noteEvents: notes, tempoMapSha256: "3".repeat(64), sustainSha256: "4".repeat(64), playbackSettingsSha256: "5".repeat(64),
    renderer: { backend: "local-test-stub", version: "1", sampleRate: 44_100, channels: 1, gain: 0.7, settingsSha256: "6".repeat(64), instrument: { name: "synthetic test tone", bankPath: bank.path, bankSha256: bank.sha256 }, evidenceClass: "synthetic-control" },
    symbolicChecks: { exactNotes: { status: "not-run", reason: "Local CLI transport contract test" }, playability: { status: "not-run", reason: "Local CLI transport contract test" } },
  });
  const job = (mode: "original" | "chords", candidate: typeof original, alignment: typeof alignmentOriginal) => ({
    id: `${mode}-opening`, mode, phraseId: "opening",
    referenceClip: { ...reference, bytes: referenceWav.length, sampleRate: 44_100, channels: 1, bitsPerSample: 16, durationSeconds: 1, assetStartSeconds: 0 },
    candidateClip: { ...candidate, bytes: (mode === "original" ? originalWav : chordsWav).length, sampleRate: 44_100, channels: 1, bitsPerSample: 16, durationSeconds: 1, assetStartSeconds: 0 },
    alignment: { status: "verified", method: "anchors", evidence: alignment, referenceAnchors: [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: 1, sourceBeat: 2 }], candidateAnchors: [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: 1, sourceBeat: 2 }] },
  });
  const manifest = {
    schemaVersion: 2, kind: "keyspilli-audio-review-manifest", source: { ...source, format: "midi" },
    reference: { asset: { ...referenceAsset, durationSeconds: 1 }, identity: { title: "Local synthetic tone fixture", evidence: "Generated only for a software transport test" } },
    phraseInventory: [{ id: "opening", kind: "opening", startBeat: 0, endBeat: 2 }],
    replays: { original: replay("original", originalAsset, originalSnapshot, originalNotes), chords: replay("chords", chordsAsset, chordsSnapshot, chordsNotes) },
    jobs: [job("original", original, alignmentOriginal), job("chords", chords, alignmentChords)],
  };
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));

  const python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  const antiScript = join(root, "anti_stub.py");
  await writeFile(antiScript, String.raw`import json, os, sys
args = sys.argv[1:]
flags = "--base-url --model --audio --probe-unverified-audio --max-calls --retry --fallback-policy --max-output-tokens --run-timeout --no-pre-read --prompt-file --save-output --json --dry-run"
if "--help" in args:
    print(flags)
    sys.exit(0)
def values(name):
    return [args[i + 1] for i, item in enumerate(args[:-1]) if item == name]
audio = values("--audio")
prompt_path = values("--prompt-file")[0]
prompt = open(prompt_path, encoding="utf8").read()
root = os.path.dirname(os.path.dirname(prompt_path))
counter_path = os.path.join(root, "stub-invocations.txt")
try:
    count = int(open(counter_path).read())
except FileNotFoundError:
    count = 0
open(counter_path, "w").write(str(count + 1))
def media(attempts):
    return {"schemaVersion":1,"kind":"audio","status":"not_sent" if attempts == 0 else "attempted","captured_count":2,"gateway_attempts":attempts,"audio":[{"index":i+1,"sha256":__import__("hashlib").sha256(open(path,"rb").read()).hexdigest(),"bytes":os.path.getsize(path)} for i,path in enumerate(audio)],"provider_audio_acceptance":"unverified","listening_verification":"not_run"}
if "--dry-run" in args:
    receipt = {"mode":"listen","estimates":[{"model":"local-stub-model"}],"media_coverage":media(0),"stages":[{"name":"listen","max_attempts":1,"possible_retries":0,"max_output_tokens":2048}]}
    print(json.dumps(receipt))
    print()
    sys.stdout.write(prompt)
else:
    force_failure = os.path.join(os.path.dirname(root), "force-next-live-response")
    if os.path.exists(force_failure):
        os.remove(force_failure)
        review = {"summary":"The candidate matches closely with no defects.","uncertainty":"low","findings":[]}
    elif "main contour" in prompt:
        review = {"schemaVersion":2,"comparisonStatus":"compared","attachments":{"reference":{"content":"music","evidence":"A sustained pitched tone is present."},"candidate":{"content":"music","evidence":"A sustained pitched tone at a different pitch is present."}},"summary":"Both attachments contain pitched tones with a clear pitch difference.","uncertainty":"medium","limitations":["Local stub output; provider hearing and audio grounding remain unverified."],"findings":[]}
    else:
        review = {"schemaVersion":2,"comparisonStatus":"abstained","attachments":{"reference":{"content":"music","evidence":"A sustained pitched tone is present."},"candidate":{"content":"silence","evidence":"No signal is claimed by this controlled stub."}},"summary":"Abstained because the local stub marks the candidate as silence.","uncertainty":"high","limitations":["Local stub output; provider hearing and audio grounding remain unverified."],"findings":[]}
    envelope = {"schemaVersion":1,"runStatus":"success","mode":"listen","model":"local-stub-model","metadata":{"result_quality":"complete","requested_model":"local-stub-model","actual_model":"local-stub-model","fallback_used":False,"fallback_chain":["local-stub-model"],"media_coverage":media(1)},"output_text":json.dumps(review)}
    print(json.dumps(envelope))
`);
  const catalog = { models: [{ id: "local-stub-model", canonical_id: "local-stub-model", capabilities: {
    canonical_id: "local-stub-model", backend_id: "local-stub-model", aliases: [], routing_identity: { version: "test", sha256: "a".repeat(64) },
    audio_input: { version: 1, transport_supported: true, format: "pcm_wav", content_type: "antigravity_audio", backend_acceptance: "unverified", requires_probe_opt_in: true, streaming: false, backend_attempt_limit: 1, max_files: 2, max_file_bytes: 2_000_000, max_total_bytes: 4_000_000, max_duration_seconds: 30 },
  } }] };
  let catalogGets = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      catalogGets++;
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(catalog));
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local test server did not bind");
  return { root, manifestPath, python, antiScript, baseUrl: `http://127.0.0.1:${address.port}/v1`, server, catalogGets: () => catalogGets };
}

async function runCli(args: string[]): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", runner, ...args], { encoding: "utf8", timeout: 30_000 });
  return result.stdout;
}

function cliArgs(fixture: Awaited<ReturnType<typeof makeLocalRun>>, outputDir: string, profile?: string, resume = false, dryRun = false): string[] {
  return [fixture.manifestPath, outputDir, dryRun ? "--dry-run" : "--send-audio", "--max-requests", dryRun ? "0" : "2",
    "--anti-python", fixture.python, "--anti-script", fixture.antiScript, "--base-url", fixture.baseUrl, "--model", "local-stub-model",
    ...(profile ? ["--review-profile", profile] : []), ...(resume ? ["--resume"] : [])];
}

describe("review-song-audio CLI", () => {
  it("rejects an unknown review profile before inspecting the manifest", () => {
    let output = "";
    try {
      execFileSync(process.execPath, ["--import", "tsx", runner,
        "/missing/manifest.json", "/tmp/profile-test-output",
        "--dry-run", "--anti-python", "/usr/bin/python3", "--anti-script", "/missing/anti.py",
        "--base-url", "http://127.0.0.1:9/v1", "--model", "local-stub", "--review-profile", "invalid"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }
    expect(output).toMatch(/unsupported review profile/i);
  });

  it("runs evidence-v2 through local stubs, reports comparison coverage, fingerprints resume profile, and keeps legacy as default", async () => {
    const fixture = await makeLocalRun();
    const outputDir = join(fixture.root, "evidence-output");
    try {
      await runCli(cliArgs(fixture, outputDir, "evidence-v2"));
      const report = JSON.parse(await readFile(join(outputDir, "report.json"), "utf8"));
      expect(report).toMatchObject({
        reviewProfile: "evidence-v2", reviewSchemaVersion: 2, providerListeningAttestation: "unverified",
        listeningCalibration: { status: "unqualified" }, musicalAcceptance: "not-established",
        submissionEvidence: { attemptsReserved: 2, validatedCompleteResponses: 2, ambiguousJobs: 0 },
        coverage: { completeJobCount: 2, comparedJobCount: 1, abstainedJobCount: 1 },
        jobs: [
          { status: "complete", comparisonStatus: "compared", submission: { listeningAttestation: "unverified" } },
          { status: "complete", comparisonStatus: "abstained", submission: { listeningAttestation: "unverified" } },
        ],
      });
      expect(report.jobs[0].review.attachments.reference.content).toBe("music");
      const markdown = await readFile(join(outputDir, "report.md"), "utf8");
      expect(markdown).toMatch(/attempts reserved: 2; validated completed responses: 2; compared: 1; abstained: 1; ambiguous jobs: 0/i);
      expect(markdown).toContain("| chords | 1/1 | 0 | 1 | none / opening | opening | provisional |");
      const countPath = join(outputDir, "stub-invocations.txt");
      expect(await readFile(countPath, "utf8")).toBe("4");

      await runCli(cliArgs(fixture, outputDir, "evidence-v2", true));
      expect(await readFile(countPath, "utf8")).toBe("4");
      let mismatch = "";
      try { await runCli(cliArgs(fixture, outputDir, "legacy", true)); }
      catch (error) { mismatch = String((error as Error).message); }
      expect(mismatch).toMatch(/review profile or schema changed/i);
      expect(await readFile(countPath, "utf8")).toBe("4");

      const legacyDir = join(fixture.root, "legacy-output");
      await runCli(cliArgs(fixture, legacyDir, undefined, false, true));
      const legacyReport = JSON.parse(await readFile(join(legacyDir, "report.json"), "utf8"));
      const legacyPrompt = await readFile(join(legacyDir, "prompts", "original-opening.txt"), "utf8");
      expect(legacyReport).toMatchObject({ reviewProfile: "legacy", reviewSchemaVersion: 1, coverage: { completeJobCount: 0, comparedJobCount: 0, abstainedJobCount: 0 } });
      expect(legacyPrompt).toContain("Compare the two attached piano excerpts");
    } finally {
      fixture.server.closeAllConnections();
      await new Promise<void>(resolveClose => fixture.server.close(() => resolveClose()));
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a reserved ambiguous attempt separately from validated complete responses", async () => {
    const fixture = await makeLocalRun();
    const outputDir = join(fixture.root, "ambiguous-output");
    try {
      await writeFile(join(fixture.root, "force-next-live-response"), "controlled invalid legacy-shaped response");
      let errorText = "";
      try { await runCli(cliArgs(fixture, outputDir, "evidence-v2")); }
      catch (error) {
        const failure = error as { message?: string; stderr?: string };
        errorText = `${failure.message ?? ""}${failure.stderr ?? ""}`;
      }
      expect(errorText).toMatch(/evidence-v2 requires domain schemaVersion 2/i);
      const report = JSON.parse(await readFile(join(outputDir, "report.json"), "utf8"));
      expect(report.submissionEvidence).toMatchObject({ attemptsReserved: 1, validatedCompleteResponses: 0, ambiguousJobs: 1 });
      expect(report.coverage).toMatchObject({ completeJobCount: 0, comparedJobCount: 0, abstainedJobCount: 0 });
      expect(report.jobs.map((job: { status: string }) => job.status)).toEqual(["ambiguous", "planned"]);
      expect(await readFile(join(outputDir, "report.md"), "utf8")).toMatch(/attempts reserved: 1; validated completed responses: 0; compared: 0; abstained: 0; ambiguous jobs: 1/i);
      expect(await readFile(join(outputDir, "stub-invocations.txt"), "utf8")).toBe("2");
    } finally {
      fixture.server.closeAllConnections();
      await new Promise<void>(resolveClose => fixture.server.close(() => resolveClose()));
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);
});
