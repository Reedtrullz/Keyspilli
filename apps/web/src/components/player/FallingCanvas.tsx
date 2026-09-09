"use client";

import React, { useEffect, useRef } from "react";
import {
  createFallingChordIndex,
  createFallingNoteIndex,
  fallingBarsIndexed,
  fallingChordRange,
  fallingNoteRange,
  keyboardRects,
  keyboardMidiAt,
  KEYMAP,
  lastFallingChordIndex,
  noteLabel,
  pitchColor,
  secPerBeat,
  measureProgressAt,
  upcomingMidi,
  type LoopRegion,
  type FallingChordIndex,
  type FallingNoteIndex,
  type PlayerSettings,
  type TimedNote,
} from "@keyspilli/player-core";

interface Props {
  measures?: { startBeat: number; endBeat: number }[];
  countIn?: number | null;
  inputEnabled?: boolean;
  onKeyDown?: (pointerId: number, midi: number) => void;
  onKeyUp?: (pointerId: number) => void;
  inputOctave?: number;
  midiConnected?: boolean;
  onResetOctave?: () => void;
  notes: TimedNote[];
  time: number;
  /** Live engine clock. When supplied it wins over the time prop so the
   * canvas can redraw at frame rate without re-rendering the whole player. */
  timeRef?: { current: number };
  /** Keep the animation loop idle while the transport is paused. */
  playing: boolean;
  settings: PlayerSettings;
  pressedKeys: Map<number, number>;
  chords: { beat: number; name: string; notes: number[]; durationBeats?: number }[];
  tempoBpm: number;
  timeSig?: [number, number];
  lowMidi: number;
  highMidi: number;
  loop: LoopRegion | null;
  waitNote?: TimedNote | null;
}

