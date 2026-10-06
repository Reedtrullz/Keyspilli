import { parsePlayerInputEvidence,parsePairedPlayerCapture,type PlayerInputEvidenceReceiptV1,type PairedPlayerCaptureV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
/** Offline assembly: no inference, upload, catalog mutation or musical attestation. */
import { createHash } from "node:crypto";
import { open, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  assertMusic,
  finiteSeconds,
  identityHash,
  isHash,
  parseAcousticReceipt,
  type AcousticReceipt,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
import type { EventComparison } from "./music-event-comparison.js";
import type { MusicalComparison } from "./music-correspondence.js";
import type { LocalAudioEvidenceReport } from "./local-audio-evidence.js";
export type MusicAudioPin = AcousticReceipt["audio"] & { path: string };
export interface RendererReceipt {
  schemaVersion: 1;
  kind: "keyspilli-renderer-verification";
  status: "ok" | "failed" | "unavailable";
  audioSha256: string;
  templateBankSha256: string;
  origin: "renderer-informed";
  unexpectedPitches: number[];
  missingExpectedPitches: number[];
  matchedPitches: number[];
  limitations: string[];
}
export interface MusicReviewInput {
  clips: Array<{
    id: string;
    audio: MusicAudioPin;
    eventsSha256: string | null;
    replaySha256?: string | null;
    analyzerSha256: string | null;
    acoustic?: AcousticReceipt;
    playerInput?: PlayerInputEvidenceReceiptV1;
    pairedCapture?: PairedPlayerCaptureV1;
    pairedCaptureSha256?: string;
    renderer?: RendererReceipt;
    playback?: EventComparison;
    correspondence?: MusicalComparison;
  }>;
  legacy?: LocalAudioEvidenceReport;
}
export interface MusicReviewFinding {
  id: string;
  clipId: string;
  startSeconds: number;
  endSeconds: number;
  description: string;
  origin:
    | "independent-acoustic-estimate"
    | "renderer-informed"
    | "authored-source"
    | "player-input-history";
  uncertainty: string;
  repairDisposition: "inspect" | "source-validation" | "software-reproducer";
}
export interface MusicReviewReport {
  schemaVersion: 1;
  kind: "keyspilli-music-review";
  inputSha256: string;
  providerCalls: 0;
  musicalAcceptance: "not-established";
  clips: Array<
    MusicReviewInput["clips"][number] & {
      channels: {
        acoustic: string;
        playerInput: string;
        renderer: string;
        playback: string;
        source: string;
      };
      findings: MusicReviewFinding[];
    }
  >;
  coverage: {
    clips: number;
    acousticAvailable: number;
    sourceCorrespondenceAvailable: number;
    humanReview: "pending";
  };
  limitations: string[];
}
const safeId = (v: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);
export function buildMusicReview(input: MusicReviewInput): MusicReviewReport {
  assertMusic(
    Array.isArray(input.clips) && input.clips.length <= 128,
    "invalid music clip inventory",
  );
  const ids = new Set<string>();
  const clips = input.clips.map((c) => {
    assertMusic(
      typeof c.id === "string" && safeId(c.id) && !ids.has(c.id),
      "duplicate or unsafe clip ID",
    );
    ids.add(c.id);
    assertMusic(
      isAbsolute(c.audio.path) &&
        isHash(c.audio.sha256) &&
        finiteSeconds(c.audio.durationSeconds) &&
        c.audio.durationSeconds > 0 &&
        c.audio.durationSeconds <= 30,
      "invalid clip pin",
    );
    const findings: MusicReviewFinding[] = [];
    const add = (
      start: number,
      end: number,
      description: string,
      origin: MusicReviewFinding["origin"],
      repairDisposition: MusicReviewFinding["repairDisposition"],
    ) => {
      assertMusic(
        finiteSeconds(start) &&
          finiteSeconds(end) &&
          start <= end &&
          start <= c.audio.durationSeconds,
        "finding outside clip",
      );
      findings.push({
        id: c.id + "-f" + findings.length,
        clipId: c.id,
        startSeconds: start,
        endSeconds: Math.min(end, c.audio.durationSeconds),
        description,
        origin,
        uncertainty:
          origin === "authored-source"
            ? "Trusted anchors apply only to their declared scope"
            : "Diagnostic estimate; requires controlled qualification and listening",
        repairDisposition,
      });
    };
    if(c.playerInput){const r=parsePlayerInputEvidence(c.playerInput);assertMusic(c.pairedCapture,'paired capture required');const paired=parsePairedPlayerCapture(c.pairedCapture);assertMusic(paired.output.sha256===c.audio.sha256 && paired.output.frames===c.audio.frames && paired.output.sampleRate===c.audio.sampleRate,'stale paired output');assertMusic(r.inputSha256===paired.input.sha256 && r.captureSha256===c.pairedCaptureSha256,'stale paired input receipt');if(r.status==='matched')add(0,1.2,`Input-side history candidates: ${r.historyPitchCandidates!.join(', ')}; completeness, current keys and audible perception unknown`,'player-input-history','inspect');}
    if (c.acoustic) {
      const r = parseAcousticReceipt(c.acoustic);
      assertMusic(
        r.audio.sha256 === c.audio.sha256 &&
          r.audio.frames === c.audio.frames &&
          r.audio.sampleRate === c.audio.sampleRate &&
          r.audio.channels === c.audio.channels &&
          r.audio.durationSeconds === c.audio.durationSeconds,
        "stale acoustic/audio receipt",
      );
      assertMusic(
        isHash(c.analyzerSha256) &&
          identityHash(r.analyzer) === c.analyzerSha256,
        "stale analyzer identity",
      );
    }
    if (c.renderer) {
      const r = c.renderer;
      assertMusic(
        r.schemaVersion === 1 &&
          r.kind === "keyspilli-renderer-verification" &&
          r.origin === "renderer-informed" &&
          r.audioSha256 === c.audio.sha256 &&
          isHash(r.templateBankSha256) &&
          ["ok", "unavailable", "failed"].includes(r.status),
        "stale or invalid renderer receipt",
      );
      assertMusic(
        [r.unexpectedPitches, r.missingExpectedPitches, r.matchedPitches].every(
          (list) =>
            Array.isArray(list) &&
            list.every((n) => Number.isInteger(n) && n >= 0 && n <= 127),
        ),
        "invalid renderer pitches",
      );
      if (r.status === "ok")
        for (const pitch of r.unexpectedPitches)
          add(
            0,
            c.audio.durationSeconds,
            "Renderer suggests unexpected MIDI pitch " + pitch,
            "renderer-informed",
            "inspect",
          );
    }
    if (c.playback) {
      assertMusic(
        c.playback.audioSha256 === c.audio.sha256 &&
          c.eventsSha256 === c.playback.eventsSha256,
        "stale playback event receipt",
      );
      for (const f of c.playback.findings)
        add(
          f.startSeconds,
          f.endSeconds,
          `${f.kind}: expected ${f.expectedId ?? "none"}, observed ${f.observedId ?? "none"}, residual ${f.residualSeconds ?? "unknown"} seconds`,
          f.origin,
          "software-reproducer",
        );
    }
    if (c.correspondence) {
      assertMusic(
        c.replaySha256 === c.correspondence.replaySha256,
        "stale source correspondence",
      );
      for (const l of c.correspondence.landmarks)
        if (l.status === "violated" || l.status === "unknown")
          add(
            l.startSeconds,
            l.endSeconds,
            l.reason,
            "authored-source",
            l.status === "unknown" ? "source-validation" : "inspect",
          );
    }
    if (input.legacy) {
      const legacy = input.legacy.clips.find((l) => l.id === c.id);
      assertMusic(
        legacy?.media.sha256 === c.audio.sha256,
        "stale legacy manifest",
      );
    }
    return {
      ...c,
      channels: {
        acoustic: c.acoustic?.status ?? "not-provided",
        playerInput:c.playerInput?.status ?? "not-provided",
        renderer: c.renderer?.status ?? "not-provided",
        playback: c.playback?.status ?? "not-provided",
        source: c.correspondence?.status ?? "not-provided",
      },
      findings,
    };
  });
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      kind: "keyspilli-music-review",
      inputSha256: identityHash(input),
      providerCalls: 0,
      musicalAcceptance: "not-established",
      clips,
      coverage: {
        clips: clips.length,
        acousticAvailable: clips.filter((c) => c.channels.acoustic === "ok")
          .length,
        sourceCorrespondenceAvailable: clips.filter(
          (c) => c.channels.source === "available",
        ).length,
        humanReview: "pending",
      },
      limitations: [
        "Input history fits are unqualified diagnostics; a matched fit can include incorrect octave candidates and does not establish pitch presence",
        "Independent acoustic estimates, renderer context and source claims are separate channels",
        "No inference or provider requests are performed by report assembly",
        "Model/renderer agreement is not source fidelity, musical quality or keyboard acceptance",
        "Real-source anchors, second-bank coverage and human judgments remain separate gates",
      ],
    }),
  ) as MusicReviewReport;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Re-read each bounded WAV before publishing a new local pack. */
