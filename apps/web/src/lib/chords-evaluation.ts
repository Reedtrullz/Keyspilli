import type { SongRow } from "@keyspilli/catalog";
import type { AccompanimentResolution, Note, SongData } from "@keyspilli/player-core";
import { replayChordsBacking, type ChordsBackingReplay } from "../components/player/chords-backing";

/**
 * Read-only structural report of the Chords backing for every visible song.
 * The default candidate is the Player's own replay; a new producer is passed
 * as `candidate` and compared on identical inputs. Coverage is not musical
 * correctness: these numbers only locate songs that need listening.
 */
export type ChordsCandidate = (data: SongData, player: ChordsBackingReplay) => AccompanimentResolution;
export type AdvancedRow = Pick<SongRow, "id" | "baseId" | "level" | "tempo" | "acquiredVia">;
export type AdvancedLoad = { data: SongData | null; errors: string[]; notesSha256: string | null };
export type AdvancedLoader = (song: AdvancedRow) => Promise<AdvancedLoad>;

type Attack = { midi: number; start: number; dur: number; hand?: "L" | "R" };

function unionLength(spans: Array<[number, number]>): number {
  let end = -Infinity, total = 0;
  for (const [start, stop] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (stop <= end) continue;
    total += stop - Math.max(start, end);
    end = stop;
  }
  return total;
}

function maximumOverlap(notes: readonly Attack[]): number {
  const edges = notes.flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as Array<[number, number]>)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, maximum = 0;
  for (const [, delta] of edges) maximum = Math.max(maximum, active += delta);
  return maximum;
}

function onsetGeometry(attacks: readonly Attack[]) {
  const byHand = { L: new Map<number, number[]>(), R: new Map<number, number[]>() };
  for (const attack of attacks) if (attack.hand) {
    const groups = byHand[attack.hand];
    groups.set(attack.start, [...(groups.get(attack.start) ?? []), attack.midi]);
  }
  return Object.fromEntries((Object.entries(byHand) as Array<["L" | "R", Map<number, number[]>]>).map(([hand, groups]) => {
    const ordered = [...groups].sort(([a], [b]) => a - b).map(([, pitches]) => pitches.sort((a, b) => a - b));
    const representatives = ordered.map((pitches) => pitches[Math.floor((pitches.length - 1) / 2)]!);
    return [hand, ordered.length ? {
      maxSimultaneousSpanSemitones: Math.max(0, ...ordered.map((pitches) => pitches[pitches.length - 1]! - pitches[0]!)),
      maxRepresentativeLeapSemitones: Math.max(0, ...representatives.slice(1).map((pitch, i) => Math.abs(pitch - representatives[i]!))),
    } : null];
  }));
}

function attackMetrics(attacks: readonly Attack[], durationBeats: number) {
  const pitches = attacks.map((attack) => attack.midi);
  const covered = unionLength(attacks.map((attack) => [attack.start, attack.start + attack.dur]));
  return {
    attacks: attacks.length,
    coveredBeats: covered,
    coveredFraction: durationBeats ? covered / durationBeats : 0,
    minMidi: pitches.length ? Math.min(...pitches) : null,
    maxMidi: pitches.length ? Math.max(...pitches) : null,
    maximumHeldOverlap: maximumOverlap(attacks),
    onsetGeometryByHand: onsetGeometry(attacks),
    unassignedHandAttacks: attacks.filter((attack) => attack.hand !== "L" && attack.hand !== "R").length,
    endingGapBeats: Math.max(0, durationBeats - Math.max(0, ...attacks.map((attack) => attack.start + attack.dur))),
  };
}

/**
 * Listener-facing checks that need no listening. Dead air: a source note
 * starts while the backing's last strike is a full bar or more back.
 * Alignment: backing strikes that land on a source onset. Clashes: the
 * highest right-hand note at each onset stands in for the tune; on a whole
 * beat it should be a tone of the sounding backing, and it should never sit a
 * semitone (or minor ninth) from a sounding backing note.
 */
