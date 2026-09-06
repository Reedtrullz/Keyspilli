import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOMR_PREPROCESSING_LADDER,
  createHomrBackend,
  type HomrPageAttempt,
  type OmrCommandRunner,
} from "../src/omr-backends.js";

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
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

async function fixtureDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function runnerWithPageBehavior(
  outputDirectory: string,
  behavior: (variant: string, path: string) => Promise<void>,
): { runner: OmrCommandRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: async (_file, args, options) => {
      expect(options.shell).toBe(false);
      if (args.includes("--help")) return { stdout: "usage: homr", stderr: "" };
      if (args[0] === "cache" && args[1] === "dir") return { stdout: "", stderr: "" };
      const image = args.at(-1)!;
      const variant = image.split("/").at(-2) ?? "unknown";
      calls.push(variant);
      await behavior(variant, image);
      return { stdout: "", stderr: "" };
    },
  };
}

describe("generic HOMR page recovery", () => {
  it("exposes a fixed deterministic preprocessing ladder", () => {
    expect(HOMR_PREPROCESSING_LADDER).toEqual([
      { variant: "original", recipe: "identity" },
      { variant: "grayscale", recipe: "grayscale(luma=0.299,0.587,0.114)" },
      { variant: "grayscale-contrast", recipe: "grayscale+contrast(min-max)" },
      { variant: "grayscale-binarize", recipe: "grayscale+threshold(128)" },
      { variant: "grayscale-binarize-trim", recipe: "grayscale+threshold(128)+whitespace-trim(conservative)" },
    ]);
  });

  it("does not preprocess a successful baseline page", async () => {
    const root = await fixtureDirectory("keyspilli-homr-recovery-baseline-");
    try {
      const source = join(root, "page.png");
      const output = join(root, "output");
      await writeFile(source, ONE_PIXEL_PNG);
      const { runner, calls } = runnerWithPageBehavior(output, async (_variant, image) => {
        await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
      });
      const result = await createHomrBackend({ preferUvx: false, executable: "/opt/homr", execFile: runner }).recognize({ imagePaths: [source], outputDirectory: output });
      const page = result.pages![0]!;
      expect(calls).toEqual(["original"]);
      expect(page.status).toBe("available");
      expect(page.attempts).toHaveLength(1);
      expect(page.attempts![0]).toMatchObject({ attempt: 1, variant: "original", status: "available" });
      expect(page.attempts![0]!.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(page.attempts![0]!.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(page.recovery).toMatchObject({ attempted: false, recovered: false, selectedAttempt: 1, attempts: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps failed side effects untrusted and recovers with the next deterministic variant", async () => {
    const root = await fixtureDirectory("keyspilli-homr-recovery-side-effect-");
    try {
      const source = join(root, "page.png");
      const output = join(root, "output");
      await writeFile(source, ONE_PIXEL_PNG);
      const { runner, calls } = runnerWithPageBehavior(output, async (variant, image) => {
        if (variant === "original") {
          await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
          throw Object.assign(new Error("abort"), { code: 134, signal: "SIGABRT", stderr: "abort" });
        }
        if (variant === "grayscale") await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
      });
      const result = await createHomrBackend({ preferUvx: false, executable: "/opt/homr", execFile: runner }).recognize({ imagePaths: [source], outputDirectory: output });
      const page = result.pages![0]!;
      expect(calls).toEqual(["original", "grayscale"]);
      expect(page.status).toBe("available");
      expect(page.recovery).toMatchObject({ attempted: true, recovered: true, selectedAttempt: 2, attempts: 2 });
      expect(page.attempts).toHaveLength(2);
      expect(page.attempts![0]).toMatchObject({ variant: "original", status: "failed", failureClass: "signal", trusted: false });
      expect(page.attempts![1]).toMatchObject({ variant: "grayscale", status: "available", trusted: true });
      expect(page.attempts![0]!.artifacts[0]!.relativePath).toContain("attempt-1/original");
      expect(page.attempts![1]!.artifacts[0]!.relativePath).toContain("attempt-2/grayscale");
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains malformed attempts and stops at the first valid variant", async () => {
    const root = await fixtureDirectory("keyspilli-homr-recovery-malformed-");
    try {
      const source = join(root, "page.png");
      const output = join(root, "output");
      await writeFile(source, ONE_PIXEL_PNG);
      const { runner, calls } = runnerWithPageBehavior(output, async (variant, image) => {
        if (variant === "grayscale") await writeFile(`${image}.musicxml`, "not xml");
        if (variant === "grayscale-contrast") await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
      });
      const result = await createHomrBackend({ preferUvx: false, executable: "/opt/homr", execFile: runner }).recognize({ imagePaths: [source], outputDirectory: output });
      const page = result.pages![0]!;
      expect(calls).toEqual(["original", "grayscale", "grayscale-contrast"]);
      expect(page.status).toBe("available");
      expect(page.attempts!.map((attempt: HomrPageAttempt) => attempt.variant)).toEqual(["original", "grayscale", "grayscale-contrast"]);
      expect(page.attempts![0]).toMatchObject({ status: "broken-output", failureClass: "no-output" });
      expect(page.attempts![1]).toMatchObject({ status: "broken-output", failureClass: "broken-output", trusted: false });
      expect(page.attempts![2]).toMatchObject({ status: "available", trusted: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not retry missing executable resolution, while timeout is retryable", async () => {
    const root = await fixtureDirectory("keyspilli-homr-recovery-resolution-");
    try {
      const source = join(root, "page.png");
      await writeFile(source, ONE_PIXEL_PNG);
      const missingCalls: string[] = [];
      const missing: OmrCommandRunner = async (_file, args) => {
        missingCalls.push(args.at(-1) ?? "probe");
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      };
      const unavailable = await createHomrBackend({ preferUvx: false, executable: "/missing/homr", execFile: missing }).recognize({ imagePaths: [source], outputDirectory: join(root, "missing") });
      expect(missingCalls).toHaveLength(1);
      expect(unavailable.pages![0]!.attempts).toHaveLength(1);
      expect(unavailable.pages![0]!.attempts![0]).toMatchObject({ failureClass: "unavailable", trusted: false });

      let attempts = 0;
      const { runner, calls } = runnerWithPageBehavior(join(root, "timeout"), async (variant, image) => {
        attempts += 1;
        if (variant === "original") throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true, signal: "SIGTERM" });
        await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
      });
      const recovered = await createHomrBackend({ preferUvx: false, executable: "/opt/homr", execFile: runner }).recognize({ imagePaths: [source], outputDirectory: join(root, "timeout") });
      expect(attempts).toBe(2);
      expect(calls).toEqual(["original", "grayscale"]);
      expect(recovered.pages![0]!.attempts![0]).toMatchObject({ failureClass: "timeout", trusted: false });
      expect(recovered.pages![0]!.status).toBe("available");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clears stale XML in a reused attempt directory before parsing a retry", async () => {
    const root = await fixtureDirectory("keyspilli-homr-recovery-stale-");
    try {
      const source = join(root, "page.png");
      const output = join(root, "output");
      await writeFile(source, ONE_PIXEL_PNG);
      let invocation = 0;
      const runner: OmrCommandRunner = async (_file, args, options) => {
        expect(options.shell).toBe(false);
        const image = args.at(-1)!;
        if (args.includes("--help")) return { stdout: "usage: homr", stderr: "" };
        invocation += 1;
        if (invocation === 1) await writeFile(`${image}.musicxml`, VALID_MUSIC_XML);
        return { stdout: "", stderr: "" };
      };
      const backend = createHomrBackend({ preferUvx: false, executable: "/opt/homr", execFile: runner });
      const first = await backend.recognize({ imagePaths: [source], outputDirectory: output });
      expect(first.pages![0]!.status).toBe("available");
      const second = await backend.recognize({ imagePaths: [source], outputDirectory: output });
      expect(second.pages![0]!.status).toBe("broken-output");
      expect(second.pages![0]!.failureClass).toBe("no-output");
      expect(second.pages![0]!.attempts![0]!.artifacts).toEqual([]);
      expect(second.pages![0]!.recovery?.selectedAttempt).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
