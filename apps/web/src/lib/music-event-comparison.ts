import {
  assertMusic,
  finiteSeconds,
  identityHash,
  isHash,
  parseAcousticReceipt,
  type AcousticReceipt,
  type AcousticNote,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
import {
  matchNotes,
  type MatchPolicy,
  type MatchView,
} from "@keyspilli/catalog/src/music-benchmark.js";
import { resolveTimedNotes, type SongData } from "@keyspilli/player-core";
export interface ExpectedPlaybackEvent {
  id: string;
  occurrenceId: string;
  midi: number;
  onsetSeconds: number;
  keyReleaseSeconds: number;
}
export interface CaptureClock {
  audioSha256: string;
  eventsSha256: string;
  captureOffsetSeconds: number;
  speed: number;
  transpose: number;
  tempoMapSha256: string;
  basis: "resolved-playback-seconds";
}
export interface EventFinding {
  kind: "missing" | "extra" | "wrong-pitch" | "octave" | "shifted";
  expectedId: string | null;
  observedId: string | null;
  startSeconds: number;
  endSeconds: number;
  residualSeconds: number | null;
  origin: "independent-acoustic-estimate";
}
export interface EventComparison {
  status: "available" | "unavailable";
  audioSha256: string;
  eventsSha256: string;
  clock: CaptureClock;
  match: MatchView | null;
  findings: EventFinding[];
  offsetStatus: "unqualified";
  limitations: string[];
}
/** Use Player's actual speed/transpose resolver; occurrence identity is provided by the caller. */
export function resolveReviewPlayback(
  song: SongData,
  speed: number,
  transpose: number,
  occurrenceId: string,
): ExpectedPlaybackEvent[] {
  return resolveTimedNotes(song, speed, transpose).map((n, i) => ({
    id: "event-" + i,
    occurrenceId,
    midi: n.midi,
    onsetSeconds: n.startSec,
    keyReleaseSeconds: n.startSec + n.durSec,
  }));
}
export function comparePlaybackEvents(
  expected: readonly ExpectedPlaybackEvent[],
  value: AcousticReceipt,
  clock: CaptureClock,
  policy: MatchPolicy,
): EventComparison {
  const receipt = parseAcousticReceipt(value);
  assertMusic(
    clock.audioSha256 === receipt.audio.sha256 &&
      clock.eventsSha256 === identityHash(expected),
    "stale playback correspondence pins",
  );
  const result: EventComparison = {
    status: "unavailable",
    audioSha256: receipt.audio.sha256,
    eventsSha256: clock.eventsSha256,
    clock,
    match: null,
    findings: [],
    offsetStatus: "unqualified",
    limitations: [
      "Acoustic offsets unqualified; key release is distinct from sounding/pedal tail",
      "Scheduling pins are transport evidence, not independent audio truth",
    ],
  };
  if (
    receipt.status !== "ok" ||
    !Number.isFinite(clock.captureOffsetSeconds) ||
    Math.abs(clock.captureOffsetSeconds) > 1 ||
    clock.basis !== "resolved-playback-seconds" ||
    !Number.isFinite(clock.speed) ||
    clock.speed <= 0 ||
    !Number.isInteger(clock.transpose) ||
    !isHash(clock.tempoMapSha256)
  ) {
    result.limitations.push(
      "Unavailable receipt or unresolved capture/speed/tempo clock",
    );
    return result;
  }
  const ids = new Set<string>();
  const notes: AcousticNote[] = expected.map((e) => {
    const id = e.id + "@" + e.occurrenceId;
    assertMusic(
      e.id && e.occurrenceId && !ids.has(id),
      "duplicate event occurrence",
    );
    ids.add(id);
    assertMusic(
      finiteSeconds(e.onsetSeconds) &&
        finiteSeconds(e.keyReleaseSeconds) &&
        e.keyReleaseSeconds >= e.onsetSeconds,
      "invalid resolved playback event",
    );
    return {
      id,
      midi: e.midi,
      onsetSeconds: e.onsetSeconds + clock.captureOffsetSeconds,
      keyOffsetSeconds: null,
      soundingOffsetSeconds: null,
      confidence: null,
    };
  });
  if (
    notes.some(
      (n) =>
        n.onsetSeconds < 0 || n.onsetSeconds >= receipt.audio.durationSeconds,
    )
  ) {
    result.limitations.push("Expected event outside captured coverage");
    return result;
  }
  parseAcousticReceipt({ ...receipt, notes });
  const view = matchNotes(notes, receipt.notes, policy.onsetSeconds);
  result.match = view;
  result.status = "available";
  const remaining = receipt.notes.filter((n) => view.extraIds.includes(n.id));
  const consumed = new Set<string>();
  for (const n of notes.filter((n) => view.missingIds.includes(n.id))) {
    const neighbors = remaining
      .filter(
        (o) =>
          !consumed.has(o.id) &&
          Math.abs(o.onsetSeconds - n.onsetSeconds) <= 0.5,
      )
      .sort(
        (a, b) =>
          (a.midi === n.midi ? 0 : 1) - (b.midi === n.midi ? 0 : 1) ||
          Math.abs(a.onsetSeconds - n.onsetSeconds) -
            Math.abs(b.onsetSeconds - n.onsetSeconds),
      );
    const o = neighbors[0];
    if (o) {
      consumed.add(o.id);
      result.findings.push({
        kind:
          o.midi === n.midi
            ? "shifted"
            : (o.midi - n.midi) % 12 === 0
              ? "octave"
              : "wrong-pitch",
        expectedId: n.id,
        observedId: o.id,
        startSeconds: Math.min(n.onsetSeconds, o.onsetSeconds),
        endSeconds: Math.max(n.onsetSeconds, o.onsetSeconds) + 0.05,
        residualSeconds: o.onsetSeconds - n.onsetSeconds,
        origin: "independent-acoustic-estimate",
      });
    } else
      result.findings.push({
        kind: "missing",
        expectedId: n.id,
        observedId: null,
        startSeconds: n.onsetSeconds,
        endSeconds: n.onsetSeconds + 0.05,
        residualSeconds: null,
        origin: "independent-acoustic-estimate",
      });
  }
  for (const o of remaining.filter((n) => !consumed.has(n.id)))
    result.findings.push({
      kind: "extra",
      expectedId: null,
      observedId: o.id,
      startSeconds: o.onsetSeconds,
      endSeconds: o.onsetSeconds + 0.05,
      residualSeconds: null,
      origin: "independent-acoustic-estimate",
    });
  return result;
}
