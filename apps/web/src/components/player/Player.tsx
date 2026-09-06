"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AudioEngine,
  OrganAudioEngine,
  SamplerAudioEngine,
  ChordGrader,
  completeChordDurations,
  dedupeChords,
  KeyboardInput,
  MidiInput,
  PlaybackEngine,
  loadJson,
  loadSettings,
  loadSongPrefs,
  measureIndex,
  measureMidiRange,
  resolveTimedNotes,
  saveJson,
  saveSettings,
  saveSongPrefs,
  secPerBeat,
  DEFAULT_SETTINGS,
  type LoopRegion,
  type ChordPracticeSnapshot,
  type PlayerSettings,
  type ViewMode,
  type SongData,
  type Section as SongSection,
} from "@keyspilli/player-core";
import type { SongRow } from "@keyspilli/catalog";
import { PUBLIC_DIFFICULTY_ORDER, isPublicDifficultyLevel } from "@keyspilli/midi";
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
import { useAnimatedSwitch, usePresence } from "./player-motion";
import { levelLabel } from "../level-labels";
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

/** Metadata-only payload used while a direct sheet route loads its player data. */
export interface PlayerShell {
  song: SongRow;
  variants: SongRow[];
}

export type PlayerInitial = PlayerDetail | PlayerShell;

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: "falling", label: "Fall Down", hint: "Notes fall onto the keyboard" },
  { id: "beginner", label: "Beginner", hint: "Big colored notes + letters" },
  { id: "sheet", label: "Sheet Music", hint: "Engraved score" },
  { id: "leadsheet", label: "Lead Sheet", hint: "Lyrics + chords" },
];

function playerVariantsForDisplay(song: Pick<SongRow, "difficulty">, variants: readonly SongRow[]): SongRow[] {
  const byDifficulty = new Map(
    variants.filter((variant) => isPublicDifficultyLevel(variant.difficulty)).map((variant) => [variant.difficulty, variant]),
  );
  const publicVariants = PUBLIC_DIFFICULTY_ORDER.flatMap((difficulty) => {
    const variant = byDifficulty.get(difficulty);
    return variant ? [variant] : [];
  });
  if (song.difficulty !== "very-easy") return publicVariants;

  const legacy = variants.find((variant) => variant.difficulty === "very-easy");
  if (!legacy) return publicVariants;
  const easyIndex = publicVariants.findIndex((variant) => variant.difficulty === "easy");
  publicVariants.splice(easyIndex < 0 ? publicVariants.length : easyIndex, 0, legacy);
  return publicVariants;
}

/** Pressed keys drop if their noteOff was lost (common with USB-MIDI). */
const GHOST_KEY_TIMEOUT_MS = 5000;
const TEMPO_SEMANTICS_NOTICE_KEY = "keyspilli.tempo-semantics.v1";

