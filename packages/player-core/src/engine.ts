import { ArticulationGrader } from "./articulation.js";
import { gradeableNotes } from "./keyboard-range.js";
import type { InputEventMetadata } from "./input.js";
import { Grader, type GradeResult } from "./grading.js";
import { beatToSec, beatsPerMeasure, completeChordDurations, firstNoteAtOrAfter, secPerBeat, type LoopRegion, type TimedNote } from "./timeline.js";
import type { ChordLabel } from "@keyspilli/midi";
import type { PlayerSettings } from "./types.js";

/** How far ahead of the playhead notes are scheduled. */
const SCHEDULE_LOOKAHEAD = 0.12;
/** Legacy fallback span for chord events without an explicit duration. */
const DEFAULT_CHORD_DURATION_SEC = 1.2;

/** Minimal audio surface the engine needs (AudioEngine satisfies this). */
export interface AudioLike {
  ensure(): unknown;
  readonly state?: string;
  onStateChange?: ((state: string) => void) | null;
  prepareTimbre?(): boolean | void;
  noteOn(n: TimedNote, when?: number): void;
  noteOff(midi: number): void;
  metronomeClick(beat: number, when?: number): void;
  /** Optional so light-weight test doubles and non-audio consumers can keep working. */
  /**
   * Play the supplied absolute MIDI voicing at a scheduled offset.
   *
   * The handoff is intentionally event-level: stop/seek cancellation is
   * global, and no per-voice identity is promised by this surface.
   */
  playChord?(midiNotes: number[], when: number, durationSec: number): void;
  cancelAll(): void;
  setGains(voice: number, piano: number): void;
  setOrganControls?(rotary: "slow" | "fast", drive: number, space: number): void;
  dispose(): void;
  sustainPedal: boolean;
}

export interface EngineSnapshot {
  time: number;
  playing: boolean;
}

export interface EngineSongMeta {
  tempoBpm: number;
  timeSig: [number, number];
  /** Stored measure starts align metronome clicks; they do not validate source phase. */
  measureStarts?: readonly number[];
}

type ChordPlaybackLabel = ChordLabel & { durationBeats?: number };

export interface PlaybackPreviewPlan {
  notes: Array<{ note: TimedNote; when: number }>;
  chords: Array<{ notes: number[]; when: number; durationSec: number }>;
}

/**
 * Plain (non-React) owner of all mutable playback state. The AudioEngine is
 * injected so the engine never touches browser context lifecycle, and the
 * frame loop lives in the caller, which drives tick(dt). Observers receive a
 * snapshot after every mutation.
 */
export class PlaybackEngine {
  time = 0;
  playing = false;
  loop: LoopRegion | null = null;
  grader: Grader | null = null;
  private articulation: ArticulationGrader | null = null;
  /** Retained after completion so the owner can render results and repeat. */
  gradingRange: { startSec: number; endSec: number } | null = null;
  gradeResult: GradeResult | null = null;
  /** Assigned by the owner whenever settings change. */
  settings: PlayerSettings;
  /** Optional beat-based source timeline used by chord background mode. */
  chords: ChordPlaybackLabel[];
  /** Resolved guidance targets used for grading; audio scheduling stays on `notes` plus `chords`. */
  gradingNotes: TimedNote[];
  /** Assigned by the owner whenever wait mode toggles. */
  waitMode = false;
  onChange: ((snap: EngineSnapshot) => void) | null = null;

  private inputClock = { time: 0, ms: 0 };
  private inputBoundaryMs = 0;
  private lastScheduled = 0;
  private lastChordScheduled = -1;

  constructor(
    public readonly audio: AudioLike,
    public notes: TimedNote[],
    public duration: number,
    private readonly song: EngineSongMeta,
    settings: PlayerSettings,
    chords: ChordPlaybackLabel[] = [],
    gradingNotes: TimedNote[] = notes,
    private monotonicNow: () => number = () => performance.now(),
  ) {
    this.settings = settings;
    this.audio.setGains(settings.voiceGain, settings.pianoGain);
    this.chords = this.normalizeChordTimeline(chords);
    this.gradingNotes = gradingNotes;
    this.resetInputClock();
  }

