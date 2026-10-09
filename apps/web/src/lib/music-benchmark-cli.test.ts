import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  unlink,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { sampleReceipt } from "../../../../packages/catalog/test/music-fixtures.js";
it("recovers a pinned terminal receipt without rerunning inference and rejects changed identities/media", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-cli-"));
  try {
    for (const dir of [
      "media",
      "capture-receipts",
      "evaluator-only",
      "receipts",
    ])
      await mkdir(join(root, dir));
    const id = "x" + "a".repeat(14),
      r = sampleReceipt(),
      bytes = Buffer.alloc(44 + 128000);
    bytes.write("RIFF");bytes.writeUInt32LE(bytes.length-8,4);bytes.write("WAVEfmt ",8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(32000,24);bytes.writeUInt32LE(64000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write("data",36);bytes.writeUInt32LE(bytes.length-44,40);
  r.audio.sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(root, "media", id + ".wav"), bytes);
    await writeFile(
      join(root, "capture-receipts", id + ".json"),
      JSON.stringify({
        audio: r.audio,
        capture: {
          recorderClock: "audio-worklet-frame",
          sourceClockOffsetsSeconds: { voice: 0 },
        },
      }),
    );
    await writeFile(
      join(root, "evaluator-only/evaluator-key.json"),
      JSON.stringify({
        cases: [
          {
            id,
            category: "clean",
            critical: true,
            played: [{ id: "target", midi: 60, onsetSeconds: 0.2, hand: "R" }],
          },
        ],
      }),
    );
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        cases: [
          {
            id,
            split: "heldout",
            mediaPath: "media/" + id + ".wav",
            input: "player",
          },
        ],
      }),
    );
    await writeFile(join(root, "identity.json"), JSON.stringify(r.analyzer));
    await writeFile(
      join(root, "receipts", id + ".receipt.json"),
      JSON.stringify(r),
    );
    const script = resolve("scripts/benchmark-music-review.mts");
    const base = [
      "--import",
      "tsx",
      script,
      "--manifest",
      join(root, "manifest.json"),
      "--candidate",
      "basic-pitch",
      "--split",
      "heldout",
      "--identity",
      join(root, "identity.json"),
      "--output",
      join(root, "out"),
    ];
    const run = promisify(execFile);
    await run(process.execPath, [
      ...base,
      "--receipt-dir",
      join(root, "receipts"),
    ]);
    const receipt = await readFile(
      join(root, "out", id + ".receipt.json"),
      "utf8",
    );
    await unlink(join(root, "out", id + ".grade.json"));
    await run(process.execPath, [...base, "--resume"]);
    expect(
      await readFile(join(root, "out", id + ".receipt.json"), "utf8"),
    ).toBe(receipt);
    expect(
      JSON.parse(await readFile(join(root, "out", id + ".grade.json"), "utf8"))
        .onset50.counts.tp,
    ).toBe(1);
    await writeFile(
      join(root, "identity.json"),
      JSON.stringify({ ...r.analyzer, version: "changed" }),
    );
    await expect(run(process.execPath, [...base, "--resume"])).rejects.toThrow(
      "changed experiment",
    );
    await writeFile(join(root, "identity.json"), JSON.stringify(r.analyzer));
    bytes[0] = 1;
    await writeFile(join(root, "media", id + ".wav"), bytes);
    await expect(run(process.execPath, [...base, "--resume"])).rejects.toThrow(
      "changed experiment",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
