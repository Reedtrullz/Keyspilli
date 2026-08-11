import { Grader, type GradeResult } from "./grading.js";
import { beatsPerMeasure, firstNoteAtOrAfter, type LoopRegion, type TimedNote } from "./timeline.js";
import type { PlayerSettings } from "./types.js";

/** How far ahead of the playhead notes are scheduled. */
const SCHEDULE_LOOKAHEAD = 0.12;

/** Minimal audio surface the engine needs (AudioEngine satisfies this). */
export interface AudioLike {
  ensure(): unknown;
  noteOn(n: TimedNote, when?: number): void;
  noteOff(midi: number): void;
  metronomeClick(beat: number, when?: number): void;
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
  /** Assigned by the owner whenever wait mode toggles. */
  waitMode = false;
  onChange: ((snap: EngineSnapshot) => void) | null = null;

  private lastScheduled = 0;

  constructor(
    public readonly audio: AudioLike,
    public notes: TimedNote[],
    public duration: number,
    private readonly song: EngineSongMeta,
    settings: PlayerSettings,
  ) {
    this.settings = settings;
  }

  start(): void {
    if (this.playing) return;
    this.audio.ensure();
    this.playing = true;
    this.lastScheduled = this.time;
    this.schedule(this.time, this.time + SCHEDULE_LOOKAHEAD);
    this.emit();
  }

  stop(): void {
    if (!this.playing && !this.grader) return;
    this.playing = false;
    this.audio.cancelAll();
    this.emit();
  }

  seek(t: number): void {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.lastScheduled = this.time;
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
    if (this.playing) this.lastScheduled = this.time;
  }

  setLoop(region: LoopRegion | null): void {
    this.loop = region;
  }

  startGrading(wait: boolean): void {
    this.waitMode = wait;
    this.stop();
    this.seek(0);
    // Skip grace notes and ornaments: they're decoration, not the content
    // being practiced. Hand filtering already happened in the notes memo.
    const minDurSec = 0.125 * (60 / this.song.tempoBpm / this.settings.speed);
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
  }

  get waitNote(): TimedNote | null {
    return this.grader?.currentWait ?? null;
  }

  private schedule(from: number, to: number): void {
    from = Math.max(from, this.lastScheduled);
    let i = firstNoteAtOrAfter(this.notes, from);
    for (; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.startSec >= to) break;
      if (n.hand === "L" && this.settings.backgroundMode !== "piano") continue;
      this.audio.noteOn(n, Math.max(0, n.startSec - this.time));
    }
    if (this.settings.metronome && this.settings.backgroundMode !== "chord") {
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

  private emit(): void {
    this.onChange?.({ time: this.time, playing: this.playing });
  }
}
