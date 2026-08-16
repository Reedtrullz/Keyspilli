import { Grader, type GradeResult } from "./grading.js";
import { beatToSec, beatsPerMeasure, firstNoteAtOrAfter, type LoopRegion, type TimedNote } from "./timeline.js";
import type { ChordLabel } from "@keyspilli/midi";
import type { PlayerSettings } from "./types.js";

/** How far ahead of the playhead notes are scheduled. */
const SCHEDULE_LOOKAHEAD = 0.12;
/** Legacy fallback span for chord events without an explicit duration. */
const DEFAULT_CHORD_DURATION_SEC = 1.2;

/** Minimal audio surface the engine needs (AudioEngine satisfies this). */
export interface AudioLike {
  ensure(): unknown;
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
}

type ChordPlaybackLabel = ChordLabel & { durationBeats?: number };

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
  /** Assigned by the owner whenever settings change. */
  settings: PlayerSettings;
  /** Optional beat-based source timeline used by chord background mode. */
  chords: ChordPlaybackLabel[];
  /** Assigned by the owner whenever wait mode toggles. */
  waitMode = false;
  onChange: ((snap: EngineSnapshot) => void) | null = null;

  private lastScheduled = 0;
  private lastChordScheduled = -1;

  constructor(
    public readonly audio: AudioLike,
    public notes: TimedNote[],
    public duration: number,
    private readonly song: EngineSongMeta,
    settings: PlayerSettings,
    chords: ChordPlaybackLabel[] = [],
  ) {
    this.settings = settings;
    this.chords = chords;
  }

  start(): void {
    if (this.playing) return;
    this.audio.ensure();
    this.playing = true;
    this.lastScheduled = this.time;
    this.lastChordScheduled = -1;
    this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    this.emit();
  }

  stop(): void {
    if (!this.playing && !this.grader) return;
    this.playing = false;
    this.audio.cancelAll();
    this.lastChordScheduled = -1;
    this.emit();
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.audio.cancelAll();
    this.time = Math.max(0, Math.min(this.duration, t));
    this.lastScheduled = this.time;
    this.lastChordScheduled = -1;
    if (wasPlaying) this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    this.emit();
  }

  /** Advance by dt seconds (called from the owner's rAF loop). */
  tick(dt: number): void {
    if (!this.playing) return;
    const next = this.time + dt;
    if (this.loop && next > this.loop.endSec) {
      this.time = this.loop.startSec;
      this.audio.cancelAll();
      this.lastScheduled = this.time;
      this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    } else {
      this.time = next;
    }
    if (this.time >= this.duration && !this.loop) {
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
    this.notes = notes;
    this.duration = duration;
    // Mid-playback note changes (speed/transpose/hand) reschedule from now.
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
    this.chords = chords;
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
    this.audio.sustainPedal = settings.sustainPedal;
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
  }

  setLoop(region: LoopRegion | null): void {
    this.loop = region;
  }

  /** Toggle wait mode for an active run and keep the grader in sync. */
  setWaitMode(wait: boolean): void {
    this.waitMode = wait;
    this.grader?.setWaitMode(wait);
    this.emit();
  }

  startGrading(wait: boolean): void {
    this.waitMode = wait;
    this.stop();
    this.seek(0);
    // Skip grace notes and ornaments: they're decoration, not the content
    // being practiced. Hand filtering already happened in the notes memo.
    const minDurSec = 0.25 * (60 / this.song.tempoBpm / this.settings.speed);
    const gradeable = this.notes.filter((n) => n.durSec >= minDurSec);
    this.grader = new Grader(gradeable, { waitMode: wait, bpm: this.song.tempoBpm });
    this.emit();
  }

  finishGrading(): GradeResult | null {
    if (!this.grader) {
      this.waitMode = false;
      this.emit();
      return null;
    }
    const result = this.grader.result();
    this.grader = null;
    this.waitMode = false;
    this.emit();
    return result;
  }

  /** Input-driven note (keyboard/MIDI). Returns false when the grader rejects it. */
  handleNoteOn(midi: number): boolean {
    if (this.grader && !this.grader.play(midi, this.time)) return false;
    this.audio.noteOn({ midi, startSec: 0, durSec: 0.4, vel: 100, hand: "R" });
    this.emit();
    return true;
  }

  handleNoteOff(midi: number): void {
    this.audio.noteOff(midi);
  }

  /** Mic-detected note: always sounds, but still feeds the grader. */
  handleMicNote(midi: number): void {
    if (this.grader) this.grader.play(midi, this.time);
    this.audio.noteOn({ midi, startSec: 0, durSec: 0.35, vel: 90, hand: "R" });
    // Microphone input does not update pressedKeys in the React owner; emit a
    // snapshot so wait-note progress and other grading UI re-render immediately.
    this.emit();
  }

  get waitNote(): TimedNote | null {
    return this.grader?.currentWait ?? null;
  }

  private schedule(from: number, to: number): void {
    from = Math.max(from, this.lastScheduled);
    const chordMode = this.settings.backgroundMode === "chord" && this.chords.length > 0 && !!this.audio.playChord;
    if (chordMode) this.scheduleChords(from, to);
    let i = firstNoteAtOrAfter(this.notes, from);
    for (; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.startSec >= to) break;
      if (n.hand === "L" && chordMode) continue;
      this.audio.noteOn(n, Math.max(0, n.startSec - this.time));
    }
    // A missing source timeline falls back to the piano background, including
    // its metronome behaviour, rather than silently muting the left hand.
    if (this.settings.metronome && !chordMode) {
      const beat = 60 / this.song.tempoBpm / this.settings.speed;
      const perMeasure = beatsPerMeasure(this.song.timeSig);
      for (let t = Math.ceil(from / beat) * beat; t < to; t += beat) {
        const beatIndex = Math.round(t / beat);
        this.audio.metronomeClick(
          beatIndex % perMeasure === 0 ? 0 : 1,
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
        if (chordAt(this.chords[i]!) <= from + 1e-6) active = i;
        else break;
      }
      if (active >= 0) {
        this.playChord(this.chords[active]!, 0);
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
      this.playChord(chord, Math.max(0, eventSec - this.time));
      cursor = i;
    }
    this.lastChordScheduled = cursor;
  }

  private playChord(chord: ChordPlaybackLabel, when: number): void {
    const playChord = this.audio.playChord;
    if (!playChord || chord.notes.length === 0) return;
    const transposed = chord.notes.map((midi) => midi + this.settings.transpose);
    // Chord labels carry absolute MIDI notes. Keep inversions and octave
    // doublings, while making ordering deterministic and collapsing only
    // exact duplicate MIDI numbers (the audio contract has no voice identity).
    const midiNotes = [...new Set(transposed)].sort((a, b) => a - b);
    if (midiNotes.length === 0) return;
    const durationSec = chord.durationBeats !== undefined
      ? beatToSec(chord.durationBeats, this.song.tempoBpm, this.settings.speed)
      : DEFAULT_CHORD_DURATION_SEC;
    playChord.call(this.audio, midiNotes, when, durationSec);
  }

  private emit(): void {
    this.onChange?.({ time: this.time, playing: this.playing });
  }
}
