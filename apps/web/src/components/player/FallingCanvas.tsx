"use client";

import { useEffect, useRef } from "react";
import { fallingBars, keyboardRects, noteLabel, pitchColor, upcomingMidi, type PlayerSettings, type TimedNote } from "@keyspilli/player-core";

interface Props {
  notes: TimedNote[];
  timeRef: React.MutableRefObject<number>;
  settings: PlayerSettings;
  pressedKeys: Set<number>;
  chords: { beat: number; name: string; notes: number[] }[];
  tempoBpm: number;
}

export function FallingCanvas({ notes, timeRef, settings, pressedKeys, chords, tempoBpm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ notes, settings, pressedKeys, chords, tempoBpm });
  propsRef.current = { notes, settings, pressedKeys, chords, tempoBpm };

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
      const { notes, settings: s, pressedKeys: pk, chords: ch, tempoBpm: bpm } = propsRef.current;
      const now = timeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const low = Math.min(48, ...notes.map((n) => n.midi)) - 3;
      const high = Math.max(72, ...notes.map((n) => n.midi)) + 3;
      const lookahead = 3.2;
      const areaHeight = H - KB_H - 10;
      const pxPerSec = areaHeight / lookahead;
      const bars = fallingBars(notes, {
        width: KEYBOARD_W,
        height: areaHeight,
        nowSec: now,
        speed: s.speed,
        lookaheadSec: lookahead,
        lowMidi: low,
        highMidi: high,
      });
      // Offset all bar x positions by the left margin
      for (const b of bars) b.x += LEFT_MARGIN;

      const upcoming = upcomingMidi(bars, areaHeight, lookahead);

      // --- Chord labels on the left margin ---
      const speed = s.speed;
      for (const c of ch) {
        const cSec = (c.beat * 60) / (bpm * speed);
        const bottom = areaHeight - (cSec - now) * pxPerSec;
        if (bottom < -30 || bottom > areaHeight + 30) continue;
        const y = Math.max(16, Math.min(areaHeight - 6, bottom - 4));
        ctx.font = "700 13px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#18181b";
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
      ctx.fillStyle = "#f4f4f5";
      for (const w of kb.whites) {
        const kx = w.x + LEFT_MARGIN;
        ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
        ctx.fillRect(kx, H - KB_H, w.w - 1, KB_H);
        ctx.strokeStyle = "#d4d4d8";
        ctx.strokeRect(kx, H - KB_H, w.w - 1, KB_H);
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = pk.has(w.midi) ? "#ffffff" : "#52525b";
        ctx.fillText(noteLabel(w.midi), kx + w.w / 2, H - 18);
      }
      for (const b of kb.blacks) {
        const kx = b.x + LEFT_MARGIN;
        ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
        ctx.fillRect(kx, H - KB_H, b.w, KB_H * 0.62);
        if (b.w >= 17) {
          ctx.font = "600 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(b.midi) ? "#18181b" : "#d4d4d8";
          ctx.fillText(noteLabel(b.midi), kx + b.w / 2, H - 16);
        }
      }

      // Upcoming-note strips on top of the key fills
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

      // --- Draw bars with hand differentiation ---
      for (const b of bars) {
        const isLeft = b.hand === "L";
        if (isLeft) {
          // Left-hand: wide ghost bars — visible but clearly muted, pitch-colored
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = ghostColor(b.color);
          ctx.beginPath();
          ctx.roundRect(b.x - 8, b.y, b.width + 16, b.height, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
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
  }, [timeRef]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="w-full h-auto" style={{ aspectRatio: "960/500", width: "100%" }} />
      <div className="absolute bottom-2 left-3 text-[11px] text-zinc-400 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}

/** Desaturate and lighten a hex color for left-hand "ghost" rendering. */
function ghostColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = Math.round(r * 0.3 + g * 0.5 + b * 0.2);
  const mix = 0.55;
  const dr = Math.round(r + (gray - r) * mix);
  const dg = Math.round(g + (gray - g) * mix);
  const db = Math.round(b + (gray - b) * mix);
  return `rgb(${Math.min(255, dr + 30)},${Math.min(255, dg + 30)},${Math.min(255, db + 30)})`;
 }
