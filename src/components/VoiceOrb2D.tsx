import React, { useEffect, useRef } from "react";

export type VoiceOrb2DProps = {
  levels?: number[];
  paused?: boolean;
  className?: string;
};

// 2D-canvas fallback orb, used when WebGL/Three.js is unavailable (e.g. GPU-less Electron).
export function VoiceOrb2D({ levels = [], paused = false, className = "" }: VoiceOrb2DProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const handleResize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const parent = canvas.parentElement;
      const width = rect.width || canvas.clientWidth || (parent ? parent.clientWidth : 0) || 300;
      const height = rect.height || canvas.clientHeight || (parent ? parent.clientHeight : 0) || 300;
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { handleResize(); if (paused) render(); });
      if (canvas.parentElement) {
        resizeObserver.observe(canvas.parentElement);
      }
      resizeObserver.observe(canvas);
    }

    const render = () => {
      try {
        handleResize();

        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(100, canvas.width / dpr);
        const height = Math.max(100, canvas.height / dpr);
        const cx = width / 2;
        const cy = height / 2;
        const baseRadius = Math.max(15, Math.min(width, height) * 0.32);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        if (!paused) {
          time += 0.025;
        }

        // Calculate audio pulse factor
        const avgLevel = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
        const radius = Math.max(15, baseRadius * (1 + avgLevel * 0.35));

        // Radial background glow
        const rInner = Math.max(0.1, radius * 0.2);
        const rOuter = Math.max(rInner + 1, radius * 1.8);
        const bgGlow = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
        bgGlow.addColorStop(0, "rgba(84, 230, 255, 0.45)");
        bgGlow.addColorStop(0.4, "rgba(84, 230, 255, 0.18)");
        bgGlow.addColorStop(0.8, "rgba(255, 183, 77, 0.06)");
        bgGlow.addColorStop(1, "rgba(3, 6, 13, 0)");

        ctx.fillStyle = bgGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
        ctx.fill();

        // Outer wave rings
        const numWaves = 4;
        for (let i = 0; i < numWaves; i++) {
          const waveRadius = radius * (0.7 + i * 0.22 + Math.sin(time + i) * 0.06);
          if (waveRadius > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
            ctx.strokeStyle = i % 2 === 0 ? "rgba(84, 230, 255, 0.35)" : "rgba(255, 183, 77, 0.25)";
            ctx.lineWidth = 1.5 + (levels[i % levels.length] || 0) * 3;
            ctx.shadowBlur = 12;
            ctx.shadowColor = "#54e6ff";
            ctx.stroke();
          }
        }

        // Core pulsating sphere
        const coreInner = 0;
        const coreOuter = Math.max(0.1, radius * 0.85);
        const coreGlow = ctx.createRadialGradient(cx, cy, coreInner, cx, cy, coreOuter);
        coreGlow.addColorStop(0, "#ffffff");
        coreGlow.addColorStop(0.3, "#96edff");
        coreGlow.addColorStop(0.7, "rgba(84, 230, 255, 0.8)");
        coreGlow.addColorStop(1, "rgba(84, 230, 255, 0)");

        ctx.fillStyle = coreGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.1, radius * 0.8), 0, Math.PI * 2);
        ctx.fill();

        // Orbiting particles
        const particleCount = 28;
        for (let p = 0; p < particleCount; p++) {
          const angle = (p / particleCount) * Math.PI * 2 + time * (p % 2 === 0 ? 0.8 : -0.6);
          const dist = radius * (0.85 + Math.sin(time * 2 + p) * 0.2);
          const px = cx + Math.cos(angle) * dist;
          const py = cy + Math.sin(angle) * dist * 0.7;
          const pSize = Math.max(1, 2 + (p % 3) * 1.5 + (levels[p % levels.length] || 0) * 4);

          ctx.beginPath();
          ctx.arc(px, py, pSize, 0, Math.PI * 2);
          ctx.fillStyle = p % 4 === 0 ? "#ffb74d" : "#54e6ff";
          ctx.shadowBlur = 10;
          ctx.shadowColor = p % 4 === 0 ? "#ffb74d" : "#54e6ff";
          ctx.fill();
        }

        ctx.restore();
      } catch (err) {
        console.warn("[VoiceOrb2D] Render cycle caught error:", err);
      }

      if (!paused) {
        animId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [levels, paused]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
