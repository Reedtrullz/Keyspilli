/** Bounded acquisition of the existing Player bank for isolated native tests. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pianoToPreset } from "smplr";
import { assertMusic as check, isHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { readPinnedSampleAssets, type PlayerAssetManifest } from "./player-reference-bank";

type Pin = Omit<PlayerAssetManifest["assets"][number], "path">;
type Fixture = { schemaVersion: number; moduleVersion: string; moduleSha256: string; rightsSource: string; sourceReceiptSha256: string; sampleAssetPins: Pin[] };
const base = "https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples/";
const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const file = (root: string, pin: Pin) => join(root, pin.sha256 + ".ogg");

function checkDirectory(root: string): void {
  check(isAbsolute(root) && realpathSync(root) === resolve(root) && lstatSync(root).isDirectory(), "canonical owned bank directory required");
}
function checkPin(pin: Pin): void {
  check(pin.url.startsWith(base) && pin.url.endsWith(".ogg") && new URL(pin.url).href === pin.url
    && isHash(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 4 * 1024 ** 2, "invalid bounded piano pin");
}
function checkNativeFile(path: string): void {
  const metadata = lstatSync(path);
  check(metadata.isFile() && !metadata.isSymbolicLink(), "bounded regular asset required");
  check(metadata.nlink === 1 && (metadata.mode & 0o222) === 0, "read-only single-link piano input required");
}
function fixture() {
  const fixturePath = new URL("../../scripts/fixtures/native-piano-assets.json", import.meta.url);
  const metadata = lstatSync(fixturePath);
  check(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 1024 ** 2, "bounded piano fixture required");
  const raw = readFileSync(fixturePath);
  const pins = JSON.parse(raw.toString()) as Fixture;
  const packagePath = createRequire(import.meta.url).resolve("smplr/package.json");
  const version = (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version;
  check(pins.schemaVersion === 1 && pins.moduleVersion === version && isHash(pins.moduleSha256)
    && sha(readFileSync(join(dirname(packagePath), "dist/index.mjs"))) === pins.moduleSha256, "native piano module drift");
  const preset = pianoToPreset({ baseUrl: "", detune: 0, decayTime: 0.5 });
  const expected = new Set(preset.groups.flatMap(group => group.regions.map(region => base + encodeURIComponent(region.sample) + ".ogg")));
  check(Array.isArray(pins.sampleAssetPins) && pins.sampleAssetPins.length === expected.size
    && new Set(pins.sampleAssetPins.map(pin => pin.url)).size === expected.size, "complete piano inventory required");
  for (const pin of pins.sampleAssetPins) { checkPin(pin); check(expected.has(pin.url), "unregistered piano sample"); }
  check(pins.sampleAssetPins.reduce((sum, pin) => sum + pin.bytes, 0) <= 256 * 1024 ** 2, "piano input exceeds 256MiB");
  check(typeof pins.rightsSource === "string" && pins.rightsSource.length > 0 && isHash(pins.sourceReceiptSha256), "piano input authority required");
  return { ...pins, fixtureSha256: sha(raw) };
}

export async function acquireNativePianoSample(pin: Pin, root: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  checkDirectory(root); checkPin(pin);
  const path = file(root, pin);
  if (lstatSync(path, { throwIfNoEntry: false })) {
    checkNativeFile(path);
    readPinnedSampleAssets([{ ...pin, path }]);
    return { path, reused: true };
  }
  const response = await request(pin.url, { redirect: "error", signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  check(response.ok && response.body, "piano asset request failed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; check(bytes <= pin.bytes, "piano asset exceeds pinned bytes"); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = Buffer.concat(chunks);
  check(body.length === pin.bytes && sha(body) === pin.sha256, "piano asset hash/bytes drift");
  writeFileSync(path, body, { flag: "wx", mode: 0o444 });
  checkNativeFile(path);
  return { path, reused: false };
}

export function readNativePianoBank(root: string) {
  checkDirectory(root); const pins = fixture();
  for (const pin of pins.sampleAssetPins) checkNativeFile(file(root, pin));
  const assets = readPinnedSampleAssets(pins.sampleAssetPins.map(pin => ({ ...pin, path: file(root, pin) })));
  return { ...pins, assets };
}

export async function prepareNativePianoBank(root: string) {
  const pins = fixture(), parent = dirname(root), total = pins.sampleAssetPins.reduce((sum, pin) => sum + pin.bytes, 0);
  checkDirectory(parent);
  const space = statfsSync(parent);
  check(Number(space.bavail) * Number(space.bsize) >= total + 6 * 1024 ** 3, "insufficient piano input space plus 6GiB reserve");
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  checkDirectory(root);
  const names = new Set(pins.sampleAssetPins.map(pin => pin.sha256 + ".ogg"));
  check(readdirSync(root).every(name => names.has(name)), "unregistered bank files preserved; fresh owned input required");
  const abort = new AbortController(), deadline = AbortSignal.timeout(120_000);
  let cursor = 0, reused = 0;
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    try {
      while (!abort.signal.aborted) {
        const pin = pins.sampleAssetPins[cursor++]; if (!pin) return;
        if ((await acquireNativePianoSample(pin, root, fetch, AbortSignal.any([abort.signal, deadline]))).reused) reused++;
      }
    } catch (error) { abort.abort(error); throw error; }
  }));
  const failure = workers.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const verified = readNativePianoBank(root);
  return { assets: verified.assets.size, bytes: total, reused, fixtureSha256: verified.fixtureSha256, rightsSource: verified.rightsSource };
}
