/** Thin offline handoff for a verified ordinary preparation. No catalog publication. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { midiBeatToNativeSeconds, parseMidi } from "@keyspilli/midi";
import { renderMidiToWav, type MidiRenderResult } from "../../../../packages/catalog/src/midi-renderer.js";
import { previewHash as hash, validatePreview } from "./preview-validation.js";

const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
export const DELIVERY_LEVELS = ["a", "m", "e", "ve", "b", "vb"] as const;
type Level = typeof DELIVERY_LEVELS[number];
const levelNames: Record<Level, string> = { a: "Advanced", m: "Medium", e: "Easy", ve: "Very Easy", b: "Beginner", vb: "Very Beginner" };
const bundleFiles = ["artifacts/manifest.json", ...DELIVERY_LEVELS.flatMap(l => ["notes.json", "variant.mid", "variant.xml"].map(f => `artifacts/${l}/${f}`)),
  "rows.json", "timeline.json", "playback.json", "chords.mid", "chords.musicxml"].sort();
const MAX_SYMBOLIC = 16 * 1024 * 1024, MAX_WAV = 256 * 1024 * 1024;
interface Mode {
  status: "rendered" | "blocked";
  midi: string; musicxml: string; preview: string;
  difficultyScope: string; warnings: string[]; error?: string;
  render?: MidiRenderResult;
}
export interface DeliveryManifest {
  schemaVersion: 1; kind: "keyspilli-song-delivery";
  status: "complete-provisional" | "incomplete";
  baseId: string; sourceSha256: string; title: string; artist: string; originalLevel: Level;
  musicalAcceptance: "not-established"; productionAdmission: false;
  bundleSha256: string; files: Record<string, string>;
  modes: { original: Mode; chords: Mode };
}
export interface DeliveryOptions { soundfont?: string; executable?: string; level?: string }

function bytes(path: string, max = MAX_SYMBOLIC): Buffer {
  const s = lstatSync(path);
  assert(s.isFile() && s.size <= max, `missing, nonregular or oversized file: ${path}`);
  const b = readFileSync(path); assert(b.length <= max, "file grew past limit"); return b;
}
function json(path: string) { return JSON.parse(bytes(path).toString("utf8")); }
function validateRenderReceipt(value: unknown): asserts value is MidiRenderResult {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const positive = (n: unknown) => finite(n) && n > 0;
  const nonnegative = (n: unknown) => finite(n) && n >= 0;
  const integer = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0;
  const ratio = (n: unknown) => finite(n) && n >= 0 && n <= 1;
  assert(record(value) && record(value.renderer) && record(value.midi) && record(value.soundfont)
    && record(value.wav) && record(value.duration), "invalid render receipt records");
  const { renderer: r, midi: m, soundfont: s, wav: w, duration: d } = value;
  assert(r.id === "fluidsynth" && r.version === "pcm16-v1", "unsupported renderer receipt");
  assert([r.executable, m.path, s.path, w.path].every(v => typeof v === "string" && v.trim().length > 0), "invalid render receipt paths");
  assert([m.sha256, s.sha256, w.sha256].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)), "invalid render receipt hashes");
  assert(integer(r.sampleRate) && positive(r.sampleRate) && positive(r.gain) && ratio(r.targetPeak) && positive(r.targetPeak), "invalid renderer settings");
  assert([m.tempoBpm, m.durationBeats, m.expectedSeconds].every(positive), "invalid MIDI receipt clock");
  assert(integer(s.bytes) && positive(s.bytes) && s.bytes <= MAX_WAV, "invalid SoundFont receipt size");
  assert(integer(w.bytes) && positive(w.bytes) && w.bitsPerSample === 16, "invalid WAV receipt size or format");
  assert([w.sampleRate, w.channels].every(n => integer(n) && positive(n)) && [w.frameCount, w.sampleCount].every(integer)
    && nonnegative(w.durationSeconds) && [w.peak, w.rms, w.silenceRatio].every(ratio) && integer(w.clippingCount), "invalid WAV receipt metrics");
  assert((w.rawPeak === undefined || nonnegative(w.rawPeak)) && (w.rawClippingCount === undefined || integer(w.rawClippingCount)), "invalid raw PCM receipt metrics");
  assert(positive(d.expectedSeconds) && nonnegative(d.renderedSeconds) && finite(d.deltaSeconds)
    && finite(d.toleranceSeconds) && d.toleranceSeconds >= 0 && (d.status === "pass" || d.status === "warning" || d.status === "fail"), "invalid duration receipt");
}
function regularRoot(path: string): string {
  const absolute = resolve(path);
  assert(lstatSync(absolute).isDirectory() && realpathSync(absolute) === absolute, "directory aliases are not supported");
  return absolute;
}
function nested(root: string, path: string): boolean { const rel = relative(root, path); return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../")); }
function safeName(name: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(name) && name.split("/").every(p => p && p !== "." && p !== ".."); }
function inventory(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, prefix))) {
    const p = prefix ? prefix + "/" + name : name, s = lstatSync(join(root, p));
    assert(safeName(p) && !s.isSymbolicLink(), "unsafe delivery member");
    if (s.isDirectory()) out.push(...inventory(root, p));
    else { assert(s.isFile(), "nonregular delivery member"); out.push(p); }
    assert(out.length <= 80, "delivery inventory exceeds bound");
  }
  return out.sort();
}
function readBundle(root: string) {
  regularRoot(root);
  const manifest = json(join(root, "bundle.json"));
  assert(manifest.schemaVersion === 1 && /^[a-z0-9][a-z0-9-]{0,119}$/.test(manifest.baseId), "invalid bundle identity");
  assert.deepEqual(Object.keys(manifest.files).sort(), bundleFiles, "incomplete bundle inventory");
  assert.deepEqual(inventory(root), [...bundleFiles, "bundle.json"].sort(), "undeclared bundle files");
  for (const name of bundleFiles) assert.equal(hash(bytes(join(root, name))), manifest.files[name], `changed bundle ${name}`);
  return manifest as { baseId: string; files: Record<string, string> };
}
function checkModeSources(root: string, level: Level) {
  const p = json(join(root, "bundle/playback.json"));
  const original = parseMidi(bytes(join(root, "original.mid"))), chords = parseMidi(bytes(join(root, "chords.mid")));
  assert(chords.durationBeats + 1 / chords.division >= p.snapshot.endBeatExclusive, "Chords MIDI loses the declared ending/rest; prepare again with the current exporter");
  assert(midiBeatToNativeSeconds(original, original.durationBeats) > 0 && midiBeatToNativeSeconds(chords, chords.durationBeats) > 0, "empty delivery source clock");
  for (const [delivered, bundled] of [["original.mid", `artifacts/${level}/variant.mid`], ["original.musicxml", `artifacts/${level}/variant.xml`],
    ["chords.mid", "chords.mid"], ["chords.musicxml", "chords.musicxml"]])
    assert(bytes(join(root, delivered!)).equals(bytes(join(root, "bundle", bundled!))), `mismatched mode export: ${delivered}`);
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function index(m: DeliveryManifest): string {
  const sections = (["original", "chords"] as const).map(mode => {
    const v = m.modes[mode], title = mode === "original" ? `Original — ${levelNames[m.originalLevel]}` : "Chords — shared Advanced-derived backing";
    return `<section><h2>${title}</h2><p>${escape(v.status)}. ${escape(v.error ?? "Provisional; not musically approved.")}</p>${v.warnings.map(w => `<p class="warning">${escape(w)}</p>`).join("")}
${v.status === "rendered" ? `<audio controls preload="metadata" src="${v.preview}">Audio preview</audio>` : ""}
<p><a href="${v.midi}" download>MIDI</a> · <a href="${v.musicxml}" download>MusicXML</a></p></section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(m.title)} — Keyspilli</title>
<style>body{font:18px system-ui;max-width:850px;margin:3em auto;padding:0 1em;line-height:1.6}audio{width:100%}section{border-top:1px solid;padding-top:1em}li{margin:.4em 0}.warning{font-weight:600}</style>
<h1>${escape(m.title)}</h1><p>${escape(m.artist)}</p><p><strong>${m.status}</strong> · Structural delivery checks only. Source, listening and keyboard acceptance remain separate. No publication authorized.</p>
${sections}<section><h2>All six Original variants</h2><ul>${DELIVERY_LEVELS.map(l => `<li>${levelNames[l]}: <a href="bundle/artifacts/${l}/variant.mid" download>MIDI</a> · <a href="bundle/artifacts/${l}/variant.xml" download>MusicXML</a></li>`).join("")}</ul>
<p>Chords is one shared backing, not six independently graded accompaniments. Previews render the exported MIDI, not a browser audio capture.</p>
<p><a href="README.md">Import and verification</a> · <a href="manifest.json">File hashes and diagnostics</a></p></section></html>\n`;
}

/** Verifies portable retained bytes without invoking renderers, installing catalogs or repairing data. */
export function verifyDelivery(directory: string): DeliveryManifest {
  const root = regularRoot(directory), m = json(join(root, "manifest.json")) as DeliveryManifest;
  assert(m.schemaVersion === 1 && m.kind === "keyspilli-song-delivery" && DELIVERY_LEVELS.includes(m.originalLevel), "unsupported delivery manifest");
  assert(m.musicalAcceptance === "not-established" && m.productionAdmission === false, "unexpected approval claim");
  assert(typeof m.title === "string" && typeof m.artist === "string", "invalid delivery labels");
  assert(typeof m.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(m.sourceSha256) && m.baseId === `upload-${m.sourceSha256}`, "source identity mismatch");
  const names = Object.keys(m.files).sort();
  assert.deepEqual(Object.keys(m.modes).sort(), ["chords", "original"], "unexpected delivery modes");
  const requiredFiles = ["README.md", "index.html", "original.mid", "original.musicxml", "chords.mid", "chords.musicxml",
    "bundle/bundle.json", ...bundleFiles.map(p => "bundle/" + p)];
  assert(requiredFiles.every(p => names.includes(p)), "missing required delivery document or export");
  assert(names.length <= 70 && names.every(safeName) && !names.includes("manifest.json"), "invalid delivery inventory");
  assert.deepEqual(inventory(root), [...names, "manifest.json"].sort(), "missing or undeclared delivery files");
  for (const name of names) assert.equal(hash(bytes(join(root, name), name.endsWith(".wav") ? MAX_WAV : MAX_SYMBOLIC)), m.files[name], `changed delivery file ${name}`);
  const b = readBundle(join(root, "bundle"));
  assert.equal(b.baseId, m.baseId); assert.equal(hash(bytes(join(root, "bundle/bundle.json"))), m.bundleSha256);
  checkModeSources(root, m.originalLevel);
  for (const mode of ["original", "chords"] as const) {
    const v = m.modes[mode];
    assert(v.midi === `${mode}.mid` && v.musicxml === `${mode}.musicxml` && v.preview === `${mode}-preview.wav`, "mode path mismatch");
    assert(v.status === "rendered" || v.status === "blocked", "invalid mode status");
    assert(v.difficultyScope === (mode === "chords" ? "shared-advanced-derived" : m.originalLevel), "mode difficulty mismatch");
    assert(Array.isArray(v.warnings) && v.warnings.every(w => typeof w === "string")
      && (v.error === undefined || typeof v.error === "string"), "invalid mode diagnostics");
    if (v.render !== undefined) validateRenderReceipt(v.render);
    if (v.status === "rendered") {
      assert(v.render, "missing render receipt");
      assert(v.render.midi.path === v.midi && v.render.wav.path === v.preview, "render receipt path mismatch");
      assert.deepEqual(validatePreview(v.render, bytes(join(root, v.midi)), bytes(join(root, v.preview), MAX_WAV)), v.warnings, "unreported preview warnings");
    } else assert(typeof v.error === "string" && v.error.length > 0, "blocked mode lacks reason");
  }
  const complete = Object.values(m.modes).every(v => v.status === "rendered");
  assert.equal(m.status, complete ? "complete-provisional" : "incomplete", "false delivery completion");
  assert.equal(bytes(join(root, "index.html")).toString("utf8"), index(m), "index differs from actual delivery state");
  return m;
}

