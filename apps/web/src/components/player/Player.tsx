"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AudioEngine,
  ChordGrader,
  completeChordDurations,
  dedupeChords,
  KeyboardInput,
  MidiInput,
  PlaybackEngine,
  loadJson,
  loadSettings,
  measureIndex,
  measureMidiRange,
  resolveTimedNotes,
  saveJson,
  saveSettings,
  secPerBeat,
  DEFAULT_SETTINGS,
  type LoopRegion,
  type ChordPracticeSnapshot,
  type PlayerSettings,
  type ViewMode,
  type SongData,
} from "@keyspilli/player-core";
import type { SongRow } from "@keyspilli/catalog";
import { FallingCanvas } from "./FallingCanvas";
import { ChordStrip } from "./ChordStrip";
import { ChordPracticePanel } from "./ChordPracticePanel";
import { buildChordPracticeTargets, selectPracticeChords } from "./chord-practice";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";
import { SheetMusicView } from "./SheetMusicView";
import { SettingsDialog } from "./SettingsDialog";
import { DownloadDialog } from "./DownloadDialog";
import { GradingPanel } from "./GradingPanel";
import {
  resolveChordSources,
  selectChordSource,
  type ChordSourceId,
} from "./chord-sources";

export interface PlayerDetail {
  song: SongRow;
  data: SongData;
  variants: SongRow[];
}

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: "falling", label: "Fall Down", hint: "Notes fall onto the keyboard" },
  { id: "beginner", label: "Beginner", hint: "Big colored notes + letters" },
  { id: "sheet", label: "Sheet Music", hint: "Engraved score" },
  { id: "leadsheet", label: "Lead Sheet", hint: "Lyrics + chords" },
];

/** Pressed keys drop if their noteOff was lost (common with USB-MIDI). */
const GHOST_KEY_TIMEOUT_MS = 5000;
const TEMPO_SEMANTICS_NOTICE_KEY = "keyspilli.tempo-semantics.v1";

