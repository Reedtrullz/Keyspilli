import { it, expect } from "vitest";
import { runAcousticAnalyzer } from "../src/acoustic-analyzer.js";
import { sampleReceipt } from "../../../packages/catalog/test/music-fixtures.js";
it("disabled execution is unavailable without invoking a process", async () => {
  const r = sampleReceipt();
  let calls = 0;
  const out = await runAcousticAnalyzer(
    {
      audioPin: { ...r.audio, path: "/missing.wav" },
      analyzerIdentity: r.analyzer,
      model: "basic-pitch",
      timeoutSeconds: 120,
    },
    {
      enabled: false,
      python: "/python",
      workDir: "/unused",
      run: async () => {
        calls++;
        return r;
      },
    },
  );
  expect(out.status).toBe("unavailable");
  expect(calls).toBe(0);
});
it("changed input fails before a process", async () => {
  const r = sampleReceipt();
  let calls = 0;
  const out = await runAcousticAnalyzer(
    {
      audioPin: { ...r.audio, path: "/missing.wav" },
      analyzerIdentity: r.analyzer,
      model: "basic-pitch",
      timeoutSeconds: 120,
    },
    {
      enabled: true,
      python: "/python",
      workDir: "/unused",
      run: async () => {
        calls++;
        return r;
      },
    },
  );
  expect(out.status).toBe("failed");
  expect(calls).toBe(0);
});

import { mkdtemp, writeFile, rm, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AnalyzerRequest } from "../src/acoustic-analyzer.js";
async function withInput(
  test: (request: AnalyzerRequest, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-analyzer-test-"));
  try {
    const bytes = Buffer.alloc(44 + 64000 * 2);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(32000, 24);
    bytes.writeUInt32LE(64000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    const path = join(root, "clip.wav");
    await writeFile(path, bytes);
    const r = sampleReceipt();
    await test(
      {
        audioPin: {
          ...r.audio,
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        analyzerIdentity: r.analyzer,
        model: "basic-pitch",
        timeoutSeconds: 120,
      },
      root,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it.each(["timeout", "killed", "malformed", "stale-output"])(
  "one invocation retains failure: %s",
  async (mode) =>
    withInput(async (request, root) => {
      let calls = 0;
      const out = await runAcousticAnalyzer(request, {
        enabled: true,
        python: "/python",
        workDir: root,
        run: async () => {
          calls++;
          if (mode === "timeout") throw new Error("deadline");
          if (mode === "killed") throw new Error("SIGKILL");
          if (mode === "malformed") return {};
          return sampleReceipt();
        },
      });
      expect(calls).toBe(1);
      expect(out.status).toBe("failed");
      expect(out.notes).toEqual([]);
    }),
);
it("successful injected receipt is separately contract tested", async () =>
  withInput(async (request, root) => {
    const fixture = sampleReceipt();
    fixture.audio = { ...request.audioPin };
    const out = await runAcousticAnalyzer(request, {
      enabled: true,
      python: "/python",
      workDir: root,
      run: async () => fixture,
    });
    expect(out.status).toBe("ok");
    expect(out.limitations.join()).toContain("Synthetic fixture");
  }));

it("cancellation kills the one real owned child and returns a terminal failure", async () =>
  withInput(async (request, root) => {
    const pidPath = join(root, "owned-child.pid");
    const helper = join(root, "sleeping-python");
    await writeFile(
      helper,
      "#!" +
        process.execPath +
        "\nrequire('node:fs').writeFileSync(" +
        JSON.stringify(pidPath) +
        ",String(process.pid));setTimeout(()=>{},300000);\n",
    );
    await chmod(helper, 0o700);
    const controller = new AbortController();
    const job = runAcousticAnalyzer(request, {
      enabled: true,
      python: helper,
      workDir: root,
      signal: controller.signal,
    });
    let pid: number | undefined;
    for (let i = 0; i < 100; i++) {
      try {
        pid = Number(await readFile(pidPath, "utf8"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    controller.abort();
    const out = await job;
    expect(pid).toBeGreaterThan(0);
    expect(out.status).toBe("failed");
    expect(out.notes).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(() => process.kill(pid!, 0)).toThrow();
  }));
