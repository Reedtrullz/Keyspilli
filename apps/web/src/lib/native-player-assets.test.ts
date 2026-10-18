import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireNativePianoSample } from "./native-player-assets";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const directory = () => { const root = mkdtempSync(join(realpathSync(tmpdir()), "keyspilli-native-assets-")); roots.push(root); return root; };
const body = Buffer.from("OggS software input fixture");
const pin = { url: "https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples/control.ogg", sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length };

it("publishes verified bytes once as an isolated read-only file and reuses them without acquisition", async () => {
  const root = directory();
  const result = await acquireNativePianoSample(pin, root, async () => new Response(body));
  expect(readFileSync(result.path)).toEqual(body);
  const before = lstatSync(result.path);
  expect(before.nlink).toBe(1);
  expect(before.mode & 0o222).toBe(0);
  const reused = await acquireNativePianoSample(pin, root, async () => { throw new Error("verified input was reacquired"); });
  expect(reused.reused).toBe(true);
  expect(lstatSync(result.path).ino).toBe(before.ino);
});

it.each([new Response("unavailable", { status: 503 }), new Response(Buffer.alloc(body.length, 1)), new Response(Buffer.alloc(body.length + 1))])(
  "refuses failed, tampered or oversized transfers without publishing an input", async response => {
    const root = directory();
    await expect(acquireNativePianoSample(pin, root, async () => response)).rejects.toThrow();
    expect(() => lstatSync(join(root, pin.sha256 + ".ogg"))).toThrow();
  });

it("preserves an existing corrupt input instead of repairing or overwriting it", async () => {
  const root = directory(), path = join(root, pin.sha256 + ".ogg");
  writeFileSync(path, "retain corrupt evidence", { mode: 0o444 });
  await expect(acquireNativePianoSample(pin, root, async () => new Response(body))).rejects.toThrow(/drift/);
  expect(readFileSync(path, "utf8")).toBe("retain corrupt evidence");
});

it("rejects a symlink to a shared original without changing that original", async () => {
  const root = directory(), original = join(directory(), "original.ogg");
  writeFileSync(original, body);
  symlinkSync(original, join(root, pin.sha256 + ".ogg"));
  await expect(acquireNativePianoSample(pin, root, async () => new Response(body))).rejects.toThrow(/regular/);
  expect(readFileSync(original)).toEqual(body);
});

it.each(["writable", "hardlink"])("refuses a hash-correct %s input without repairing shared metadata", async kind => {
  const root = directory(), path = join(root, pin.sha256 + ".ogg");
  const original = kind === "hardlink" ? join(directory(), "original.ogg") : path;
  writeFileSync(original, body, { mode: kind === "writable" ? 0o644 : 0o444 });
  if (kind === "hardlink") linkSync(original, path);
  const before = lstatSync(original);
  await expect(acquireNativePianoSample(pin, root, async () => new Response(body))).rejects.toThrow(/read-only|single-link/);
  expect(readFileSync(original)).toEqual(body);
  expect(lstatSync(original).mode).toBe(before.mode);
  expect(lstatSync(original).nlink).toBe(before.nlink);
});
