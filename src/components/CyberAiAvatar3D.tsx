import React, { useEffect, useRef } from 'react';

interface CyberAiAvatar3DProps {
  status: 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';
  speechLevel: number; // 0 to 100 (live audio level when AI is speaking)
  micLevel?: number;   // 0 to 100 (user mic level)
  className?: string;
  isAnalyzing?: boolean;
}

/**
 * CyberAiAvatar3D: Futuristic Cybernetic Audio Frequency Visualizer
 * Replaces human face with high-tech real-time sound frequency spectrum:
 * - 64-band radial cyber frequency equalizer with neon glowing bars & falling peak indicators
 * - Multi-layer harmonic oscilloscope audio waveform responding dynamically to voice syllables
 * - Central AI neural core pulsating with speech decibels and vocal resonance
 * - Concentric sonic shockwave rings expanding outwards on voice peaks
 * - Real-time telemetry readouts: dynamic Hz, spectral resonance, audio flux & status mode
 * - Ambient sound-reactive nano-particles
 */
export const CyberAiAvatar3D: React.FC<CyberAiAvatar3DProps> = ({
  status,
  speechLevel,
  micLevel = 0,
  className = '',
  isAnalyzing = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const speechLevelRef = useRef(speechLevel);
  speechLevelRef.current = speechLevel;

  const statusRef = useRef(status);
  statusRef.current = status;

  const micLevelRef = useRef(micLevel);
  micLevelRef.current = micLevel;

  const isAnalyzingRef = useRef(isAnalyzing);
  isAnalyzingRef.current = isAnalyzing;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Handle high-DPI scaling
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = container.clientWidth || 360;
      height = container.clientHeight || 360;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    // Spectrum Bars state (64 radial bars)
    const numBars = 64;
    const barHeights = new Float32Array(numBars);
    const barPeaks = new Float32Array(numBars);
    const barSpeeds = new Float32Array(numBars);

    // Shockwave rings
    interface Shockwave {
      radius: number;
      maxRadius: number;
      opacity: number;
      color: string;
    }
    const shockwaves: Shockwave[] = [];

    // Ambient sonic particles
    const particleCount = 40;
    const particles = Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 50 + Math.random() * 120,
      baseDist: 50 + Math.random() * 120,
      size: 1 + Math.random() * 2,
      speed: 0.2 + Math.random() * 0.6,
      opacity: 0.2 + Math.random() * 0.6,
      hue: Math.random() > 0.5 ? 190 : 160,
    }));

    let lastTime = performance.now();
    let smoothedSpeech = 0;
    let waveOffset = 0;
    let rotationAngle = 0;

    const render = (now: number) => {
      animationFrameId = requestAnimationFrame(render);

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const curSpeech = speechLevelRef.current;
      const curMic = micLevelRef.current;
      const curStatus = statusRef.current;
      const curAnalyzing = isAnalyzingRef.current;

      const isSpeaking = curStatus === 'speaking' || curSpeech > 4;
      const isListening = curStatus === 'listening';

      // Smooth speech level with quick attack and gentle release
      const targetSpeech = isSpeaking ? Math.max(curSpeech, 8) : isListening ? curMic * 0.8 : 0;
      smoothedSpeech += (targetSpeech - smoothedSpeech) * (targetSpeech > smoothedSpeech ? 0.35 : 0.12);

      const normSpeech = Math.min(1.0, smoothedSpeech / 70);
      rotationAngle += dt * (0.3 + normSpeech * 0.8);
      waveOffset += dt * (2.5 + normSpeech * 6.0);

      // Trigger sonic shockwaves on speech spikes
      if (isSpeaking && normSpeech > 0.45 && Math.random() < 0.2) {
        shockwaves.push({
          radius: 35,
          maxRadius: Math.min(width, height) * 0.48,
          opacity: 0.8,
          color: normSpeech > 0.75 ? '#67e8f9' : '#00f0ff',
        });
      }

      // Clear frame
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = Math.min(width, height) * 0.22;

      // 1. Background Cybernetic Glow & Radar Grid
      const bgGlow = ctx.createRadialGradient(cx, cy, 10, cx, cy, baseRadius * 1.8);
      if (isSpeaking) {
        bgGlow.addColorStop(0, `rgba(0, 240, 255, ${0.15 + normSpeech * 0.25})`);
        bgGlow.addColorStop(0.5, `rgba(2, 132, 199, ${0.08 + normSpeech * 0.12})`);
        bgGlow.addColorStop(1, 'rgba(2, 6, 23, 0)');
      } else if (isListening) {
        bgGlow.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
        bgGlow.addColorStop(0.5, 'rgba(6, 95, 70, 0.12)');
        bgGlow.addColorStop(1, 'rgba(2, 6, 23, 0)');
      } else if (curAnalyzing) {
        bgGlow.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
        bgGlow.addColorStop(0.5, 'rgba(3, 105, 161, 0.08)');
        bgGlow.addColorStop(1, 'rgba(2, 6, 23, 0)');
      } else {
        bgGlow.addColorStop(0, 'rgba(14, 116, 144, 0.12)');
        bgGlow.addColorStop(0.6, 'rgba(8, 47, 73, 0.05)');
        bgGlow.addColorStop(1, 'rgba(2, 6, 23, 0)');
      }
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, width, height);

      // 2. Shockwave Rings Expansion
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += dt * 140;
        sw.opacity -= dt * 1.2;

        if (sw.opacity <= 0 || sw.radius >= sw.maxRadius) {
          shockwaves.splice(i, 1);
          continue;
        }

        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = sw.opacity;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = sw.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // 3. Orbital Concentric HUD Rings with Tick Marks
      ctx.save();
      ctx.translate(cx, cy);

      // Static inner guide ring
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius - 12, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating dashed outer ring
      ctx.rotate(rotationAngle * 0.3);
      ctx.strokeStyle = isSpeaking ? 'rgba(0, 240, 255, 0.45)' : 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius + 44, 0, Math.PI * 2);
      ctx.stroke();

      // Counter-rotating segmented arcs
      ctx.rotate(-rotationAngle * 0.7);
      ctx.strokeStyle = isSpeaking ? '#38bdf8' : '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([24, 48]);
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius + 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 4. Ambient Sonic Nano-Particles
      particles.forEach((p) => {
        p.angle += dt * p.speed * (1 + normSpeech * 2);
        const speechExpansion = normSpeech * 35;
        p.dist = p.baseDist + speechExpansion + Math.sin(now * 0.003 + p.angle) * 8;

        const px = cx + Math.cos(p.angle) * p.dist;
        const py = cy + Math.sin(p.angle) * p.dist;

        ctx.fillStyle = isListening
          ? `hsla(150, 90%, 65%, ${p.opacity})`
          : `hsla(${p.hue}, 95%, 65%, ${p.opacity})`;
        ctx.shadowColor = isListening ? '#10b981' : '#00f0ff';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (1 + normSpeech * 0.6), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;

      // 5. Radial Equalizer Bars (64 Spectrum Frequencies)
      const maxBarLength = Math.min(width, height) * 0.2;

      for (let i = 0; i < numBars; i++) {
        // Multi-frequency synthesis for realistic audio harmonics
        const freqRatio = i / numBars;
        const harmonic1 = Math.sin(now * 0.009 * (1 + freqRatio * 3) + i * 0.35);
        const harmonic2 = Math.cos(now * 0.014 * (2 + freqRatio * 2) - i * 0.2);
        const harmonic3 = Math.sin(waveOffset + i * 0.5);

        let targetH = 0;
        if (isSpeaking) {
          // Dynamic speech spectrum curve (higher energy in vocal mid-range)
          const voiceProfile = Math.sin(freqRatio * Math.PI) * 0.8 + 0.3;
          const energy = Math.abs(harmonic1 * 0.4 + harmonic2 * 0.4 + harmonic3 * 0.2);
          targetH = (6 + energy * maxBarLength * normSpeech * 1.4) * voiceProfile;
        } else if (isListening) {
          const micEnergy = Math.abs(harmonic1 * 0.6 + harmonic2 * 0.4);
          targetH = 4 + micEnergy * maxBarLength * (curMic / 100) * 0.9;
        } else if (curAnalyzing) {
          // Scanning wave pulse
          const scanPos = (now * 0.003) % 1;
          const distToScan = Math.abs(freqRatio - scanPos);
          const scanEnergy = Math.max(0, 1 - distToScan * 4);
          targetH = 6 + scanEnergy * 24 + Math.abs(harmonic1) * 8;
        } else {
          // Gentle idle breathing wave
          targetH = 4 + Math.abs(harmonic1) * 10;
        }

        // Interpolate bar height
        barHeights[i] += (targetH - barHeights[i]) * 0.3;

        // Falling Peak Dots
        if (barHeights[i] >= barPeaks[i]) {
          barPeaks[i] = barHeights[i];
          barSpeeds[i] = 0;
        } else {
          barSpeeds[i] += dt * 35;
          barPeaks[i] = Math.max(0, barPeaks[i] - barSpeeds[i]);
        }

        const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const x1 = cx + cos * baseRadius;
        const y1 = cy + sin * baseRadius;
        const x2 = cx + cos * (baseRadius + barHeights[i]);
        const y2 = cy + sin * (baseRadius + barHeights[i]);

        // Bar Color Gradient
        const barGrad = ctx.createLinearGradient(x1, y1, x2, y2);
        if (isSpeaking) {
          barGrad.addColorStop(0, '#00e5ff');
          barGrad.addColorStop(0.7, '#38bdf8');
          barGrad.addColorStop(1, normSpeech > 0.6 ? '#ffffff' : '#818cf8');
        } else if (isListening) {
          barGrad.addColorStop(0, '#10b981');
          barGrad.addColorStop(1, '#6ee7b7');
        } else if (curAnalyzing) {
          barGrad.addColorStop(0, '#06b6d4');
          barGrad.addColorStop(1, '#38bdf8');
        } else {
          barGrad.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
          barGrad.addColorStop(1, 'rgba(56, 189, 248, 0.7)');
        }

        ctx.strokeStyle = barGrad;
        ctx.lineWidth = Math.max(2, (2 * Math.PI * baseRadius) / (numBars * 1.6));
        ctx.lineCap = 'round';
        ctx.shadowColor = isListening ? '#10b981' : '#00f0ff';
        ctx.shadowBlur = isSpeaking ? 8 + normSpeech * 8 : 4;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Peak Dot
        const px = cx + cos * (baseRadius + barPeaks[i] + 3);
        const py = cy + sin * (baseRadius + barPeaks[i] + 3);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // 6. Central AI Neural Sound Core
      const coreRadius = baseRadius * 0.72;
      const corePulse = isSpeaking ? 1.0 + normSpeech * 0.22 : 1.0 + Math.sin(now * 0.003) * 0.04;

      // Core Outer Halo
      const coreHalo = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * corePulse);
      if (isSpeaking) {
        coreHalo.addColorStop(0, '#ffffff');
        coreHalo.addColorStop(0.3, '#38bdf8');
        coreHalo.addColorStop(0.7, '#0284c7');
        coreHalo.addColorStop(1, 'rgba(2, 132, 199, 0)');
      } else if (isListening) {
        coreHalo.addColorStop(0, '#ffffff');
        coreHalo.addColorStop(0.4, '#34d399');
        coreHalo.addColorStop(0.8, '#059669');
        coreHalo.addColorStop(1, 'rgba(5, 150, 105, 0)');
      } else {
        coreHalo.addColorStop(0, '#e0f2fe');
        coreHalo.addColorStop(0.4, '#0284c7');
        coreHalo.addColorStop(0.9, 'rgba(8, 47, 73, 0.8)');
        coreHalo.addColorStop(1, 'rgba(8, 47, 73, 0)');
      }

      ctx.fillStyle = coreHalo;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * corePulse, 0, Math.PI * 2);
      ctx.fill();

      // Core Inner Dark Plate with Cyber Border
      ctx.fillStyle = '#030712';
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isSpeaking ? '#00f0ff' : isListening ? '#10b981' : '#0284c7';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 7. Horizontal Oscilloscope Waveform through the Core
      const waveWidth = coreRadius * 1.1;
      const waveStartX = cx - waveWidth / 2;
      const wavePoints = 32;

      ctx.strokeStyle = isSpeaking ? '#ffffff' : isListening ? '#6ee7b7' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();

      for (let j = 0; j <= wavePoints; j++) {
        const wx = waveStartX + (j / wavePoints) * waveWidth;
        const progress = j / wavePoints;
        const envelope = Math.sin(progress * Math.PI); // Pinches at edges
        const waveAmp = (isSpeaking ? 16 * normSpeech + 6 : isListening ? 12 * (curMic / 100) + 4 : 4);
        const wy = cy + Math.sin(waveOffset * 1.5 + progress * 12) * waveAmp * envelope;

        if (j === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 8. High-Tech Telemetry & Frequency Readouts
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Top frequency readout
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = isSpeaking ? '#67e8f9' : '#94a3b8';
      const currentHz = isSpeaking
        ? (24.2 + Math.sin(now * 0.01) * 3.8).toFixed(1)
        : curAnalyzing
        ? (14.5 + Math.sin(now * 0.005) * 1.2).toFixed(1)
        : '12.0';
      ctx.fillText(`${currentHz} kHz`, cx, cy - coreRadius * 0.35);

      // Bottom Status badge
      ctx.font = 'bold 8px monospace';
      if (isSpeaking) {
        ctx.fillStyle = '#00f0ff';
        ctx.fillText('IA FALANDO', cx, cy + coreRadius * 0.38);
      } else if (isListening) {
        ctx.fillStyle = '#34d399';
        ctx.fillText('OUVINDO VOZ', cx, cy + coreRadius * 0.38);
      } else if (curAnalyzing) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('VARREDURA ATIVA', cx, cy + coreRadius * 0.38);
      } else {
        ctx.fillStyle = '#64748b';
        ctx.fillText('FREQUÊNCIA OK', cx, cy + coreRadius * 0.38);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[300px] flex items-center justify-center overflow-hidden pointer-events-auto bg-neutral-950/60 rounded-2xl border border-cyan-500/10 ${className}`}
    >
      {/* Real-time Frequency Spectrum Canvas */}
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Cyber Corner HUD Brackets */}
      <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-500/40 pointer-events-none" />
      <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-500/40 pointer-events-none" />
      <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-500/40 pointer-events-none" />
      <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-500/40 pointer-events-none" />

      {/* Top Banner Tag */}
      <div className="absolute top-2.5 inset-x-0 flex justify-center pointer-events-none">
        <span className="px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-[9px] font-mono font-bold tracking-widest text-cyan-300 uppercase shadow-[0_0_12px_rgba(6,182,212,0.25)] flex items-center gap-1.5 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          ESPECTRO DE FREQUÊNCIA DA IA
        </span>
      </div>

      {/* Bottom Audio Telemetry Info */}
      <div className="absolute bottom-2.5 inset-x-3 flex items-center justify-between pointer-events-none text-[8px] font-mono text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="text-cyan-400 font-bold">FLUXO:</span>
          {speechLevel > 0 ? `${Math.round(speechLevel)}%` : isAnalyzing ? 'ANALISANDO' : 'STANDBY'}
        </span>
        <span className="text-neutral-500 uppercase tracking-wider">
          MODULAÇÃO NEURAL 64-BANDAS
        </span>
      </div>
    </div>
  );
};
