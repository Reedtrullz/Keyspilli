"use client";

import { useEffect, useRef } from "react";
import { fallingBars, keyboardRects, noteLabel, pitchColor, type PlayerSettings, type TimedNote } from "@keyspilli/player-core";

interface Props {
  notes: TimedNote[];
  timeRef: React.MutableRefObject<number>;
  settings: PlayerSettings;
  pressedKeys: Set<number>;
}

export function FallingCanvas({ notes, timeRef, settings, pressedKeys }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ notes, settings, pressedKeys });
  propsRef.current = { notes, settings, pressedKeys };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const W = 900;
    const H = 460;
    const KB_H = 160;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = "100%";

    const draw = () => {
      const { notes, settings: s, pressedKeys: pk } = propsRef.current;
      const now = timeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const low = Math.min(48, ...notes.map((n) => n.midi)) - 5;
      const high = Math.max(72, ...notes.map((n) => n.midi)) + 5;
      const lookahead = 3.2;
      const areaHeight = H - KB_H - 10;
      const bars = fallingBars(notes, {
        width: W,
        height: areaHeight,
        nowSec: now,
        speed: s.speed,
        lookaheadSec: lookahead,
        lowMidi: low,
        highMidi: high,
      });

      // keyboard
      const kb = keyboardRects({ width: W, lowMidi: low, highMidi: high, whiteHeight: KB_H });
      ctx.fillStyle = "#f4f4f5";
      for (const w of kb.whites) {
        ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
        ctx.fillRect(w.x, H - KB_H, w.w - 1, KB_H);
        ctx.strokeStyle = "#d4d4d8";
        ctx.strokeRect(w.x, H - KB_H, w.w - 1, KB_H);
        // key label: pitch letter, octave on C
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = pk.has(w.midi) ? "#ffffff" : "#52525b";
        ctx.fillText(noteLabel(w.midi), w.x + w.w / 2, H - 18);
      }
      for (const b of kb.blacks) {
        ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
        ctx.fillRect(b.x, H - KB_H, b.w, KB_H * 0.62);
        if (b.w >= 17) {
          ctx.font = "600 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(b.midi) ? "#18181b" : "#d4d4d8";
          ctx.fillText(noteLabel(b.midi), b.x + b.w / 2, H - 16);
        }
      }

      // playhead line just above the keyboard (the note lands exactly here)
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, areaHeight);
      ctx.lineTo(W, areaHeight);
      ctx.stroke();
      ctx.fillStyle = "#18181b";
      ctx.font = "12px monospace";
      ctx.fillText(`${now.toFixed(1)}s`, 8, areaHeight - 6);

      // draw bars ON TOP of the keyboard so a sounding note visibly
      // continues past the playhead over the keys instead of vanishing
      for (const b of bars) {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.width, b.height, 4);
        ctx.fill();
        // note label on the bar (skip slivers too short for text)
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
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [timeRef]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="w-full h-auto" style={{ aspectRatio: "900/460", width: "100%" }} />
      <div className="absolute bottom-2 left-3 text-[11px] text-zinc-400 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}
