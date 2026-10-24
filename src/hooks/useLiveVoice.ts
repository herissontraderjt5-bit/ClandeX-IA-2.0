import { useState, useRef, useCallback, useEffect } from 'react';
import { Asset, TimeFrame, MarketAnalysis, ConfluenceBreakdown } from '../types/trading';
import { getRelevantEconomicEvents, getCurrentMarketSession } from '../services/economicCalendar';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';

interface UseLiveVoiceParams {
  asset: Asset;
  timeframe: TimeFrame;
  marketAnalysis: MarketAnalysis;
  confluences: ConfluenceBreakdown;
}

export function useLiveVoice({
  asset,
  timeframe,
  marketAnalysis,
  confluences,
}: UseLiveVoiceParams) {
  const [status, setStatus] = useState<LiveVoiceStatus>('idle');
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

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

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
        // Already ended
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
  const requestMicrophoneAccess = useCallback(async () => {
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
      setErrorMessage('Microfone não autorizado no navegador.');
    } finally {
      setIsActivatingMic(false);
    }
  }, []);

  // Connect to Gemini Live API
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;
      audioPlaybackStateRef.current = { nextStartTime: outputCtx.currentTime, activeSources: [] };

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const currentCtx = contextRef.current;
      const { upcomingHighImpact, relevantEvents } = getRelevantEconomicEvents(currentCtx.asset.symbol);
      const marketSession = getCurrentMarketSession();

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            voiceName: 'Kore',
            marketContext: {
              asset: currentCtx.asset.symbol,
              assetName: currentCtx.asset.name,
              currentPrice: currentCtx.asset.currentPrice,
              spread: currentCtx.asset.spread,
              timeframe: currentCtx.timeframe,
              marketAnalysis: currentCtx.marketAnalysis,
              confluences: currentCtx.confluences,
              upcomingHighImpact,
              relevantEvents: relevantEvents.slice(0, 5),
              marketSession,
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
            setErrorMessage(msg.error || 'Erro na sessão com a IA.');
            setStatus('error');
          }
        } catch (err) {
          console.error('Error parsing live ws message:', err);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket live error:', e);
        setErrorMessage('Falha ao conectar no servidor de voz.');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('idle');
      };

      // Connect microphone
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
  }, [scheduleAudioChunk, stopAudioPlayback]);

  // Handle Mute Toggle
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
        });
      }
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  return {
    status,
    errorMessage,
    hasMicPermission,
    isMuted,
    micLevel,
    aiSpeechLevel,
    isActivatingMic,
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
    stopAudioPlayback,
  };
}