  private resetInputClock(): void {
    this.inputBoundaryMs = this.monotonicNow();
    this.inputClock = { time: this.time, ms: this.inputBoundaryMs };
  }

  start(): void {
    if (this.playing) return;
    this.audio.ensure();
    if (!this.grader && this.audio.prepareTimbre?.() === false) return;
    this.playing = true;
    this.resetInputClock();
    this.lastScheduled = this.time;
    this.lastChordScheduled = -1;
    this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    this.emit();
  }

  stop(): void {
    if (!this.playing && !this.grader) return;
    this.playing = false;
    this.resetInputClock();
    this.audio.cancelAll();
    this.lastChordScheduled = -1;
    this.emit();
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.audio.cancelAll();
    this.time = Math.max(0, Math.min(this.duration, t));
    this.resetInputClock();
    this.lastScheduled = this.time;
    this.lastChordScheduled = -1;
    if (wasPlaying) this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    this.emit();
  }

  /** Advance by dt seconds (called from the owner's rAF loop). */
  tick(dt: number): void {
    if (!this.playing || (this.grader && this.waitMode)) return;
    if (!Number.isFinite(dt) || dt < 0) return;
    // Physical releases get a bounded 400ms dispatch tail; no target audio is scheduled past the passage.
    if (this.grader && this.gradingRange && this.time + dt >= this.gradingRange.endSec + (this.articulation ? .4 : 0)) {
      this.time = this.gradingRange.endSec;
      this.grader.tick(this.time);
      this.finishGrading();
      return;
    }
    const next = this.time + dt;
    const wrapped = this.loop && !this.grader && next >= this.loop.endSec;
    this.time = wrapped && this.loop
      ? this.loop.startSec + (next - this.loop.startSec) % (this.loop.endSec - this.loop.startSec)
      : next;
    this.inputClock = { time: this.time, ms: this.monotonicNow() };
    if (wrapped) this.inputBoundaryMs = this.inputClock.ms;
    // Skip missed attacks after a stalled frame, while still processing loop/end state.
    if (dt > 0.5 || wrapped) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
    }
    if (this.time >= this.duration && !this.loop && (!this.grader || !this.gradingRange)) {
      this.stop();
      this.seek(0);
      return;
    }
    this.schedule(this.lastScheduled, this.time + SCHEDULE_LOOKAHEAD);
    if (this.grader && !this.waitMode) this.grader.tick(this.time);
    this.emit();
  }

  setNotes(notes: TimedNote[], duration: number): void {
    if (this.notes === notes) return;
    this.resetInputClock();
    this.notes = notes;
    this.gradingNotes = notes;
    this.duration = duration;
    this.chords = this.normalizeChordTimeline(this.chords);
    // Mid-playback note changes (speed/transpose/hand) reschedule from now.
    if (this.playing) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    }
  }

  /** Update notes, duration, and chords in one atomic operation. */
  setTimeline(notes: TimedNote[], duration: number, chords: ChordPlaybackLabel[], gradingNotes: TimedNote[] = notes): void {
    const notesChanged = this.notes !== notes;
    const chordsChanged = this.chords !== chords;
    const gradingNotesChanged = this.gradingNotes !== gradingNotes;
    if (!notesChanged && !chordsChanged && !gradingNotesChanged) return;
    if (notesChanged) {
      this.resetInputClock();
      this.notes = notes;
      this.duration = duration;
    }
    if (gradingNotesChanged) this.gradingNotes = gradingNotes;
    if (chordsChanged) {
      this.chords = this.normalizeChordTimeline(chords);
    }
    if (this.playing) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    }
  }

  /** Update the source timeline without requiring a new playback engine. */
  setChords(chords: ChordPlaybackLabel[]): void {
    if (this.chords === chords) return;
    this.chords = this.normalizeChordTimeline(chords);
    this.lastChordScheduled = -1;
    if (this.playing) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    }
  }

  /**
   * Apply settings while allowing background source changes to take effect at
   * the current playhead. Direct assignment remains supported for callers that
   * only need the old behaviour.
   */
  setSettings(settings: PlayerSettings): void {
    const backgroundChanged = this.settings.backgroundMode !== settings.backgroundMode;
    const chordTimingChanged = this.settings.speed !== settings.speed || this.settings.transpose !== settings.transpose;
    const metronomeChanged = this.settings.metronome !== settings.metronome;
    const sustainChanged = this.settings.sustainPedal !== settings.sustainPedal;
    this.settings = settings;
    this.audio.setGains(settings.voiceGain, settings.pianoGain);
    this.audio.sustainPedal = settings.sustainPedal;
    this.audio.setOrganControls?.(settings.organRotary, settings.organDrive, settings.organSpace);
    if (backgroundChanged && this.playing) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    } else if ((chordTimingChanged || metronomeChanged || sustainChanged) && this.playing) {
      // The notes effect will immediately install the newly resolved notes;
      // clear the old audio horizon here so it cannot overlap that update (or
      // leave stale metronome clicks/pedal tails after a setting change).
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
    }

    // Update grader tolerance when playback speed changes
    if (this.grader && chordTimingChanged) {
      this.grader.updateTempo(this.song.tempoBpm, settings.speed);
    }
  }

  setLoop(region: LoopRegion | null): void {
    if (region && (!Number.isFinite(region.startSec) || !Number.isFinite(region.endSec)
      || region.startSec < 0 || region.endSec <= region.startSec || region.endSec > this.duration)) throw new RangeError("Invalid loop bounds");
    this.loop = region;
    if (this.playing) {
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.lastChordScheduled = -1;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    }
  }

  /** Toggle wait mode for an active run and keep the grader in sync. */
  setWaitMode(wait: boolean): void {
    this.waitMode = wait;
    this.grader?.setWaitMode(wait);
    this.emit();
  }

  startGrading(wait: boolean, range?: { startSec: number; endSec: number }, articulationToleranceMs?: number): void {
    if (articulationToleranceMs !== undefined && (wait || !Number.isFinite(articulationToleranceMs) || articulationToleranceMs < 50 || articulationToleranceMs > 400)) throw new RangeError("Articulation requires timed practice and 50–400ms tolerance");
    if (range && (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec))) {
      throw new RangeError("Practice bounds must be finite");
    }
    const bounded = range ? {
      startSec: Math.max(0, Math.min(this.duration, range.startSec)),
      endSec: Math.max(0, Math.min(this.duration, range.endSec)),
    } : null;
    if (bounded && bounded.endSec <= bounded.startSec) throw new RangeError("Practice end must follow its start");
    // Hand filtering already happened in the notes memo; ornaments are decoration.
    const minDurSec = 0.25 * (60 / this.song.tempoBpm / this.settings.speed);
    const gradeable = gradeableNotes(this.gradingNotes, bounded, minDurSec);
    if (!gradeable.length) throw new RangeError("No playable notes in this passage");
    this.audio.ensure();
    if (this.audio.prepareTimbre?.() === false) throw new Error("Piano samples are not ready. Wait or select synthesis fallback in Sound.");
    if (this.playing || this.grader) this.audio.cancelAll();
    this.playing = false;
    this.gradingRange = bounded ?? (articulationToleranceMs !== undefined ? {startSec:0,endSec:this.duration} : null);
    this.articulation = articulationToleranceMs === undefined ? null : new ArticulationGrader(gradeable.length,this.gradingRange!.endSec,articulationToleranceMs);
    this.gradeResult = null;
    this.waitMode = wait;
    this.grader = new Grader(gradeable, { waitMode: wait, bpm: this.song.tempoBpm, speed: this.settings.speed });
    this.seek(bounded?.startSec ?? 0);
  }

  finishGrading(): GradeResult | null {
    if (this.grader) {
      this.playing = false;
      this.audio.cancelAll();
      this.lastChordScheduled = -1;
      this.gradeResult = this.grader.result();
      if(this.articulation)this.gradeResult.articulation=this.articulation.result();
      this.articulation=null;
      this.grader = null;
    }
    this.waitMode = false;
    this.emit();
    return this.gradeResult;
  }

  /**
   * Input-driven note (keyboard/MIDI). Returns false when the grader rejects it.
   * Input voices are tagged so noteOff can release only what the player played
   * instead of cutting song-scheduled notes at the same pitch (voice stealing).
   */
  handleNoteOn(midi: number, event?: InputEventMetadata, offsetMs = 0): boolean {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) return false;
    if (!this.gradeInput(midi, event, offsetMs)) return false;
    const velocity = event && Number.isFinite(event.velocity) ? Math.min(127, Math.max(1, event.velocity)) : 100;
    this.audio.noteOn({ midi, startSec: 0, durSec: 0.4, vel: velocity, hand: "R", fromInput: true });
    this.emit();
    return true;
  }

  private physicalTime(event: InputEventMetadata | undefined): number | null {
    if(!event || event.timingSource !== "event" || !Number.isFinite(event.timestampMs) || event.timestampMs < this.inputBoundaryMs || event.timestampMs > this.monotonicNow()+1)return null;
    return this.inputClock.time+(event.timestampMs-this.inputClock.ms)/1000;
  }
  observeKeyPress(identity:string,event:InputEventMetadata|undefined,offsetMs=0):void {
    const raw=this.physicalTime(event),target=this.grader?.lastAccepted();
    if(this.articulation && target && raw!==null)this.articulation.press(identity,target,this.grader!.acceptedTargetIndex(),raw,offsetMs);
  }
  observeKeyRelease(identity:string,event:InputEventMetadata|undefined):void {
    const raw=this.physicalTime(event);if(this.articulation && raw!==null)this.articulation.release(identity,raw);
  }

  handleNoteOff(midi: number): void {
    this.audio.noteOff(midi);
  }

  /** Mic-detected note: always sounds, but still feeds the grader. */
  handleMicNote(midi: number): void {
    const grading = this.grader;
    this.gradeInput(midi);
    // The final accepted note may finish grading and cancel audio. Do not
    // start a new feedback voice after that cancellation.
    if (!grading || this.grader) this.audio.noteOn({ midi, startSec: 0, durSec: 0.35, vel: 90, hand: "R" });
    // Microphone input does not update pressedKeys in the React owner; emit a
    // snapshot so wait-note progress and other grading UI re-render immediately.
    this.emit();
  }

  /** Both input sources advance wait targets even without a UI reading waitNote. */
  private gradeInput(midi: number, event?: InputEventMetadata, offsetMs = 0): boolean {
    if (!this.grader) return true;
    const target = this.grader.currentWait;
    let raw = this.time;
    if (event) {
      if (!Number.isFinite(event.timestampMs) || event.timestampMs < this.inputBoundaryMs || event.timestampMs > this.monotonicNow() + 1) return false;
      if (this.playing && !this.waitMode) raw = this.inputClock.time + (event.timestampMs - this.inputClock.ms) / 1000;
    }
    const offset = target ? 0 : Math.min(250, Math.max(-250, Number.isFinite(offsetMs) ? offsetMs : 0));
    if (!this.grader.play(midi, raw - offset / 1000, { rawSec: raw, offsetMs: offset })) return false;
    if (target) {
      const next = this.grader.currentWait;
      const accepted = this.grader.lastAccepted() ?? target;
      this.time = Math.min(this.gradingRange?.endSec ?? this.duration,
        Math.max(this.time, next?.startSec ?? accepted.startSec + accepted.durSec));
      this.lastScheduled = this.time;
      if (this.gradingRange && !next) this.finishGrading();
      else if (!this.playing) this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    }
    return true;
  }

  get waitNote(): TimedNote | null {
    return this.grader?.currentWait ?? null;
  }

  get waitNotes(): TimedNote[] {
    return this.grader?.currentWaitGroup ?? [];
  }

  /** Build the bounded audible event list used by the player's preview button. */
  previewPlan(startSec: number, endSec: number): PlaybackPreviewPlan {
    const start = Math.max(0, Math.min(this.duration, startSec));
    const end = Math.max(start, Math.min(this.duration, endSec));
    if (end <= start + 1e-6) return { notes: [], chords: [] };

    const notes = this.notes.flatMap((note) => {
      if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) return [];
      const noteEnd = note.startSec + note.durSec;
      const visibleStart = Math.max(start, note.startSec);
      const visibleEnd = Math.min(end, noteEnd);
      if (visibleEnd <= visibleStart + 1e-6) return [];
      return [{
        when: visibleStart - start,
        note: {
          ...note,
          startSec: visibleStart - start,
          durSec: visibleEnd - visibleStart,
        },
      }];
    });

    const chords: PlaybackPreviewPlan["chords"] = [];
    let active = -1;
    for (let index = 0; index < this.chords.length; index++) {
      const chord = this.chords[index]!;
      const chordStart = beatToSec(chord.beat, this.song.tempoBpm, this.settings.speed);
      if (chordStart > start + 1e-6) break;
      const chordEnd = chordStart + this.chordDurationSec(chord);
      if (this.isPlayable(chord) && start < chordEnd - 1e-6) active = index;
    }
    const addChord = (chord: ChordPlaybackLabel): void => {
      const chordStart = beatToSec(chord.beat, this.song.tempoBpm, this.settings.speed);
      const visibleStart = Math.max(start, chordStart);
      const visibleEnd = Math.min(end, chordStart + this.chordDurationSec(chord));
      const durationSec = visibleEnd - visibleStart;
      const notes = this.chordMidiNotes(chord);
      if (!notes.length || durationSec <= 1e-6) return;
      chords.push({ notes, when: visibleStart - start, durationSec });
    };
    if (active >= 0) addChord(this.chords[active]!);
    for (let index = Math.max(0, active + 1); index < this.chords.length; index++) {
      const chord = this.chords[index]!;
      const chordStart = beatToSec(chord.beat, this.song.tempoBpm, this.settings.speed);
      if (chordStart < start - 1e-6) continue;
      if (chordStart >= end - 1e-6) break;
      addChord(chord);
    }
    return { notes, chords };
  }

  private schedule(from: number, to: number): void {
    const endpoint = this.scheduleEndpoint();
    to = Math.min(to, endpoint);
    from = Math.max(from, this.lastScheduled);
    if (to <= from) return;
    const chordMode = this.settings.backgroundMode === "chord" && this.hasPlayableChord() && !!this.audio.playChord;
    if (chordMode) this.scheduleChords(from, to);
    let i = firstNoteAtOrAfter(this.notes, from);
    for (; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.startSec >= to) break;
      if (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127) continue;
      const durSec = Math.min(n.durSec, endpoint - n.startSec);
      if (durSec > 0) this.audio.noteOn(durSec === n.durSec ? n : { ...n, durSec }, Math.max(0, n.startSec - this.time));
    }
    // The metronome follows the song timeline in either background mode.
    if (this.settings.metronome) {
      const beat = 60 / this.song.tempoBpm / this.settings.speed;
      const perMeasure = beatsPerMeasure(this.song.timeSig);
      const clickBeats = new Set<number>();
      for (let beatIndex = Math.ceil(from / beat); beatIndex < to / beat; beatIndex += 1) clickBeats.add(beatIndex);
      for (const startBeat of this.song.measureStarts ?? []) {
        if (Number.isFinite(startBeat) && startBeat >= from / beat - 1e-6 && startBeat < to / beat) clickBeats.add(startBeat);
      }
      for (const beatIndex of [...clickBeats].sort((left, right) => left - right)) {
        const t = beatIndex * beat;
        const sourceDownbeat = this.song.measureStarts?.some((startBeat) => Math.abs(startBeat - beatIndex) <= 1e-6);
        this.audio.metronomeClick(
          (sourceDownbeat ?? (beatIndex % perMeasure === 0)) ? 0 : 1,
          Math.max(0, t - this.time),
        );
      }
    }
    this.lastScheduled = to;
  }

  private scheduleChords(from: number, to: number): void {
    const playChord = this.audio.playChord;
    if (!playChord || this.chords.length === 0) return;
    const speed = this.settings.speed;
    const chordAt = (chord: ChordLabel) => beatToSec(chord.beat, this.song.tempoBpm, speed);

    // When starting or seeking into the middle of a song, sound the chord that
    // is already active at the playhead before scheduling future changes.
    let cursor = this.lastChordScheduled;
    if (cursor < 0) {
      let active = -1;
      for (let i = 0; i < this.chords.length; i++) {
        const chord = this.chords[i]!;
        if (chordAt(chord) > from + 1e-6) break;
        if (this.isPlayable(chord) && from < chordAt(chord) + this.chordDurationSec(chord) - 1e-6) active = i;
      }
      if (active >= 0) {
        this.playChord(this.chords[active]!, from);
        cursor = active;
      }
    }

    for (let i = cursor + 1; i < this.chords.length; i++) {
      const chord = this.chords[i]!;
      const eventSec = chordAt(chord);
      if (eventSec < from - 1e-6) {
        cursor = i;
        continue;
      }
      if (eventSec >= to) break;
      if (this.isPlayable(chord)) this.playChord(chord, eventSec);
      cursor = i;
    }
    this.lastChordScheduled = cursor;
  }

  private playChord(chord: ChordPlaybackLabel, startSec: number): void {
    const playChord = this.audio.playChord;
    const midiNotes = this.chordMidiNotes(chord);
    if (!playChord || midiNotes.length === 0) return;
    // Chord labels carry absolute MIDI notes. Keep inversions and octave
    // doublings, while making ordering deterministic and collapsing only
    // exact duplicate MIDI numbers (the audio contract has no voice identity).
    const chordEndSec = beatToSec(chord.beat, this.song.tempoBpm, this.settings.speed) + this.chordDurationSec(chord);
    const durationSec = Math.min(chordEndSec, this.scheduleEndpoint()) - startSec;
    if (durationSec > 1e-6) {
      playChord.call(this.audio, midiNotes, Math.max(0, startSec - this.time), durationSec);
    }
  }

  private scheduleEndpoint(): number {
    return Math.min(this.duration, this.grader
      ? this.gradingRange?.endSec ?? this.duration
      : this.loop?.endSec ?? this.duration);
  }

  private chordMidiNotes(chord: ChordPlaybackLabel): number[] {
    if (!this.isPlayable(chord)) return [];
    const transposed = chord.notes.map((midi) => midi + this.settings.transpose)
      .filter((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127);
    return [...new Set(transposed)].sort((a, b) => a - b);
  }

  private chordDurationSec(chord: ChordPlaybackLabel): number {
    return chord.durationBeats !== undefined
      ? beatToSec(chord.durationBeats, this.song.tempoBpm, this.settings.speed)
      : DEFAULT_CHORD_DURATION_SEC;
  }

  private isPlayable(chord: ChordPlaybackLabel): boolean {
    return Array.isArray(chord.notes) && chord.notes.some((note) => Number.isInteger(note) && note >= 0 && note <= 127);
  }

  private hasPlayableChord(): boolean {
    return this.chords.some((chord) => this.isPlayable(chord));
  }

  /**
   * New provenance-aware events get beat spans before reaching audio. Legacy
   * events are intentionally left untouched so their fixed wall-clock
   * fallback remains a compatibility path only.
   */
  private normalizeChordTimeline(chords: ChordPlaybackLabel[]): ChordPlaybackLabel[] {
    const known = chords.filter((chord) => chord.sourceKind !== undefined);
    const legacy = chords.filter((chord) => chord.sourceKind === undefined);
    const durationBeats = this.duration / secPerBeat(this.song.tempoBpm, this.settings.speed);
    const completed = completeChordDurations(known, durationBeats);
    return [...completed, ...legacy].sort((a, b) => a.beat - b.beat);
  }

  private emit(): void {
    this.onChange?.({ time: this.time, playing: this.playing });
  }
}