function listenerChecks(data: SongData, audio: readonly Attack[]) {
  const strikes = [...new Set(audio.map((attack) => attack.start))].sort((a, b) => a - b);
  const sourceOnsets = [...new Set(data.notes.map((note) => note.start))].sort((a, b) => a - b);
  const onsetSet = new Set(sourceOnsets);
  let deadAirBars = 0, longestWait = 0, last = -Infinity, i = 0;
  for (const onset of sourceOnsets) {
    while (i < strikes.length && strikes[i]! <= onset + 1e-7) last = strikes[i++]!;
    const bar = data.measures.find((measure) => measure.startBeat <= onset && onset < measure.endBeat);
    const barLength = bar ? bar.endBeat - bar.startBeat : 4;
    const wait = onset - last;
    if (Number.isFinite(wait)) longestWait = Math.max(longestWait, wait);
    if (!(wait < barLength)) deadAirBars++;
  }
  const tops = new Map<number, number>();
  for (const note of data.notes) if (note.hand !== "L") tops.set(note.start, Math.max(tops.get(note.start) ?? -Infinity, note.midi));
  let strongBeat = 0, chordTone = 0, semitoneClashes = 0, tuneNotes = 0;
  for (const [onset, midi] of tops) {
    const sounding = audio.filter((attack) => attack.start <= onset + 1e-7 && onset < attack.start + attack.dur);
    if (!sounding.length) continue;
    tuneNotes++;
    if (sounding.some((attack) => [1, 11].includes(((attack.midi - midi) % 12 + 12) % 12))) semitoneClashes++;
    if (Math.abs(onset - Math.round(onset)) < 1e-7) {
      strongBeat++;
      if (sounding.some((attack) => (attack.midi - midi) % 12 === 0)) chordTone++;
    }
  }
  return {
    deadAirOnsets: deadAirBars,
    longestWaitForStrikeBeats: longestWait,
    strikes: strikes.length,
    strikesOnSourceOnsets: strikes.filter((beat) => onsetSet.has(beat)).length,
    strikesUnderOneBeatApart: strikes.slice(1).filter((beat, index) => beat - strikes[index]! < 1 - 1e-7).length,
    tuneNotesOverBacking: tuneNotes,
    strongBeatTuneChordToneShare: strongBeat ? chordTone / strongBeat : null,
    tuneSemitoneClashShare: tuneNotes ? semitoneClashes / tuneNotes : null,
  };
}

function noteAttacks(notes: readonly Note[]): Attack[] {
  return notes.map(({ midi, start, dur, hand }) => ({ midi, start, dur, hand }));
}

export function evaluateChordsBacking(data: SongData, candidate?: ChordsCandidate) {
  const player = replayChordsBacking(data);
  const resolution = candidate ? candidate(data, player) : player.resolution;
  const durationBeats = player.arrangementEnd;
  const notes = data.notes;
  const sourceGaps: Array<[number, number]> = [];
  let occupiedEnd = 0;
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    if (note.start > occupiedEnd) sourceGaps.push([occupiedEnd, note.start]);
    occupiedEnd = Math.max(occupiedEnd, note.start + note.dur);
  }
  const kinds = data.chords.map((chord) => chord.sourceKind ?? "generated");
  const chordAttacks: Attack[] = resolution.chords.flatMap((chord) => chord.notes.map((midi, i) => ({
    midi, start: chord.beat, dur: chord.durationBeats ?? 0, hand: chord.suggestedHands?.[i],
  })));
  // Playback schedules both streams; a pitch struck twice at one onset is a
  // doubled attack for the listener and an unpressable target for the learner.
  const audioAttacks = [...noteAttacks(resolution.notes), ...chordAttacks];
  const onsetKeys = audioAttacks.map((attack) => `${attack.midi}:${attack.start}`);
  const firstMeasure = data.measures[0]?.startBeat ?? 0;
  return {
    sourceFingerprint: data.sourceFingerprint ?? null,
    source: {
      noteCount: notes.length,
      chordCount: data.chords.length,
      chordProvenance: Object.fromEntries([...new Set(kinds)].sort().map((kind) => [kind, kinds.filter((k) => k === kind).length])),
      generatedOnly: kinds.length > 0 && kinds.every((kind) => kind === "generated"),
      roleNoteCount: notes.filter((note) => note.identitySource !== undefined).length,
      vocalNoteCount: notes.filter((note) => note.identitySource === "vocals").length,
      laneNoteCount: notes.filter((note) => note.sourceLane !== undefined).length,
      originNoteCount: notes.filter((note) => note.sourceOrigins?.length).length,
      durationBeats,
      sourceRestBeats: unionLength(sourceGaps) + Math.max(0, durationBeats - occupiedEnd),
      pickupOrOffset: firstMeasure !== 0,
      unusualMeter: data.timeSigEvents?.some((event) => JSON.stringify(event.timeSig) !== JSON.stringify(data.timeSig)) ?? false,
      meterEventCount: data.timeSigEvents?.length ?? 0,
      ...attackMetrics(noteAttacks(notes), durationBeats),
    },
    player: {
      chordSource: player.selected.source?.id ?? null,
      chordSourceLabel: player.selected.source?.label ?? null,
      chartCoverage: player.selected.source?.coverage ?? null,
      fallback: player.selected.fallback,
      fallbackReason: player.selected.fallbackReason,
      timelineChords: player.chords.length,
      reviewedSourceBacking: player.reviewedSourceBacking,
    },
    backing: {
      input: candidate ? "candidate" : "player",
      chordEvents: resolution.chords.length,
      noteStreamAttacks: resolution.notes.length,
      chordVoicingAttacks: chordAttacks.length,
      duplicateOnsetAttacks: onsetKeys.length - new Set(onsetKeys).size,
      chordVoicingCoveredBeats: unionLength(chordAttacks.map((attack) => [attack.start, attack.start + attack.dur])),
      unsupportedSpans: resolution.fallbackSpans.map(({ startBeat, endBeat, reason }) => ({ startBeat, endBeat, reason })),
      ...attackMetrics(audioAttacks, durationBeats),
      listener: listenerChecks(data, audioAttacks),
    },
  };
}

