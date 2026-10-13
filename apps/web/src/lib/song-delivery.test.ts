/** Full command-path controls with authored MIDI and a PCM-emitting backend. Not listening evidence. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi, writeMidi } from "@keyspilli/midi";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
let scratch: string, run: string, input: string, bank: string;
let retained = false;
function command(script: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts", script + ".mts"), ...args], {
    cwd: root, encoding: "utf8", timeout: 90_000, env: { ...process.env, NODE_ENV: "test" }, maxBuffer: 2 * 1024 * 1024,
  });
}
function backend(name: string, seconds: number, amplitude = 5000, breakChords = false): string {
  const path = join(scratch, name);
  // The real renderer invokes this process with its real MIDI/output/SoundFont args.
  writeFileSync(path, `#!${process.execPath}\nconst fs=require('node:fs');
const args=process.argv.slice(2),out=args[args.indexOf('-F')+1], input=args.at(-1);
const rate=Number(args[args.indexOf('-r')+1]);
const seconds=${breakChords ? `(input.endsWith('chords.mid') ? 0.1 : ${seconds})` : seconds};
const frames=Math.round(rate*seconds), b=Buffer.alloc(44+frames*2);
b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
b.write('data',36);b.writeUInt32LE(frames*2,40);
for(let i=0;i<frames;i++)b.writeInt16LE(${amplitude}*(i%2?1:-1),44+i*2);
fs.writeFileSync(out,b);\n`);
  chmodSync(path, 0o700); return path;
}
const deliver = (out: string, executable: string, extra: string[] = [], prepared = run) =>
  command("deliver-song", [prepared, out, "--soundfont", bank, "--executable", executable, ...extra]);
function complete(result: ReturnType<typeof command>) {
  if (result.status !== 0) retained = true;
  expect(result.status, result.stderr || result.stdout).toBe(0);
}
beforeAll(() => {
  mkdirSync(join(root, "output"), { recursive: true });
  scratch = mkdtempSync(join(root, "output/delivery-test-"));
  run = join(scratch, "prepared"); input = join(scratch, "source.mid"); bank = join(scratch, "test.sf2");
  const notes = Array.from({ length: 8 }, (_, i) => i * 4).flatMap(start => [48, 64, 67].map(midi => ({ midi, start, dur: 2, vel: 80 })));
  writeFileSync(input, writeMidi(notes, { tempoBpm: 120, measures: Array.from({ length: 8 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })) }));
  writeFileSync(bank, "authored fake bank for controlled PCM tests only");
  complete(command("prepare-song", [input, run, 'Control <script>alert(1)</script>', 'Software & testing']));
}, 90_000);
afterAll(() => { if (retained) console.error("delivery controls retained", scratch); else rmSync(scratch, { recursive: true, force: true }); });

describe("complete song delivery", () => {
  it("preserves the declared terminal rest in the actual Chords MIDI", () => {
    const playback = read(join(run, "bundle/playback.json"));
    expect(parseMidi(readFileSync(join(run, "bundle/chords.mid"))).durationBeats).toBe(playback.snapshot.endBeatExclusive);
  });
  it("advertises an offline delivery and read-only verify command", () => {
    const result = command("deliver-song", ["--help"]); complete(result);
    expect(result.stdout).toContain("verify"); expect(result.stdout).toContain("provisional");
  });
  it("delivers both complete previews, all six Original tiers and a relocatable escaped index", () => {
    const out = join(scratch, "complete"); complete(deliver(out, backend("complete-backend", 17)));
    const m = read(join(out, "manifest.json"));
    expect(m).toMatchObject({ status: "complete-provisional", musicalAcceptance: "not-established", productionAdmission: false });
    expect(m.modes.original.status).toBe("rendered"); expect(m.modes.chords.status).toBe("rendered");
    expect(m.modes.chords.difficultyScope).toBe("shared-advanced-derived");
    for (const [path, digest] of Object.entries(m.files)) expect(sha(readFileSync(join(out, path)))).toBe(digest);
    for (const level of ["a", "m", "e", "ve", "b", "vb"]) for (const ext of ["mid", "xml"])
      expect(readFileSync(join(out, `bundle/artifacts/${level}/variant.${ext}`))).toEqual(readFileSync(join(run, `bundle/artifacts/${level}/variant.${ext}`)));
    expect(readFileSync(join(out, "original.mid"))).toEqual(readFileSync(join(run, "bundle/artifacts/a/variant.mid")));
    expect(readFileSync(join(out, "chords.mid"))).toEqual(readFileSync(join(run, "bundle/chords.mid")));
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html.match(/<audio /g)).toHaveLength(2); expect(html).not.toContain("<script>"); expect(html).not.toContain(scratch);
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("shared");
    const relocated = join(scratch, "relocated"); cpSync(out, relocated, { recursive: true });
    complete(command("deliver-song", ["verify", relocated]));
  }, 90_000);
  it("supports an explicit Original preview tier without inventing six Chords backings", () => {
    const out = join(scratch, "easy"); complete(deliver(out, backend("easy-backend", 17), ["--level", "e"]));
    expect(readFileSync(join(out, "original.mid"))).toEqual(readFileSync(join(run, "bundle/artifacts/e/variant.mid")));
    expect(read(join(out, "manifest.json")).modes.chords.difficultyScope).toBe("shared-advanced-derived");
  }, 90_000);
  it("retains a good Original when Chords rendering is truncated and exits nonzero", () => {
    const out = join(scratch, "truncated"); const result = deliver(out, backend("cut-backend", 17, 5000, true));
    expect(result.status).not.toBe(0);
    const m = read(join(out, "manifest.json"));
    expect(m.status).toBe("incomplete"); expect(m.modes.original.status).toBe("rendered");
    expect(m.modes.chords).toMatchObject({ status: "blocked" });
    expect(m.modes.chords.error).toMatch(/duration|truncat/i);
    expect(readFileSync(join(out, "index.html"), "utf8").match(/<audio /g)).toHaveLength(1);
    const verified = command("deliver-song", ["verify", out]); expect(verified.status).not.toBe(0);
  }, 90_000);
  it.each([["silent", 0], ["clipped", 32767]] as const)("does not deliver %s PCM as a complete preview", (name, amplitude) => {
    const out = join(scratch, name); const result = deliver(out, backend(name + "-backend", 17, amplitude));
    expect(result.status).not.toBe(0); expect(read(join(out, "manifest.json")).status).toBe("incomplete");
  }, 90_000);
  it("exposes release-tail warnings instead of silently claiming a clean pass", () => {
    const out = join(scratch, "tail"); complete(deliver(out, backend("tail-backend", 19)));
    expect(read(join(out, "manifest.json")).modes.original.warnings.join(" ")).toMatch(/duration|tail/i);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain("warning");
  }, 90_000);
  it("preserves an existing destination", () => {
    const out = join(scratch, "owned"); mkdirSync(out); writeFileSync(join(out, "keep.txt"), "owner");
    expect(deliver(out, "/missing/backend").status).not.toBe(0);
    expect(readdirSync(out)).toEqual(["keep.txt"]); expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("owner");
  });
  it("marks a genuinely unavailable backend as incomplete without losing preparation", () => {
    const out = join(scratch, "missing"); const before = readFileSync(join(run, "result.json"));
    expect(deliver(out, "/missing/backend").status).not.toBe(0);
    expect(read(join(out, "manifest.json")).modes.original.status).toBe("blocked");
    expect(readFileSync(join(run, "result.json"))).toEqual(before);
  }, 90_000);
  it("read-only verification refuses modified bytes without repairing them", () => {
    const out = join(scratch, "mutation"); complete(deliver(out, backend("mutation-backend", 17)));
    writeFileSync(join(out, "original-preview.wav"), "changed");
    expect(command("deliver-song", ["verify", out]).status).not.toBe(0);
    expect(readFileSync(join(out, "original-preview.wav"), "utf8")).toBe("changed");
  }, 90_000);
  it("rejects repeated/unknown options before creating output", () => {
    const out = join(scratch, "invalid");
    for (const extra of [["--level", "a", "--level", "e"], ["--publish"], ["--level", "unknown"]]) {
      expect(deliver(out, "/missing/backend", extra).status).not.toBe(0); expect(existsSync(out)).toBe(false);
    }
  });
  it("refuses a bundle directory alias before reserving delivery output", () => {
    const aliasRun = join(scratch, "alias-run"); cpSync(run, aliasRun, {recursive: true});
    const manifest = read(join(aliasRun, "result.json"));
    manifest.bundle = join(aliasRun, "bundle"); manifest.installed = join(aliasRun, "installed");
    writeFileSync(join(aliasRun, "result.json"), JSON.stringify(manifest));
    rmSync(join(aliasRun, "bundle"), {recursive: true}); symlinkSync(join(run, "bundle"), join(aliasRun, "bundle"), "dir");
    const out = join(scratch, "aliased-delivery");
    const result = deliver(out, backend("alias-backend", 17), [], aliasRun);
    expect(result.status).not.toBe(0); expect(existsSync(out)).toBe(false);
    expect(result.stderr).toMatch(/alias|symlink/);
  }, 90000);
  it("the existing prepared-Chords renderer also refuses a 100ms source shortfall", () => {
    const copy = join(scratch, "batch"); cpSync(join(run, "prepared"), copy, {recursive: true});
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts/render-prepared-chords.mts"), copy], {
      cwd: root, encoding: "utf8", timeout: 90000,
      env: {...process.env, KEYSPILLI_SOUNDFONT: bank, KEYSPILLI_FLUIDSYNTH: backend("batch-cut-backend", 15.9)},
    });
    expect(result.status).not.toBe(0);
    expect(read(join(copy, "audio-ledger.json"))[0].error).toMatch(/duration|truncat/);
  }, 90000);
  it("requires the promised README even after someone edits the inventory", () => {
    const out = join(scratch, "missing-readme"); complete(deliver(out, backend("readme-backend", 17)));
    rmSync(join(out, "README.md")); const m = read(join(out, "manifest.json")); delete m.files["README.md"];
    writeFileSync(join(out, "manifest.json"), JSON.stringify(m));
    expect(command("deliver-song", ["verify", out]).status).not.toBe(0);
  }, 90000);
  it("verifies unchanged semantic receipts regardless of JSON object key order", () => {
    const out = join(scratch, "json-order"); complete(deliver(out, backend("order-backend", 17)));
    const m = read(join(out, "manifest.json"));
    for (const mode of ["original", "chords"]) m.modes[mode].render.duration = Object.fromEntries(Object.entries(m.modes[mode].render.duration).reverse());
    writeFileSync(join(out, "manifest.json"), JSON.stringify(m));
    complete(command("deliver-song", ["verify", out]));
  }, 90000);
  it("ordinary preparation rejects empty renderer options unless previews were requested", () => {
    const next = join(scratch, "ignored-empty-option");
    const result = command("prepare-song", [input, next, "Control", "Software", "--soundfont", ""]);
    expect(result.status).not.toBe(0); expect(existsSync(next)).toBe(false);
  }, 90000);
  it("ordinary preparation can opt into the same complete delivery path", () => {
    const next = join(scratch, "single-command");
    complete(command("prepare-song", [input, next, "Complete delivery", "Software", "--previews", "--soundfont", bank, "--executable", backend("single-command-backend", 17)]));
    expect(read(join(next, "delivery/manifest.json")).status).toBe("complete-provisional");
    expect(read(join(next, "result.json")).checks).toEqual({ freshImport: true, musicalIdempotence: true });
  }, 90_000);
});