function FullPlayer({ initial, mode, focusTarget }: { initial: PlayerDetail; mode: ViewMode | null; focusTarget?: "practice" }) {
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    const s = loadSettings();
    // Per-song practice settings override global defaults for this song.
    const songPrefs = loadSongPrefs(initial.song.id);
    if (songPrefs.speed !== undefined) s.speed = songPrefs.speed;
    if (songPrefs.transpose !== undefined) s.transpose = songPrefs.transpose;
    if (songPrefs.mode !== undefined) s.mode = songPrefs.mode as ViewMode;
    if (songPrefs.hand !== undefined) s.hand = songPrefs.hand;
    if (mode) s.mode = mode;
    return s;
  });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  // Client-only preferences: initialize false for SSR, then sync from
  // localStorage after mount. Avoids hydration mismatch on class names.
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  useEffect(() => {
    setSectionsCollapsed(loadJson("keyspilli.sectionsCollapsed", false));
    setFullWidth(loadJson("keyspilli.fullWidth", false));
  }, []);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const downloadTriggerRef = useRef<HTMLButtonElement>(null);
  const practiceTriggerRef = useRef<HTMLButtonElement>(null);
  const chordPracticeTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const adjustTriggerRef = useRef<HTMLButtonElement>(null);
  const adjustPanelRef = useRef<HTMLDivElement>(null);
  const sectionsExitRef = useRef<HTMLDivElement>(null);
  const modeMenuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusTarget !== "practice") return undefined;
    const frame = window.requestAnimationFrame(() => practiceTriggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget]);
  // Store loop anchors in musical time (beats); seconds are derived from the
  // current speed so tempo changes automatically reproject the region.
  const [loopBeats, setLoopBeats] = useState<{ startBeat: number; endBeat: number } | null>(null);
  const loop = useMemo<LoopRegion | null>(() => {
    if (!loopBeats) return null;
    const spb = secPerBeat(initial.data.tempoBpm, settings.speed);
    return { startSec: loopBeats.startBeat * spb, endSec: loopBeats.endBeat * spb };
  }, [loopBeats, initial.data.tempoBpm, settings.speed]);
  const sections: SongSection[] = initial.data.sections ?? [];
  const displayVariants = playerVariantsForDisplay(initial.song, initial.variants);
  const [showSettings, setShowSettings] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const showSettingsRef = useRef(showSettings);
  const showDownloadRef = useRef(showDownload);
  const showModeMenuRef = useRef(showModeMenu);
  const showAdjustRef = useRef(showAdjust);
  showSettingsRef.current = showSettings;
  showDownloadRef.current = showDownload;
  showModeMenuRef.current = showModeMenu;
  showAdjustRef.current = showAdjust;
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const modeMenuPresence = usePresence(showModeMenu);
  const adjustPresence = usePresence(showAdjust);
  const modeSwitch = useAnimatedSwitch(settings.mode);
  const sectionsSwitch = useAnimatedSwitch(sectionsCollapsed);
  const playingNoticePresence = usePresence(playing);
  const [showTempoSemanticsNotice, setShowTempoSemanticsNotice] = useState(false);
  const tempoNoticePresence = usePresence(showTempoSemanticsNotice);
  const [grading, setGrading] = useState(false);
  const gradingPresence = usePresence(grading);
  const [chordPracticeActive, setChordPracticeActive] = useState(false);
  const chordPracticePresence = usePresence(chordPracticeActive);
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

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const panel = adjustPanelRef.current;
    if (!panel) return;
    if (isNarrowViewport && !showAdjust) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [isNarrowViewport, showAdjust, adjustPresence.mounted]);

  useEffect(() => {
    const layer = sectionsExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [sectionsSwitch.previous]);

  useEffect(() => {
    const menu = modeMenuPanelRef.current;
    if (!menu) return;
    if (!showModeMenu) menu.setAttribute("inert", "");
    else menu.removeAttribute("inert");
  }, [modeMenuPresence.mounted, showModeMenu]);

  // Tempo semantics changed from rewriting beat coordinates to controlling
  // playback speed. Keep acknowledgement in versioned UI state so a future
  // semantics change can show a new notice without touching artifact data.
  useEffect(() => {
    setShowTempoSemanticsNotice(loadJson<boolean>(TEMPO_SEMANTICS_NOTICE_KEY, false) !== true);
  }, []);

  function dismissTempoSemanticsNotice() {
    saveJson(TEMPO_SEMANTICS_NOTICE_KEY, true);
    setShowTempoSemanticsNotice(false);
    window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
  }

  const engineRef = useRef<PlaybackEngine | null>(null);
  const audioSwapStateRef = useRef<{ time: number; playing: boolean } | null>(null);
  const chordPracticeRef = useRef<ChordGrader | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const chordPracticeActiveRef = useRef(chordPracticeActive);
  const skipChordPracticeRef = useRef(skipChordPractice);
  const hearChordPracticeRef = useRef(hearChordPractice);

  // Latest-ref pattern: assign during render instead of subscribing effects
  // that re-fire every render because function declarations get new identities.
  chordPracticeActiveRef.current = chordPracticeActive;
  skipChordPracticeRef.current = skipChordPractice;
  hearChordPracticeRef.current = hearChordPractice;

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
  // Freeze chord-practice targets at session start: a seek changes the
  // current measure but must not silently discard accumulated progress.
  const chordPracticeTargetsRef = useRef<ReturnType<typeof buildChordPracticeTargets> | null>(null);
  const chordPracticeTargets = useMemo(
    () => {
      if (chordPracticeActive && chordPracticeTargetsRef.current) return chordPracticeTargetsRef.current;
      const next = buildChordPracticeTargets(selectPracticeChords(chords, initial.data.measures, currentMeasure), settings.transpose);
      chordPracticeTargetsRef.current = next;
      return next;
    },
    [chords, initial.data.measures, currentMeasure, settings.transpose, chordPracticeActive],
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
    const previous = audioSwapStateRef.current;
    audioSwapStateRef.current = null;
    const audio = settings.soundSource === "sampled"
      ? new SamplerAudioEngine()
      : settings.soundSource === "organ"
        ? new OrganAudioEngine(settings.organDrive, settings.organRotary, settings.organStyle, settings.organSpace)
        : new AudioEngine();
    const engine = new PlaybackEngine(
      audio,
      notes,
      duration,
      { tempoBpm: initial.data.tempoBpm, timeSig: initial.data.timeSig },
      settings,
      chords,
    );
    engine.onChange = (snap) => {
      // Per-frame updates go to a ref consumed by the canvas rAF loop.
      // React state changes are reserved for discrete events (play/pause,
      // seek, grading start/finish), which call the setters directly.
      timeRef.current = snap.time;
      playingRef.current = snap.playing;
    };
    engine.audio.sustainPedal = settings.sustainPedal;
    engineRef.current = engine;
    if (previous) {
      engine.seek(previous.time);
      if (previous.playing) engine.start();
      setTime(engine.time);
      setPlaying(engine.playing);
    }
    return () => {
      audioSwapStateRef.current = { time: engine.time, playing: engine.playing };
      engineRef.current = null;
      engine.audio.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.soundSource, settings.organStyle]);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  // Discrete events (play/pause/seek) still update React state so buttons
  // and progress bar re-render; per-frame engine ticks only touch refs.
  function syncTransportState() {
    if (!engineRef.current) return;
    setTime(engineRef.current.time);
    setPlaying(engineRef.current.playing);
  }

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
    // React-rendered transport UI (progress bar, timer, chord/section
    // highlights) refreshes at 10Hz; the canvas reads the live ref at 60fps.
    let lastSync = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const eng = engineRef.current;
      if (!eng) return;
      eng.tick(dt);
      if (now - lastSync >= 100) {
        lastSync = now;
        setTime(eng.time);
      }
      if (eng.playing) {
        raf = requestAnimationFrame(tick);
      } else {
        // PlaybackEngine stops and seeks to zero when a song reaches its end.
        // Mirror that terminal state in React so the canvas animation loop is
        // also torn down instead of continuing after transport has stopped.
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startPlayback = useCallback(() => {
    if (chordPracticeActive) return;
    engineRef.current?.start();
    syncTransportState();
    void fetch(`/api/songs/${encodeURIComponent(initial.song.id)}/play`, { method: "POST" }).catch(() => {});
  }, [chordPracticeActive, initial.song.id]);

  const stopPlayback = useCallback(() => {
    engineRef.current?.stop();
    syncTransportState();
  }, []);

  const seek = useCallback((t: number) => {
    engineRef.current?.seek(t);
    syncTransportState();
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
        if (showModeMenuRef.current) {
          setShowModeMenu(false);
          window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
        }
        if (showAdjustRef.current) {
          setShowAdjust(false);
          window.requestAnimationFrame(() => adjustTriggerRef.current?.focus());
        }
      } else if (e.key === " " && e.type === "keydown") {
        // Space = play/pause, but never hijack typing or focused controls.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.tagName === "BUTTON" || t.isContentEditable)) return;
        e.preventDefault();
        togglePlayRef.current();
      } else {
        const t = e.target as HTMLElement | null;
        const tagName = t?.tagName;
        if (showSettingsRef.current || showDownloadRef.current || t?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || tagName === "BUTTON" || tagName === "A") return;
        if (chordPracticeActiveRef.current) {
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
        const hadFocus = modeMenuRef.current.contains(document.activeElement);
        setShowModeMenu(false);
        if (hadFocus) window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
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
      const selectedIndex = MODES.findIndex((m) => m.id === settings.mode);
      setModeMenuIdx(selectedIndex);
      const frame = window.requestAnimationFrame(() => {
        const item = MODES[selectedIndex];
        if (item) document.getElementById(`mode-menu-${item.id}`)?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [showModeMenu, settings.mode]);

  function focusModeMenuItem(index: number) {
    const nextIndex = (index + MODES.length) % MODES.length;
    setModeMenuIdx(nextIndex);
    const item = MODES[nextIndex];
    if (item) window.requestAnimationFrame(() => document.getElementById(`mode-menu-${item.id}`)?.focus());
  }

  function handleModeMenuKey(e: React.KeyboardEvent) {
    if (!showModeMenu) return;
    const len = MODES.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusModeMenuItem(modeMenuIdx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusModeMenuItem(modeMenuIdx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusModeMenuItem(0);
        break;
      case "End":
        e.preventDefault();
        focusModeMenuItem(len - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (modeMenuIdx >= 0) {
          const m = MODES[modeMenuIdx]!;
          modeMenuTriggerRef.current?.focus();
          updateSettings({ mode: m.id });
          setShowModeMenu(false);
          const modePath = m.id === "falling" ? "" : `/${m.id}`;
          window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}${modePath}`);
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowModeMenu(false);
        modeMenuTriggerRef.current?.focus();
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
      setLoopBeats(null);
      return;
    }
    const startBeat = initial.data.measures[currentMeasure]?.startBeat ?? 0;
    const measureBeats = initial.data.timeSig[0] * (4 / initial.data.timeSig[1]);
    setLoopBeats({ startBeat, endBeat: startBeat + 4 * measureBeats });
  }

  function seekToSection(s: SongSection) {
    seek(s.startBeat * secPerBeat(initial.data.tempoBpm, settings.speed));
  }

  function loopSection(s: SongSection) {
    setLoopBeats({ startBeat: s.startBeat, endBeat: s.endBeat });
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
    // Persist practice-relevant settings per song so switching songs restores them.
    saveSongPrefs(initial.song.id, {
      speed: next.speed,
      transpose: next.transpose,
      mode: next.mode,
      hand: next.hand,
    });
  }

  function updateChordSource(source: ChordSourceId) {
    setChordSourcePreference(source);
    saveJson("keyspilli.chordSource", source);
  }

  function toggleSectionsCollapsed() {
    setSectionsCollapsed((v) => {
      saveJson("keyspilli.sectionsCollapsed", !v);
      return !v;
    });
  }

  function toggleFullWidth() {
    setFullWidth((v) => {
      saveJson("keyspilli.fullWidth", !v);
      return !v;
    });
  }

  function startGrading(wait: boolean) {
    if (chordPracticeActive) exitChordPractice(false);
    setWaitMode(wait);
    setGrading(true);
    setGradeResult(null);
    engineRef.current?.startGrading(wait);
    if (!wait) startPlayback();
  }

  function finishGrading(restoreFocus = true) {
    const result = engineRef.current?.finishGrading();
    if (result) setGradeResult(result);
    syncTransportState();
    setGrading(false);
    setWaitMode(false);
    if (restoreFocus) window.requestAnimationFrame(() => practiceTriggerRef.current?.focus());
  }

  function startChordPractice() {
    if (grading) finishGrading(false);
    engineRef.current?.stop();
    chordPracticeTargetsRef.current = null; // recompute for the new session
    const session = new ChordGrader(chordPracticeTargets);
    chordPracticeRef.current = session;
    setChordPracticeActive(true);
    setChordPracticeSnapshot(session.snapshot());
  }

  function exitChordPractice(restoreFocus = true) {
    chordPracticeRef.current = null;
    chordPracticeTargetsRef.current = null;
    setChordPracticeActive(false);
    setChordPracticeSnapshot(null);
    if (restoreFocus) window.requestAnimationFrame(() => chordPracticeTriggerRef.current?.focus());
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
  const activeSection = sections.find((s) => {
    const spb = secPerBeat(initial.data.tempoBpm, settings.speed);
    return time >= s.startBeat * spb && time < s.endBeat * spb;
  });
  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const renderSectionContent = (collapsed: boolean) => collapsed ? (
    <span className="text-xs text-zinc-500 truncate">{activeSection?.label ?? "Sections hidden"}</span>
  ) : (
    sections.map((s) => {
      const spb = secPerBeat(initial.data.tempoBpm, settings.speed);
      const startSec = s.startBeat * spb;
      const endSec = s.endBeat * spb;
      const active = time >= startSec && time < endSec;
      const isLooping = loop && loop.startSec === startSec && loop.endSec === endSec;
      return (
        <span key={s.id} className="inline-flex items-center rounded-full border text-xs min-h-9 overflow-hidden shrink-0">
          <button
            onClick={() => seekToSection(s)}
            aria-current={active ? "true" : undefined}
            className={`px-2.5 py-1 font-medium transition-colors ${active ? "bg-zinc-900 text-white border-zinc-900" : "hover:bg-zinc-100 border-transparent"}`}
          >
            {s.label}
          </button>
          <button
            onClick={() => loopSection(s)}
            aria-pressed={!!isLooping}
            title={`Loop ${s.label}`}
            className={`px-1.5 py-1 border-l ${isLooping ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "border-zinc-200 hover:bg-zinc-50 text-zinc-500"}`}
          >
            ⟳
          </button>
        </span>
      );
    })
  );
  const renderModeView = (viewMode: ViewMode) => (
    <>
      {viewMode === "falling" && <ChordStrip chords={visualChords} currentBeat={currentBeat} />}
      {viewMode === "falling" && (
        <FallingCanvas
          notes={notes}
          time={time}
          timeRef={timeRef}
          playing={playing}
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
      {viewMode === "beginner" && <BeginnerView data={initial.data} time={time} settings={settings} chords={chords} />}
      {viewMode === "leadsheet" && <LeadSheetView data={initial.data} time={time} settings={settings} chords={chords} />}
      {viewMode === "sheet" && <SheetMusicView songId={initial.song.id} />}
    </>
  );

  return (
    <div className={`${fullWidth ? "w-full px-4 py-6" : "max-w-6xl mx-auto px-4 py-6"} page-shell player-page`}>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold leading-tight truncate max-w-[70vw]" title={initial.song.title}>{initial.song.title}</h1>
          <div className="text-sm text-zinc-500">by {initial.song.artist}</div>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.key}</span>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{levelLabel(initial.song.difficulty)}</span>
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

      {tempoNoticePresence.mounted && (
        <div
          className="motion-presence mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          data-state={tempoNoticePresence.visible ? "open" : "closed"}
          // Keep the closing notice in the accessibility tree until the
          // presence hook unmounts it; hiding a focused button mid-exit leaves
          // keyboard and screen-reader focus in an aria-hidden subtree.
          aria-hidden={false}
          role="status"
        >
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

      <div className="player-options flex flex-wrap items-center gap-2 mb-4">
        <div className="player-primary-controls flex flex-wrap items-center gap-2">
          <div className="relative" ref={modeMenuRef}>
          <button
            ref={modeMenuTriggerRef}
            onClick={() => setShowModeMenu((s) => !s)}
            className="pressable min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            aria-controls="player-view-menu"
            onKeyDown={handleModeMenuKey}
            aria-expanded={showModeMenu}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{MODES.find((m) => m.id === settings.mode)?.label}</span>
          </button>
          {modeMenuPresence.mounted && (
            <div
              ref={modeMenuPanelRef}
              id="player-view-menu"
              className="motion-presence absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2"
              data-state={modeMenuPresence.visible ? "open" : "closed"}
              aria-hidden={!showModeMenu}
              role="menu"
              onKeyDown={handleModeMenuKey}
              tabIndex={-1}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="menuitemradio"
                  id={`mode-menu-${m.id}`}
                  tabIndex={-1}
                  aria-checked={settings.mode === m.id}
                  onClick={() => {
                    modeMenuTriggerRef.current?.focus();
                    updateSettings({ mode: m.id });
                    setShowModeMenu(false);
                    const modePath = m.id === "falling" ? "" : `/${m.id}`;
                    window.history.replaceState(null, "", `/player/${initial.song.id}${modePath}`);
                  }}
                  className="pressable w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100"
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
              aria-label={h === "L" ? "Left hand" : h === "R" ? "Right hand" : "Both hands"}
              className={`pressable min-w-11 min-h-11 px-3 py-2 rounded-full text-sm border ${settings.hand === h ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
            >
              {h === "both" ? "All" : h}
            </button>
          ))}
          </div>

          <button
            type="button"
            ref={adjustTriggerRef}
            onClick={() => setShowAdjust((visible) => !visible)}
            aria-expanded={showAdjust}
            aria-controls="player-adjust-panel"
            className="player-adjust-toggle pressable min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm"
          >
            {showAdjust ? "Done" : "Adjust"}
          </button>
        </div>

        <div
          id="player-adjust-panel"
          ref={adjustPanelRef}
          className="player-advanced-panel flex flex-wrap items-center gap-2"
          data-open={showAdjust}
          data-mounted={adjustPresence.mounted}
          data-state={adjustPresence.visible ? "open" : "closed"}
          role="group"
          aria-label="Player adjustments"
          aria-hidden={isNarrowViewport && !showAdjust ? true : undefined}
        >
          <button
            onClick={() => updateSettings({ chordKeys: !settings.chordKeys })}
            aria-pressed={settings.chordKeys}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.chordKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Chord Keys
          </button>
          <button
            onClick={() => updateSettings({ metronome: !settings.metronome })}
            aria-pressed={settings.metronome}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.metronome ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Metronome
          </button>
          <button
            onClick={() => updateSettings({ showAllKeys: !settings.showAllKeys })}
            aria-pressed={settings.showAllKeys}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.showAllKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            88 Keys
          </button>
          <button
            onClick={toggleFullWidth}
            aria-pressed={fullWidth}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${fullWidth ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Full width
          </button>
          <div className="player-advanced-inline flex items-center gap-1" aria-label="Transpose">
            <button onClick={() => updateSettings({ transpose: settings.transpose - 1 })} className="pressable min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose down">−</button>
            <span className="px-2 text-xs font-medium">
              Key {songKeyLabel} {settings.transpose ? `(${settings.transpose > 0 ? "+" : ""}${settings.transpose})` : ""}
            </span>
            <button onClick={() => updateSettings({ transpose: settings.transpose + 1 })} className="pressable min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose up">+</button>
            {settings.transpose !== 0 && (
              <button onClick={() => updateSettings({ transpose: 0 })} className="pressable min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs text-zinc-500" aria-label="Reset transpose">
                Reset
              </button>
            )}
          </div>
          <button
            onClick={toggleLoop}
            aria-pressed={!!loop}
            className={`pressable min-h-11 px-3 py-1.5 rounded-full text-xs font-mono border ${loop ? "bg-indigo-100 border-indigo-300 text-indigo-800" : "border-zinc-300"}`}
            title="Loop 4 measures from current position"
          >
            LOOP {loop ? "ON" : "OFF"}
          </button>

          <div className="player-secondary-actions ml-auto flex flex-wrap justify-end gap-2 text-sm">
            <button ref={downloadTriggerRef} onClick={() => setShowDownload(true)} className="pressable min-h-11 px-4 py-2 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700" aria-label="Download sheet music and MIDI">
              Download Sheet &amp; MIDI
            </button>
            <button ref={settingsTriggerRef} onClick={() => setShowSettings(true)} className="pressable min-h-11 px-4 py-2 rounded-full border border-zinc-300 font-medium hover:bg-zinc-100" aria-label="Open settings">
              Settings
            </button>
            <button
              onClick={() => chordPracticeActive ? exitChordPractice() : startChordPractice()}
              ref={chordPracticeTriggerRef}
              className={`pressable min-h-11 px-4 py-2 rounded-full border font-medium ${chordPracticeActive ? "bg-indigo-100 border-indigo-300 text-indigo-900" : "border-indigo-300 text-indigo-800 hover:bg-indigo-50"}`}
              aria-pressed={chordPracticeActive}
            >
              {chordPracticeActive ? "Exit chord practice" : "Chord practice"}
            </button>
            <button
              onClick={toggleFavorite}
              aria-pressed={favorites.includes(initial.song.id)}
              className={`pressable min-h-11 px-3 py-2 rounded-full border text-sm ${favorites.includes(initial.song.id) ? "bg-rose-100 border-rose-300" : "border-zinc-300 hover:bg-zinc-100"}`}
              title="Add to favorites"
            >
              {favorites.includes(initial.song.id) ? "♥ Favorited" : "♡ Favorite"}
            </button>
            <button
              onClick={toggleLearned}
              aria-pressed={learned.includes(initial.song.id)}
              className={`pressable min-h-11 px-3 py-2 rounded-full border text-sm ${learned.includes(initial.song.id) ? "bg-green-100 border-green-300" : "border-zinc-300 hover:bg-zinc-100"}`}
              title="Mark as learned"
            >
              {learned.includes(initial.song.id) ? "✓ Learned" : "Learned?"}
            </button>
          </div>
        </div>
      </div>

      <div className="player-surface rounded-2xl border border-zinc-200 bg-white mb-4">
        <div className="player-control-strip flex items-center gap-3 px-4 py-3 border-b border-zinc-100 flex-wrap">
          <button onClick={togglePlay} disabled={chordPracticeActive} className="pressable w-12 h-12 rounded-full bg-zinc-900 text-white text-lg shadow-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={playing ? "Pause" : "Play"} title={chordPracticeActive ? "Exit chord practice to play the arrangement" : undefined}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            ref={practiceTriggerRef}
            onClick={() => grading ? finishGrading() : startGrading(false)}
            className={`pressable player-practice-button min-h-11 px-3 py-1.5 rounded-full border font-medium text-sm ${grading ? "bg-amber-100 border-amber-300" : "border-zinc-300 hover:bg-zinc-100"}`}
          >
            {grading ? "Finish practice" : "Practice"}
          </button>
          <div className="player-measure-controls flex items-center gap-1">
            <button onClick={() => seekToMeasure(Math.max(0, currentMeasure - 1))} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Previous measure">‹</button>
            <span className="px-2 text-xs font-mono" title="Measure — click to jump">
              {currentMeasure + 1}/{initial.data.measures.length}
            </span>
            <button onClick={() => seekToMeasure(Math.min(initial.data.measures.length - 1, currentMeasure + 1))} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Next measure">›</button>
          </div>
          <div className="player-speed-controls flex items-center gap-1" aria-label="Practice speed">
            <button onClick={() => updateSettings({ speed: Math.max(0.25, +(settings.speed - 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Decrease speed">−</button>
            <span className="px-2 text-xs font-medium" title="Practice speed">{Math.round(settings.speed * 100)}%</span>
            <button onClick={() => updateSettings({ speed: Math.min(2, +(settings.speed + 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Increase speed">+</button>
          </div>
          <output role="timer" aria-label="Elapsed time" className="ml-auto text-xs text-zinc-500 font-mono tabular-nums text-right select-none flex items-center gap-1.5">
            <span>{fmtTime(time)}</span>
            <span className="text-zinc-300">/</span>
            <span>{fmtTime(duration)}</span>
            <span className="text-zinc-500">(-{fmtTime(Math.max(0, duration - time))})</span>
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
        {sections.length > 1 && (
          <div role="navigation" aria-label="Song sections" className="px-4 py-2 border-b border-zinc-100 flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={toggleSectionsCollapsed}
              aria-expanded={!sectionsCollapsed}
              className={`min-h-9 px-2 py-1 rounded-full border text-xs font-medium shrink-0 ${sectionsCollapsed ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              title={sectionsCollapsed ? "Expand sections" : "Collapse sections"}
            >
              {sectionsCollapsed ? "▸ Sections" : "▾ Sections"}
            </button>
            <div className="player-sections-switch">
              {sectionsSwitch.previous !== null && (
                <div ref={sectionsExitRef} className="player-sections-layer-exit" aria-hidden="true">
                  {renderSectionContent(sectionsSwitch.previous)}
                </div>
              )}
              <div key={String(sectionsSwitch.current)} className="player-sections-layer-enter">
                {renderSectionContent(sectionsSwitch.current)}
              </div>
            </div>
          </div>
        )}

        <div
          className={`player-stage relative ${playing && !grading ? "cursor-pointer" : ""}`}
          tabIndex={playing && !grading ? 0 : undefined}
          onKeyDown={(event) => {
            if (!playing || grading || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            event.stopPropagation();
            stopPlayback();
          }}
          onClick={() => {
            if (playing && !grading) stopPlayback();
          }}
          role="region"
          aria-label={`Player stage — ${activeModeLabel}`}
        >
          {chordPracticePresence.mounted ? (
            <ChordPracticePanel
              targets={chordPracticeTargets}
              snapshot={chordPracticeSnapshot ?? new ChordGrader(chordPracticeTargets).snapshot()}
              active={chordPracticeActive}
              onStart={startChordPractice}
              onHear={hearChordPractice}
              onSkip={skipChordPractice}
              onExit={exitChordPractice}
              presenceVisible={chordPracticePresence.visible}
            />
          ) : (
            <div className="player-mode-stack">
              {modeSwitch.previous && (
                <div className="player-mode-layer-exit" aria-hidden="true">
                  {renderModeView(modeSwitch.previous)}
                </div>
              )}
              <div key={modeSwitch.current} className="player-mode-layer-enter">
                {renderModeView(modeSwitch.current)}
              </div>
            </div>
          )}
          {gradingPresence.mounted && (
            <GradingPanel
              waitMode={waitMode}
              waitNote={waitNote}
              result={gradeResult}
              onWaitToggle={() => setWaitMode((w) => !w)}
              onExit={finishGrading}
              onMicNote={handleMicNote}
              presenceVisible={gradingPresence.visible}
            />
          )}
          {playingNoticePresence.mounted && (
            <div
              className="motion-presence absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-900/80 text-white text-xs"
              data-state={playingNoticePresence.visible ? "open" : "closed"}
              aria-hidden={!playing}
            >
              Playing — click anywhere to pause
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {activeModeLabel} view active
          </p>
          <p className="sr-only">When playback is active, press Enter or Space on the stage to pause. Computer keyboard A through K plays notes.</p>
        </div>
      </div>

      {displayVariants.length > 1 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Same song, other levels</h2>
          <div className="flex flex-wrap gap-2">
            {displayVariants.map((v) => (
              <Link
                key={v.id}
                href={`/player/${v.id}`}
                className={`px-3 py-2 rounded-full text-sm border ${v.id === initial.song.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              >
                {levelLabel(v.difficulty)}
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
          onClose={() => {
            setShowSettings(false);
            window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
          }}
        />
      )}
      {showDownload && <DownloadDialog songId={initial.song.id} hasSheetXml={initial.song.hasSheetXml === 1} onClose={() => {
        setShowDownload(false);
        window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
      }} />}

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

function isPlayerDetail(initial: PlayerInitial): initial is PlayerDetail {
  return "data" in initial && initial.data != null;
}

/**
 * Keep direct sheet navigation useful before the large player payload arrives.
 * The sheet renderer only needs the song id, while practice controls and the
 * other views explicitly request the complete detail JSON from the API.
 */
function PlayerShellView({ initial, mode }: { initial: PlayerShell; mode: ViewMode | null }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [requestedMode, setRequestedMode] = useState<ViewMode>(mode ?? "sheet");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuPresence = usePresence(showModeMenu);
  const [showDownload, setShowDownload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modeMenuIdx, setModeMenuIdx] = useState(-1);
  const downloadTriggerRef = useRef<HTMLButtonElement>(null);
  const loadControlsTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuPanelRef = useRef<HTMLDivElement>(null);
  const modeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const shellExitRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const detailSwitch = useAnimatedSwitch(Boolean(detail));
  const shellLoadingPresence = usePresence(loading);
  const shellErrorPresence = usePresence(Boolean(error));

  useEffect(() => {
    const layer = shellExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [detailSwitch.previous]);

  useEffect(() => {
    const menu = modeMenuPanelRef.current;
    if (!menu) return;
    if (!showModeMenu) menu.setAttribute("inert", "");
    else menu.removeAttribute("inert");
  }, [modeMenuPresence.mounted, showModeMenu]);

  useEffect(() => () => {
    loadRequestRef.current?.abort();
    loadRequestRef.current = null;
  }, []);

  useEffect(() => {
    if (!showModeMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const hadFocus = modeMenuRef.current?.contains(document.activeElement) ?? false;
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setShowModeMenu(false);
        setModeMenuIdx(-1);
        if (hadFocus) window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showModeMenu]);

  useEffect(() => {
    if (!showModeMenu) {
      setModeMenuIdx(-1);
      return undefined;
    }
    const selectedIndex = MODES.findIndex((item) => item.id === requestedMode);
    setModeMenuIdx(selectedIndex);
    const frame = window.requestAnimationFrame(() => {
      const item = MODES[selectedIndex];
      if (item) document.getElementById(`shell-mode-menu-${item.id}`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedMode, showModeMenu]);

  function focusShellModeMenuItem(index: number) {
    const nextIndex = (index + MODES.length) % MODES.length;
    setModeMenuIdx(nextIndex);
    const item = MODES[nextIndex];
    if (item) window.requestAnimationFrame(() => document.getElementById(`shell-mode-menu-${item.id}`)?.focus());
  }

  function handleShellModeMenuKey(event: React.KeyboardEvent) {
    if (!showModeMenu) return;
    const len = MODES.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusShellModeMenuItem(modeMenuIdx + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusShellModeMenuItem(modeMenuIdx - 1);
        break;
      case "Home":
        event.preventDefault();
        focusShellModeMenuItem(0);
        break;
      case "End":
        event.preventDefault();
        focusShellModeMenuItem(len - 1);
        break;
      case "Escape":
        event.preventDefault();
        setShowModeMenu(false);
        setModeMenuIdx(-1);
        modeMenuTriggerRef.current?.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (modeMenuIdx >= 0) {
          const item = MODES[modeMenuIdx]!;
          modeMenuTriggerRef.current?.focus();
          setShowModeMenu(false);
          setModeMenuIdx(-1);
          if (item.id === "sheet") {
            loadRequestRef.current?.abort();
            setLoading(false);
            setError("");
            setRequestedMode("sheet");
            window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/sheet`);
          } else {
            void loadDetail(item.id);
          }
        }
        break;
    }
  }

  const loadDetail = useCallback(async (nextMode: ViewMode) => {
    // Remember the requested target before the network round-trip so a failed
    // mode switch can be retried with the same target instead of silently
    // falling back to the sheet route.
    setRequestedMode(nextMode);
    if (detail) {
      if (nextMode !== "sheet") {
        window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/${nextMode}`);
      }
      return;
    }
    loadRequestRef.current?.abort();
    const controller = new AbortController();
    loadRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(initial.song.id)}`, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (controller.signal.aborted) return;
      const value = await response.json().catch(() => null) as Partial<PlayerDetail> | null;
      if (controller.signal.aborted || loadRequestRef.current !== controller) return;
      if (!response.ok || !value || !value.song || !value.data || !Array.isArray(value.variants)) {
        throw new Error("The player arrangement could not be loaded.");
      }
      setDetail(value as PlayerDetail);
      if (nextMode !== "sheet") {
        window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/${nextMode}`);
      }
    } catch (cause) {
      if (loadRequestRef.current === controller && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The player arrangement could not be loaded.");
      }
    } finally {
      if (loadRequestRef.current === controller) {
        loadRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [detail, initial.song.id]);

  const activeMode = requestedMode === "sheet" ? "Sheet Music" : MODES.find((item) => item.id === requestedMode)?.label ?? requestedMode;
  const displayVariants = playerVariantsForDisplay(initial.song, initial.variants);

  const shell = (
    <div className="page-shell player-page max-w-6xl mx-auto px-4 py-6">
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold leading-tight truncate max-w-[70vw]" title={initial.song.title}>{initial.song.title}</h1>
          <div className="text-sm text-zinc-500">by {initial.song.artist}</div>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.key}</span>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{levelLabel(initial.song.difficulty)}</span>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{initial.song.tempo} BPM</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" ref={modeMenuRef}>
          <button
            ref={modeMenuTriggerRef}
            onClick={() => {
              setShowModeMenu((visible) => !visible);
              setModeMenuIdx(-1);
            }}
            className="min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            aria-controls="shell-player-view-menu"
            aria-expanded={showModeMenu}
            onKeyDown={handleShellModeMenuKey}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{activeMode}</span>
          </button>
          {modeMenuPresence.mounted && (
            <div
              ref={modeMenuPanelRef}
              id="shell-player-view-menu"
              className="motion-presence absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2"
              data-state={modeMenuPresence.visible ? "open" : "closed"}
              aria-hidden={!showModeMenu}
              role="menu"
              tabIndex={-1}
              onKeyDown={handleShellModeMenuKey}
            >
              {MODES.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  id={`shell-mode-menu-${item.id}`}
                  aria-checked={requestedMode === item.id}
                  tabIndex={-1}
                  onClick={() => {
                    modeMenuTriggerRef.current?.focus();
                    setShowModeMenu(false);
                    setModeMenuIdx(-1);
                    if (item.id === "sheet") {
                      loadRequestRef.current?.abort();
                      setLoading(false);
                      setError("");
                      setRequestedMode("sheet");
                      window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/sheet`);
                    } else {
                      void loadDetail(item.id);
                    }
                  }}
                  className="pressable w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100"
                >
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-zinc-500">{item.hint}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          ref={downloadTriggerRef}
          onClick={() => setShowDownload(true)}
          className="min-h-11 px-4 py-2 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700"
          aria-label="Download sheet music and MIDI"
        >
          Download Sheet &amp; MIDI
        </button>
        <button
          ref={loadControlsTriggerRef}
          onClick={() => void loadDetail("sheet")}
          disabled={loading}
          className="min-h-11 px-4 py-2 rounded-full border border-zinc-300 font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? "Loading controls…" : "Load practice controls"}
        </button>
      </div>

      {shellErrorPresence.mounted && (
        <div
          className="motion-presence mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-state={shellErrorPresence.visible ? "open" : "closed"}
          aria-hidden={!error}
          role="alert"
        >
          <p>{error}</p>
          <button onClick={() => {
            void loadDetail(requestedMode);
            window.requestAnimationFrame(() => loadControlsTriggerRef.current?.focus());
          }} className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100">
            Retry
          </button>
        </div>
      )}

      <div className="player-surface rounded-2xl border border-zinc-200 bg-white mb-4">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 flex-wrap">
          <span className="text-sm text-zinc-600">Sheet Music</span>
          {shellLoadingPresence.mounted && (
            <span
              className="motion-presence text-xs text-zinc-500"
              data-state={shellLoadingPresence.visible ? "open" : "closed"}
              aria-hidden={!loading}
              role="status"
            >
              Loading practice controls…
            </span>
          )}
        </div>
        <div className="player-stage relative" role="region" aria-label="Player stage — Sheet Music">
          <SheetMusicView songId={initial.song.id} />
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Sheet Music view active</p>
        </div>
      </div>

      {displayVariants.length > 1 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Same song, other levels</h2>
          <div className="flex flex-wrap gap-2">
            {displayVariants.map((variant) => (
              <Link
                key={variant.id}
                href={`/player/${variant.id}`}
                className={`px-3 py-2 rounded-full text-sm border ${variant.id === initial.song.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              >
                {levelLabel(variant.difficulty)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {showDownload && <DownloadDialog songId={initial.song.id} hasSheetXml={initial.song.hasSheetXml === 1} onClose={() => {
        setShowDownload(false);
        window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
      }} />}

      <section className="mt-8 text-sm text-zinc-600">
        <h2 className="font-semibold text-zinc-800 mb-2">About this arrangement</h2>
        <p>Key of {initial.song.key} · {initial.song.tempo} BPM · {initial.song.bassPattern} bass</p>
        <p className="mt-2 text-zinc-500">Load practice controls to play, transpose, or switch to another learning view.</p>
      </section>
    </div>
  );

  if (detailSwitch.current && detail) {
    return (
      <div className="player-shell-swap">
        {detailSwitch.previous === false && (
          <div ref={shellExitRef} className="player-shell-swap-exit" aria-hidden="true">
            {shell}
          </div>
        )}
        <div className="player-shell-swap-enter">
          <FullPlayer initial={detail} mode={requestedMode} focusTarget={detailSwitch.previous === false ? "practice" : undefined} />
        </div>
      </div>
    );
  }
  return shell;
}

export function Player({ initial, mode }: { initial: PlayerInitial; mode: ViewMode | null }) {
  return isPlayerDetail(initial)
    ? <FullPlayer initial={initial} mode={mode} />
    : <PlayerShellView key={`${initial.song.id}:${mode ?? "sheet"}`} initial={initial} mode={mode} />;
}
