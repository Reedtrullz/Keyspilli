"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AudioEngine,
  KeyboardInput,
  MidiInput,
  Grader,
  loadSettings,
  saveSettings,
  resolveTimedNotes,
  DEFAULT_SETTINGS,
  type PlayerSettings,
  type ViewMode,
  type SongData,
} from "@keyspilli/player-core";
import type { SongRow } from "@keyspilli/catalog";
import { FallingCanvas } from "./FallingCanvas";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";
import { SheetMusicView } from "./SheetMusicView";
import { SettingsDialog } from "./SettingsDialog";
import { DownloadDialog } from "./DownloadDialog";
import { GradingPanel } from "./GradingPanel";
import { loadJson, saveJson } from "@keyspilli/player-core";

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

export function Player({ initial, mode }: { initial: PlayerDetail; mode: ViewMode | null }) {
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    const s = loadSettings();
    if (mode) s.mode = mode;
    return s;
  });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [grading, setGrading] = useState(false);
  const [waitMode, setWaitMode] = useState(false);
  const [gradeResult, setGradeResult] = useState<string | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [midiConnected, setMidiConnected] = useState(false);
  const [songKeyLabel, setSongKeyLabel] = useState(initial.data.key);
  const [favorites, setFavorites] = useState<string[]>(() => loadJson("keyspilli.favorites", [] as string[]));
  const [learned, setLearned] = useState<string[]>(() => loadJson("keyspilli.learned", [] as string[]));

  const audioRef = useRef<AudioEngine | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const posRef = useRef(0);
  const lastScheduledRef = useRef(0);
  const graderRef = useRef<Grader | null>(null);
  const waitRef = useRef(false);
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  const settingsRef = useRef(settings);
  const dataRef = useRef(initial.data);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  settingsRef.current = settings;
  dataRef.current = initial.data;
  waitRef.current = waitMode;
  loopRef.current = loop;

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AudioEngine();
      audioRef.current.setGains(settingsRef.current.voiceGain, settingsRef.current.pianoGain);
    }
    return audioRef.current;
  }, []);

  const notes = useMemo(
    () =>
      resolveTimedNotes(initial.data, settings.speed, settings.transpose).filter((n) => {
        if (settings.hand === "L") return n.hand === "L";
        if (settings.hand === "R") return n.hand === "R";
        return true;
      }),
    [initial.data, settings.speed, settings.transpose, settings.hand],
  );

  const duration = useMemo(
    () => notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 8),
    [notes],
  );

  const scheduleWindow = useCallback((from: number, to: number) => {
    const eng = audioRef.current;
    if (!eng) return;
    from = Math.max(from, posRef.current);
    for (const n of notes) {
      if (n.startSec >= from && n.startSec < to && (n.hand === "L" ? settingsRef.current.backgroundMode === "piano" : true)) {
        eng.noteOn(n, Math.max(0, n.startSec - posRef.current));
      }
    }
    if (settingsRef.current.metronome && settingsRef.current.backgroundMode !== "chord") {
      const beat = 60 / initial.data.tempoBpm / settingsRef.current.speed;
      for (let t = Math.ceil(from / beat) * beat; t < to; t += beat) {
        const beatIndex = Math.round(t / beat);
        eng.metronomeClick(beatIndex % (initial.data.timeSig[0] * (4 / initial.data.timeSig[1])) === 0 ? 0 : 1, Math.max(0, t - posRef.current));
      }
    }
    lastScheduledRef.current = to;
  }, [notes, initial.data.tempoBpm, initial.data.timeSig]);

  const startPlayback = useCallback(() => {
    const eng = audio();
    eng.ensure();
    playingRef.current = true;
    setPlaying(true);
    posRef.current = timeRef.current;
    lastScheduledRef.current = timeRef.current;
    scheduleWindow(timeRef.current, timeRef.current + 0.12);
    void fetch(`/api/songs/${initial.song.id}/play`, { method: "POST" });
  }, [audio, scheduleWindow, initial.song.id]);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (audioRef.current) {
      audioRef.current.dispose();
      audioRef.current = null;
    }
  }, []);

  const seek = useCallback((t: number) => {
    const next = Math.max(0, Math.min(duration, t));
    posRef.current = next;
    timeRef.current = next;
    lastScheduledRef.current = next;
    setTime(next);
  }, [duration]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) stopPlayback();
    else startPlayback();
  }, [startPlayback, stopPlayback]);

  // Main rAF loop
  useEffect(() => {
    if (!playingRef.current) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = posRef.current + dt;
      if (loopRef.current && next > loopRef.current.end) {
        posRef.current = loopRef.current.start;
        audioRef.current?.dispose();
        audioRef.current = null;
        audio().ensure();
        lastScheduledRef.current = posRef.current;
        scheduleWindow(posRef.current, posRef.current + 0.12);
      } else {
        posRef.current = next;
      }
      if (posRef.current >= duration && !loopRef.current) {
        stopPlayback();
        seek(0);
        return;
      }
      scheduleWindow(lastScheduledRef.current, posRef.current + 0.12);
      if (graderRef.current && !waitRef.current) graderRef.current.tick(posRef.current);
      timeRef.current = posRef.current;
      setTime(posRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, audio, scheduleWindow, stopPlayback, seek, duration]);

  // Keyboard + MIDI input
  useEffect(() => {
    const ki = new KeyboardInput({
      onNoteOn: (m) => handleNote(m, true),
      onNoteOff: (m) => handleNote(m, false),
    });
    const onKey = (e: KeyboardEvent) => ki.handleKey(e);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowModeMenu(false);
        setShowSettings(false);
        setShowDownload(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (showModeMenu && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [showModeMenu]);

  function handleNote(midi: number, on: boolean) {
    if (!on) {
      audioRef.current?.noteOff(midi);
      setPressedKeys((s) => {
        const n = new Set(s);
        n.delete(midi);
        return n;
      });
      return;
    }
    if (grading && graderRef.current) {
      const accepted = graderRef.current.play(midi, posRef.current);
      if (!accepted) return;
    }
    const n = { midi, startSec: 0, durSec: 0.4, vel: 100, hand: "R" as const };
    audioRef.current?.noteOn(n);
    setPressedKeys((s) => new Set(s).add(midi));
  }

  function handleMicNote(midi: number) {
    if (grading && graderRef.current) {
      graderRef.current.play(midi, posRef.current);
    }
    const n = { midi, startSec: 0, durSec: 0.35, vel: 90, hand: "R" as const };
    audioRef.current?.noteOn(n);
  }

  function toggleLoop() {
    if (loop) {
      setLoop(null);
      return;
    }
    const measures = 4 * (initial.data.timeSig[0] * (4 / initial.data.timeSig[1]));
    const secPerBeat = 60 / initial.data.tempoBpm / settings.speed;
    const end = timeRef.current + measures * secPerBeat;
    setLoop({ start: timeRef.current, end });
  }

  function seekToMeasure(i: number) {
    const m = initial.data.measures[i];
    if (m) seek(m.startBeat * (60 / initial.data.tempoBpm / settings.speed));
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
    const next = { ...settingsRef.current, ...p };
    setSettings(next);
    audioRef.current?.setGains(next.voiceGain, next.pianoGain);
    saveSettings(next);
  }

  function startGrading(wait: boolean) {
    setWaitMode(wait);
    setGrading(true);
    setGradeResult(null);
    stopPlayback();
    seek(0);
    graderRef.current = new Grader(notes, { waitMode: wait });
  }

  function finishGrading() {
    if (graderRef.current) setGradeResult(graderRef.current.result().summary);
    graderRef.current = null;
    setGrading(false);
    setWaitMode(false);
  }

  const waitNote = grading && waitMode ? graderRef.current?.currentWait : null;
  const currentMeasure = Math.min(
    initial.data.measures.length - 1,
    Math.floor((time / (60 / initial.data.tempoBpm / settings.speed)) / (initial.data.timeSig[0] * (4 / initial.data.timeSig[1]))),
  );
  const activeModeLabel = MODES.find((m) => m.id === settings.mode)?.label ?? settings.mode;
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
          {midiConnected && <span className="px-2 py-1 rounded-full bg-green-100 text-green-800">MIDI connected</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" ref={modeMenuRef}>
          <button
            onClick={() => setShowModeMenu((s) => !s)}
            className="min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            aria-expanded={showModeMenu}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{MODES.find((m) => m.id === settings.mode)?.label}</span>
          </button>
          {showModeMenu && (
            <div className="absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2" role="menu">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="menuitemradio"
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

        <div className="ml-auto flex flex-wrap justify-end gap-2 text-sm">
          <button onClick={() => setShowDownload(true)} className="min-h-11 px-4 py-2 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700">
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
          <button onClick={togglePlay} className="w-12 h-12 rounded-full bg-zinc-900 text-white text-lg shadow-sm hover:bg-zinc-700" aria-label={playing ? "Pause" : "Play"}>
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
            <button onClick={() => updateSettings({ speed: Math.max(0.25, +(settings.speed - 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs">−</button>
            <span className="px-2 text-xs font-medium" title="Practice speed">{Math.round(settings.speed * 100)}%</span>
            <button onClick={() => updateSettings({ speed: Math.min(2, +(settings.speed + 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs">+</button>
          </div>
          <div className="flex items-center gap-1" aria-label="Transpose">
            <button onClick={() => updateSettings({ transpose: settings.transpose - 1 })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs">−</button>
            <span className="px-2 text-xs font-medium">
              Key {songKeyLabel} {settings.transpose ? `(${settings.transpose > 0 ? "+" : ""}${settings.transpose})` : ""}
            </span>
            <button onClick={() => updateSettings({ transpose: settings.transpose + 1 })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs">+</button>
            {settings.transpose !== 0 && (
              <button onClick={() => updateSettings({ transpose: 0 })} className="min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs text-zinc-500">
                Reset
              </button>
            )}
          </div>
          <output role="timer" aria-label="Elapsed time" className="ml-auto text-xs text-zinc-500 font-mono tabular-nums w-[5ch] text-right select-none">
            {fmtTime(time)}
          </output>
        </div>

        <div
          className={`relative ${playing && !grading ? "cursor-pointer" : ""}`}
          onClick={() => {
            if (playing && !grading) stopPlayback();
          }}
          role="region"
          aria-label={`Player stage — ${activeModeLabel}`}
        >
          {settings.mode === "falling" && <FallingCanvas notes={notes} timeRef={timeRef} settings={settings} pressedKeys={pressedKeys} chords={initial.data.chords} tempoBpm={initial.data.tempoBpm} />}
          {settings.mode === "beginner" && <BeginnerView data={initial.data} time={time} settings={settings} />}
          {settings.mode === "leadsheet" && <LeadSheetView data={initial.data} time={time} settings={settings} />}
          {settings.mode === "sheet" && <SheetMusicView songId={initial.song.id} />}
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