export function Player({ initial, mode }: { initial: PlayerDetail; mode: ViewMode | null }) {
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    const s = loadSettings();
    if (mode) s.mode = mode;
    return s;
  });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [showTempoSemanticsNotice, setShowTempoSemanticsNotice] = useState(false);
  const [grading, setGrading] = useState(false);
  const [chordPracticeActive, setChordPracticeActive] = useState(false);
  const [modeMenuIdx, setModeMenuIdx] = useState(-1);
  const [chordPracticeSnapshot, setChordPracticeSnapshot] = useState<ChordPracticeSnapshot | null>(null);
  const [waitMode, setWaitMode] = useState(false);
  const [gradeResult, setGradeResult] = useState<{ summary: string; accuracyPct: number; hit: number; missed: number; wrong: number; late: number; total: number } | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Map<number, number>>(new Map());
  const [midiConnected, setMidiConnected] = useState(false);
  const [songKeyLabel, setSongKeyLabel] = useState(initial.data.key);
  const [favorites, setFavorites] = useState<string[]>(() => loadJson("keyspilli.favorites", [] as string[]));
  const [learned, setLearned] = useState<string[]>(() => loadJson("keyspilli.learned", [] as string[]));
  const [chordSourcePreference, setChordSourcePreference] = useState<ChordSourceId>(() => {
    const value = loadJson("keyspilli.chordSource", "auto" as ChordSourceId);
    return value === "ug" || value === "generated" || value === "auto" ? value : "auto";
  });

  // Tempo semantics changed from rewriting beat coordinates to controlling
  // playback speed. Keep acknowledgement in versioned UI state so a future
  // semantics change can show a new notice without touching artifact data.
  useEffect(() => {
    setShowTempoSemanticsNotice(loadJson<boolean>(TEMPO_SEMANTICS_NOTICE_KEY, false) !== true);
  }, []);

  function dismissTempoSemanticsNotice() {
    saveJson(TEMPO_SEMANTICS_NOTICE_KEY, true);
    setShowTempoSemanticsNotice(false);
  }

  const engineRef = useRef<PlaybackEngine | null>(null);
  const chordPracticeRef = useRef<ChordGrader | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const chordPracticeActiveRef = useRef(chordPracticeActive);
  const skipChordPracticeRef = useRef(skipChordPractice);
  const hearChordPracticeRef = useRef(hearChordPractice);

  useEffect(() => { chordPracticeActiveRef.current = chordPracticeActive; }, [chordPracticeActive]);
  useEffect(() => { skipChordPracticeRef.current = skipChordPractice; }, [skipChordPractice]);
  useEffect(() => { hearChordPracticeRef.current = hearChordPractice; }, [hearChordPractice]);

  const notes = useMemo(
    () =>
      resolveTimedNotes(initial.data, settings.speed, settings.transpose).filter((n) => {
        if (settings.hand === "L") return n.hand === "L";
        if (settings.hand === "R") return n.hand === "R";
        return true;
      }),
    [initial.data, settings.speed, settings.transpose, settings.hand],
  );

  const duration = useMemo(() => notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 8), [notes]);

  const chordSources = useMemo(() => {
    const resolved = resolveChordSources(initial.data);
    const arrangementEnd = Math.max(
      initial.data.notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
      initial.data.measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0),
    );
    return {
      ...resolved,
      // Keep the established inferred-chord naming/cleanup path unchanged;
      // only source timelines bypass relabeling so their provenance is visible.
      // Normalize through the generated source first. This stamps legacy
      // generated events with sourceKind=generated while preserving explicit
      // authored/inferred/unknown metadata on newer artifacts.
      generated: {
        ...resolved.generated,
        chords: completeChordDurations(dedupeChords(resolved.generated.chords, { durationBeats: arrangementEnd }), arrangementEnd),
      },
    };
  }, [initial.data]);
  const selectedChordSource = useMemo(
    () => selectChordSource(chordSources, chordSourcePreference),
    [chordSources, chordSourcePreference],
  );
  // Existing artifacts still carry per-grid-slice chord spam; collapse runs of
  // the same chord before rendering. (New ingests dedupe in chordsAt.) The
  // source timeline keeps its supplied names/voicings intact.
  const chords = useMemo(
    () => selectedChordSource.source?.chords ?? [],
    [selectedChordSource.source],
  );
  const currentMeasure = measureIndex(
    time,
    initial.data.tempoBpm,
    settings.speed,
    initial.data.timeSig,
    initial.data.measures.length,
  );
  const chordPracticeTargets = useMemo(
    () => buildChordPracticeTargets(selectPracticeChords(chords, initial.data.measures, currentMeasure), settings.transpose),
    [chords, initial.data.measures, currentMeasure, settings.transpose],
  );
  // Playback applies transpose inside PlaybackEngine. Keep the visual chord
  // keys in the same transposed coordinate space as the falling notes without
  // feeding already-transposed values back into the audio scheduler.
  const visualChords = useMemo(
    () => chords.map((c) => ({ ...c, notes: c.notes.map((midi) => midi + settings.transpose) })),
    [chords, settings.transpose],
  );

  useEffect(() => {
    if (!chordPracticeActive) return;
    const session = new ChordGrader(chordPracticeTargets);
    chordPracticeRef.current = session;
    setChordPracticeSnapshot(session.snapshot());
  }, [chordPracticeActive, chordPracticeTargets]);

  // Keyboard range is stable per measure so the piano doesn't re-center every
  // frame; empty measures keep the previous range.
  const lastMidiRangeRef = useRef({ lowMidi: 45, highMidi: 99 });
  const midiRange = useMemo<{ lowMidi: number; highMidi: number }>(() => {
    if (settings.showAllKeys) {
      return { lowMidi: 21, highMidi: 108 };
    }
    const r = measureMidiRange(
      notes,
      initial.data.measures,
      initial.data.tempoBpm,
      settings.speed,
      currentMeasure,
      lastMidiRangeRef.current,
    );
    lastMidiRangeRef.current = r;
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, settings.speed, currentMeasure, settings.showAllKeys]);

  // Engine lifecycle: one PlaybackEngine per mount, disposed on unmount.
  useEffect(() => {
    const engine = new PlaybackEngine(
      new AudioEngine(),
      notes,
      duration,
      { tempoBpm: initial.data.tempoBpm, timeSig: initial.data.timeSig },
      settings,
      chords,
    );
    engine.onChange = (snap) => {
      setTime(snap.time);
      setPlaying(snap.playing);
    };
    engine.audio.sustainPedal = settings.sustainPedal;
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.audio.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    engineRef.current?.setNotes(notes, duration);
  }, [notes, duration]);

  useEffect(() => {
    engineRef.current?.setChords(chords);
  }, [chords]);

  useEffect(() => {
    engineRef.current?.setLoop(loop);
  }, [loop]);

  useEffect(() => {
    engineRef.current?.setWaitMode(waitMode);
  }, [waitMode]);

  // Main rAF loop. The engine owns playback state; this just feeds it dt.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const eng = engineRef.current;
      if (!eng) return;
      eng.tick(dt);
      if (eng.playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startPlayback = useCallback(() => {
    if (chordPracticeActive) return;
    engineRef.current?.start();
    void fetch(`/api/songs/${initial.song.id}/play`, { method: "POST" });
  }, [chordPracticeActive, initial.song.id]);

  const stopPlayback = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const seek = useCallback((t: number) => {
    engineRef.current?.seek(t);
  }, []);

  function togglePlay() {
    if (playing) stopPlayback();
    else startPlayback();
  }
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  // Keyboard + MIDI input (one keydown listener; Escape handled first).
  useEffect(() => {
    const ki = new KeyboardInput({
      onNoteOn: (m) => handleNote(m, true),
      onNoteOff: (m) => handleNote(m, false),
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowModeMenu(false);
        setShowSettings(false);
        setShowDownload(false);
      } else if (e.key === " " && e.type === "keydown") {
        // Space = play/pause, but never hijack typing or focused controls.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.tagName === "BUTTON" || t.isContentEditable)) return;
        e.preventDefault();
        togglePlayRef.current();
      } else if (chordPracticeActiveRef.current) {
        // Chord practice shortcuts
        if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          skipChordPracticeRef.current?.();
        } else if (e.key === "h" || e.key === "H") {
          e.preventDefault();
          hearChordPracticeRef.current?.();
        }
      } else {
        ki.handleKey(e);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const mi = new MidiInput({
      onNoteOn: (m) => handleNote(m, true),
      onNoteOff: (m) => handleNote(m, false),
    });
    void mi.connect().then(setMidiConnected);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      mi.disconnect();
    };
  }, []);

  // Outside-click closes the mode menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (showModeMenu && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showModeMenu]);

  // Reset mode menu index when menu opens/closes.
  useEffect(() => {
    if (!showModeMenu) {
      setModeMenuIdx(-1);
    } else {
      setModeMenuIdx(MODES.findIndex((m) => m.id === settings.mode));
    }
  }, [showModeMenu, settings.mode]);


  function handleModeMenuKey(e: React.KeyboardEvent) {
    if (!showModeMenu) return;
    const len = MODES.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setModeMenuIdx((i) => (i + 1) % len);
        break;
      case "ArrowUp":
        e.preventDefault();
        setModeMenuIdx((i) => (i - 1 + len) % len);
        break;
      case "Home":
        e.preventDefault();
        setModeMenuIdx(0);
        break;
      case "End":
        e.preventDefault();
        setModeMenuIdx(len - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (modeMenuIdx >= 0) {
          const m = MODES[modeMenuIdx]!;
          updateSettings({ mode: m.id });
          setShowModeMenu(false);
          const modePath = m.id === "falling" ? "" : `/${m.id}`;
          window.history.replaceState(null, "", `/player/${initial.song.id}${modePath}`);
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowModeMenu(false);
        break;
    }
  }


  // Sweep pressed keys whose noteOff never arrived.
  useEffect(() => {
    const id = setInterval(() => {
      setPressedKeys((m) => {
        const now = performance.now();
        const next = new Map<number, number>();
        let changed = false;
        for (const [midi, at] of m) {
          if (now - at < GHOST_KEY_TIMEOUT_MS) next.set(midi, at);
          else changed = true;
        }
        return changed ? next : m;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  function handleNote(midi: number, on: boolean) {
    const eng = engineRef.current;
    if (!eng) return;
    if (!on) {
      eng.handleNoteOff(midi);
      setPressedKeys((s) => {
        const n = new Map(s);
        n.delete(midi);
        return n;
      });
      return;
    }
    if (!eng.handleNoteOn(midi)) return;
    if (chordPracticeRef.current) {
      chordPracticeRef.current.play(midi);
      setChordPracticeSnapshot(chordPracticeRef.current.snapshot());
    }
    setPressedKeys((s) => new Map(s).set(midi, performance.now()));
  }

  function handleMicNote(midi: number) {
    // Current pitch detection is monophonic, so microphone input remains a
    // note-practice feature and is intentionally not used to grade chords.
    if (!chordPracticeRef.current) engineRef.current?.handleMicNote(midi);
  }

  function toggleLoop() {
    if (loop) {
      setLoop(null);
      return;
    }
    const startBeat = initial.data.measures[currentMeasure]?.startBeat ?? 0;
    const measureBeats = initial.data.timeSig[0] * (4 / initial.data.timeSig[1]);
    const startSec = startBeat * secPerBeat(initial.data.tempoBpm, settings.speed);
    const endSec = (startBeat + 4 * measureBeats) * secPerBeat(initial.data.tempoBpm, settings.speed);
    setLoop({ startSec, endSec });
  }

  function seekToMeasure(i: number) {
    const m = initial.data.measures[i];
    if (m) seek(m.startBeat * secPerBeat(initial.data.tempoBpm, settings.speed));
  }

  function toggleFavorite() {
    const id = initial.song.id;
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    saveJson("keyspilli.favorites", next);
  }

  function toggleLearned() {
    const id = initial.song.id;
    const next = learned.includes(id) ? learned.filter((f) => f !== id) : [...learned, id];
    setLearned(next);
    saveJson("keyspilli.learned", next);
  }

  function updateSettings(p: Partial<PlayerSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    engineRef.current?.audio.setGains(next.voiceGain, next.pianoGain);
    if (engineRef.current) engineRef.current.audio.sustainPedal = next.sustainPedal;
    saveSettings(next);
  }

  function updateChordSource(source: ChordSourceId) {
    setChordSourcePreference(source);
    saveJson("keyspilli.chordSource", source);
  }

  function startGrading(wait: boolean) {
    if (chordPracticeActive) exitChordPractice();
    setWaitMode(wait);
    setGrading(true);
    setGradeResult(null);
    engineRef.current?.startGrading(wait);
    if (!wait) startPlayback();
  }

  function finishGrading() {
    const result = engineRef.current?.finishGrading();
    if (result) setGradeResult(result);
    setGrading(false);
    setWaitMode(false);
  }

  function startChordPractice() {
    if (grading) finishGrading();
    engineRef.current?.stop();
    const session = new ChordGrader(chordPracticeTargets);
    chordPracticeRef.current = session;
    setChordPracticeActive(true);
    setChordPracticeSnapshot(session.snapshot());
  }

  function exitChordPractice() {
    chordPracticeRef.current = null;
    setChordPracticeActive(false);
    setChordPracticeSnapshot(null);
  }

  function skipChordPractice() {
    const session = chordPracticeRef.current;
    if (!session) return;
    session.skip();
    setChordPracticeSnapshot(session.snapshot());
  }

  function hearChordPractice() {
    const target = chordPracticeRef.current?.currentTarget;
    const audio = engineRef.current?.audio;
    if (!target || !audio?.playChord) return;
    audio.ensure();
    audio.playChord(target.notes, 0, 1.5);
  }

  const waitNote = grading && waitMode ? engineRef.current?.waitNote : null;
  const activeModeLabel = MODES.find((m) => m.id === settings.mode)?.label ?? settings.mode;
  const chordModeBadge = settings.backgroundMode !== "chord"
    ? null
    : selectedChordSource.source
      ? selectedChordSource.fallback && selectedChordSource.source.id === "generated"
        ? "Generated fallback"
        : selectedChordSource.source.label
      : "Piano fallback";
  const currentBeat = time / secPerBeat(initial.data.tempoBpm, settings.speed);
  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold leading-tight truncate max-w-[70vw]" title={initial.song.title}>{initial.song.title}</h1>
          <div className="text-sm text-zinc-500">by {initial.song.artist}</div>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.key}</span>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.difficulty}</span>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.tempo} BPM</span>
          {settings.backgroundMode === "chord" && (
            <span
              className={`px-2 py-1 rounded-full font-medium ${selectedChordSource.fallback ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}
              data-testid="chord-mode-status"
              role="status"
              title={selectedChordSource.fallbackReason ?? selectedChordSource.source?.provenance ?? undefined}
            >
              {chordModeBadge}
            </span>
          )}
          {midiConnected && <span className="px-2 py-1 rounded-full bg-green-100 text-green-800">MIDI connected</span>}
        </div>
      </div>

      {showTempoSemanticsNotice && (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" role="status">
          <div className="flex items-start gap-3">
            <p className="flex-1">
              Practice tempo changes playback speed only and preserve the arrangement&apos;s beat coordinates. Source tempo
              corrections are a separate maintainer calibration/rebuild action.
            </p>
            <button onClick={dismissTempoSemanticsNotice} className="shrink-0 rounded-lg border border-indigo-300 px-2 py-1 text-xs font-medium hover:bg-indigo-100">
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" ref={modeMenuRef}>
          <button
            onClick={() => setShowModeMenu((s) => !s)}
            className="min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            onKeyDown={handleModeMenuKey}
            aria-expanded={showModeMenu}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{MODES.find((m) => m.id === settings.mode)?.label}</span>
          </button>
          {showModeMenu && (
            <div className="absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2" role="menu"
              onKeyDown={handleModeMenuKey}
              aria-activedescendant={modeMenuIdx >= 0 ? `mode-menu-${MODES[modeMenuIdx]!.id}` : undefined}
              tabIndex={-1}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="menuitemradio"
                  id={`mode-menu-${m.id}`}
                  tabIndex={-1}
                  aria-checked={settings.mode === m.id}
                  onClick={() => {
                    updateSettings({ mode: m.id });
                    setShowModeMenu(false);
                    const modePath = m.id === "falling" ? "" : `/${m.id}`;
                    window.history.replaceState(null, "", `/player/${initial.song.id}${modePath}`);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100"
                >
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-zinc-500">{m.hint}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1" role="group" aria-label="Hands">
          {(["L", "R", "both"] as const).map((h) => (
            <button
              key={h}
              onClick={() => updateSettings({ hand: h })}
              aria-pressed={settings.hand === h}
              className={`min-w-11 min-h-11 px-3 py-2 rounded-full text-sm border ${settings.hand === h ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
            >
              {h === "both" ? "All" : h}
            </button>
          ))}
        </div>

        <button
          onClick={() => updateSettings({ chordKeys: !settings.chordKeys })}
          aria-pressed={settings.chordKeys}
          className={`min-h-11 px-3 py-2 rounded-full text-sm border ${settings.chordKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
        >
          Chord Keys
        </button>
        <button
          onClick={() => updateSettings({ metronome: !settings.metronome })}
          aria-pressed={settings.metronome}
          className={`min-h-11 px-3 py-2 rounded-full text-sm border ${settings.metronome ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
        >
          Metronome
        </button>
        <button
          onClick={() => updateSettings({ showAllKeys: !settings.showAllKeys })}
          aria-pressed={settings.showAllKeys}
          className={`min-h-11 px-3 py-2 rounded-full text-sm border ${settings.showAllKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
        >
          88 Keys
        </button>

        <div className="ml-auto flex flex-wrap justify-end gap-2 text-sm">
          <button onClick={() => setShowDownload(true)} className="min-h-11 px-4 py-2 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700" aria-label="Download sheet music and MIDI">
            Download Sheet &amp; MIDI
          </button>
          <button onClick={() => setShowSettings(true)} className="min-h-11 px-4 py-2 rounded-full border border-zinc-300 font-medium hover:bg-zinc-100" aria-label="Open settings">
            Settings
          </button>
          <button
            onClick={() => grading ? finishGrading() : startGrading(false)}
            className={`min-h-11 px-4 py-2 rounded-full border font-medium ${grading ? "bg-amber-100 border-amber-300" : "border-zinc-300 hover:bg-zinc-100"}`}
          >
            {grading ? "Finish practice" : "Practice"}
          </button>
          <button
            onClick={() => chordPracticeActive ? exitChordPractice() : startChordPractice()}
            className={`min-h-11 px-4 py-2 rounded-full border font-medium ${chordPracticeActive ? "bg-indigo-100 border-indigo-300 text-indigo-900" : "border-indigo-300 text-indigo-800 hover:bg-indigo-50"}`}
            aria-pressed={chordPracticeActive}
          >
            {chordPracticeActive ? "Exit chord practice" : "Chord practice"}
          </button>
          <button
            onClick={toggleFavorite}
            aria-pressed={favorites.includes(initial.song.id)}
            className={`min-h-11 px-3 py-2 rounded-full border text-sm ${favorites.includes(initial.song.id) ? "bg-rose-100 border-rose-300" : "border-zinc-300 hover:bg-zinc-100"}`}
            title="Add to favorites"
          >
            {favorites.includes(initial.song.id) ? "♥ Favorited" : "♡ Favorite"}
          </button>
          <button
            onClick={toggleLearned}
            aria-pressed={learned.includes(initial.song.id)}
            className={`min-h-11 px-3 py-2 rounded-full border text-sm ${learned.includes(initial.song.id) ? "bg-green-100 border-green-300" : "border-zinc-300 hover:bg-zinc-100"}`}
            title="Mark as learned"
          >
            {learned.includes(initial.song.id) ? "✓ Learned" : "Learned?"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden mb-4">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 flex-wrap">
          <button onClick={togglePlay} disabled={chordPracticeActive} className="w-12 h-12 rounded-full bg-zinc-900 text-white text-lg shadow-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={playing ? "Pause" : "Play"} title={chordPracticeActive ? "Exit chord practice to play the arrangement" : undefined}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            onClick={toggleLoop}
            aria-pressed={!!loop}
            className={`min-h-11 px-3 py-1.5 rounded-full text-xs font-mono border ${loop ? "bg-indigo-100 border-indigo-300 text-indigo-800" : "border-zinc-300"}`}
            title="Loop 4 measures from current position"
          >
            LOOP {loop ? "ON" : "OFF"}
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => seekToMeasure(Math.max(0, currentMeasure - 1))} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Previous measure">‹</button>
            <span className="px-2 text-xs font-mono" title="Measure — click to jump">
              {currentMeasure + 1}/{initial.data.measures.length}
            </span>
            <button onClick={() => seekToMeasure(Math.min(initial.data.measures.length - 1, currentMeasure + 1))} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Next measure">›</button>
          </div>
          <div className="flex items-center gap-1" aria-label="Practice speed">
            <button onClick={() => updateSettings({ speed: Math.max(0.25, +(settings.speed - 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Decrease speed">−</button>
            <span className="px-2 text-xs font-medium" title="Practice speed">{Math.round(settings.speed * 100)}%</span>
            <button onClick={() => updateSettings({ speed: Math.min(2, +(settings.speed + 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Increase speed">+</button>
          </div>
          <div className="flex items-center gap-1" aria-label="Transpose">
            <button onClick={() => updateSettings({ transpose: settings.transpose - 1 })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose down">−</button>
            <span className="px-2 text-xs font-medium">
              Key {songKeyLabel} {settings.transpose ? `(${settings.transpose > 0 ? "+" : ""}${settings.transpose})` : ""}
            </span>
            <button onClick={() => updateSettings({ transpose: settings.transpose + 1 })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose up">+</button>
            {settings.transpose !== 0 && (
              <button onClick={() => updateSettings({ transpose: 0 })} className="min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs text-zinc-500" aria-label="Reset transpose">
                Reset
              </button>
            )}
          </div>
          <output role="timer" aria-label="Elapsed time" className="ml-auto text-xs text-zinc-500 font-mono tabular-nums text-right select-none flex items-center gap-1.5">
            <span>{fmtTime(time)}</span>
            <span className="text-zinc-300">/</span>
            <span>{fmtTime(duration)}</span>
            <span className="text-zinc-400">(-{fmtTime(Math.max(0, duration - time))})</span>
          </output>
        </div>

        <div className="px-4 pb-3 border-b border-zinc-100">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.01}
            value={Math.min(time, duration)}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-zinc-900"
            style={{
              background: `linear-gradient(to right, #18181b 0%, #18181b ${(time / Math.max(1, duration)) * 100}%, #e4e4e7 ${(time / Math.max(1, duration)) * 100}%, #e4e4e7 100%)`,
            }}
            aria-label="Seek"
          />
        </div>

        <div
          className={`relative ${playing && !grading ? "cursor-pointer" : ""}`}
          onClick={() => {
            if (playing && !grading) stopPlayback();
          }}
          role="region"
          aria-label={`Player stage — ${activeModeLabel}`}
        >
          {chordPracticeActive ? (
            <ChordPracticePanel
              targets={chordPracticeTargets}
              snapshot={chordPracticeSnapshot ?? new ChordGrader(chordPracticeTargets).snapshot()}
              active={chordPracticeActive}
              onStart={startChordPractice}
              onHear={hearChordPractice}
              onSkip={skipChordPractice}
              onExit={exitChordPractice}
            />
          ) : (
            <>
              {settings.mode === "falling" && <ChordStrip chords={visualChords} currentBeat={currentBeat} />}
              {settings.mode === "falling" && (
                <FallingCanvas
                  notes={notes}
                  time={time}
                  settings={settings}
                  pressedKeys={pressedKeys}
                  chords={visualChords}
                  tempoBpm={initial.data.tempoBpm}
                  lowMidi={midiRange.lowMidi}
                  highMidi={midiRange.highMidi}
                  loop={loop}
                  waitNote={waitNote}
                />
              )}
              {settings.mode === "beginner" && <BeginnerView data={initial.data} time={time} settings={settings} chords={chords} />}
              {settings.mode === "leadsheet" && <LeadSheetView data={initial.data} time={time} settings={settings} chords={chords} />}
              {settings.mode === "sheet" && <SheetMusicView songId={initial.song.id} />}
            </>
          )}
          {grading && (
            <GradingPanel
              waitMode={waitMode}
              waitNote={waitNote}
              result={gradeResult}
              onWaitToggle={() => setWaitMode((w) => !w)}
              onExit={finishGrading}
              onMicNote={handleMicNote}
            />
          )}
          {playing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-900/80 text-white text-xs">
              Playing — click anywhere to pause
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {activeModeLabel} view active
          </p>
        </div>
      </div>

      {initial.variants.length > 1 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Same song, other levels</h2>
          <div className="flex flex-wrap gap-2">
            {initial.variants.map((v) => (
              <Link
                key={v.id}
                href={`/player/${v.id}`}
                className={`px-3 py-2 rounded-full text-sm border ${v.id === initial.song.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              >
                {v.difficulty}
              </Link>
            ))}
          </div>
        </section>
      )}

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onChange={updateSettings}
          chordSource={chordSourcePreference}
          chordSources={{
            ug: chordSources.ug,
            generated: chordSources.generated,
            auto: chordSources.auto,
          }}
          chordSourceStatus={selectedChordSource.fallbackReason}
          onChordSourceChange={updateChordSource}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showDownload && <DownloadDialog songId={initial.song.id} hasSheetXml={initial.song.hasSheetXml === 1} onClose={() => setShowDownload(false)} />}

      <section className="mt-8 text-sm text-zinc-600">
        <h2 className="font-semibold text-zinc-800 mb-2">About this arrangement</h2>
        <p>
          Key of {initial.data.key} · {initial.data.tempoBpm} BPM · {initial.data.timeSig[0]}/{initial.data.timeSig[1]} ·
          {" "}{initial.song.bassPattern} bass · {initial.data.notes.length} notes
        </p>
        <p className="mt-2 text-zinc-500">
          Practice tips: slow it to 50% first, loop tricky measures, and use Practice mode to get graded feedback.
        </p>
      </section>
    </div>
  );
}
