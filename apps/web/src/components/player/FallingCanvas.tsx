"use client";

import React, { useEffect, useRef } from "react";
import {
  createFallingChordIndex,
  createFallingNoteIndex,
  fallingBarsIndexed,
  fallingChordRange,
  fallingNoteRange,
  keyboardRects,
  lastFallingChordIndex,
  noteLabel,
  pitchColor,
  secPerBeat,
  upcomingMidi,
  type LoopRegion,
  type FallingChordIndex,
  type FallingNoteIndex,
  type PlayerSettings,
  type TimedNote,
} from "@keyspilli/player-core";

interface Props {
  notes: TimedNote[];
  time: number;
  /** Live engine clock. When supplied it wins over the time prop so the
   * canvas can redraw at frame rate without re-rendering the whole player. */
  timeRef?: { current: number };
  /** Keep the animation loop idle while the transport is paused. */
  playing: boolean;
  settings: PlayerSettings;
  pressedKeys: Map<number, number>;
  chords: { beat: number; name: string; notes: number[] }[];
  tempoBpm: number;
  timeSig?: [number, number];
  lowMidi: number;
  highMidi: number;
  loop: LoopRegion | null;
  waitNote?: TimedNote | null;
}

export function FallingCanvas({ notes, time, timeRef, playing, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop, waitNote, timeSig = [4, 4] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
  }, [notes, time, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop, waitNote, timeSig]);

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
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const speed = s.speed;
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
        ctx.strokeStyle = isDownbeat ? "rgba(24, 24, 27, 0.12)" : "rgba(24, 24, 27, 0.04)";
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
      const activeChordEventIndex = lastFallingChordIndex(chordIndex, currentBeat);
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
        ctx.fillStyle = isActive ? "#2563eb" : "#18181b";
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
        ctx.fillStyle = "#52525b";
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
     for (const w of kb.whites) {
       const kx = w.x + LEFT_MARGIN;
       const isChord = s.chordKeys && activeChordNotes.has(w.midi) && !pk.has(w.midi);
       const isWait = currentWaitNote && w.midi === currentWaitNote.midi && !pk.has(w.midi);
       ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
       ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
       ctx.strokeStyle = "#d4d4d8";
       ctx.strokeRect(kx, H - KB_H, w.w - 1, KB_H);
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
       } else if (isChord) {
         // Chord key: tinted body + thick colored strip + border
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = pitchColor(w.midi);
          ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
          ctx.globalAlpha = 1;
          ctx.fillStyle = pitchColor(w.midi);
          ctx.fillRect(kx, H - 44, w.w - 1, 44);
          ctx.fillStyle = "#ffffff";
          ctx.font = "700 13px system-ui, sans-serif";
          ctx.strokeStyle = pitchColor(w.midi);
          ctx.lineWidth = 2;
          ctx.strokeRect(kx + 1, H - KB_H, w.w - 3, KB_H);
        } else {
          ctx.fillStyle = pk.has(w.midi) ? "#ffffff" : "#52525b";
        }
        if (ctx.measureText(noteLabel(w.midi)).width + 4 <= w.w) ctx.fillText(noteLabel(w.midi), kx + w.w / 2, H - 18);
      }
     for (const b of kb.blacks) {
       const kx = b.x + LEFT_MARGIN;
       const isChordB = s.chordKeys && activeChordNotes.has(b.midi) && !pk.has(b.midi);
       const isWaitB = currentWaitNote && b.midi === currentWaitNote.midi && !pk.has(b.midi);
       ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
       ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
       if (isWaitB) {
         ctx.fillStyle = "#f59e0b";
         ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
         ctx.strokeStyle = "#b45309";
         ctx.lineWidth = 3;
         ctx.strokeRect(kx, H - KB_H, b.w, KB_H * 0.62);
       } else if (isChordB) {
         ctx.fillStyle = pitchColor(b.midi);
          ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
          ctx.strokeStyle = pitchColor(b.midi);
          ctx.lineWidth = 2;
          ctx.strokeRect(kx, H - KB_H, b.w, KB_H * 0.62);
        }
        if (b.w >= 17) {
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(b.midi) || isChordB ? "#ffffff" : "#d4d4d8";
          if (ctx.measureText(noteLabel(b.midi)).width + 4 <= b.w) ctx.fillText(noteLabel(b.midi), kx + b.w / 2, H - KB_H * 0.38 - 8);
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
      ctx.fillStyle = "#71717a";
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
      const currentLabels = new Set<string>();
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
        } else if (b.y + b.height >= areaHeight - 24 && b.y <= areaHeight) {
          currentLabels.add(`${isLeft ? "L" : "R"} ${b.label}`);
        }
      }
      if (currentLabels.size) {
        let cue = [...currentLabels].join(" · ");
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(LEFT_MARGIN, 24, KEYBOARD_W, 18);
        ctx.fillStyle = "#18181b";
        while (cue.length > 1 && ctx.measureText(cue).width > KEYBOARD_W - 8) cue = cue.slice(0, -2).trimEnd() + "…";
        ctx.fillText(cue, LEFT_MARGIN + 4, 26);
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

  return (
    <div className="falling-canvas relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="block h-full w-full" />
      <div className="absolute top-1 right-3 bg-white/90 px-1 text-[11px] text-zinc-700 pointer-events-none">LH: pale · RH: solid</div>
    </div>
  );
}
