import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, PhoneOff, Radio } from 'lucide-react';
import { Asset, MarketAnalysis, ConfluenceBreakdown, TimeFrame } from '../types/trading';
import { CyberAiAvatar3D } from './CyberAiAvatar3D';

interface VoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset;
  timeframe: TimeFrame;
  marketAnalysis: MarketAnalysis;
  confluences: ConfluenceBreakdown;
}

type SessionStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';

export const VoiceModal: React.FC<VoiceModalProps> = ({
  isOpen,
  onClose,
  asset,
  timeframe,
  marketAnalysis,
  confluences,
}) => {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [aiSpeechLevel, setAiSpeechLevel] = useState<number>(0);
  const [isActivatingMic, setIsActivatingMic] = useState(false);

  // Audio & WebSocket Refs
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioPlaybackStateRef = useRef<{ nextStartTime: number; activeSources: AudioBufferSourceNode[] }>({
    nextStartTime: 0,
    activeSources: [],
  });
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  // Linear resampler to convert native input sampleRate to 16000Hz for Gemini Live
  const resampleTo16k = (inputData: Float32Array, inputSampleRate: number): Float32Array => {
    if (inputSampleRate === 16000) return inputData;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = i * ratio;
      const indexFloor = Math.floor(originalIndex);
      const indexCeil = Math.min(inputData.length - 1, Math.ceil(originalIndex));
      const fraction = originalIndex - indexFloor;
      result[i] = inputData[indexFloor] * (1 - fraction) + inputData[indexCeil] * fraction;
    }
    return result;
  };

  // Convert Float32Array to Int16 Little-Endian Base64 (16kHz PCM)
  const pcmToBase64 = (float32Array: Float32Array): string => {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Convert Base64 (24kHz 16-bit PCM LE) to Float32Array
  const base64ToPcm = (base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  };

  // Stop current audio playback
  const stopAudioPlayback = useCallback(() => {
    const state = audioPlaybackStateRef.current;
    state.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Source might have finished already
      }
    });
    state.activeSources = [];
    if (outputAudioCtxRef.current) {
      state.nextStartTime = outputAudioCtxRef.current.currentTime;
    }
    setAiSpeechLevel(0);
  }, []);

  // Schedule raw 24kHz PCM chunk for audio playback
  const scheduleAudioChunk = useCallback((base64Audio: string) => {
    try {
      const pcmData = base64ToPcm(base64Audio);
      if (!outputAudioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      }

      const ctx = outputAudioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      let sum = 0;
      for (let i = 0; i < pcmData.length; i += 8) {
        sum += pcmData[i] * pcmData[i];
      }
      const rms = Math.sqrt(sum / (pcmData.length / 8));
      const level = Math.min(100, Math.round(rms * 320));
      setAiSpeechLevel(Math.max(15, level));

      const audioBuffer = ctx.createBuffer(1, pcmData.length, 24000);
      audioBuffer.getChannelData(0).set(pcmData);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const state = audioPlaybackStateRef.current;
      const now = ctx.currentTime;
      const startTime = Math.max(now, state.nextStartTime);
      source.start(startTime);
      state.nextStartTime = startTime + audioBuffer.duration;
      state.activeSources.push(source);

      source.onended = () => {
        state.activeSources = state.activeSources.filter((s) => s !== source);
        if (state.activeSources.length === 0) {
          setAiSpeechLevel(0);
          setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
        }
      };
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }, []);

  // Disconnect WebSocket and media streams
  const disconnectSession = useCallback(() => {
    stopAudioPlayback();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    setStatus('idle');
    setMicLevel(0);
    setAiSpeechLevel(0);
    setHasMicPermission(null);
  }, [stopAudioPlayback]);

  // Request & attach microphone access
  const requestMicrophoneAccess = async () => {
    try {
      setIsActivatingMic(true);

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (outputAudioCtxRef.current && outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      micStreamRef.current = stream;
      setHasMicPermission(true);
      setErrorMessage(null);

      const inputCtx = new AudioCtx();
      inputAudioCtxRef.current = inputCtx;

      if (inputCtx.state === 'suspended') {
        await inputCtx.resume();
      }

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          setMicLevel(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i += 8) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / (inputData.length / 8));
        setMicLevel(Math.min(100, Math.round(rms * 280)));

        const resampled = resampleTo16k(inputData, inputCtx.sampleRate);
        const base64Pcm = pcmToBase64(resampled);
        wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
    } catch (err: any) {
      console.warn('Microphone activation notice:', err?.name, err?.message);
      setHasMicPermission(false);
      setErrorMessage('Permissão do microfone negada. Clique em Ativar Microfone no navegador.');
    } finally {
      setIsActivatingMic(false);
    }
  };

  // Connect to Live API
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;
      audioPlaybackStateRef.current = { nextStartTime: outputCtx.currentTime, activeSources: [] };

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let hostToUse = window.location.host;
      if (
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        window.location.port !== '3000' &&
        window.location.port !== ''
      ) {
        hostToUse = `${window.location.hostname}:3000`;
      }
      const wsUrl = `${protocol}//${hostToUse}/api/live`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setStatus('listening');
        setHasMicPermission(true);
        return;
      }
      wsRef.current = ws;

      let didOpen = false;

      ws.onopen = () => {
        didOpen = true;
        ws.send(
          JSON.stringify({
            type: 'start',
            voiceName: 'Kore',
            marketContext: {
              asset: asset.symbol,
              assetName: asset.name,
              currentPrice: asset.currentPrice,
              spread: asset.spread,
              timeframe,
              marketAnalysis,
              confluences,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ready') {
            setStatus('listening');
          } else if (msg.type === 'audio') {
            setStatus('speaking');
            scheduleAudioChunk(msg.audio);
          } else if (msg.type === 'interrupted') {
            setStatus('listening');
            stopAudioPlayback();
          } else if (msg.type === 'error') {
            console.warn('[Gemini Live] Servidor aviso:', msg.error);
            setStatus('listening');
            setHasMicPermission(true);
          }
        } catch (err) {
          console.error('Error parsing live ws message:', err);
        }
      };

      ws.onerror = (e) => {
        console.warn('WebSocket live error, fallback to browser speech:', e);
        if (!didOpen) {
          setStatus('listening');
          setHasMicPermission(true);
        }
      };

      ws.onclose = () => {
        if (status !== 'idle' && status !== 'listening') {
          setStatus('idle');
        }
      };

      // Auto-request mic if possible
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }

          micStreamRef.current = stream;
          setHasMicPermission(true);

          const inputCtx = new AudioCtx();
          inputAudioCtxRef.current = inputCtx;
          if (inputCtx.state === 'suspended') {
            await inputCtx.resume();
          }

          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(2048, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            if (isMutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              setMicLevel(0);
              return;
            }

            const inputData = e.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < inputData.length; i += 8) {
              sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / (inputData.length / 8));
            setMicLevel(Math.min(100, Math.round(rms * 280)));

            const resampled = resampleTo16k(inputData, inputCtx.sampleRate);
            const base64Pcm = pcmToBase64(resampled);
            wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
          };

          source.connect(processor);
          processor.connect(inputCtx.destination);
        } catch {
          setHasMicPermission(false);
        }
      } else {
        setHasMicPermission(false);
      }
    } catch (err: any) {
      console.error('Failed to start live session:', err);
      setErrorMessage(err?.message || 'Falha ao iniciar conversa de voz.');
      setStatus('error');
    }
  }, [
    asset,
    timeframe,
    marketAnalysis,
    confluences,
    scheduleAudioChunk,
    stopAudioPlayback,
    status,
  ]);

  // Handle Mute Toggle
  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
        });
      }
      return next;
    });
  };

  // Auto-connect on open
  useEffect(() => {
    if (isOpen && status === 'idle') {
      startLiveConversation();
    }
    if (!isOpen && status !== 'idle') {
      disconnectSession();
    }
  }, [isOpen, status, startLiveConversation, disconnectSession]);

  // Clean on unmount
  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg bg-[#0a0e1a] border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.3)] overflow-hidden flex flex-col font-sans select-none">
        {/* Sleek Minimal Header */}
        <div className="p-3.5 sm:p-4 bg-gradient-to-r from-[#0d1424] to-[#121c33] border-b border-[#1c2844] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="font-extrabold text-white text-sm tracking-wide">
                ClandeX-IA
              </div>
              <div className="text-[11px] text-neutral-400 font-mono">
                {asset.symbol} • R$ {asset.currentPrice.toFixed(asset.pipDecimals)}
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              disconnectSession();
              onClose();
            }}
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800/80 rounded-xl transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Centralized Large 3D Female Robotic Avatar */}
        <div className="relative flex-1 min-h-[380px] sm:min-h-[440px] bg-[#070a12] flex flex-col items-center justify-center overflow-hidden p-4">
          {/* Ambient Cybernetic Glow */}
          <div
            className={`absolute w-80 h-80 rounded-full blur-3xl opacity-30 pointer-events-none transition-all duration-700 ${
              status === 'speaking'
                ? 'bg-cyan-400 scale-125'
                : status === 'listening'
                ? hasMicPermission ? 'bg-emerald-400 scale-100' : 'bg-cyan-500 scale-95'
                : 'bg-blue-600 scale-75'
            }`}
          />

          {/* Cyber Sound Frequency Visualizer Component */}
          <div className="relative w-full h-[320px] sm:h-[380px] rounded-2xl overflow-hidden flex items-center justify-center">
            <CyberAiAvatar3D
              status={status}
              speechLevel={aiSpeechLevel}
              micLevel={micLevel}
              className="w-full h-full"
            />
          </div>

          {/* Subtle status label underneath */}
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'speaking'
                  ? 'bg-cyan-400 animate-ping'
                  : status === 'listening'
                  ? hasMicPermission ? (isMuted ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse') : 'bg-cyan-400 animate-pulse'
                  : 'bg-neutral-500'
              }`}
            />
            <span className="text-xs font-mono font-bold text-neutral-300">
              {status === 'speaking'
                ? 'IA Falando...'
                : status === 'listening'
                ? hasMicPermission
                  ? isMuted ? 'Microfone Mutado' : 'Microfone Ativo (Fale com a IA)'
                  : 'Aguardando Microfone'
                : status === 'connecting'
                ? 'Conectando...'
                : 'Pronta'}
            </span>
          </div>

          {/* Error Banner if needed */}
          {errorMessage && (
            <div className="mt-2 w-full max-w-sm p-2 bg-rose-950/50 border border-rose-500/40 rounded-xl text-xs text-rose-300 text-center font-mono">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Bottom Bar: Somente o botão de microfone e encerrar a chamada */}
        <div className="p-4 bg-[#0a0e1a] border-t border-[#18223a] flex items-center justify-between gap-3">
          {/* Botão Ativar / Controlar Microfone */}
          {hasMicPermission ? (
            <button
              onClick={toggleMute}
              className={`flex-1 py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isMuted
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-[#141b2c] hover:bg-[#1b243b] text-neutral-200 border border-[#222d48]'
              }`}
            >
              {isMuted ? <MicOff className="w-5 h-5 text-amber-400" /> : <Mic className="w-5 h-5 text-emerald-400" />}
              <span>{isMuted ? 'Desmutar Microfone' : 'Microfone Ativo'}</span>
            </button>
          ) : (
            <button
              onClick={requestMicrophoneAccess}
              disabled={isActivatingMic}
              className="flex-1 py-3 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-neutral-950 flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/20 cursor-pointer disabled:opacity-50 active:scale-98"
            >
              <Mic className="w-5 h-5 text-neutral-950 animate-pulse" />
              <span>{isActivatingMic ? 'Solicitando Permissão...' : 'Ativar Microfone'}</span>
            </button>
          )}

          {/* Botão Encerrar Chamada */}
          <button
            onClick={() => {
              disconnectSession();
              onClose();
            }}
            className="flex-1 py-3 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-600/20 cursor-pointer active:scale-98"
          >
            <PhoneOff className="w-5 h-5" />
            <span>Encerrar Chamada</span>
          </button>
        </div>
      </div>
    </div>
  );
};