function share(pairs: Array<[number, number]>): number | null {
  const [hit, all] = pairs.reduce(([h, a], [x, y]) => [h + x, a + y], [0, 0]);
  return all ? hit / all : null;
}

function median(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return known.length ? known[Math.floor((known.length - 1) / 2)]! : null;
}

export type ChordsEvaluationRow = {
  baseId: string;
  songId: string | null;
  acquiredVia: string | null;
  notesSha256: string | null;
  status: "evaluated" | "no-advanced" | "unavailable";
  errors: string[];
} & Partial<ReturnType<typeof evaluateChordsBacking>>;

/**
 * Evaluate each visible base's Advanced variant exactly as the Player loads
 * it. `advanced` maps every visible base to its Advanced row, or null when
 * the base has none; hidden and orphan artifact counts come from the caller.
 */
export async function evaluateVisibleChords(
  advanced: ReadonlyMap<string, AdvancedRow | null>,
  load: AdvancedLoader,
  counts: { hiddenAdvancedArtifacts: number; orphanAdvancedArtifacts: number },
  candidate?: ChordsCandidate,
) {
  const rows: ChordsEvaluationRow[] = [];
  for (const [baseId, song] of [...advanced].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!song) {
      rows.push({ baseId, songId: null, acquiredVia: null, notesSha256: null, status: "no-advanced", errors: [] });
      continue;
    }
    const loaded = await load(song);
    const identity = { baseId, songId: song.id, acquiredVia: song.acquiredVia, notesSha256: loaded.notesSha256 };
    rows.push(loaded.data
      ? { ...identity, status: "evaluated", errors: [], ...evaluateChordsBacking(loaded.data, candidate) }
      : { ...identity, status: "unavailable", errors: loaded.errors });
  }
  const evaluated = rows.filter((row) => row.status === "evaluated");
  const count = (predicate: (row: ChordsEvaluationRow) => boolean) => evaluated.filter(predicate).length;
  const chordSources: Record<string, number> = {};
  for (const row of evaluated) {
    const id = row.player?.reviewedSourceBacking ? "reviewed-source-backing" : row.player?.chordSource ?? "none";
    chordSources[id] = (chordSources[id] ?? 0) + 1;
  }
  const fractions = evaluated.map((row) => row.backing!.coveredFraction).sort((a, b) => a - b);
  const unsupportedBeatsByReason: Record<string, number> = {};
  for (const row of evaluated) for (const span of row.backing!.unsupportedSpans) {
    unsupportedBeatsByReason[span.reason] = (unsupportedBeatsByReason[span.reason] ?? 0) + span.endBeat - span.startBeat;
  }
  return {
    summary: {
      visibleBases: rows.length,
      evaluated: evaluated.length,
      unavailable: rows.filter((row) => row.status === "unavailable").length,
      noAdvanced: rows.filter((row) => row.status === "no-advanced").length,
      ...counts,
      generatedOnlyBases: count((row) => row.source!.generatedOnly),
      noChordBases: count((row) => row.source!.chordCount === 0),
      roleLabeledBases: count((row) => row.source!.roleNoteCount > 0),
      vocalLabeledBases: count((row) => row.source!.vocalNoteCount > 0),
      originLabeledBases: count((row) => row.source!.originNoteCount > 0),
      chordSources,
      songsWithUnsupportedSpans: count((row) => row.backing!.unsupportedSpans.length > 0),
      // "explicit no-chord" is a labeled rest; the other reasons are gaps.
      unsupportedBeatsByReason,
      silentSongs: count((row) => row.backing!.attacks === 0),
      songsWithDuplicateOnsetAttacks: count((row) => row.backing!.duplicateOnsetAttacks > 0),
      songsUnder80PercentCovered: count((row) => row.backing!.coveredFraction < 0.8),
      medianCoveredFraction: fractions.length ? fractions[Math.floor((fractions.length - 1) / 2)]! : null,
      songsWithDeadAir: count((row) => row.backing!.listener.deadAirOnsets > 0),
      deadAirOnsets: evaluated.reduce((total, row) => total + row.backing!.listener.deadAirOnsets, 0),
      strikeOnSourceOnsetShare: share(evaluated.map((row) => [row.backing!.listener.strikesOnSourceOnsets, row.backing!.listener.strikes])),
      medianStrongBeatTuneChordToneShare: median(evaluated.map((row) => row.backing!.listener.strongBeatTuneChordToneShare)),
      medianTuneSemitoneClashShare: median(evaluated.map((row) => row.backing!.listener.tuneSemitoneClashShare)),
    },
    rows,
  };
}
