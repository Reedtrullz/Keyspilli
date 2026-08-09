"use client";

import { useEffect, useRef } from "react";
import { fallingBars, keyboardRects, pitchColor, type PlayerSettings, type TimedNote } from "@keyspilli/player-core";

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
      const pxPerSec = (H - 180) / lookahead;
      const bars = fallingBars(notes, {
        width: W,
        height: H - 180,
        nowSec: now,
        speed: s.speed,
        lookaheadSec: lookahead,
        lowMidi: low,
        highMidi: high,
      });

      // draw bars
      for (const b of bars) {
        ctx.globalAlpha = b.y < 0 ? 0.5 : 1;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.width, b.height, 4);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // keyboard
      const kb = keyboardRects({ width: W, lowMidi: low, highMidi: high, whiteHeight: 160 });
      ctx.fillStyle = "#f4f4f5";
      for (const w of kb.whites) {
        ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
        ctx.fillRect(w.x, H - 160, w.w - 1, 160);
        ctx.strokeStyle = "#d4d4d8";
        ctx.strokeRect(w.x, H - 160, w.w - 1, 160);
      }
      for (const b of kb.blacks) {
        ctx.fillStyle = pk.has(b.midi) ? pitchColor(b.midi) : "#27272a";
        ctx.fillRect(b.x, H - 160, b.w, 100);
      }

      // playhead line
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(W, 8);
      ctx.stroke();
      ctx.fillStyle = "#18181b";
      ctx.font = "12px monospace";
      ctx.fillText(`${now.toFixed(1)}s`, 8, 22);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [timeRef]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" style={{ aspectRatio: "900/460" }} />
      <div className="absolute bottom-2 left-3 text-[11px] text-zinc-400 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}
