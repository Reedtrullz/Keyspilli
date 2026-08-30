import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPdfRasterArgs,
  createAudiverisBackend,
  createHomrBackend,
  createPdfRasterizer,
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

  it("fails closed for an unavailable optional homr executable without startup probing", async () => {
    const directory = await temporaryDirectory("keyspilli-omr-homr-");
    try {
      let calls = 0;
      const execFile: OmrCommandRunner = async () => {
        calls += 1;
        throw Object.assign(new Error("spawn homr ENOENT"), { code: "ENOENT" });
      };
      const backend = createHomrBackend({ executable: "/missing/homr", execFile });
      expect(calls).toBe(0);
      const result = await backend.recognize({ imagePaths: ["/private/input/page-1.png"], outputDirectory: directory });
      expect(calls).toBe(2); // lazy version probe, then the recognition attempt
      expect(backend.id).toBe("homr");
      expect(result.status).toBe("unavailable");
      expect(result.errors.join(" ")).toMatch(/homr unavailable/i);
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
