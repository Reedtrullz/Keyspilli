import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
export interface CorpusEvent {
  id: string;
  midi: number;
  onsetSeconds: number;
  durationSeconds: number;
  velocity: number;
  hand: "L" | "R";
  phraseId: string;
  occurrenceId: string;
}
export interface CorpusCase {
  id: string;
  split: "development" | "heldout";
  lineage: string;
  mediaPath: string;
  eventsPath: string;
  mode: "original" | "chords";
  input: "player" | "silence" | "missing";
}
const families = [
  "register-contour",
  "repeat-held",
  "pedal",
  "chords-octaves",
  "quiet-overlap",
  "wrong-note",
  "missing-note",
  "extra-note",
  "shifted-entry",
  "repeated-section",
  "reduction",
  "silence-missing",
] as const;
export function makeMusicCorpus(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("seed must be a nonnegative integer");
  const cases: CorpusCase[] = [];
  const key: Array<{
    id: string;
    split: CorpusCase["split"];
    family: string;
    category: string;
    source: CorpusEvent[];
    played: CorpusEvent[];
    authority: "self-authored";
    realization: string;
    critical: boolean;
  }> = [];
  const fixtures: Array<{
    id: string;
    title: string;
    data: Record<string, unknown>;
  }> = [];
  const captures: Record<
    string,
    {
      clipId: string;
      songId: string;
      mode: "original" | "chords";
      durationMs: number;
      expectedAttackSeconds: number[];
      expectedAttackSecondsByBus: { voice: number[]; backing: number[] };
    }
  > = {};
  let held = 0;
  for (const [familyIndex, family] of families.entries())
    for (let j = 0; j < 10; j++) {
      const split = j < 2 ? "development" : "heldout";
      const category =
        split === "heldout"
          ? ["clean", "fault", "valid"][held++ % 3]!
          : j === 0
            ? "clean"
            : "fault";
      const id = "x" + identityHash({ seed, familyIndex, j }).slice(0, 14);
      const mode: CorpusCase["mode"] =
        family === "reduction" || (familyIndex + j) % 4 === 0
          ? "chords"
          : "original";
      const base = 48 + ((seed + familyIndex * 3 + j) % 22);
      const phrase = "p" + familyIndex + "-" + j;
      let source: CorpusEvent[] = Array.from({ length: 4 }, (_, n) => ({
        id: id + "-e" + n,
        midi: base + [0, 4, 7, 12][n]!,
        onsetSeconds: 0.25 + n * (0.42 + j * 0.004),
        durationSeconds: 0.28 + j * 0.003,
        velocity: family === "quiet-overlap" ? 30 : 76,
        hand: n % 2 === 0 ? "L" : "R",
        phraseId: phrase,
        occurrenceId: n < 2 ? "o1" : "o2",
      }));
      if (family === "repeat-held")
        source =
          j % 2
            ? [{ ...source[0]!, midi: base, durationSeconds: 1.6 }]
            : source.map((n) => ({ ...n, midi: base, durationSeconds: 0.28 }));
      if (family === "chords-octaves")
        source = source.map((n, i) => ({
          ...n,
          onsetSeconds: 0.25 + (i < 3 ? 0 : 0.9),
        }));
      if (family === "pedal")
        source = source.map((n) => ({ ...n, durationSeconds: 0.5 }));
      if (family === "quiet-overlap")
        source = source.map((n) => ({ ...n, durationSeconds: 0.7 }));
      if (family === "repeated-section")
        source = source.map((n, i) => ({
          ...n,
          midi: base + [0, 7, 0, 7][i]!,
        }));
      let played = source.map((n) => ({ ...n }));
      let realization = "faithful authored construction";
      if (category === "fault") {
        if (familyIndex % 4 === 0) {
          played = played.map((n, i) =>
            i === 1 ? { ...n, midi: n.midi + 1 } : n,
          );
          realization = "faithfully played seeded bad arrangement";
        }
        if (familyIndex % 4 === 1) {
          if (played.length > 1) {
            played = played.filter((_, i) => i !== 1);
            realization = "seeded dropped realization event";
          } else {
            played = played.map((n) => ({ ...n, midi: n.midi + 1 }));
            realization = "seeded changed held realization pitch";
          }
        }
        if (familyIndex % 4 === 2) {
          played.push({
            ...played[0]!,
            id: id + "-extra",
            midi: base + 2,
            onsetSeconds: 1.8,
          });
          realization = "seeded extra realization event";
        }
        if (familyIndex % 4 === 3) {
          played = played.map((n) => ({
            ...n,
            onsetSeconds: n.onsetSeconds + 0.2,
          }));
          realization = "seeded shifted realization entrance";
        }
      } else if (category === "valid") {
        if (mode === "chords") {
          played = played.filter((n) => n.hand === "L");
          realization = "approved backing-only melody omission";
        } else {
          played = played.map((n) => ({ ...n, midi: n.midi + 12 }));
          realization = "approved octave displacement";
        }
      }
      const input =
        family === "silence-missing"
          ? j % 2
            ? "missing"
            : "silence"
          : "player";
      if (input === "silence") played = [];
      const lineage = identityHash({ source, seed, family, split });
      cases.push({
        id,
        split,
        lineage,
        mediaPath: "media/" + id + ".wav",
        eventsPath: "events/" + id + ".json",
        mode,
        input,
      });
      key.push({
        id,
        split,
        family,
        category,
        source,
        played,
        authority: "self-authored",
        realization,
        critical: ["silence-missing", "repeat-held", "chords-octaves"].includes(
          family,
        ),
      });
      if (input !== "player") continue;
      const notes = played
        .map((n) => ({
          midi: n.midi,
          start: n.onsetSeconds * 2,
          dur: n.durationSeconds * 2,
          vel: n.velocity,
          hand: n.hand,
        }))
        .sort((a, b) => a.start - b.start || a.midi - b.midi);
      // Explicit authored accompaniment is used in Chords; no implicit chord generator truth.
      const chordNames = [
        "C",
        "Db",
        "D",
        "Eb",
        "E",
        "F",
        "Gb",
        "G",
        "Ab",
        "A",
        "Bb",
        "B",
      ];
      const explicitChords =
        mode === "chords"
          ? played
              .filter((n) => n.hand === "L")
              .map((n) => ({
                beat: n.onsetSeconds * 2,
                durationBeats: n.durationSeconds * 2,
                name: chordNames[n.midi % 12],
                notes: [n.midi, n.midi + 4, n.midi + 7],
                sourceKind: "authored",
              }))
          : [];
      const data = {
        notes,
        key: "C",
        tempoBpm: 120,
        timeSig: [4, 4],
        chords: explicitChords,
        measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
        sections: [{ id: phrase, label: "Phrase", startBeat: 0, endBeat: 4 }],
      };
      fixtures.push({ id, title: "Self-authored review phrase", data });
      const voices =
        mode === "original" ? played.filter((n) => n.hand === "R") : [];
      const backing = played.filter((n) => n.hand === "L");
      captures[id] = {
        clipId: id,
        songId: id + "-m",
        mode,
        durationMs: 3100,
        expectedAttackSeconds: [...voices, ...backing].map(
          (n) => n.onsetSeconds,
        ),
        expectedAttackSecondsByBus: {
          voice: voices.map((n) => n.onsetSeconds),
          backing: backing.map((n) => n.onsetSeconds),
        },
      };
    }
  return {
    schemaVersion: 1,
    kind: "keyspilli-music-review-corpus",
    seed,
    cases,
    key,
    fixtures,
    captures,
    limitations: [
      "Self-authored synthetic controls; no real-song acceptance",
      "Single sampled piano bank; second bank uncovered",
      "Source claims and transport schedules are not independent acoustic truth",
    ],
  };
}