export function FallingCanvas({ measures = [], countIn = null, inputEnabled = true, onKeyDown, onKeyUp, inputOctave = 2, midiConnected = false, onResetOctave, notes, time, timeRef, playing, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop, waitNote, timeSig = [4, 4] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rhythmLabelRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLProgressElement>(null);
  const rhythmRef = useRef({ measures, countIn });
  rhythmRef.current = { measures, countIn };
  const selectedLabelRef = useRef<HTMLSpanElement>(null);
  const pianoRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<ReturnType<typeof keyboardRects> | null>(null);
  const pointersRef = useRef(new Map<number, number | null>());
  const selectedRef = useRef(60);
  const callbacks = useRef({ onKeyDown, onKeyUp });
  callbacks.current = { onKeyDown, onKeyUp };
  const inputOctaveRef = useRef(inputOctave);
  inputOctaveRef.current = inputOctave;

  // Individual refs for each prop — draw loop reads these instead of closures
  const fallbackTimeRef = useRef(time);
  const notesRef = useRef(notes);
  const noteIndexRef = useRef<FallingNoteIndex | null>(null);
  const settingsRef = useRef(settings);
  const pressedKeysRef = useRef(pressedKeys);
  const chordIndexRef = useRef<FallingChordIndex<Props["chords"][number]> | null>(null);
  const tempoBpmRef = useRef(tempoBpm);
  const lowMidiRef = useRef(lowMidi);
  const highMidiRef = useRef(highMidi);
  const loopRef = useRef(loop);
  const waitNoteRef = useRef(waitNote);
  const timeSigRef = useRef(timeSig);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const drawRef = useRef<(() => void) | null>(null);
  const rafRef = useRef(0);

  // Lightweight sync: props → refs (no rAF involved)
  useEffect(() => { fallbackTimeRef.current = time; }, [time]);
  useEffect(() => {
    notesRef.current = notes;
    noteIndexRef.current = createFallingNoteIndex(notes);
  }, [notes]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { pressedKeysRef.current = pressedKeys; }, [pressedKeys]);
  useEffect(() => {
    chordIndexRef.current = createFallingChordIndex(chords);
  }, [chords]);
  useEffect(() => { tempoBpmRef.current = tempoBpm; }, [tempoBpm]);
  useEffect(() => { lowMidiRef.current = lowMidi; }, [lowMidi]);
  useEffect(() => { highMidiRef.current = highMidi; }, [highMidi]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { waitNoteRef.current = waitNote; }, [waitNote]);
  useEffect(() => { timeSigRef.current = timeSig; }, [timeSig]);
  const liveTime = timeRef ?? fallbackTimeRef;

  // When paused, refs still receive updates for seeks/settings/input, but a
  // single redraw is enough. During playback the animation loop below reads
  // the refs directly and does not need an extra React-driven draw.
  useEffect(() => {
    if (!playingRef.current) drawRef.current?.();
  }, [notes, time, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop, waitNote, timeSig, inputOctave, measures, countIn]);

  // Single rAF loop — draws once on mount and only schedules frames while
  // playing, reading state from refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let appliedClientW = 0;
    let appliedClientH = 0;
    let appliedDpr = 0;
    let keyboardWidthCache = 0;
    let keyboardHeightCache = 0;
    let keyboardLowCache = Number.NaN;
    let keyboardHighCache = Number.NaN;
    let keyboardCache: ReturnType<typeof keyboardRects> | null = null;
    const barsCache: ReturnType<typeof fallingBarsIndexed> = [];
    const upcomingCache = new Set<number>();
    const noteRangeCache = { start: 0, end: 0 };
    const chordRangeCache = { start: 0, end: 0 };
    const activeChordNotes = new Set<number>();
    let activeChordIndex = -2;
    let activeChordIndexSource: FallingChordIndex<Props["chords"][number]> | null = null;
    let chordWidth = 0;
    let measuredChordSource: FallingChordIndex<Props["chords"][number]> | null = null;

    const draw = () => {
      rafRef.current = 0;
      const W = Math.max(1, canvas.clientWidth);
      const H = Math.max(1, canvas.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      if (W !== appliedClientW || H !== appliedClientH || dpr !== appliedDpr) {
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        appliedClientW = W;
        appliedClientH = H;
        appliedDpr = dpr;
      }
      // Read all state from refs (stable across frames)
      const now = liveTime.current;
      const currentNotes = notesRef.current;
      const s = settingsRef.current;
      const pk = pressedKeysRef.current;
      const bpm = tempoBpmRef.current;
      const low = lowMidiRef.current;
      const high = highMidiRef.current;
      const currentLoop = loopRef.current;
      const currentWaitNote = waitNoteRef.current;
      ctx.clearRect(0, 0, W, H);
      const dark = s.stageTheme === "charcoal";
      ctx.fillStyle = dark ? "#15181e" : "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const speed = s.speed;
      const progress = measureProgressAt(now / secPerBeat(bpm, speed), rhythmRef.current.measures);
      if (progressRef.current) {
        progressRef.current.hidden = !progress || rhythmRef.current.countIn !== null;
        progressRef.current.value = progress?.fraction ?? 0;
        const label = rhythmRef.current.countIn !== null ? `Count in: ${rhythmRef.current.countIn}` : progress ? `Bar ${progress.index + 1} progress` : "Bar progress";
        if (rhythmLabelRef.current && rhythmLabelRef.current.textContent !== label.replace(" progress", "")) rhythmLabelRef.current.textContent = progress || rhythmRef.current.countIn !== null ? label.replace(" progress", "") : "";
        if (progressRef.current.getAttribute("aria-label") !== label) progressRef.current.setAttribute("aria-label", label);
      }
      const lookahead = 3.2;
      const KB_H = Math.min(W < 640 ? 96 : 140, H * 0.45);
      const areaHeight = Math.max(1, H - KB_H - 10);
      const chordIndex = chordIndexRef.current!;
      const chordLabels = fallingChordRange(chordIndex, now / secPerBeat(bpm, speed), (now + lookahead) / secPerBeat(bpm, speed), chordRangeCache);
      ctx.font = "800 14px system-ui, sans-serif";
      // Keep pitch lanes fixed while time advances; measure once per chord set.
      if (measuredChordSource !== chordIndex) {
        chordWidth = 0;
        for (const chord of chordIndex.events) chordWidth = Math.max(chordWidth, ctx.measureText(chord.name).width);
        measuredChordSource = chordIndex;
      }
      const LEFT_MARGIN = Math.min(W * 0.25, Math.max(16, chordWidth + 16));
      const RIGHT_MARGIN = 16;
      const KEYBOARD_W = Math.max(1, W - LEFT_MARGIN - RIGHT_MARGIN);
      const pxPerSec = areaHeight / lookahead;

      // --- Beat grid lines ---
      const beatSec = secPerBeat(bpm, speed);
      const startBeat = Math.floor((now - 0.5) / beatSec);
      const endBeat = Math.ceil((now + lookahead) / beatSec);
      for (let b = startBeat; b <= endBeat; b++) {
        if (b < 0) continue;
        const bSec = b * beatSec;
        const y = areaHeight - (bSec - now) * pxPerSec;
        if (y < 0 || y > areaHeight) continue;
        // Downbeat spacing follows the song's actual meter, not a hardcoded 4.
        const isDownbeat = b % (timeSigRef.current[0] * 4 / timeSigRef.current[1]) === 0;
        ctx.strokeStyle = dark ? (isDownbeat ? "#484e59" : "#2d323b") : (isDownbeat ? "rgba(24, 24, 27, 0.12)" : "rgba(24, 24, 27, 0.04)");
        ctx.lineWidth = isDownbeat ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(LEFT_MARGIN, y);
        ctx.lineTo(W - RIGHT_MARGIN, y);
        ctx.stroke();
      }
      const noteIndex = noteIndexRef.current!;
      const bars = fallingBarsIndexed(noteIndex, {
        width: KEYBOARD_W, height: areaHeight, nowSec: now, speed,
        lookaheadSec: lookahead, lowMidi: low, highMidi: high,
      }, barsCache);
      const upcoming = upcomingMidi(bars, areaHeight, lookahead, 1, upcomingCache);

      // --- Determine current chord ---
      const currentBeat = now / beatSec;
      const previousChordIndex = lastFallingChordIndex(chordIndex, currentBeat);
      const previousChord = chordIndex.events[previousChordIndex];
      // Match the chord strip: legacy events last until the next event, but
      // explicit durations can leave a gap with no active harmony.
      const activeChordEventIndex = previousChord && (previousChord.durationBeats === undefined
        || (Number.isFinite(previousChord.durationBeats) && currentBeat < previousChord.beat + previousChord.durationBeats))
        ? previousChordIndex : -1;
      if (chordIndex !== activeChordIndexSource || activeChordEventIndex !== activeChordIndex) {
        activeChordNotes.clear();
        if (activeChordEventIndex >= 0) {
          for (const midi of chordIndex.events[activeChordEventIndex]!.notes) activeChordNotes.add(midi);
        }
        activeChordIndex = activeChordEventIndex;
        activeChordIndexSource = chordIndex;
      }
      let activeChordName = "";
      if (activeChordEventIndex >= 0) activeChordName = chordIndex.events[activeChordEventIndex]!.name;

      // --- Left-hand background zone ---
      let lxMin = Number.POSITIVE_INFINITY;
      let lxMax = Number.NEGATIVE_INFINITY;
      for (const b of bars) {
        if (b.hand !== "L") continue;
        if (b.x < lxMin) lxMin = b.x;
        if (b.x + b.width > lxMax) lxMax = b.x + b.width;
      }
      if (lxMin !== Number.POSITIVE_INFINITY) {
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = "#6366f1";
        ctx.fillRect(lxMin + LEFT_MARGIN - 16, 0, lxMax - lxMin + 32, areaHeight);
        ctx.globalAlpha = 1;
      }

      // --- Chord labels on the left margin ---
      for (let chordIdx = chordLabels.start; chordIdx < chordLabels.end; chordIdx++) {
        const c = chordIndex.events[chordIdx]!;
        const cSec = (c.beat * 60) / (bpm * speed);
        const bottom = areaHeight - (cSec - now) * pxPerSec;
        if (bottom < -30 || bottom > areaHeight + 30) continue;
        const y = Math.max(16, Math.min(areaHeight - 6, bottom - 4));
        const isActive = c.name === activeChordName;
        ctx.font = isActive ? "800 14px system-ui, sans-serif" : "700 13px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isActive ? (dark ? "#93c5fd" : "#2563eb") : (dark ? "#e4e4e7" : "#18181b");
        ctx.fillText(c.name, LEFT_MARGIN - 8, y, Math.max(1, LEFT_MARGIN - 12));
      }

      // --- Draw lyrics (right side) ---
      const lyricMarginSec = 20 / pxPerSec;
      const lyricRange = fallingNoteRange(noteIndex, now - lyricMarginSec, lookahead + 2 * lyricMarginSec, 0.05, noteRangeCache);
      for (let noteIdx = lyricRange.start; noteIdx < lyricRange.end; noteIdx++) {
        const n = currentNotes[noteIdx]!;
        if (!n.lyrics) continue;
        const bottom = areaHeight - (n.startSec - now) * pxPerSec;
        if (bottom < -20 || bottom > areaHeight + 20) continue;
        const y = Math.max(14, Math.min(areaHeight - 4, bottom - 4));
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = dark ? "#d4d4d8" : "#52525b";
        ctx.fillText(n.lyrics, W - RIGHT_MARGIN + 10, y);
      }

      // --- Keyboard ---
      if (keyboardLowCache !== low || keyboardHighCache !== high || keyboardWidthCache !== KEYBOARD_W || keyboardHeightCache !== KB_H || !keyboardCache) {
        keyboardWidthCache = KEYBOARD_W;
        keyboardHeightCache = KB_H;
        keyboardLowCache = low;
        keyboardHighCache = high;
        keyboardCache = keyboardRects({ width: KEYBOARD_W, lowMidi: low, highMidi: high, whiteHeight: KB_H });
      }
      const kb = keyboardCache!;
      keysRef.current = kb;
      const piano = pianoRef.current;
      if (piano) {
        piano.style.left = `${LEFT_MARGIN}px`; piano.style.width = `${KEYBOARD_W}px`; piano.style.height = `${KB_H}px`;
      }
      const showLabel = (midi: number) => s.keyboardLabels === "notes" || (s.keyboardLabels === "octaves" && midi % 12 === 0);
      const hintFor = (midi: number) => Object.entries(KEYMAP).find(([, base]) => base + (inputOctaveRef.current - 2) * 12 === midi)?.[0].toUpperCase();
     for (const w of kb.whites) {
       const kx = w.x + LEFT_MARGIN;
       const isChord = s.chordKeys && activeChordNotes.has(w.midi) && !pk.has(w.midi);
       const isWait = currentWaitNote && w.midi === currentWaitNote.midi && !pk.has(w.midi);
       ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
       ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
       ctx.lineWidth = 1;
       ctx.strokeStyle = "#d4d4d8";
       ctx.strokeRect(kx, H - KB_H, w.w - 1, KB_H);
       if (pk.has(w.midi)) {
         ctx.strokeStyle = "#18181b"; ctx.lineWidth = 2;
         ctx.strokeRect(kx + 2, H - KB_H + 2, Math.max(1, w.w - 5), KB_H - 7);
         ctx.lineWidth = 1;
       }
       ctx.font = "600 12px system-ui, sans-serif";
       ctx.textAlign = "center";
       ctx.textBaseline = "alphabetic";
       if (isWait) {
         ctx.fillStyle = "#fbbf24";
         ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
         ctx.strokeStyle = "#f59e0b";
         ctx.lineWidth = 3;
         ctx.strokeRect(kx + 1, H - KB_H, w.w - 3, KB_H);
         ctx.fillStyle = "#78350f";
       } else {
          ctx.fillStyle = pk.has(w.midi) ? "#ffffff" : "#52525b";
        }
        if (showLabel(w.midi) && ctx.measureText(noteLabel(w.midi)).width + 4 <= w.w) {
          const labelWidth = ctx.measureText(noteLabel(w.midi)).width;
          ctx.fillStyle = "#ffffff"; ctx.fillRect(kx + (w.w - labelWidth) / 2 - 1, H - 30, labelWidth + 2, 15);
          ctx.fillStyle = "#3f3f46"; ctx.fillText(noteLabel(w.midi), kx + w.w / 2, H - 18);
        }
        // Small bevels give keys depth without an animated shadow or new draw loop.
        ctx.fillStyle = "#18181b18"; ctx.fillRect(kx, H - 4, w.w - 1, 4);
        ctx.fillStyle = "#ffffff66"; ctx.fillRect(kx + 1, H - KB_H + 1, 1, KB_H - 6);
        if (w.midi === 60) { ctx.fillStyle = "#4338ca"; ctx.fillRect(kx + w.w / 2 - 2, H - 10, 4, 3); }
        const hint = s.showKeyBindings && KB_H >= 130 ? hintFor(w.midi) : undefined;
        if (hint && ctx.measureText(hint).width + 4 <= w.w) {
          ctx.fillStyle = "#f4f4f5"; ctx.fillRect(kx + w.w / 2 - Math.min(14, w.w - 2) / 2, H - 63, Math.min(14, w.w - 2), 15);
          ctx.fillStyle = "#3f3f46"; ctx.fillText(hint, kx + w.w / 2, H - 51);
        }
        if (isChord && !isWait) {
          ctx.beginPath();
          ctx.arc(kx + w.w / 2, H - 36, Math.min(4, w.w / 4), 0, Math.PI * 2);
          ctx.fillStyle = "#6366f1"; ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
     for (const b of kb.blacks) {
       const kx = b.x + LEFT_MARGIN;
       const isChordB = s.chordKeys && activeChordNotes.has(b.midi) && !pk.has(b.midi);
       const isWaitB = currentWaitNote && b.midi === currentWaitNote.midi && !pk.has(b.midi);
       ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
       ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
       ctx.fillStyle = "#ffffff22"; ctx.fillRect(kx + 2, H - KB_H + 2, Math.max(1, b.w - 4), 2);
       ctx.fillStyle = "#00000055"; ctx.fillRect(kx, H - KB_H * 0.38 - 4, b.w, 4);
       if (pk.has(b.midi)) {
         ctx.strokeStyle = "#fafafa"; ctx.lineWidth = 2;
         ctx.strokeRect(kx + 2, H - KB_H + 2, Math.max(1, b.w - 4), KB_H * 0.62 - 4);
         ctx.lineWidth = 1;
       }
       if (isWaitB) {
         ctx.fillStyle = "#f59e0b";
         ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
         ctx.strokeStyle = "#b45309";
         ctx.lineWidth = 3;
         ctx.strokeRect(kx, H - KB_H, b.w, KB_H * 0.62);
       }
        if (isChordB && !isWaitB) {
          ctx.beginPath();
          ctx.arc(kx + b.w / 2, H - KB_H * 0.38 - 25, Math.min(4, b.w / 4), 0, Math.PI * 2);
          ctx.fillStyle = "#6366f1"; ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
        if (b.w >= 17) {
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(b.midi) ? "#ffffff" : "#d4d4d8";
          if (showLabel(b.midi) && ctx.measureText(noteLabel(b.midi)).width + 4 <= b.w) {
            ctx.fillStyle = "#27272a"; ctx.fillRect(kx + 1, H - KB_H * 0.38 - 21, b.w - 2, 15);
            ctx.fillStyle = "#fafafa"; ctx.fillText(noteLabel(b.midi), kx + b.w / 2, H - KB_H * 0.38 - 8);
          }
          const hint = s.showKeyBindings && KB_H * 0.62 >= 52 ? hintFor(b.midi) : undefined;
          if (hint && ctx.measureText(hint).width + 4 <= b.w) {
            ctx.fillStyle = "#27272a"; ctx.fillRect(kx + 1, H - KB_H + 12, b.w - 2, 15);
            ctx.fillStyle = "#fafafa"; ctx.fillText(hint, kx + b.w / 2, H - KB_H + 24);
          }
        }
      }

      // Upcoming-note strips
      for (const key of kb.whites) {
        if (!upcoming.has(key.midi) || pk.has(key.midi)) continue;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = pitchColor(key.midi);
        ctx.fillRect(key.x + LEFT_MARGIN, H - KB_H, key.w, 8);
        ctx.globalAlpha = 1;
      }
      for (const key of kb.blacks) {
        if (!upcoming.has(key.midi) || pk.has(key.midi)) continue;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = pitchColor(key.midi);
        ctx.fillRect(key.x + LEFT_MARGIN, H - KB_H, key.w, 8);
        ctx.globalAlpha = 1;
      }

      // Playhead line
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(LEFT_MARGIN, areaHeight);
      ctx.lineTo(W - RIGHT_MARGIN, areaHeight);
      ctx.stroke();


      // --- Loop region (dashed lines + tinted band) ---
      if (currentLoop) {
        const yStart = areaHeight - (currentLoop.startSec - now) * pxPerSec;
        const yEnd = areaHeight - (currentLoop.endSec - now) * pxPerSec;
        const top = Math.min(yStart, yEnd);
        const bottom = Math.max(yStart, yEnd);
        if (bottom > 0 && top < areaHeight) {
          ctx.fillStyle = "rgba(79,70,229,0.08)";
          ctx.fillRect(LEFT_MARGIN, Math.max(0, top), W - LEFT_MARGIN - RIGHT_MARGIN, Math.min(areaHeight, bottom) - Math.max(0, top));
        }
        ctx.strokeStyle = "#4f46e5";
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        for (const y of [yStart, yEnd]) {
          if (y < 0 || y > areaHeight) continue;
          ctx.beginPath();
          ctx.moveTo(LEFT_MARGIN, y);
          ctx.lineTo(W - RIGHT_MARGIN, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // --- Out-of-range edge indicators ---
      let below = 0;
      let above = 0;
      const edgeRange = fallingNoteRange(noteIndex, now, lookahead, 0.05, noteRangeCache);
      for (let noteIdx = edgeRange.start; noteIdx < edgeRange.end; noteIdx++) {
        const n = currentNotes[noteIdx]!;
        if (n.startSec > now + lookahead || n.startSec + n.durSec < now - 0.05) continue;
        if (n.midi < low) below++;
        else if (n.midi > high) above++;
      }
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.fillStyle = dark ? "#d4d4d8" : "#71717a";
      if (below > 0) {
        ctx.beginPath();
        ctx.moveTo(LEFT_MARGIN + 2, H - KB_H + 8);
        ctx.lineTo(LEFT_MARGIN + 12, H - KB_H + 8);
        ctx.lineTo(LEFT_MARGIN + 7, H - KB_H - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillText(String(below), LEFT_MARGIN + 16, H - KB_H + 8);
      }
      if (above > 0) {
        const rx = W - RIGHT_MARGIN - 12;
        ctx.beginPath();
        ctx.moveTo(rx, H - KB_H + 8);
        ctx.lineTo(rx + 10, H - KB_H + 8);
        ctx.lineTo(rx + 5, H - KB_H - 2);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = "left";
        ctx.fillText(String(above), rx + 14, H - KB_H + 8);
        ctx.textAlign = "center";
      }

      // Hand styling stays inside each pitch lane so dense chords do not overlap.
      for (const b of bars) {
        const bx = Math.max(LEFT_MARGIN, b.x + LEFT_MARGIN);
        const width = Math.max(0, Math.min(b.width, W - RIGHT_MARGIN - bx));
        if (!width) continue;
        const isLeft = b.hand === "L";
        ctx.globalAlpha = isLeft ? 0.45 : 1;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(bx, b.y, width, b.height, 4);
        else ctx.rect(bx, b.y, width, b.height);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isLeft) {
          ctx.fillStyle = "#312e81";
          ctx.fillRect(bx, b.y, Math.min(2, width), b.height);
        }
        ctx.font = "600 12px system-ui, sans-serif";
        if (b.height >= 16 && ctx.measureText(b.label).width + 6 <= width) {
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          // A solid light label backing gives consistent contrast for every pitch colour.
          const labelWidth = ctx.measureText(b.label).width;
          const labelY = Math.max(8, Math.min(b.y + b.height / 2, areaHeight - 8));
          ctx.fillStyle = "#fafafa";
          ctx.fillRect(bx + (width - labelWidth) / 2 - 2, labelY - 7, labelWidth + 4, 14);
          ctx.fillStyle = "#18181b";
          ctx.fillText(b.label, bx + width / 2, labelY);
        }
      }
      if (playingRef.current) rafRef.current = requestAnimationFrame(draw);
    };
    drawRef.current = draw;
    draw();
    const resize = () => {
      cancelAnimationFrame(rafRef.current);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, []);

  // A paused canvas still needs one frame when playback starts/stops. Cancel
  // any queued callback first so rapid play/pause toggles cannot create two
  // concurrent loops.
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    drawRef.current?.();
  }, [playing]);

  function releasePointers() {
    for (const id of pointersRef.current.keys()) callbacks.current.onKeyUp?.(id);
    pointersRef.current.clear();
  }
  useEffect(() => {
    releasePointers();
    const hidden = () => { if (document.hidden) releasePointers(); };
    window.addEventListener("blur", releasePointers);
    window.addEventListener("resize", releasePointers);
    document.addEventListener("visibilitychange", hidden);
    return () => { releasePointers(); window.removeEventListener("blur", releasePointers); window.removeEventListener("resize", releasePointers); document.removeEventListener("visibilitychange", hidden); };
  }, [inputEnabled, lowMidi, highMidi, settings.soundSource, settings.organStyle]);

  function movePointer(id: number, clientX: number, clientY: number) {
    const box = pianoRef.current?.getBoundingClientRect();
    const keys = keysRef.current;
    if (!box || !keys) return;
    const midi = keyboardMidiAt(clientX - box.left, clientY - box.top, keys);
    if (pointersRef.current.get(id) === midi) return;
    callbacks.current.onKeyUp?.(id);
    pointersRef.current.set(id, midi);
    if (midi !== null) callbacks.current.onKeyDown?.(id, midi);
  }

  return (
    <div className="falling-canvas relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" aria-description="The indigo landmark marks middle C. The keyboard range stays fixed throughout the arrangement." className="block w-full" style={{ height: "calc(100% - 24px)" }} />
      <div ref={pianoRef} className="piano-pointer-surface absolute bottom-6 touch-none outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
        role="button" tabIndex={0} aria-label="Piano keyboard" aria-disabled={!inputEnabled}
        aria-description={inputEnabled ? "Play with touch, mouse or computer keys. Arrow keys select a note; Enter or Space holds it. The indigo mark is middle C." : "On-screen input is unavailable during setup, count-in, or a MIDI/microphone-only attempt."}
        onPointerDown={event => {
          if (!inputEnabled || (event.pointerType === "mouse" && event.button !== 0)) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointersRef.current.set(event.pointerId, null);
          movePointer(event.pointerId, event.clientX, event.clientY);
        }}
        onPointerMove={event => { if (inputEnabled && pointersRef.current.has(event.pointerId)) movePointer(event.pointerId, event.clientX, event.clientY); }}
        onPointerUp={event => { callbacks.current.onKeyUp?.(event.pointerId); pointersRef.current.delete(event.pointerId); }}
        onPointerCancel={event => { callbacks.current.onKeyUp?.(event.pointerId); pointersRef.current.delete(event.pointerId); }}
        onLostPointerCapture={event => { callbacks.current.onKeyUp?.(event.pointerId); pointersRef.current.delete(event.pointerId); }}
        onClick={event => event.stopPropagation()}
        onBlur={releasePointers}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (!inputEnabled) return;
          if (event.key === "Enter" || event.key === " ") {
            if (!event.repeat) { const id = event.key === "Enter" ? -1 : -2; selectedRef.current = Math.min(highMidi, Math.max(lowMidi, selectedRef.current)); pointersRef.current.set(id, selectedRef.current); callbacks.current.onKeyDown?.(id, selectedRef.current); }
          } else {
            const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? 12 : -12;
            selectedRef.current = Math.min(highMidi, Math.max(lowMidi, selectedRef.current + step));
            event.currentTarget.setAttribute("aria-label", `Piano keyboard, ${noteLabel(selectedRef.current, true)} selected`);
            if (selectedLabelRef.current) selectedLabelRef.current.textContent = `${noteLabel(selectedRef.current, true)} selected`;
          }
        }}
        onKeyUp={event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); const id = event.key === "Enter" ? -1 : -2; callbacks.current.onKeyUp?.(id); pointersRef.current.delete(id); }
        }} />
      <div className="piano-input-status flex h-6 items-center gap-2 px-3 text-[11px] bg-zinc-100 text-zinc-700 overflow-hidden whitespace-nowrap" onClick={event => event.stopPropagation()}>
        <span className="min-w-0 truncate">{midiConnected ? "MIDI connected · " : "Computer keys · "}{noteLabel(60 + (inputOctave - 2) * 12)}–{noteLabel(76 + (inputOctave - 2) * 12, true)} · Z/X octave</span>
        {(60 + (inputOctave - 2) * 12 < lowMidi || 76 + (inputOctave - 2) * 12 > highMidi) && <button className="shrink-0 underline" onClick={onResetOctave} title="Computer input extends outside the visible piano">Outside view · Reset</button>}
        <span ref={selectedLabelRef} className="sr-only" aria-live="polite" />
        <span ref={rhythmLabelRef} className="ml-auto shrink-0" />
        <progress ref={progressRef} max={1} value={0} aria-label="Bar progress" className="h-1 w-12 shrink-0 accent-indigo-600 motion-reduce:hidden" />
      </div>
      <div className="absolute top-1 right-3 bg-white/90 px-1 text-[11px] text-zinc-700 pointer-events-none">LH: pale · RH: solid{settings.chordKeys && <span> · <span className="text-indigo-500" aria-hidden="true">●</span> Chord guide</span>} · Top strip: next note</div>
    </div>
  );
}
