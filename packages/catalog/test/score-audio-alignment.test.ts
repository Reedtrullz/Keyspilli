import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapScoreBeatToAudioSeconds,
  runScoreAudioAlignment,
  SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID,
  type ScoreAudioAlignmentReport,
} from "../src/score-audio-alignment.js";

function report(): ScoreAudioAlignmentReport {
  return {
    schemaVersion: 1,
    candidate: { id: SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID, fingerprint: "f".repeat(64), config: {} },
    score: { sha256: "s".repeat(64), bytes: 4, format: 1, division: 480, trackCount: 1, noteCount: 2, durationBeats: 2, durationSeconds: 1 },
    audio: { sha256: "a".repeat(64), bytes: 4, sampleRate: 22050, frameCount: 3, durationSeconds: 1.2 },
    mapping: { method: "test", anchors: [{ beat: 0, audioSeconds: 0.1 }, { beat: 2, audioSeconds: 1.1 }], segmentCount: 1, rawPathFrames: 3, rawScoreFrames: 3, compactApproximationErrorSeconds: 0, dtwCost: 0.1 },
    confidence: { state: "ALIGNED_HIGH_CONFIDENCE", score: 0.9, coverage: 1, signals: [] },
    determinismSha256: "d".repeat(64),
  };
}

describe("score-to-recording alignment runner", () => {
  it("invokes the frozen candidate without a shell and parses its path-safe report", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-audio-"));
    const score = join(root, "score.mid");
    const audio = join(root, "audio.wav");
    await writeFile(score, "MThd");
    await writeFile(audio, "RIFF");
    const calls: { file: string; args: readonly string[]; shell: boolean }[] = [];
    const result = await runScoreAudioAlignment(score, audio, { python: "/opt/python", script: "/opt/calibrate.py", timeoutMs: 1234 }, {
      execFile: async (file, args, options) => {
        calls.push({ file, args, shell: options.shell });
        return { stdout: JSON.stringify(report()), stderr: "" };
      },
    });
    expect(result.status).toBe("aligned");
    expect(result.report?.candidate.id).toBe(SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID);
    expect(calls).toEqual([{ file: "/opt/python", args: ["/opt/calibrate.py", "--production", "--midi", score, "--audio", audio], shell: false }]);
  });

  it("fails closed for remote paths and malformed runner output", async () => {
    const remote = await runScoreAudioAlignment("https://example.invalid/score.mid", "/tmp/audio.wav", { python: "python", script: "align.py" });
    expect(remote).toMatchObject({ status: "failed", report: null });
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-audio-"));
    const score = join(root, "score.mid");
    const audio = join(root, "audio.wav");
    await writeFile(score, "MThd");
    await writeFile(audio, "RIFF");
    const malformed = await runScoreAudioAlignment(score, audio, { python: "python", script: "align.py" }, {
      execFile: async () => ({ stdout: "<html>not-json</html>", stderr: "" }),
    });
    expect(malformed).toMatchObject({ status: "failed", report: null });
  });

  it("maps beats monotonically from compact anchors", () => {
    const value = report();
    expect(mapScoreBeatToAudioSeconds(value, -1)).toBe(0.1);
    expect(mapScoreBeatToAudioSeconds(value, 1)).toBeCloseTo(0.6);
    expect(mapScoreBeatToAudioSeconds(value, 3)).toBe(1.1);
    expect(mapScoreBeatToAudioSeconds(value, Number.NaN)).toBeNull();
  });
});
