import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeVariantArtifacts, type Variant } from "@keyspilli/midi";
import { createLegacyBootstrapManifest } from "../src/artifact-manifest.js";
import { deleteBaseArtifact, publishBaseArtifact, withBaseArtifactLock, reconcileBaseArtifact } from "../src/publish.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keyspilli-publish-"));
}

async function writeManifest(stage: string, baseId = "test-song"): Promise<void> {
  for (const level of ["a", "b", "e", "m", "ve", "vb"]) {
    const dir = join(stage, level);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(join(dir, "notes.json"), "{}\n"),
      writeFile(join(dir, "variant.mid"), "midi\n"),
      writeFile(join(dir, "variant.xml"), "xml\n"),
    ]);
  }
  await writeFile(
    join(stage, "manifest.json"),
    `${JSON.stringify(createLegacyBootstrapManifest(baseId, 120, "2026-08-16T17:30:00.000Z"))}\n`,
  );
}

async function writeSemanticManifest(stage: string, baseId = "test-song", mutate?: (level: string, dir: string) => Promise<void>): Promise<void> {
  const source: Variant = {
    level: "advanced",
    difficultyScore: 1,
    notes: [
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
    ],
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  };
  for (const [level, code] of [["advanced", "a"], ["beginner", "b"], ["easy", "e"], ["medium", "m"], ["very-easy", "ve"], ["very-beginner", "vb"]] as const) {
    const dir = join(stage, code);
    await mkdir(dir, { recursive: true });
    const variant = { ...source, level } as Variant;
    const artifacts = writeVariantArtifacts(variant, "Test", "Artist");
    await Promise.all([
      writeFile(join(dir, "notes.json"), `${JSON.stringify(variant)}\n`),
      writeFile(join(dir, "variant.mid"), artifacts.midi),
      writeFile(join(dir, "variant.xml"), artifacts.xml),
    ]);
    await mutate?.(code, dir);
  }
  await writeFile(
    join(stage, "manifest.json"),
    `${JSON.stringify(createLegacyBootstrapManifest(baseId, 120, "2026-08-16T17:30:00.000Z"))}\n`,
  );
}