export async function deliverSong(runPath: string, destination: string, options: DeliveryOptions = {}): Promise<DeliveryManifest> {
  const run = regularRoot(runPath), out = resolve(destination), level = options.level ?? "a";
  assert(DELIVERY_LEVELS.includes(level as Level), "unsupported Original preview level");
  assert(!existsSync(out), "delivery output already exists; preserve it and select a new directory");
  assert(realpathSync(dirname(out)) === dirname(out), "output parent must exist without aliases");
  for (const protectedPath of [join(run, "bundle"), join(run, "installed"), join(run, "data"), join(checkout, "plugins")])
    assert(!nested(protectedPath, out) && !nested(out, protectedPath), "delivery output overlaps source or plugin");
  const resultBytes = bytes(join(run, "result.json")), result = JSON.parse(resultBytes.toString("utf8"));
  assert(result.bundle === join(run, "bundle") && result.installed === join(run, "installed") && result.checks?.freshImport === true && result.checks?.musicalIdempotence === true, "requires an ordinary verified preparation run");
  regularRoot(join(run, "installed"));
  const b = readBundle(join(run, "bundle")), before = new Map([...bundleFiles, "bundle.json"].map(p => [p, bytes(join(run, "bundle", p))]));
  assert(b.baseId === result.baseId && b.baseId === `upload-${result.sourceSha256}`, "preparation identity mismatch");
  execFileSync(process.execPath, ["--import", "tsx", join(checkout, "apps/web/scripts/song-bundle.mts"), "verify", join(run, "bundle"), join(run, "installed")],
    { cwd: checkout, env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  const rows = json(join(run, "bundle/rows.json"));
  assert(rows.length === 6 && rows.every((r: {baseId: string}) => r.baseId === b.baseId), "incomplete source rows");
  const selected = rows.find((r: {level: string}) => r.level === level); assert(selected, "missing Original tier");
  mkdirSync(out); mkdirSync(join(out, "bundle"));
  for (const [name, content] of before) { const path = join(out, "bundle", name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { flag: "wx" }); }
  const m: DeliveryManifest = { schemaVersion: 1, kind: "keyspilli-song-delivery", baseId: b.baseId, sourceSha256: result.sourceSha256,
    title: selected.title, artist: selected.artist, originalLevel: level as Level, status: "incomplete", musicalAcceptance: "not-established", productionAdmission: false,
    bundleSha256: hash(before.get("bundle.json")!), files: {}, modes: {} as DeliveryManifest["modes"] };
  for (const mode of ["original", "chords"] as const) {
    const from = mode === "original" ? `artifacts/${level}/variant` : "chords";
    writeFileSync(join(out, `${mode}.mid`), before.get(from + ".mid")!, { flag: "wx" });
    writeFileSync(join(out, `${mode}.musicxml`), before.get(from + (mode === "original" ? ".xml" : ".musicxml"))!, { flag: "wx" });
    m.modes[mode] = { status: "blocked", midi: `${mode}.mid`, musicxml: `${mode}.musicxml`, preview: `${mode}-preview.wav`, warnings: [],
      difficultyScope: mode === "chords" ? "shared-advanced-derived" : level, error: "Preview has not been rendered." };
  }
  checkModeSources(out, level as Level);
  for (const mode of ["original", "chords"] as const) {
    const v = m.modes[mode];
    try {
      const input = bytes(join(out, v.midi));
      const bank = options.soundfont ?? process.env.KEYSPILLI_SOUNDFONT;
      if (bank) {
        const info = lstatSync(bank);
        assert(info.isFile() && info.size <= MAX_WAV, "sound bank must be a regular file within the 256 MiB delivery limit");
      }
      const rendered = await renderMidiToWav({ midiPath: join(out, v.midi), outputPath: join(out, v.preview) },
        { soundfontPath: options.soundfont, executable: options.executable, gain: 0.2, sampleRate: 22050, timeoutMs: 120_000 });
      v.render = rendered;
      v.warnings = validatePreview(rendered, input, bytes(join(out, v.preview), MAX_WAV));
      assert(input.equals(bytes(join(out, v.midi))), "MIDI changed during rendering");
      assert.equal(hash(bytes(rendered.soundfont.path, MAX_WAV)), rendered.soundfont.sha256, "sound bank changed during rendering");
      // Delivery paths are relative; external runtime paths are provenance only, never used by verify.
      rendered.midi.path = v.midi; rendered.wav.path = v.preview;
      v.status = "rendered"; delete v.error;
    } catch (error) {
      v.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      const preview = join(out, v.preview);
      if (existsSync(preview)) {
        const rejected = lstatSync(preview);
        if (rejected.isFile() && rejected.size > MAX_WAV) {
          v.error += ` Rejected preview output removed: ${rejected.size} bytes exceeds the 256 MiB delivery limit.`;
          unlinkSync(preview);
        }
      }
    }
  }
  for (const [name, content] of before) assert(content.equals(bytes(join(run, "bundle", name))), "preparation changed during delivery");
  assert(resultBytes.equals(bytes(join(run, "result.json"))), "preparation result changed during delivery");
  m.status = Object.values(m.modes).every(v => v.status === "rendered") ? "complete-provisional" : "incomplete";
  writeFileSync(join(out, "README.md"), `# Keyspilli local song delivery\n\nOpen index.html for both preview statuses and downloads. Original preview: ${levelNames[level as Level]}. Chords is one shared Advanced-derived backing.\n\nFrom the matching supported Keyspilli checkout:\n\n    node --import tsx apps/web/scripts/deliver-song.mts verify /absolute/delivery\n    node --import tsx apps/web/scripts/song-bundle.mts install /absolute/delivery/bundle output/new-isolated-catalog\n\nChoose a new catalog directory, never production. The complete bundle is preserved byte for byte. Verification checks integrity, not authenticity of arbitrary replacement manifests.\n\nThese exports/previews are provisional. Source identity, acoustic fidelity, musical judgment and keyboard acceptance are not established by passing software checks. No sound bank is included and no publication is authorized.\n`, { flag: "wx" });
  writeFileSync(join(out, "index.html"), index(m), { flag: "wx" });
  m.files = Object.fromEntries(inventory(out).map(p => [p, hash(bytes(join(out, p), p.endsWith(".wav") ? MAX_WAV : MAX_SYMBOLIC))]));
  writeFileSync(join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n", { flag: "wx" });
  verifyDelivery(out); return m;
}