export async function readMusicAudio(pin: MusicAudioPin): Promise<Buffer> {
  assertMusic(
    isAbsolute(pin.path) && isHash(pin.sha256),
    "absolute pinned media required",
  );
  const handle = await open(pin.path, "r");
  try {
    const before = await handle.stat({ bigint: true });
    assertMusic(
      before.isFile() &&
        before.size >= 44n &&
        before.size <= 2n * 1024n * 1024n,
      "bounded regular PCM WAV required",
    );
    const raw = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < raw.length) {
      const r = await handle.read(raw, length, raw.length - length, length);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    assertMusic(
      before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs &&
        length === Number(before.size),
      "media changed during read",
    );
    const bytes = raw.subarray(0, length);
    assertMusic(
      createHash("sha256").update(bytes).digest("hex") === pin.sha256,
      "stale audio bytes",
    );
    // The worker/browser produce this classic canonical PCM16 format; other containers need an explicit derivative.
    assertMusic(
      bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.readUInt32LE(4) === bytes.length - 8 &&
        bytes.toString("ascii", 8, 16) === "WAVEfmt " &&
        bytes.readUInt32LE(16) === 16 &&
        bytes.readUInt16LE(20) === 1 &&
        bytes.readUInt16LE(34) === 16 &&
        bytes.toString("ascii", 36, 40) === "data",
      "unsupported WAV; prepare explicit PCM16 derivative",
    );
    assertMusic(
      bytes.readUInt16LE(22) === pin.channels &&
        [1, 2].includes(pin.channels) &&
        bytes.readUInt32LE(24) === pin.sampleRate &&
        bytes.readUInt16LE(32) === pin.channels * 2 &&
        bytes.readUInt32LE(28) === pin.sampleRate * pin.channels * 2 &&
        bytes.readUInt32LE(40) === bytes.length - 44 &&
        (bytes.length - 44) / (2 * pin.channels) === pin.frames &&
        Math.abs(pin.frames / pin.sampleRate - pin.durationSeconds) < 1e-8,
      "stale WAV clock or encoding pin",
    );
    return bytes;
  } finally {
    await handle.close();
  }
}
function waveform(bytes: Buffer, channels: number): string {
  const frames = (bytes.length - 44) / (channels * 2),
    width = 100;
  const peaks = Array.from({ length: width }, (_, i) => {
    let peak = 0;
    for (
      let n = Math.floor((i * frames) / width);
      n < Math.floor(((i + 1) * frames) / width);
      n++
    )
      for (let c = 0; c < channels; c++)
        peak = Math.max(
          peak,
          Math.abs(bytes.readInt16LE(44 + (n * channels + c) * 2)) / 32768,
        );
    return peak;
  });
  return (
    '<svg viewBox="0 0 100 40" role="img" aria-label="PCM amplitude waveform">' +
    peaks
      .map(
        (p, i) => `<path d="M${i},${20 - p * 18}v${p * 36}" stroke="#5167a0"/>`,
      )
      .join("") +
    "</svg>"
  );
}
export async function writeMusicReviewPack(
  report: MusicReviewReport,
  output: string,
): Promise<void> {
  assertMusic(
    report.schemaVersion === 1 &&
      report.kind === "keyspilli-music-review" &&
      report.providerCalls === 0 &&
      report.musicalAcceptance === "not-established",
    "invalid review report",
  );
  // Validate all pins and IDs before reserving the output; all subsequent writes are exclusive.
  const validated = buildMusicReview({ clips: report.clips });
  const media = await Promise.all(
    validated.clips.map(async (c) => ({
      c,
      bytes: await readMusicAudio(c.audio),
    })),
  );
  await mkdir(output, { recursive: false });
  await mkdir(join(output, "media"));
  let body =
    "<h1>Music review</h1><p>Unqualified local diagnostic evidence. A matched input fit can include incorrect octave candidates and does not establish pitch presence. Human listening, source validation and keyboard judgments are pending.</p>";
  for (const { c, bytes } of media) {
    const asset = c.id + ".wav";
    if(c.playerInput)body+=`<p>Unqualified input candidates (first 1.2 s only): ${escape(JSON.stringify(c.playerInput.historyPitchCandidates))}; input SHA256 ${escape(c.playerInput.inputSha256)}; bank SHA256 ${escape(c.playerInput.referenceBankSha256)}</p>`;
    await writeFile(join(output, "media", asset), bytes, { flag: "wx" });
    body += `<section><h2>${escape(c.id)}</h2><audio controls preload="none" src="media/${asset}"></audio>${waveform(bytes, c.audio.channels)}<p>${escape(`Player input history: ${c.channels.playerInput} (current keys, completeness and audibility unknown) · Acoustic estimate: ${c.channels.acoustic} · Renderer evidence: ${c.channels.renderer} · Playback comparison: ${c.channels.playback} · Source comparison: ${c.channels.source}`)}<br>Channel status describes available evidence; it does not establish model admission or musical acceptance.</p><ul>${c.findings.map((f) => `<li><button type="button" onclick="this.closest('section').querySelector('audio').currentTime=${f.startSeconds};this.closest('section').querySelector('audio').play()">${f.startSeconds.toFixed(2)}–${f.endSeconds.toFixed(2)} s</button> ${escape(f.description)} (${escape(f.origin)})</li>`).join("")}</ul><label>Listening notes <textarea></textarea></label><p>Source review: pending · keyboard review: pending</p></section>`;
  }
  body +=
    "<h2>Limitations</h2><ul>" +
    report.limitations.map((t) => "<li>" + escape(t) + "</li>").join("") +
    "</ul>";
  const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Music review</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 20px;background:#f5f5f7;color:#20202a}section{padding:24px;background:white;margin:20px 0;border-radius:12px}audio,svg{width:100%}svg{height:100px}textarea{display:block;width:100%;min-height:70px}button{margin:6px}</style>' +
    body +
    "</html>";
  await writeFile(join(output, "index.html"), html, { flag: "wx" });
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  await writeFile(
    join(output, "report.md"),
    "# Music review\n\nMusical acceptance: not established. Provider calls: 0.\n\n" +
      report.clips
        .map(
          (c) =>
            `- ${c.id}: ${JSON.stringify(c.channels)}; ${c.findings.length} findings`,
        )
        .join("\n") +
      "\n",
    { flag: "wx" },
  );
}
