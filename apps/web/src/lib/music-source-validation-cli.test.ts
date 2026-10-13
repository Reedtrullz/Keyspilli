import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreFixture } from "./score-review-test-fixture.js";

it("validates the actual reviewer-file pin and labels V1 as historical", async () => {
  const f = await scoreFixture();
  try {
    const receipt = await f.pin("receipt.json", { schemaVersion: 1, kind: "keyspilli-source-validation", sourceSha256: f.delivery.sha256, selected: { phraseId: "phrase", occurrenceId: "occ", role: "melody", onsetSeconds: 0 }, reviewer: { id: "SYNTHETIC-CONTROL", role: "source-reviewer", assertion: "validated" }, scope: { mode: "original", difficulty: "medium" }, timingKnown: true });
    const source = { sha256: f.delivery.sha256, authority: "human-validated", timingKnown: true, validationReceiptSha256: receipt.sha256, anchors: [{ id: "a", phraseId: "phrase", occurrenceId: "occ", role: "melody", midi: 60, onsetSeconds: 0, durationSeconds: 0.5, required: true }] };
    const sourcePin = await f.pin("source.json", source);
    const run = () => execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../scripts/validate-music-source.mts", import.meta.url)), "--source", sourcePin.path, "--receipt", receipt.path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(run())).toMatchObject({ status: "historical", repairAuthority: "none", assertionWritten: false });
    await f.pin("source.json", { ...source, validationReceiptSha256: "f".repeat(64) });
    expect(run).toThrow(/hash pin changed/);
  } finally { await f.cleanup(); }
});
