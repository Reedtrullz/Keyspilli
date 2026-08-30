import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPdfRasterArgs,
  buildHomrExecutableArgs,
  buildHomrUvxArgs,
  createAudiverisBackend,
  createHomrBackend,
  createPdfRasterizer,
  HOMR_DEFAULTS,
  hashImageFile,
  probeExecutableVersion,
  resolvePdfRasterConfig,
  type OmrCommandRunner,
} from "../src/omr-backends.js";

// A tiny valid 1x1 RGB PNG.  Keeping the fixture inline makes the test
// independent of Poppler, ImageMagick, and any external OMR installation.
const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/Sc7rWQAAAABJRU5ErkJggg==",
  "base64",
));

const VALID_MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Lead Voice</part-name></score-part></part-list>
  <part id="P1"><measure number="1" page="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("optional OMR backends and PDF rasterization", () => {
  it("normalizes deterministic PNG raster settings and builds shell-free arguments", () => {
    expect(resolvePdfRasterConfig()).toEqual({
      dpi: 300,
      format: "png",
      crop: "none",
      rotation: 0,
      firstPage: 1,
      lastPage: null,
    });
    expect(resolvePdfRasterConfig({ dpi: 400, firstPage: 2, lastPage: 4 })).toEqual({
      dpi: 400,
      format: "png",
      crop: "none",
      rotation: 0,
      firstPage: 2,
      lastPage: 4,
    });
    expect(buildPdfRasterArgs({
      pdfPath: "/private/input/score.pdf",
      outputPrefix: "/private/output/page",
      dpi: 300,
      firstPage: 2,
      lastPage: 4,
    })).toEqual([
      "-r", "300", "-png", "-f", "2", "-l", "4",
      "/private/input/score.pdf", "/private/output/page",
    ]);
  });

  it("rejects unsafe raster paths and invalid page settings before execution", () => {
    expect(() => buildPdfRasterArgs({
      pdfPath: "/private/input/score\n.pdf",
      outputPrefix: "/private/output/page",
      dpi: 300,
      firstPage: 1,
      lastPage: null,
    })).toThrow(/single-line path/);
    expect(() => resolvePdfRasterConfig({ dpi: 72 })).toThrow(/DPI/);
    expect(() => resolvePdfRasterConfig({ firstPage: 4, lastPage: 2 })).toThrow(/page range/);
  });

  it("rasterizes pages through an injected runner and reports deterministic image metadata", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-raster-");
    try {
      const calls: Array<{ file: string; args: string[]; shell: unknown }> = [];
      const execFile: OmrCommandRunner = async (file, args, options) => {
        calls.push({ file, args: [...args], shell: options.shell });
        const prefix = args.at(-1)!;
        await writeFile(`${prefix}-1.png`, ONE_PIXEL_PNG);
        await writeFile(`${prefix}-2.png`, ONE_PIXEL_PNG);
        return { stdout: "pdftoppm version 24.08.0", stderr: "" };
      };
      const rasterizer = createPdfRasterizer({ executable: "pdftoppm", execFile });
      const first = await rasterizer.rasterize({
        pdfPath: "/private/input/score.pdf",
        outputDirectory: directory,
        firstPage: 1,
        lastPage: 2,
      });
      const second = await rasterizer.rasterize({
        pdfPath: "/private/input/score.pdf",
        outputDirectory: directory,
        firstPage: 1,
        lastPage: 2,
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ file: "pdftoppm", shell: false });
      expect(first.renderer).toMatchObject({ id: "pdftoppm", version: "24.08.0", dpi: 300, format: "png", crop: "none", rotation: 0 });
      expect(first.pages).toHaveLength(2);
      expect(first.pages.map((page) => page.page)).toEqual([1, 2]);
      expect(first.pages[0]).toMatchObject({ relativePath: "page-1.png", width: 1, height: 1, bytes: ONE_PIXEL_PNG.byteLength });
      expect(first.pages.map((page) => page.sha256)).toEqual(second.pages.map((page) => page.sha256));
      expect(first.pages.every((page) => !Object.prototype.hasOwnProperty.call(page, "path"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("hashes a PNG and exposes dimensions without exposing its absolute path", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-image-");
    try {
      const imagePath = join(directory, "page-7.png");
      await writeFile(imagePath, ONE_PIXEL_PNG);
      const metadata = await hashImageFile(imagePath, directory, 7);
      expect(metadata).toMatchObject({ page: 7, relativePath: "page-7.png", width: 1, height: 1, bytes: ONE_PIXEL_PNG.byteLength });
      expect(metadata).not.toHaveProperty("path");
      expect(metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("wraps Audiveris with lazy version probing and path-safe artifacts", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-audiveris-");
    try {
      const calls: string[][] = [];
      const execFile: OmrCommandRunner = async (_file, args, options) => {
        expect(options.shell).toBe(false);
        calls.push([...args]);
        if (args.includes("--version") || args.includes("-version")) return { stdout: "Audiveris 5.11.0", stderr: "" };
        await writeFile(join(directory, "result.mxl"), Buffer.from("synthetic-mxl"));
        return { stdout: "", stderr: "" };
      };
      const backend = createAudiverisBackend({ executable: "/opt/Audiveris", execFile });
      const result = await backend.recognize({ imagePaths: ["/private/input/page-1.png"], outputDirectory: directory });
      expect(backend.id).toBe("audiveris");
      expect(backend.version).toBe("5.11.0");
      expect(result).toMatchObject({ backend: "audiveris", version: "5.11.0", status: "pass" });
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({ relativePath: "result.mxl", format: "mxl", bytes: 13 });
      expect(result.artifacts[0]).not.toHaveProperty("path");
      expect(calls[0]).toEqual(["--version"]);
      expect(calls[1]).toContain("-batch");
      expect(calls[1]).toContain("/private/input/page-1.png");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("builds the exact HOMR 0.7.0 uvx and executable command shapes", () => {
    expect(HOMR_DEFAULTS).toMatchObject({ packageName: "homr", version: "0.7.0", uvxExecutable: "uvx", executable: "homr", preferUvx: true, forceCpu: true });
    expect(buildHomrUvxArgs({ imagePath: "/private/staged/page-1/input.png" })).toEqual([
      "--from", "homr==0.7.0", "homr", "--gpu", "no", "/private/staged/page-1/input.png",
    ]);
    expect(buildHomrExecutableArgs({ imagePath: "/private/staged/page-1/input.png" })).toEqual([
      "--gpu", "no", "/private/staged/page-1/input.png",
    ]);
    expect(buildHomrUvxArgs({ imagePath: "/private/staged/page-1/input.png", packageName: "homr-fork", version: "0.8.1", forceCpu: false })).toEqual([
      "--from", "homr-fork==0.8.1", "homr-fork", "/private/staged/page-1/input.png",
    ]);
  });

  it("resolves uvx lazily and runs one staged page with adjacent MusicXML", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-");
    try {
      const inputPath = join(directory, "source-page.png");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, ONE_PIXEL_PNG);
      const calls: Array<{ file: string; args: string[]; shell: unknown }> = [];
      const execFile: OmrCommandRunner = async (file, args, options) => {
        calls.push({ file, args: [...args], shell: options.shell });
        if (args.includes("--help")) return { stdout: "usage: homer", stderr: "" };
        if (file === "uv") return { stdout: "", stderr: "" };
        const staged = args.at(-1)!;
        await writeFile(`${staged}.musicxml`, VALID_MUSIC_XML);
        return { stdout: "", stderr: "" };
      };
      const backend = createHomrBackend({ execFile });
      expect(calls).toHaveLength(0);
      const result = await backend.recognize({ imagePaths: [inputPath], outputDirectory });
      expect(calls).toHaveLength(3); // lazy uvx probe, one page invocation, then cache discovery
      expect(calls[0]).toMatchObject({ file: "uvx", args: ["--from", "homr==0.7.0", "homr", "--help"], shell: false });
      expect(calls[1]).toMatchObject({ file: "uvx", shell: false });
      expect(calls[1]!.args).toEqual(["--from", "homr==0.7.0", "homr", "--gpu", "no", expect.stringContaining("page-1")]);
      expect(calls[2]).toMatchObject({ file: "uv", args: ["cache", "dir"], shell: false });
      expect(backend.id).toBe("homr");
      expect(backend.version).toBe("0.7.0");
      expect(result).toMatchObject({ backend: "homr", version: "0.7.0", status: "pass", health: "available" });
      expect(result.pages).toHaveLength(1);
      expect(result.pages![0]).toMatchObject({ page: 1, status: "available", exitCode: 0, measureCount: 1, noteCount: 1, staffCount: 1 });
      expect(result.pages![0]!.relativeInput).toMatch(/^page-1\//);
      expect(result.pages![0]!.artifacts).toHaveLength(1);
      expect(result.pages![0]!.artifacts[0]!.relativePath).toMatch(/^page-1\//);
      expect(result.invocation).toMatchObject({ mode: "uvx", executable: "uvx", packageName: "homr", version: "0.7.0", perPage: true, forceCpu: true });
      expect(result.model).toMatchObject({ packageName: "homr", version: "0.7.0", runtime: "uvx", forceCpu: true });
      expect(JSON.stringify(result)).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("falls back to an explicit homr executable when uvx is unavailable", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-fallback-");
    try {
      const inputPath = join(directory, "source.png");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, ONE_PIXEL_PNG);
      const calls: Array<{ file: string; args: string[]; shell: unknown }> = [];
      const execFile: OmrCommandRunner = async (file, args, options) => {
        calls.push({ file, args: [...args], shell: options.shell });
        if (file === "uvx") throw Object.assign(new Error("spawn uvx ENOENT"), { code: "ENOENT" });
        await writeFile(`${args.at(-1)!}.musicxml`, VALID_MUSIC_XML);
        return { stdout: "", stderr: "" };
      };
      const result = await createHomrBackend({ executable: "/opt/homr", execFile }).recognize({ imagePaths: [inputPath], outputDirectory });
      expect(calls.map((call) => call.file)).toEqual(["uvx", "/opt/homr"]);
      expect(calls[1]!.args).toEqual(["--gpu", "no", expect.stringContaining("page-1")]);
      expect(result.health).toBe("available");
      expect(result.invocation).toMatchObject({ mode: "executable", executable: "homr", perPage: true });
      expect(JSON.stringify(result)).not.toContain("/opt/homr");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records a sanitized uvx package-resolution fallback with executable provenance", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-resolution-fallback-");
    try {
      const inputPath = join(directory, "source.png");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, ONE_PIXEL_PNG);
      const calls: string[] = [];
      const execFile: OmrCommandRunner = async (file, args) => {
        calls.push(file);
        if (file === "uvx") {
          throw Object.assign(new Error("uvx failed"), {
            code: 1,
            stderr: `error: package homr==0.7.0 could not be resolved from ${directory}/private/cache`,
          });
        }
        await writeFile(`${args.at(-1)!}.musicxml`, VALID_MUSIC_XML);
        return { stdout: "", stderr: "" };
      };
      const result = await createHomrBackend({ executable: "/opt/homr", execFile }).recognize({ imagePaths: [inputPath], outputDirectory });

      expect(calls).toEqual(["uvx", "/opt/homr"]);
      expect(result.status).toBe("pass");
      expect(result.invocation).toMatchObject({ mode: "executable", executable: "homr" });
      expect(result.model).toMatchObject({ runtime: "executable", source: "external-executable", cache: "external" });
      expect(result.errors.join(" ")).toMatch(/uvx.*resolution|could not be resolved/i);
      expect(result.errors.join(" ")).not.toContain(directory);
      expect(result.errors.join(" ")).toContain("[redacted-path]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discovers uvx model files after a successful page and retries a cold cache", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-model-discovery-");
    try {
      const first = join(directory, "first.png");
      const second = join(directory, "second.png");
      const outputDirectory = join(directory, "output");
      const cacheDirectory = join(directory, "uv-cache");
      const modelPath = join(cacheDirectory, "archive-v0", "homr-wheel", "homr", "segmentation", "segnet_308-abc.onnx");
      await Promise.all([first, second].map((path) => writeFile(path, ONE_PIXEL_PNG)));
      const events: string[] = [];
      let cacheLookups = 0;
      const execFile: OmrCommandRunner = async (file, args) => {
        if (file === "uvx" && args.includes("--help")) {
          events.push("probe");
          return { stdout: "usage: homer", stderr: "" };
        }
        if (file === "uv") {
          cacheLookups += 1;
          events.push(`cache-${cacheLookups}`);
          return { stdout: `${cacheDirectory}\n`, stderr: "" };
        }
        events.push(`page-${args.at(-1)!.includes("page-1") ? 1 : 2}`);
        await writeFile(`${args.at(-1)!}.musicxml`, VALID_MUSIC_XML);
        if (events.includes("page-2")) {
          await mkdir(join(cacheDirectory, "archive-v0", "homr-wheel", "homr", "segmentation"), { recursive: true });
          await writeFile(modelPath, Buffer.from("synthetic-model"));
        }
        return { stdout: "", stderr: "" };
      };
      const result = await createHomrBackend({ execFile }).recognize({ imagePaths: [first, second], outputDirectory });
      const model = result.model as { files?: Array<{ name: string; bytes: number; sha256: string }> };

      expect(events).toEqual(["probe", "page-1", "cache-1", "page-2", "cache-2"]);
      expect(events.indexOf("page-1")).toBeLessThan(events.indexOf("cache-1"));
      expect(cacheLookups).toBe(2);
      expect(model.files).toEqual([{
        name: "archive-v0/homr-wheel/homr/segmentation/segnet_308-abc.onnx",
        bytes: Buffer.byteLength("synthetic-model"),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }]);
      expect(JSON.stringify(result)).not.toContain(cacheDirectory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("continues sequentially after a page failure and reports partial health", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-partial-");
    try {
      const first = join(directory, "first.png");
      const second = join(directory, "second.png");
      const third = join(directory, "third.png");
      const outputDirectory = join(directory, "output");
      await Promise.all([first, second, third].map((path) => writeFile(path, ONE_PIXEL_PNG)));
      const calls: string[] = [];
      const execFile: OmrCommandRunner = async (_file, args, options) => {
        expect(options.shell).toBe(false);
        if (args.includes("--help")) return { stdout: "usage: homer", stderr: "" };
        if (args[0] === "cache" && args[1] === "dir") return { stdout: "", stderr: "" };
        const staged = args.at(-1)!;
        calls.push(staged);
        if (staged.includes("page-1")) await writeFile(`${staged}.musicxml`, VALID_MUSIC_XML);
        else if (staged.includes("page-2")) throw Object.assign(new Error("homr failed"), { code: 2, stderr: `${outputDirectory}/page-2/input.png: no staff` });
        else await writeFile(`${staged}.musicxml`, VALID_MUSIC_XML);
        return { stdout: "", stderr: "" };
      };
      const result = await createHomrBackend({ execFile }).recognize({ imagePaths: [first, second, third], outputDirectory });
      expect(calls).toHaveLength(3);
      expect(calls.map((path) => path.match(/page-[1-3]/)?.[0])).toEqual(["page-1", "page-2", "page-3"]);
      expect(result.status).toBe("pass");
      expect(result.health).toBe("partially-available");
      expect(result.pages!.map((page) => page.status)).toEqual(["available", "failed", "available"]);
      expect(result.pages![1]!.exitCode).toBe(2);
      expect(result.pages![1]!.errors.join(" ")).not.toContain(outputDirectory);
      expect(result.pages![1]!.errors.join(" ")).toContain("[redacted-path]");
      expect(result.pages![0]!.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.pages![2]!.artifacts).toHaveLength(1);
      expect(result.artifacts).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed with broken-output health for malformed or empty MusicXML", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-broken-");
    try {
      const inputPath = join(directory, "source.png");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, ONE_PIXEL_PNG);
      const execFile: OmrCommandRunner = async (_file, args) => {
        if (args.includes("--help")) return { stdout: "usage: homer", stderr: "" };
        if (args[0] === "cache" && args[1] === "dir") return { stdout: "", stderr: "" };
        await writeFile(`${args.at(-1)!}.musicxml`, "<score-partwise>");
        return { stdout: "", stderr: "" };
      };
      const result = await createHomrBackend({ execFile }).recognize({ imagePaths: [inputPath], outputDirectory });
      expect(result.status).toBe("failed");
      expect(result.health).toBe("broken-output");
      expect(result.pages![0]).toMatchObject({ status: "broken-output", measureCount: 0, noteCount: 0, staffCount: 0 });
      expect(result.pages![0]!.errors.join(" ")).toMatch(/MusicXML|malformed|empty/i);
      expect(result.artifacts).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports unavailable when both uvx and the explicit executable are missing", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-missing-");
    try {
      const inputPath = join(directory, "source.png");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, ONE_PIXEL_PNG);
      const calls: string[] = [];
      const execFile: OmrCommandRunner = async (file) => {
        calls.push(file);
        throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
      };
      const result = await createHomrBackend({ executable: "/missing/homr", execFile }).recognize({ imagePaths: [inputPath], outputDirectory });
      expect(calls).toEqual(["uvx", "/missing/homr"]);
      expect(result.status).toBe("unavailable");
      expect(result.health).toBe("unavailable");
      expect(result.errors.join(" ")).toMatch(/homr unavailable/i);
      expect(JSON.stringify(result)).not.toContain("/missing/homr");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("probes versions from stdout/stderr and returns unknown for non-version output", async () => {
    const calls: string[][] = [];
    const version = await probeExecutableVersion("homr", async (_file, args, options) => {
      expect(options.shell).toBe(false);
      calls.push([...args]);
      return { stdout: "homr 0.3.1\n", stderr: "" };
    });
    expect(version).toBe("0.3.1");
    expect(calls).toEqual([["--version"]]);
    await expect(probeExecutableVersion("homr", async () => ({ stdout: "ready", stderr: "" }))).resolves.toBe("unknown");
  });
});