describe("publishBaseArtifact", () => {
  it("publishes only a complete staged tree with manifest as commit marker", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("test-song", async (stage) => {
      await writeManifest(stage);
      await writeFile(join(stage, "a.txt"), "new\n");
      return "ok";
    }, { artifactsRoot: root });
    expect(await readFile(join(root, "test-song", "a.txt"), "utf8")).toBe("new\n");
  });

  it("keeps the previous complete tree when staging fails", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("test-song", async (stage) => {
      await writeManifest(stage);
      await writeFile(join(stage, "a.txt"), "old\n");
    }, { artifactsRoot: root });
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeFile(join(stage, "a.txt"), "incomplete\n");
      throw new Error("injected writer failure");
    }, { artifactsRoot: root })).rejects.toThrow("injected writer failure");
    expect(await readFile(join(root, "test-song", "a.txt"), "utf8")).toBe("old\n");
  });

  it("checks ownership after complete staging and preserves the prior tree on rejection", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("test-song", (stage) => writeManifest(stage), { artifactsRoot: root });
    const old = await readFile(join(root, "test-song", "manifest.json"), "utf8");
    let staged = false;
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeManifest(stage);
      staged = true;
    }, { artifactsRoot: root, beforeSwap: () => {
      expect(staged).toBe(true);
      throw new Error("lease lost");
    } })).rejects.toThrow("lease lost");
    expect(await readFile(join(root, "test-song", "manifest.json"), "utf8")).toBe(old);
    expect(existsSync(join(root, ".test-song.new"))).toBe(false);
  });

  it("never steals a live lock because of age and releases it on failure", async () => {
    const root = await tempRoot();
    await expect(withBaseArtifactLock("test-song", { artifactsRoot: root }, async () => {
      await expect(withBaseArtifactLock("test-song", { artifactsRoot: root }, () => undefined))
        .rejects.toThrow("already locked");
      await withBaseArtifactLock("other-song", { artifactsRoot: root }, () => undefined);
      throw new Error("writer failed");
    })).rejects.toThrow("writer failed");
    await withBaseArtifactLock("test-song", { artifactsRoot: root }, () => undefined);
  });

  it("excludes another process and recovers automatically after its death", async () => {
    const root = await tempRoot();
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1]);
      db.exec('BEGIN EXCLUSIVE');
      process.stdout.write('locked');
      setInterval(() => {}, 1000);
    `, join(root, ".test-song.lock.sqlite")], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout!.once("data", () => resolve()); child.once("error", reject); child.once("exit", () => reject(new Error("lock holder exited early"))); });
      await expect(withBaseArtifactLock("test-song", { artifactsRoot: root }, () => undefined)).rejects.toThrow("already locked");
    } finally {
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      child.kill("SIGKILL");
      await closed;
    }
    await withBaseArtifactLock("test-song", { artifactsRoot: root }, () => undefined);
  });

  it("does not steal a legacy directory lock even when its timestamp is old", async () => {
    const root = await tempRoot();
    const lock = join(root, ".test-song.lock");
    await mkdir(lock);
    const { utimes } = await import("node:fs/promises");
    await utimes(lock, new Date(0), new Date(0));
    await expect(withBaseArtifactLock("test-song", { artifactsRoot: root }, () => undefined))
      .rejects.toThrow("legacy artifact lock");
    expect(existsSync(lock)).toBe(true);
  });

  it("journals a post-swap failure and preserves the backup until explicit reconciliation", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("test-song", async stage => {
      await writeManifest(stage); await writeFile(join(stage, "version"), "old");
    }, { artifactsRoot: root });
    await expect(publishBaseArtifact("test-song", async stage => {
      await writeManifest(stage); await writeFile(join(stage, "version"), "new");
    }, { artifactsRoot: root, afterSwap: () => { throw new Error("DB unavailable"); } }))
      .rejects.toMatchObject({ code: "ARTIFACT_RECONCILIATION_REQUIRED", baseId: "test-song" });
    expect(await readFile(join(root, ".test-song.old", "version"), "utf8")).toBe("old");
    expect(existsSync(join(root, ".test-song.reconciliation.json"))).toBe(true);
    await expect(publishBaseArtifact("test-song", stage => writeManifest(stage), { artifactsRoot: root }))
      .rejects.toMatchObject({ code: "ARTIFACT_RECONCILIATION_REQUIRED" });
    let reconciled = false;
    await reconcileBaseArtifact("test-song", { artifactsRoot: root }, () => { reconciled = true; });
    expect(reconciled).toBe(true);
    expect(existsSync(join(root, ".test-song.old"))).toBe(false);
    expect(existsSync(join(root, ".test-song.reconciliation.json"))).toBe(false);
    expect(await readFile(join(root, "test-song", "version"), "utf8")).toBe("new");
  });

  it("recovers a crash before the swap without committing database rows", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".test-song.old"));
    await writeFile(join(root, ".test-song.old", "version"), "old");
    await mkdir(join(root, ".test-song.new"));
    await writeFile(join(root, ".test-song.new", ".publication-id"), "pending");
    await writeFile(join(root, ".test-song.reconciliation.json"), JSON.stringify({ version: 1, operation: "publish", token: "pending" }));
    await reconcileBaseArtifact("test-song", { artifactsRoot: root }, () => { throw new Error("must not commit"); });
    expect(await readFile(join(root, "test-song", "version"), "utf8")).toBe("old");
    expect(existsSync(join(root, ".test-song.reconciliation.json"))).toBe(false);
  });

  it("requires the staged manifest before swapping", async () => {
    const root = await tempRoot();
    await expect(publishBaseArtifact("test-song", async () => undefined, { artifactsRoot: root }))
      .rejects.toThrow("missing manifest.json");
  });

  it("rejects a staged manifest when any required level file is missing", async () => {
    const root = await tempRoot();
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeManifest(stage);
      await import("node:fs/promises").then(({ rm }) => rm(join(stage, "ve", "variant.xml")));
    }, { artifactsRoot: root })).rejects.toThrow("missing ve/variant.xml");
  });

  it("keeps isolated placeholder fixtures permissive unless semantic validation is requested", async () => {
    const root = await tempRoot();
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeManifest(stage);
    }, { artifactsRoot: root })).resolves.toBeUndefined();
  });

  it("rejects a valid manifest with malformed semantic artifacts in strict mode", async () => {
    const root = await tempRoot();
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeSemanticManifest(stage, "test-song", async (level, dir) => {
        if (level === "a") await writeFile(join(dir, "variant.mid"), "not-midi\n");
      });
    }, { artifactsRoot: root, semanticValidation: "strict" })).rejects.toThrow(/semantic validation failed.*a: midi roundtrip parse failed/);
    expect(existsSync(join(root, "test-song"))).toBe(false);
  });

  it("accepts a complete generated semantic artifact set in strict mode", async () => {
    const root = await tempRoot();
    await expect(publishBaseArtifact("test-song", async (stage) => {
      await writeSemanticManifest(stage);
    }, { artifactsRoot: root, semanticValidation: "strict" })).resolves.toBeUndefined();
    expect(existsSync(join(root, "test-song", "manifest.json"))).toBe(true);
  });

  it("deletes the canonical tree and abandoned publish roots under the shared lock", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("delete-song", async (stage) => {
      await writeManifest(stage, "delete-song");
      await writeFile(join(stage, "a.txt"), "old\n");
    }, { artifactsRoot: root });
    await mkdir(join(root, ".delete-song.new"));
    await mkdir(join(root, ".delete-song.old"));

    let callbackSawFilesystemCommit = false;
    await expect(deleteBaseArtifact("delete-song", {
      artifactsRoot: root,
      afterFilesystemDelete: () => {
        callbackSawFilesystemCommit = !existsSync(join(root, "delete-song"));
      },
    })).resolves.toEqual({ baseId: "delete-song", existed: true });

    expect(callbackSawFilesystemCommit).toBe(true);
    expect(existsSync(join(root, "delete-song"))).toBe(false);
    expect(existsSync(join(root, ".delete-song.new"))).toBe(false);
    expect(existsSync(join(root, ".delete-song.old"))).toBe(false);
  });

  it("does not hide a DB/read-model failure after deleting the filesystem tree", async () => {
    const root = await tempRoot();
    await publishBaseArtifact("delete-failure", async (stage) => {
      await writeManifest(stage, "delete-failure");
    }, { artifactsRoot: root });

    await expect(deleteBaseArtifact("delete-failure", {
      artifactsRoot: root,
      afterFilesystemDelete: () => {
        throw new Error("injected reconciliation failure");
      },
    })).rejects.toThrow("injected reconciliation failure");
    expect(existsSync(join(root, "delete-failure"))).toBe(false);
  });

  it("coordinates deletion with an in-flight publication for the same base", async () => {
    const root = await tempRoot();
    let release!: () => void;
    let announceStarted!: () => void;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const publishing = publishBaseArtifact("lock-delete", async (stage) => {
      await writeManifest(stage, "lock-delete");
      announceStarted();
      await held;
    }, { artifactsRoot: root });
    await started;
    await expect(deleteBaseArtifact("lock-delete", { artifactsRoot: root })).rejects.toThrow("already locked");
    release();
    await publishing;
  });
});
