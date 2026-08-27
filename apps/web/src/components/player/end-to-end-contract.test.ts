import { describe, expect, it } from "vitest";
import { normalizeChordTimeline as normalizeCatalogChordTimeline } from "@keyspilli/catalog";
import { buildVariants, type ParsedMidi } from "@keyspilli/midi";
import {
  beatToSec,
  DEFAULT_SETTINGS,
  PlaybackEngine,
  type AudioLike,
  type TimedNote,
} from "@keyspilli/player-core";
import { normalizeChordTimeline as normalizePlayerChordTimeline } from "./chord-sources";

/**
 * A deliberately small audio boundary spy. The fixture is not testing Web
 * Audio; it is checking the values that survive the catalog and player
 * contracts before a real AudioEngine receives them.
 */
class ContractAudio implements AudioLike {
  playedChords: { midiNotes: number[]; when: number; durationSec: number }[] = [];

  ensure(): unknown {
    return {};
  }

  noteOn(_note: TimedNote, _when?: number): void {}

  noteOff(_midi: number): void {}

  metronomeClick(_beat: number, _when?: number): void {}

  playChord(midiNotes: number[], when: number, durationSec: number): void {
    this.playedChords.push({ midiNotes, when, durationSec });
  }

  cancelAll(): void {}

  setGains(_voice: number, _piano: number): void {}

  dispose(): void {}

  sustainPedal = true;
}

function syntheticMidi(): ParsedMidi {
  return {
    format: 0,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    // Two sustained LH triads with a RH attack at each onset give chordsAt()
    // enough harmonic evidence while keeping the fixture recognizably small.
    notes: [
      { midi: 48, start: 0, dur: 2, vel: 80, hand: "L" },
      { midi: 52, start: 0, dur: 2, vel: 80, hand: "L" },
      { midi: 55, start: 0, dur: 2, vel: 80, hand: "L" },
      { midi: 72, start: 0, dur: 0.5, vel: 96, hand: "R" },
      { midi: 74, start: 1, dur: 0.5, vel: 96, hand: "R" },
      { midi: 50, start: 4, dur: 2, vel: 80, hand: "L" },
      { midi: 53, start: 4, dur: 2, vel: 80, hand: "L" },
      { midi: 57, start: 4, dur: 2, vel: 80, hand: "L" },
      { midi: 74, start: 4, dur: 0.5, vel: 96, hand: "R" },
    ],
    trackNames: ["LH", "RH"],
    durationBeats: 8,
  };
}

describe("chord contract end to end", () => {
  it("carries chordsAt voicings and provenance through catalog/web normalization into playback", () => {
    const variant = buildVariants(
      syntheticMidi(),
      { title: "Contract Fixture", artist: "Keyspilli" },
      { maxDurBeats: null },
    ).find((candidate) => candidate.level === "advanced");
    expect(variant).toBeDefined();
    expect(variant!.chords).toEqual([
      { beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "generated", inferred: true, inferenceType: "voicing", durationBeats: 4 },
      { beat: 4, name: "Dm", notes: [50, 53, 57], sourceKind: "generated", inferred: true, inferenceType: "voicing", durationBeats: 4 },
    ]);

    // Treat the variant as the serialized artifact crossing the catalog
    // boundary. Catalog normalization accepts the explicit spans (legacy
    // artifacts can still derive them from the artifact duration) and
    // preserves absolute MIDI notes.
    const catalogTimeline = normalizeCatalogChordTimeline({
      schemaVersion: 1,
      baseId: "synthetic-contract-fixture",
      title: "Contract Fixture",
      artist: "Keyspilli",
      tempoBpm: variant!.tempoBpm,
      timeSig: variant!.timeSig,
      durationBeats: 8,
      chords: variant!.chords,
      provenance: {
        sourceId: "synthetic-fixture",
        provider: "keyspilli-test",
        kind: "midi-derived",
        sourceRef: "test://synthetic-contract-fixture",
        confidence: "high",
      },
    });
    expect(catalogTimeline.chords).toEqual([
      { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "generated", inferred: true, inferenceType: "voicing" },
      { beat: 4, durationBeats: 4, name: "Dm", notes: [50, 53, 57], sourceKind: "generated", inferred: true, inferenceType: "voicing" },
    ]);

    // This is the web boundary used by Player. It must not reduce the
    // catalog's absolute voicing back to pitch classes or lose provenance.
    const playerChords = normalizePlayerChordTimeline(catalogTimeline);
    expect(playerChords).toEqual(catalogTimeline.chords);
    expect(playerChords.every((chord) => chord.sourceKind === "generated")).toBe(true);

    const speed = 1.25;
    const transpose = 2;
    const audio = new ContractAudio();
    const engine = new PlaybackEngine(
      audio,
      [],
      beatToSec(catalogTimeline.durationBeats, variant!.tempoBpm, speed),
      { tempoBpm: variant!.tempoBpm, timeSig: variant!.timeSig },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord", speed, transpose },
      playerChords,
    );

    engine.start();
    expect(audio.playedChords).toEqual([
      { midiNotes: [50, 54, 57], when: 0, durationSec: 1.6 },
    ]);

    // The second event lands at beat 4 = 1.6 seconds at this tempo/speed.
    // Advance in sub-clamp increments (dt is clamped to 0.5s to prevent
    // tab-background jumps, so a single 1.6s tick would not reach here).
    for (let i = 0; i < 4; i++) engine.tick(0.4);
    expect(audio.playedChords[1]).toMatchObject({
      midiNotes: [52, 55, 59],
      durationSec: 1.6,
    });
    expect(audio.playedChords[1]!.when).toBeCloseTo(0, 8);
  });
});
