import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSong, getSongsByBase, artifactsDir, loadChordTimeline, SongRow } from "@keyspilli/catalog";
import { chordToNotes, type ChordLabel } from "@keyspilli/midi";
import type { SongData } from "@keyspilli/player-core";

type LoadedChordTimeline = NonNullable<Awaited<ReturnType<typeof loadChordTimeline>>>;
type PlayerChord = ChordLabel & { durationBeats?: number };

/**
 * Merge a normalized chart with generated chords without leaving silent gaps.
 * A chart is allowed to omit a voicing for a symbol; those events are filled
 * from the generated timeline (or from the shared symbol voicer above).
 */
export function mergeChartTimeline(
  timeline: LoadedChordTimeline,
  generated: ChordLabel[],
): { chords: PlayerChord[]; provenance: LoadedChordTimeline["provenance"] } {
  if (timeline.provenance.kind !== "chart") {
    return {
      chords: timeline.chords.flatMap((chord) => (
        Array.isArray(chord.notes) && chord.notes.length > 0
          ? [{ beat: chord.beat, durationBeats: chord.durationBeats, name: chord.name, notes: chord.notes }]
          : []
      )),
      provenance: timeline.provenance,
    };
  }

  const chartChords: PlayerChord[] = timeline.chords.flatMap((chord) => {
    const supplied = Array.isArray(chord.notes) && chord.notes.length > 0 ? chord.notes : null;
    const notes = supplied ?? (() => {
      try {
        return chordToNotes(chord.name, { octave: 3, bassOctave: 2, includeBass: true });
      } catch {
        return null;
      }
    })();
    return notes?.length
      ? [{ beat: chord.beat, durationBeats: chord.durationBeats, name: chord.name, notes }]
      : [];
  });

  const generatedFallback = generated.filter((chord) => (
    !chartChords.some((chart) => chord.beat >= chart.beat && chord.beat < chart.beat + (chart.durationBeats ?? 0))
  ));
  const partial = timeline.coverage !== undefined && timeline.coverage !== "full-song";
  const fallback = timeline.provenance.fallback === true || partial || generatedFallback.length > 0;
  const provenance = fallback
    ? {
        ...timeline.provenance,
        fallback: true,
        fallbackReason: partial
          ? `UG chart covers ${timeline.coverage}; generated chords fill uncovered chart events and the remaining song.`
          : "UG chart had unsupported or unvoiced events; generated chords fill the uncovered positions.",
      }
    : timeline.provenance;

  return {
    chords: [...chartChords, ...generatedFallback].sort((a, b) => a.beat - b.beat),
    provenance,
  };
}

export interface SongDetail {
  song: SongRow;
  data: SongData | null;
  variants: SongRow[];
}

export async function getSongDetail(id: string): Promise<SongDetail | null> {
  const song = getSong(id);
  if (!song) return null;
  const stored = await readFile(join(artifactsDir(song.baseId, song.level), "notes.json"), "utf8")
    .then((s) => JSON.parse(s) as SongData)
    .catch(() => null);
  let data = stored;
  if (data) {
    // Chord charts live beside the immutable app image rather than in the
    // mutable song database. Keep the existing generated timeline intact and
    // expose a separate source timeline only when a verified chart exists.
    try {
      const timeline = await loadChordTimeline(song.baseId, { fallbackLevel: song.level });
      if (timeline) {
        const merged = mergeChartTimeline(timeline, data.chords);
        const metadata = {
          ...data,
          chordProvenance: merged.provenance,
        } as SongData & { chordProvenance?: unknown; ugChordTimeline?: unknown };
        if (timeline.provenance.kind === "chart") {
          metadata.ugChordTimeline = merged.chords;
        }
        data = metadata;
      }
    } catch {
      // A missing/invalid optional chart must never make a normal song fail to
      // load; the player will use its generated chord fallback.
    }
  }
  const variants = getSongsByBase(song.baseId);
  return { song, data, variants };
}

export async function getArtifactFile(id: string, name: "variant.mid" | "variant.xml"): Promise<Buffer | null> {
  const song = getSong(id);
  if (!song) return null;
  return readFile(join(artifactsDir(song.baseId, song.level), name)).catch(() => null);
}
