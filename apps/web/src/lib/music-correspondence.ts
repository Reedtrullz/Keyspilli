import {
  measurePlayability,
  assessPlayability,
  type PlayabilityAssessment,
} from "@keyspilli/midi";
import {
  assertMusic,
  finiteSeconds,
  identityHash,
  isHash,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
export interface MusicalEvent {
  id: string;
  phraseId: string;
  occurrenceId: string;
  role: "melody" | "bass" | "harmony";
  hand?: "L" | "R";
  midi: number;
  onsetSeconds: number;
  durationSeconds: number;
}
export interface ReplaySnapshot {
  schemaVersion: 1;
  sourceSha256: string;
  events: MusicalEvent[];
  tempoBpm?: number;
  playerCapture?: {captureSha256:string;inputSha256:string;clipOffsetSeconds:0};
}
export interface SourceAnchors {
  sha256: string;
  authority: "unknown" | "model-estimate" | "self-authored" | "human-validated";
  validationReceiptSha256?: string;
  timingKnown?: boolean;
  anchors: Array<MusicalEvent & { required: boolean; ambiguous?: boolean }>;
}
export interface ArrangementIntent {
  mode: "original" | "chords";
  difficulty: "beginner" | "medium" | "advanced";
  approvedTransformations: Array<
    "octave-displacement" | "alternate-voicing" | "density-reduction"
  >;
  maximumHandSpan: number;
}
export interface MusicalComparison {
  status: "available" | "incomplete";
  sourceSha256: string;
  replaySha256: string;
  landmarks: Array<{
    id: string;
    phraseId: string;
    occurrenceId: string;
    startSeconds: number;
    endSeconds: number;
    status: "preserved" | "changed-permitted" | "violated" | "unknown";
    reason: string;
  }>;
  difficulty:
    | { status: "not-assessed"; reason: string }
    | {
        status: "assessed";
        assessment: PlayabilityAssessment;
        handSpanExceeded: boolean;
        reason: string;
      };
  musicalAcceptance: "not-established";
  limitations: string[];
}
export function validateReplay(snapshot: ReplaySnapshot): ReplaySnapshot {
  assertMusic(
    snapshot.schemaVersion === 1 &&
      snapshot.sourceSha256 === identityHash(snapshot.events),
    "stale replay hash",
  );
  assertMusic(
    Array.isArray(snapshot.events) && snapshot.events.length <= 20000,
    "invalid replay inventory",
  );
  const ids = new Set<string>();
  for (const e of snapshot.events) {
    assertMusic(
      e &&
        typeof e.id === "string" &&
        typeof e.phraseId === "string" &&
        typeof e.occurrenceId === "string" &&
        !ids.has(e.id),
      "duplicate or missing replay event identity",
    );
    ids.add(e.id);
    assertMusic(
      ["melody", "bass", "harmony"].includes(e.role) &&
        Number.isInteger(e.midi) &&
        e.midi >= 0 &&
        e.midi <= 127 &&
        finiteSeconds(e.onsetSeconds) &&
        finiteSeconds(e.durationSeconds) &&
        e.durationSeconds > 0 &&
        (e.hand === undefined || e.hand === "L" || e.hand === "R"),
      "invalid musical event",
    );
  }
  return JSON.parse(JSON.stringify(snapshot)) as ReplaySnapshot;
}
export function compareMusicalIntent(
  source: SourceAnchors,
  snapshot: ReplaySnapshot,
  intent: ArrangementIntent,
): MusicalComparison {
  validateReplay(snapshot);
  assertMusic(
    isHash(source.sha256) &&
      Array.isArray(source.anchors) &&
      source.anchors.length <= 20000,
    "invalid source anchors",
  );
  assertMusic(
    ["unknown", "model-estimate", "self-authored", "human-validated"].includes(
      source.authority,
    ),
    "invalid authority",
  );
  assertMusic(
    ["original", "chords"].includes(intent.mode) &&
      ["beginner", "medium", "advanced"].includes(intent.difficulty) &&
      Number.isInteger(intent.maximumHandSpan) &&
      intent.maximumHandSpan > 0 &&
      intent.maximumHandSpan <= 24,
    "invalid arrangement intent",
  );
  assertMusic(
    intent.approvedTransformations.every((t) =>
      [
        "octave-displacement",
        "alternate-voicing",
        "density-reduction",
      ].includes(t),
    ),
    "unsupported transformation",
  );
  const trusted =
    source.authority === "self-authored" ||
    (source.authority === "human-validated" &&
      isHash(source.validationReceiptSha256));
  const used = new Set<string>();
  const anchorIds = new Set<string>();
  const landmarks = source.anchors.map((a) => {
    assertMusic(
      a &&
        typeof a.id === "string" &&
        !anchorIds.has(a.id) &&
        typeof a.required === "boolean" &&
        finiteSeconds(a.onsetSeconds) &&
        finiteSeconds(a.durationSeconds) &&
        a.durationSeconds > 0 &&
        Number.isInteger(a.midi) &&
        a.midi >= 0 &&
        a.midi <= 127 &&
        ["melody", "bass", "harmony"].includes(a.role),
      "invalid or duplicate source landmark",
    );
    anchorIds.add(a.id);
    let status: MusicalComparison["landmarks"][number]["status"] = "unknown",
      reason = "Source authority or timing remains unvalidated";
    if (trusted && source.timingKnown !== false && !a.ambiguous) {
      const candidates = snapshot.events.filter(
        (e) =>
          !used.has(e.id) &&
          e.phraseId === a.phraseId &&
          e.occurrenceId === a.occurrenceId &&
          e.role === a.role &&
          Math.abs(e.onsetSeconds - a.onsetSeconds) <= 0.1,
      );
      const exact = candidates.find((e) => e.midi === a.midi);
      const octave = candidates.find((e) => (e.midi - a.midi) % 12 === 0);
      if (intent.mode === "chords" && a.role === "melody") {
        status = exact ? "preserved" : "changed-permitted";
        reason = "Backing-only Chords permits melody omission";
        if (exact) used.add(exact.id);
      } else if (exact) {
        status = "preserved";
        reason = "Trusted landmark preserved";
        used.add(exact.id);
      } else if (
        octave &&
        intent.approvedTransformations.includes("octave-displacement")
      ) {
        status = "changed-permitted";
        reason = "Explicitly approved octave displacement";
        used.add(octave.id);
      } else if (
        !a.required &&
        intent.approvedTransformations.includes("density-reduction")
      ) {
        status = "changed-permitted";
        reason = "Optional landmark reduced with explicit approval";
      } else if (
        a.role === "harmony" &&
        candidates.length &&
        intent.approvedTransformations.includes("alternate-voicing")
      ) {
        status = "unknown";
        reason =
          "Alternate voicing permitted, harmonic equivalence needs validated chord anchors";
      } else {
        status = a.required ? "violated" : "unknown";
        reason = a.required
          ? "Required trusted landmark absent or changed"
          : "Optional landmark unresolved";
      }
    }
    return {
      id: a.id,
      phraseId: a.phraseId,
      occurrenceId: a.occurrenceId,
      startSeconds: a.onsetSeconds,
      endSeconds: a.onsetSeconds + a.durationSeconds,
      status,
      reason,
    };
  });
  return {
    status: landmarks.some((l) => l.status === "unknown")
      ? "incomplete"
      : "available",
    sourceSha256: source.sha256,
    replaySha256: snapshot.sourceSha256,
    landmarks,
    difficulty:
      snapshot.tempoBpm !== undefined &&
      Number.isFinite(snapshot.tempoBpm) &&
      snapshot.tempoBpm > 0 &&
      snapshot.events.every((e) => e.hand !== undefined)
        ? (() => {
            const tempo = snapshot.tempoBpm!;
            const metrics = measurePlayability(
              snapshot.events.map((e) => ({
                midi: e.midi,
                start: (e.onsetSeconds * tempo) / 60,
                dur: (e.durationSeconds * tempo) / 60,
                vel: 80,
                hand: e.hand,
              })),
              tempo,
            );
            return {
              status: "assessed" as const,
              assessment: assessPlayability(metrics, intent.difficulty),
              handSpanExceeded: Object.values(metrics.hands).some(
                (h) => h.maxChordSpanSemitones > intent.maximumHandSpan,
              ),
              reason:
                "Existing learner playability audit with explicit tempo and hands; keyboard acceptance pending",
            };
          })()
        : {
            status: "not-assessed",
            reason:
              "Explicit tempo and hand assignments required by existing playability audit; no defaults inferred",
          },
    musicalAcceptance: "not-established",
    limitations: [
      "Landmarks do not establish overall recognizability, voicing quality or keyboard acceptance",
      "Model-estimated anchors remain uncertain; human-only attestation is unchanged",
    ],
  };
}
