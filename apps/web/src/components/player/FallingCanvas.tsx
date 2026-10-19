"use client";

import { useEffect, useRef } from "react";
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
  /** Static fallback clock for callers without a live store or ref. */
  time?: number;
  /** Clock store: a seek while paused redraws without re-rendering the canvas. */
  timeStore?: { get(): number; subscribe(listener: () => void): () => void };
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

export function FallingCanvas({ notes, time = 0, timeStore, timeRef, playing, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop, waitNote, timeSig = [4, 4] }: Props) {
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

  // Seeks while paused arrive through the store; the playing loop reads the
  // live ref each frame and ignores these notifications.
  useEffect(() => {
    if (!timeStore) return;
    return timeStore.subscribe(() => {
      fallbackTimeRef.current = timeStore.get();
      if (!playingRef.current) drawRef.current?.();
    });
  }, [timeStore]);

  // Single rAF loop — draws once on mount and only schedules frames while
  // playing, reading state from refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 960;
    const H = 540;
    const KB_H = 140;
    const LEFT_MARGIN = 32;
    const RIGHT_MARGIN = 32;
    const KEYBOARD_W = W - LEFT_MARGIN - RIGHT_MARGIN;
    // Fit the fixed logical space onto the element's real size each time it
    // changes, so narrow/mobile viewports scale instead of clipping.
    let appliedClientW = 0;
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

    // Keyboard drawing is split per key so the static bed can be cached while
    // highlighted keys (pressed, chord, wait) are redrawn on top.
    type KeyRect = { midi: number; x: number; w: number };
    const drawWhiteKey = (c: CanvasRenderingContext2D, w: KeyRect, pressed: boolean, isChord: boolean, isWait: boolean) => {
      const kx = w.x + LEFT_MARGIN;
      c.globalAlpha = 1;
      c.fillStyle = pressed ? pitchColor(w.midi) : "#ffffff";
      c.fillRect(kx, H - KB_H, w.w - 1, KB_H);
      c.strokeStyle = "#d4d4d8";
      c.lineWidth = 1;
      c.strokeRect(kx, H - KB_H, w.w - 1, KB_H);
      c.font = "600 12px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "alphabetic";
      if (isWait) {
        c.fillStyle = "#fbbf24";
        c.fillRect(kx, H - KB_H, w.w - 1, KB_H);
        c.strokeStyle = "#f59e0b";
        c.lineWidth = 3;
        c.strokeRect(kx + 1, H - KB_H, w.w - 3, KB_H);
        c.fillStyle = "#78350f";
      } else if (isChord) {
        // Chord key: tinted body + thick colored strip + border
        c.globalAlpha = 0.4;
        c.fillStyle = pitchColor(w.midi);
        c.fillRect(kx, H - KB_H, w.w - 1, KB_H);
        c.globalAlpha = 1;
        c.fillStyle = pitchColor(w.midi);
        c.fillRect(kx, H - 44, w.w - 1, 44);
        c.fillStyle = "#ffffff";
        c.font = "700 13px system-ui, sans-serif";
        c.strokeStyle = pitchColor(w.midi);
        c.lineWidth = 2;
        c.strokeRect(kx + 1, H - KB_H, w.w - 3, KB_H);
      } else {
        c.fillStyle = pressed ? "#ffffff" : "#52525b";
      }
      c.fillText(noteLabel(w.midi), kx + w.w / 2, H - 18);
    };
    const drawBlackKey = (c: CanvasRenderingContext2D, b: KeyRect, pressed: boolean, isChordB: boolean, isWaitB: boolean) => {
      const kx = b.x + LEFT_MARGIN;
      c.globalAlpha = 1;
      c.fillStyle = pressed ? pitchColor(b.midi) : "#27272a";
      c.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
      if (isWaitB) {
        c.fillStyle = "#f59e0b";
        c.fillRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
        c.strokeStyle = "#b45309";
        c.lineWidth = 3;
        c.strokeRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
      } else if (isChordB) {
        c.fillStyle = pitchColor(b.midi);
        c.fillRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
        c.strokeStyle = pitchColor(b.midi);
        c.lineWidth = 2;
        c.strokeRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
      }
      if (b.w >= 17) {
        c.font = "600 9px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "alphabetic";
        c.fillStyle = pressed || isChordB ? "#ffffff" : "#d4d4d8";
        c.fillText(noteLabel(b.midi), kx + b.w / 2, H - 16);
      }
    };
    // Offscreen strip holding the idle keyboard at the canvas' backing
    // resolution. Rebuilt only when the key range or pixel size changes.
    let blackNeighbors: number[][] = [];
    let keyboardBase: HTMLCanvasElement | null = null;
    let keyboardBaseKey = "";
    let keyboardBaseTop = 0;
    const ensureKeyboardBase = (kb: NonNullable<typeof keyboardCache>): HTMLCanvasElement | null => {
      const key = `${keyboardLowCache}|${keyboardHighCache}|${canvas.width}x${canvas.height}`;
      if (keyboardBase && keyboardBaseKey === key) return keyboardBase;
      const sx = canvas.width / W;
      const sy = canvas.height / H;
      const top = Math.floor((H - KB_H) * sy);
      const strip = keyboardBase ?? document.createElement("canvas");
      strip.width = canvas.width;
      strip.height = Math.max(1, canvas.height - top);
      const sctx = strip.getContext("2d");
      if (!sctx) return null;
      // Integer device-pixel offset keeps the blit aligned with direct drawing.
      sctx.setTransform(sx, 0, 0, sy, 0, -top);
      for (const w of kb.whites) drawWhiteKey(sctx, w, false, false, false);
      for (const b of kb.blacks) drawBlackKey(sctx, b, false, false, false);
      keyboardBase = strip;
      keyboardBaseKey = key;
      keyboardBaseTop = top;
      return strip;
    };


    const draw = () => {
      rafRef.current = 0;
      const clientW = canvas.clientWidth;
      if (clientW !== appliedClientW) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(clientW * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
        appliedClientW = clientW;
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
      const areaHeight = H - KB_H - 10;
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
      const chordIndex = chordIndexRef.current!;
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
      const chordMarginSec = 30 / pxPerSec;
      const chordBeatPerSec = (bpm * speed) / 60;
      const chordLabels = fallingChordRange(
        chordIndex,
        (now - chordMarginSec) * chordBeatPerSec,
        (now + lookahead + chordMarginSec) * chordBeatPerSec,
        chordRangeCache,
      );
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
        ctx.fillText(c.name, LEFT_MARGIN - 10, y);
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
      // The key bed is static between pressed/chord/wait changes, so it is
      // drawn once to an offscreen strip and blitted; only keys in a
      // highlighted state are redrawn on top each frame.
      if (keyboardLowCache !== low || keyboardHighCache !== high || !keyboardCache) {
        keyboardLowCache = low;
        keyboardHighCache = high;
        const rects = keyboardRects({ width: KEYBOARD_W, lowMidi: low, highMidi: high, whiteHeight: KB_H });
        keyboardCache = rects;
        blackNeighbors = rects.whites.map((w) => {
          const hits: number[] = [];
          rects.blacks.forEach((b, j) => {
            if (b.x < w.x + w.w && b.x + b.w > w.x) hits.push(j);
          });
          return hits;
        });
        keyboardBaseKey = "";
      }
      const kb = keyboardCache!;
      const base = ensureKeyboardBase(kb);
      if (base) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(base, 0, keyboardBaseTop);
        ctx.restore();
      }
      const waitMidi = currentWaitNote ? currentWaitNote.midi : -1;
      const redrawBlack = new Uint8Array(kb.blacks.length);
      if (!base) redrawBlack.fill(1);
      kb.whites.forEach((w, i) => {
        const pressed = pk.has(w.midi);
        const isChord = s.chordKeys && activeChordNotes.has(w.midi) && !pressed;
        const isWait = w.midi === waitMidi && !pressed;
        if (base && !pressed && !isChord && !isWait) return;
        drawWhiteKey(ctx, w, pressed, isChord, isWait);
        // A redrawn white key paints over the black keys that straddle it.
        for (const j of blackNeighbors[i]!) redrawBlack[j] = 1;
      });
      kb.blacks.forEach((b, j) => {
        const pressed = pk.has(b.midi);
        const isChordB = s.chordKeys && activeChordNotes.has(b.midi) && !pressed;
        const isWaitB = b.midi === waitMidi && !pressed;
        if (pressed || isChordB || isWaitB) redrawBlack[j] = 1;
        if (redrawBlack[j]) drawBlackKey(ctx, b, pressed, isChordB, isWaitB);
      });

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
      ctx.fillStyle = "#18181b";
      ctx.font = "12px monospace";
      // Previously inherited from the last key label drawn; set explicitly now
      // that idle keys are blitted rather than drawn each frame.
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`${now.toFixed(1)}s`, LEFT_MARGIN + 4, areaHeight - 6);

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

      // --- Draw bars with hand differentiation ---
      for (const b of bars) {
        const bx = b.x + LEFT_MARGIN;
        const isLeft = b.hand === "L";
        if (isLeft) {
          // Left-hand: wide, visible bars with note labels
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = b.color;
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(bx - 6, b.y, b.width + 12, b.height, 4);
          } else {
            ctx.rect(bx - 6, b.y, b.width + 12, b.height);
          }
          ctx.fill();
          ctx.globalAlpha = 1;
          if (b.height >= 14) {
            ctx.font = "600 10px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = b.color;
            ctx.fillText(b.label, bx + b.width / 2, Math.min(b.y + b.height / 2, areaHeight - 4));
          }
        } else {
          // Right-hand: vivid, compact, with note labels
          ctx.fillStyle = b.color;
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(bx, b.y, b.width, b.height, 4);
          } else {
            ctx.rect(bx, b.y, b.width, b.height);
          }
          ctx.fill();
          if (b.height >= 11) {
            const fs = Math.min(13, Math.max(9, b.height - 6));
            ctx.font = `600 ${fs}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.lineWidth = 3;
            ctx.strokeText(b.label, bx + b.width / 2, Math.min(b.y + b.height / 2, H - 14));
            ctx.fillStyle = "#ffffff";
            ctx.fillText(b.label, bx + b.width / 2, Math.min(b.y + b.height / 2, H - 14));
          }
        }
      }
      if (playingRef.current) rafRef.current = requestAnimationFrame(draw);
    };
    drawRef.current = draw;
    draw();
    return () => {
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
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="w-full h-auto" style={{ aspectRatio: "960/540", width: "100%" }} />
      <div className="player-stage-hint absolute bottom-2 left-3 text-[11px] text-zinc-500 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}
