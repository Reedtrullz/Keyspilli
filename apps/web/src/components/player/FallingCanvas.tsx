"use client";

import { useEffect, useRef } from "react";
import {
  fallingBars,
  keyboardRects,
  noteLabel,
  pitchColor,
  secPerBeat,
  upcomingMidi,
  type LoopRegion,
  type PlayerSettings,
  type TimedNote,
} from "@keyspilli/player-core";

interface Props {
  notes: TimedNote[];
  time: number;
  settings: PlayerSettings;
  pressedKeys: Map<number, number>;
  chords: { beat: number; name: string; notes: number[] }[];
  tempoBpm: number;
  lowMidi: number;
  highMidi: number;
  loop: LoopRegion | null;
}

export function FallingCanvas({ notes, time, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ notes, time, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop });
  propsRef.current = { notes, time, settings, pressedKeys, chords, tempoBpm, lowMidi, highMidi, loop };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const W = 960;
    const H = 500;
    const KB_H = 140;
    const LEFT_MARGIN = 80;
    const RIGHT_MARGIN = 80;
    const KEYBOARD_W = W - LEFT_MARGIN - RIGHT_MARGIN;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = "100%";

    const draw = () => {
      const {
        notes,
        time: now,
        settings: s,
        pressedKeys: pk,
        chords: ch,
        tempoBpm: bpm,
        lowMidi: low,
        highMidi: high,
        loop,
      } = propsRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const speed = s.speed;
      const lookahead = 3.2;
      const areaHeight = H - KB_H - 10;
      const pxPerSec = areaHeight / lookahead;

      const bars = fallingBars(notes, {
        width: KEYBOARD_W, height: areaHeight, nowSec: now, speed,
        lookaheadSec: lookahead, lowMidi: low, highMidi: high,
      });
      for (const b of bars) b.x += LEFT_MARGIN;
      const upcoming = upcomingMidi(bars, areaHeight, lookahead);

      // --- Determine current chord ---
      const beatSec = secPerBeat(bpm, speed);
      const currentBeat = now / beatSec;
      let activeChordNotes: Set<number> = new Set();
      let activeChordName = "";
      for (let i = ch.length - 1; i >= 0; i--) {
        if (currentBeat >= ch[i]!.beat) {
          activeChordNotes = new Set(ch[i]!.notes);
          activeChordName = ch[i]!.name;
          break;
        }
      }

      // --- Left-hand background zone ---
      const leftBars = bars.filter((b) => b.hand === "L");
      if (leftBars.length > 0) {
        const lxMin = Math.min(...leftBars.map((b) => b.x));
        const lxMax = Math.max(...leftBars.map((b) => b.x + b.width));
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = "#6366f1";
        ctx.fillRect(lxMin - 16, 0, lxMax - lxMin + 32, areaHeight);
        ctx.globalAlpha = 1;
      }

      // --- Chord labels on the left margin ---
      for (const c of ch) {
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
      for (const n of notes) {
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
      const kb = keyboardRects({ width: KEYBOARD_W, lowMidi: low, highMidi: high, whiteHeight: KB_H });
      for (const w of kb.whites) {
        const kx = w.x + LEFT_MARGIN;
        const isChord = activeChordNotes.has(w.midi) && !pk.has(w.midi);
        ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
        ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
        ctx.strokeStyle = "#d4d4d8";
        ctx.strokeRect(kx, H - KB_H, w.w - 1, KB_H);
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        if (isChord) {
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
        ctx.fillText(noteLabel(w.midi), kx + w.w / 2, H - 18);
      }
      for (const b of kb.blacks) {
        const kx = b.x + LEFT_MARGIN;
        const isChordB = activeChordNotes.has(b.midi) && !pk.has(b.midi);
        ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
        ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
        if (isChordB) {
          ctx.fillStyle = pitchColor(b.midi);
          ctx.fillRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
          ctx.strokeStyle = pitchColor(b.midi);
          ctx.lineWidth = 2;
          ctx.strokeRect(kx, H - KB_H * 0.62, b.w, KB_H * 0.62);
        }
        if (b.w >= 17) {
          ctx.font = "600 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(b.midi) || isChordB ? "#ffffff" : "#d4d4d8";
          ctx.fillText(noteLabel(b.midi), kx + b.w / 2, H - 16);
        }
      }

      // Upcoming-note strips
      for (const key of [...kb.whites, ...kb.blacks]) {
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
      ctx.fillText(`${now.toFixed(1)}s`, LEFT_MARGIN + 4, areaHeight - 6);

      // --- Loop region (dashed lines + tinted band) ---
      if (loop) {
        const yStart = areaHeight - (loop.startSec - now) * pxPerSec;
        const yEnd = areaHeight - (loop.endSec - now) * pxPerSec;
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
      for (const n of notes) {
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
        const isLeft = b.hand === "L";
        if (isLeft) {
          // Left-hand: wide, visible bars with note labels
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.roundRect(b.x - 6, b.y, b.width + 12, b.height, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (b.height >= 14) {
            ctx.font = "600 10px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = b.color;
            ctx.fillText(b.label, b.x + b.width / 2, Math.min(b.y + b.height / 2, areaHeight - 4));
          }
        } else {
          // Right-hand: vivid, compact, with note labels
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.roundRect(b.x, b.y, b.width, b.height, 4);
          ctx.fill();
          if (b.height >= 11) {
            const fs = Math.min(13, Math.max(9, b.height - 6));
            ctx.font = `600 ${fs}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.lineWidth = 3;
            ctx.strokeText(b.label, b.x + b.width / 2, Math.min(b.y + b.height / 2, H - 14));
            ctx.fillStyle = "#ffffff";
            ctx.fillText(b.label, b.x + b.width / 2, Math.min(b.y + b.height / 2, H - 14));
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="w-full h-auto" style={{ aspectRatio: "960/500", width: "100%" }} />
      <div className="absolute bottom-2 left-3 text-[11px] text-zinc-400 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}
