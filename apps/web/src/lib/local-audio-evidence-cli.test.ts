import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runner = new URL("../../scripts/report-local-audio-evidence.mts", import.meta.url).pathname;
const exec = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cli = (args: string[]) => exec(process.execPath, ["--import", "tsx", runner, ...args], { timeout: 15_000, encoding: "utf8" });
async function fixture(run: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  const f = await createFixture();
  try { await run(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-local-evidence-cli-"));
  const buffer = Buffer.alloc(46);
  buffer.write("RIFF"); buffer.writeUInt32LE(38, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(32_000, 24); buffer.writeUInt32LE(64_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(2, 40); buffer.writeInt16LE(4000, 44);
  const audio = { path: join(root, "clip.wav"), sha256: hash(buffer), bytes: 46, sampleRate: 32_000, channels: 1, bitsPerSample: 16, durationSeconds: 1 / 32_000, assetStartSeconds: 0 };
  await writeFile(audio.path, buffer);
  const events = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "keyspilli-render-events", clock: "asset-seconds", clipSha256: audio.sha256, assetStartSeconds: 0, events: [{ midi: 64, startSeconds: 0, durationSeconds: 1 / 32_000 }] }));
  const sourceEvents = { path: join(root, "events.json"), sha256: hash(events) }; await writeFile(sourceEvents.path, events);
  const manifest = { schemaVersion: 1, kind: "keyspilli-local-audio-evidence-manifest", clips: [{ id: "excerpt", mode: "original", audio, sourceEvents }] };
  const manifestPath = join(root, "manifest.json"); await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, audio, manifestPath, output: join(root, "report") };
}

describe("local audio evidence CLI", () => {
  it("advertises an offline command with no upload capability", async () => {
    const result = await cli(["capabilities"]);
    expect(JSON.parse(result.stdout)).toMatchObject({ localOnly: true, providerCalls: 0, acceptsSavedAntiObservations: true, uploadsAudio: false });
  });
  it("writes private, user-readable JSON and Markdown with unavailable acoustic/model evidence", async () => fixture(async f => {
    const result = await cli([f.manifestPath, f.output]);
    expect(JSON.parse(result.stdout)).toMatchObject({ providerCalls: 0, musicalAcceptance: "not-established" });
    const report = JSON.parse(await readFile(join(f.output, "evidence.json"), "utf8"));
    expect(report).toMatchObject({ calibrated: false, clips: [{ sourceIntent: { noteOnEventCount: 1, distinctStartTimeCount: 1 }, pcm: { onsetEstimateSeconds: [0] }, advisory: { status: "not-provided" }, acousticPitch: { pitches: null } }] });
    expect(await readFile(join(f.output, "evidence.md"), "utf8")).toContain("excerpt / original");
    expect((await stat(f.output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.output, "evidence.json"))).mode & 0o777).toBe(0o600);
  }));
  it("refuses live flags and does not create output", async () => fixture(async f => {
    await expect(cli([f.manifestPath, f.output, "--send-audio"])).rejects.toThrow(/local|Usage|offline/i);
    await expect(stat(f.output)).rejects.toThrow(/ENOENT/);
  }));
  it("refuses changed bytes before producing a report", async () => fixture(async f => {
    await writeFile(f.audio.path, "changed");
    await expect(cli([f.manifestPath, f.output])).rejects.toThrow(/pin|byte|changed/i);
    await expect(stat(f.output)).rejects.toThrow(/ENOENT/);
  }));
  it("preserves an existing output directory", async () => fixture(async f => {
    await mkdir(f.output); await writeFile(join(f.output, "keep.txt"), "owner data");
    await expect(cli([f.manifestPath, f.output])).rejects.toThrow(/exist|new directory/i);
    expect(await readFile(join(f.output, "keep.txt"), "utf8")).toBe("owner data");
    await expect(stat(join(f.output, "evidence.json"))).rejects.toThrow(/ENOENT/);
  }));
});
