import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Asset, TimeFrame, MarketAnalysis, ConfluenceBreakdown } from '../types/trading';
import { getRelevantEconomicEvents, getCurrentMarketSession, getRealMarketNews } from '../services/economicCalendar';
import { isForexMarketOpen } from '../services/marketData';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';
export type VoiceEngine = 'gemini_live' | 'browser_speech';

export interface LiveTurnMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

interface UseLiveVoiceParams {
  asset: Asset;
  timeframe: TimeFrame;
  marketAnalysis: MarketAnalysis;
  confluences: ConfluenceBreakdown;
}

const getEffectiveGeminiKey = (): string => {
  let envKey = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      envKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
    }
  } catch {}

  let localKey = '';
  if (typeof window !== 'undefined') {
    localKey = localStorage.getItem('clandex_gemini_api_key') || '';
  }

  if (localKey && localKey.includes('AIzaSyDlckr22NxUjJXWVp9ENtPFxuDoBy2LFZ4')) {
    try {
      localStorage.removeItem('clandex_gemini_api_key');
    } catch {}
    localKey = '';
  }

  return (localKey || envKey || '').trim();
};

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
  const [activeEngine, setActiveEngine] = useState<VoiceEngine>('gemini_live');
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [lastTurnMessage, setLastTurnMessage] = useState<LiveTurnMessage | null>(null);

  const statusRef = useRef<LiveVoiceStatus>('idle');
  statusRef.current = status;

  // Supressão de eco acústico e controle estrito de turnos
  const isAiSpeakingRef = useRef<boolean>(false);
  const speechCooldownTimeoutRef = useRef<any>(null);
  const currentAiTurnTextRef = useRef<string>('');
  const activeEngineRef = useRef<VoiceEngine>('gemini_live');

  // Direct Client-Side Gemini Live Session Ref
  const geminiLiveSessionRef = useRef<any>(null);

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

  // Browser Fallback Recognition & TTS Refs
  const recognitionRef = useRef<any>(null);
  const speechAnimIntervalRef = useRef<any>(null);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  // VAD Hangover para evitar corte de palavras
  const lastVoiceActiveTimeRef = useRef<number>(0);
  const speechSilenceTimeoutRef = useRef<any>(null);
  const accumulatedSpeechRef = useRef<string>('');
  const hasSpokenInTurnRef = useRef<boolean>(false);

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

  // Resampler em tempo real: converte taxa nativa (ex: 44.1kHz ou 48kHz) para 16kHz Little-Endian
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

  const stopAudioPlayback = useCallback(() => {
    const state = audioPlaybackStateRef.current;
    state.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    });
    state.activeSources = [];
    state.nextStartTime = 0;
    setAiSpeechLevel(0);

    if (speechAnimIntervalRef.current) {
      clearInterval(speechAnimIntervalRef.current);
      speechAnimIntervalRef.current = null;
    }
    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isAiSpeakingRef.current = false;
  }, []);

  /**
   * Reprodução de áudio sem cortes (Gapless Scheduling a 24.000 Hz) via Web Audio API
   */
  const scheduleAudioChunk = useCallback((base64Audio: string) => {
    try {
      const pcmData = base64ToPcm(base64Audio);
      const ctx = outputAudioCtxRef.current;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Calcula RMS do áudio da IA para animar o avatar 3D
      let sum = 0;
      for (let i = 0; i < pcmData.length; i += 16) {
        sum += Math.abs(pcmData[i]);
      }
      const avg = sum / (pcmData.length / 16);
      const level = Math.min(100, Math.round(avg * 320));
      setAiSpeechLevel(Math.max(20, level));

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

      // Marca que a IA está falando (o microfone é fechado contra eco)
      isAiSpeakingRef.current = true;
      if (speechCooldownTimeoutRef.current) {
        clearTimeout(speechCooldownTimeoutRef.current);
        speechCooldownTimeoutRef.current = null;
      }
      setStatus('speaking');

      source.onended = () => {
        state.activeSources = state.activeSources.filter((s) => s !== source);
        if (state.activeSources.length === 0) {
          setAiSpeechLevel(0);
          // Cooldown de 800ms após o fim do áudio para que todo o som ambiente dissipe antes de reabrir o microfone
          speechCooldownTimeoutRef.current = setTimeout(() => {
            isAiSpeakingRef.current = false;
            setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
            try {
              if (recognitionRef.current && statusRef.current === 'listening') {
                recognitionRef.current.start();
              }
            } catch {}
          }, 800);
        }
      };
    } catch (err) {
      console.error('Error playing 24kHz audio chunk:', err);
    }
  }, []);

  /**
   * Resposta local especializada em Opções Binárias e SMC (Português do Brasil)
   */
  const answerQuestionLocally = useCallback((questionText: string): string => {
    const q = questionText.toLowerCase();
    const ctx = contextRef.current;
    const isClosedWeekendForex = ctx.asset.category === 'FOREX' && !isForexMarketOpen();
    const { upcomingHighImpact } = getRelevantEconomicEvents(ctx.asset.symbol);
    const realNews = getRealMarketNews(ctx.asset.symbol);

    if (isClosedWeekendForex && (q.includes('entrar') || q.includes('sinal') || q.includes('compro') || q.includes('vendo') || q.includes('call') || q.includes('put'))) {
      return `Aviso do TradingView: O mercado Forex está fechado neste fim de semana para ${ctx.asset.symbol}. Para sinais e operações ativas agora, recomendo usar Criptomoedas como Bitcoin ou Ethereum, que operam vinte e quatro horas por dia.`;
    }

    if (
      q.includes('notícia') ||
      q.includes('noticia') ||
      q.includes('calendário') ||
      q.includes('calendario') ||
      q.includes('impacto')
    ) {
      if (realNews.length > 0) {
        return `Notícia do TradingView: ${realNews[0].title}. O sentimento macroeconômico está ativo.`;
      }
      if (upcomingHighImpact) {
        return `Atenção: temos ${upcomingHighImpact.event} da moeda ${upcomingHighImpact.currency} às ${upcomingHighImpact.time}. Impacto alto. Recomendo prudência ou pausar operações.`;
      }
      return 'Sem notícias críticas de alto impacto agendadas para os próximos minutos nesta paridade. O fluxo técnico está limpo.';
    }

    if (
      q.includes('entrar') ||
      q.includes('entrada') ||
      q.includes('sinal') ||
      q.includes('compro') ||
      q.includes('vendo') ||
      q.includes('call') ||
      q.includes('put')
    ) {
      if (ctx.confluences.totalScore >= 75) {
        const dir = ctx.confluences.direction === 'CALL' ? 'COMPRA' : 'VENDA';
        return `Confluência forte de ${ctx.confluences.totalScore}% para ${dir}. Principais gatilhos: ${ctx.confluences.reasons.slice(0, 2).join(' e ')}. Respeite seu gerenciamento.`;
      } else if (ctx.confluences.totalScore >= 60) {
        return `Oportunidade em observação com probabilidade de ${ctx.confluences.totalScore}%. Aguarde a validação do candle.`;
      }
      return `Sem confluência suficiente no momento, pontuação de apenas ${ctx.confluences.totalScore}%. Mercado em ruído ou lateral. Preserve sua banca.`;
    }

    if (q.includes('tendência') || q.includes('tendencia') || q.includes('fluxo')) {
      return `No timeframe ${ctx.timeframe}, o ativo ${ctx.asset.symbol} está em tendência de ${ctx.marketAnalysis.trend}, com força compradora ${ctx.marketAnalysis.buyerStrength} e força vendedora ${ctx.marketAnalysis.sellerStrength}.`;
    }

    if (
      q.includes('suporte') ||
      q.includes('resistência') ||
      q.includes('resistencia') ||
      q.includes('taxa') ||
      q.includes('preço') ||
      q.includes('preco')
    ) {
      const keyLevels = ctx.marketAnalysis.keyLevels || [];
      const sup = keyLevels
        .filter((k) => k.type === 'SUPPORT')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      const res = keyLevels
        .filter((k) => k.type === 'RESISTANCE')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      let msg = `O preço atual do ${ctx.asset.symbol} é ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. `;
      if (sup.length > 0) msg += `Suporte em ${sup[0]}. `;
      if (res.length > 0) msg += `Resistência em ${res[0]}.`;
      return msg;
    }

    return `Ativo ${ctx.asset.symbol} operando a ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. Tendência ${ctx.marketAnalysis.trend} com confluência ${ctx.confluences.direction} de ${ctx.confluences.totalScore}%. Pode perguntar sobre suporte, tendência ou confluências.`;
  }, []);

  /**
   * Fallback de síntese caso Gemini Live não esteja disponível
   */
  const speakBrowserText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    stopAudioPlayback();
    isAiSpeakingRef.current = true;
    setStatus('speaking');

    const clean = textToSpeak.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    utterance.pitch = 1.02;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(
      (v) =>
        (v.lang.startsWith('pt') || v.lang.includes('BR')) &&
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Luciana') || v.name.includes('Francisca') || v.name.includes('Maria'))
    ) || voices.find((v) => v.lang.startsWith('pt') || v.lang.includes('BR'));

    if (ptVoice) utterance.voice = ptVoice;

    let hasEnded = false;
    const finishPlayback = () => {
      if (hasEnded) return;
      hasEnded = true;

      if (speechAnimIntervalRef.current) {
        clearInterval(speechAnimIntervalRef.current);
        speechAnimIntervalRef.current = null;
      }
      setAiSpeechLevel(0);

      speechCooldownTimeoutRef.current = setTimeout(() => {
        isAiSpeakingRef.current = false;
        setStatus('listening');
      }, 700);
    };

    utterance.onstart = () => {
      let phase = 0;
      speechAnimIntervalRef.current = setInterval(() => {
        phase += 0.35;
        const baseLevel = 45 + Math.sin(phase * 4.2) * 25 + Math.sin(phase * 8.5) * 15;
        setAiSpeechLevel(Math.max(25, Math.min(95, Math.round(baseLevel))));
      }, 70);
    };

    utterance.onend = () => finishPlayback();
    utterance.onerror = () => finishPlayback();

    const maxSafetyMs = Math.max(2500, Math.ceil((clean.length / 10) * 1000) + 1500);
    setTimeout(() => {
      if (!hasEnded && isAiSpeakingRef.current) {
        finishPlayback();
      }
    }, maxSafetyMs);

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  }, [stopAudioPlayback]);

  // Parar reconhecimento de voz do navegador
  const stopSpeechRecognition = useCallback(() => {
    if (speechSilenceTimeoutRef.current) {
      clearTimeout(speechSilenceTimeoutRef.current);
      speechSilenceTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
  }, []);

  // Iniciar reconhecimento de voz paralelo do navegador (PT-BR)
  const startSpeechRecognition = useCallback(() => {
    stopSpeechRecognition();
    if (typeof window === 'undefined') return;
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.warn('[ClandeX-IA] Web SpeechRecognition não disponível, transmitindo áudio direto 16kHz.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        // Se a IA estiver falando, descarta para evitar capturar a própria voz do assistente
        if (isAiSpeakingRef.current || statusRef.current === 'speaking') {
          return;
        }

        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const text = item[0]?.transcript || '';
          if (item.isFinal) {
            finalChunk += text;
          } else {
            interim += text;
          }
        }

        const currentDisplay = (finalChunk || interim).trim();
        if (currentDisplay) {
          setUserTranscript(currentDisplay);
        }

        if (finalChunk.trim()) {
          accumulatedSpeechRef.current = (accumulatedSpeechRef.current + ' ' + finalChunk).trim();
        }

        if (speechSilenceTimeoutRef.current) {
          clearTimeout(speechSilenceTimeoutRef.current);
        }

        // Aguarda 750ms após término da fala para enviar a pergunta final
        speechSilenceTimeoutRef.current = setTimeout(() => {
          const fullQuestion = (accumulatedSpeechRef.current || currentDisplay).trim();
          if (fullQuestion && fullQuestion.length > 1 && !isAiSpeakingRef.current) {
            console.log('[ClandeX-IA Voz] Pergunta do trader concluída via SpeechRecognition:', fullQuestion);
            accumulatedSpeechRef.current = '';
            setUserTranscript(fullQuestion);
            setLastTurnMessage({
              id: `user-voice-${Date.now()}`,
              role: 'user',
              text: fullQuestion,
              timestamp: Date.now(),
            });

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'turn_complete', text: fullQuestion }));
            }
          }
        }, 750);
      };

      recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[ClandeX-IA SpeechRecognition] Evento:', e.error);
        }
      };

      recognition.onend = () => {
        if (statusRef.current === 'listening' && !isAiSpeakingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('[ClandeX-IA] Falha ao iniciar reconhecimento:', err);
    }
  }, [stopSpeechRecognition]);

  // Request Microphone Permissions & Audio Processing com Resampler 16kHz
  const requestMicrophoneAccess = useCallback(async () => {
    try {
      setIsActivatingMic(true);
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioCtx();
      inputAudioCtxRef.current = inputCtx;
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume();
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

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // Se a IA estiver falando ou mutado: NÃO ENVIA ÁUDIO PARA EVITAR ECO
        if (isMutedRef.current || isAiSpeakingRef.current || statusRef.current === 'speaking') {
          setMicLevel(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i += 8) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / (inputData.length / 8));
        const currentLevel = Math.min(100, Math.round(rms * 280));
        setMicLevel(currentLevel);

        const now = Date.now();
        // VAD gate: Se o volume for acima do piso de ruído, marca voz ativa
        if (rms > 0.012) {
          lastVoiceActiveTimeRef.current = now;
          hasSpokenInTurnRef.current = true;
        }

        // Permite envio contínuo enquanto o usuário fala e mantém hangover de 1.0s após pausas
        const isVoiceActive = now - lastVoiceActiveTimeRef.current < 1000;

        // 1. Resample nativo para 16kHz Little-Endian
        const resampled = resampleTo16k(inputData, inputCtx.sampleRate);
        const base64Pcm = pcmToBase64(resampled);

        // 2. Envio via WebSocket (/api/live)
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          if (isVoiceActive) {
            wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
          }

          // Fallback de silêncio para áudio puro:
          if (hasSpokenInTurnRef.current && now - lastVoiceActiveTimeRef.current > 1050) {
            hasSpokenInTurnRef.current = false;
            console.log('[ClandeX-IA] Fim de fala detectado no áudio. Enviando turn_complete...');
            wsRef.current.send(JSON.stringify({ type: 'turn_complete' }));
          }
        }

        // 3. Envio direto via Gemini Live Session (caso conectado diretamente)
        if (geminiLiveSessionRef.current) {
          if (isVoiceActive) {
            try {
              geminiLiveSessionRef.current.sendRealtimeInput({
                media: [{ data: base64Pcm, mimeType: 'audio/pcm;rate=16000' }],
              });
            } catch {}
          }
        }
      };

      const muteNode = inputCtx.createGain();
      muteNode.gain.value = 0;

      source.connect(processor);
      processor.connect(muteNode);
      muteNode.connect(inputCtx.destination);
    } catch (err: any) {
      console.warn('Microphone activation notice:', err?.name, err?.message);
      setHasMicPermission(false);
      setErrorMessage('Acesso ao microfone não concedido no navegador.');
    } finally {
      setIsActivatingMic(false);
    }
  }, []);

  /**
   * Conecta à Voz em Tempo Real oficial Gemini Live (gemini-3.8-live) com voz Zephyr
   */
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      // 1. Inicializa AudioContext para reprodução a 24.000 Hz
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      } else if (outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }
      const outputCtx = outputAudioCtxRef.current;
      audioPlaybackStateRef.current = { nextStartTime: outputCtx.currentTime, activeSources: [] };

      // 2. Solicita acesso ao microfone e liga o resampler 16kHz
      await requestMicrophoneAccess();

      const currentCtx = contextRef.current;
      const { upcomingHighImpact } = getRelevantEconomicEvents(currentCtx.asset.symbol);
      const marketSession = getCurrentMarketSession();
      const keyLevels = Array.isArray(currentCtx.marketAnalysis?.keyLevels) ? currentCtx.marketAnalysis.keyLevels : [];
      const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
      const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);

      const marketContextPayload = {
        asset: currentCtx.asset.symbol,
        assetName: currentCtx.asset.name,
        currentPrice: currentCtx.asset.currentPrice,
        timeframe: currentCtx.timeframe,
        marketAnalysis: currentCtx.marketAnalysis,
        confluences: currentCtx.confluences,
        upcomingHighImpact,
        marketSession,
      };

      // 3. Tenta conexão via WebSocket local (/api/live)
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

      let wsConnected = false;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          wsConnected = true;
          setActiveEngine('gemini_live');
          activeEngineRef.current = 'gemini_live';
          ws.send(
            JSON.stringify({
              type: 'start',
              voiceName: 'Zephyr',
              marketContext: marketContextPayload,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'ready') {
              setStatus('listening');
              startSpeechRecognition();
              // Saudação inicial de boas-vindas da ClandeX-IA em áudio neural 24kHz
              ws.send(
                JSON.stringify({
                  type: 'client_content',
                  text: `Olá trader! Sou a ClandeX-IA. Conexão neural de voz estabelecida. Estou monitorando ${contextRef.current.asset.symbol} com você em tempo real. Pode me fazer qualquer pergunta sobre o mercado!`,
                })
              );
            } else if (msg.type === 'audio') {
              scheduleAudioChunk(msg.audio);
            } else if (msg.type === 'text') {
              currentAiTurnTextRef.current += (currentAiTurnTextRef.current ? ' ' : '') + msg.text.trim();
              setAiResponseText(currentAiTurnTextRef.current);
            } else if (msg.type === 'user_text') {
              setUserTranscript(msg.userText);
              setLastTurnMessage({
                id: `user-voice-${Date.now()}`,
                role: 'user',
                text: msg.userText,
                timestamp: Date.now(),
              });
            } else if (msg.type === 'turn_complete') {
              if (currentAiTurnTextRef.current.trim()) {
                setLastTurnMessage({
                  id: `model-voice-${Date.now()}`,
                  role: 'model',
                  text: currentAiTurnTextRef.current.trim(),
                  timestamp: Date.now(),
                });
                currentAiTurnTextRef.current = '';
              }
            } else if (msg.type === 'interrupted') {
              setStatus('listening');
              stopAudioPlayback();
            } else if (msg.type === 'error') {
              console.warn('[Gemini Live WS Aviso]:', msg.error);
            }
          } catch (parseErr) {
            console.error('Error handling ws message:', parseErr);
          }
        };

        ws.onerror = (e) => {
          console.warn('[Gemini Live WS] Erro de conexão WebSocket, tentando Gemini Live direto...');
        };

        ws.onclose = () => {
          if (statusRef.current !== 'idle') {
            console.log('[Gemini Live WS] WebSocket encerrado.');
          }
        };

        // Aguarda até 2.5s para o WebSocket abrir, senão tenta Gemini Live client-side
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (wsConnected) {
          return;
        }
      } catch {}

      // 4. Conexão direta client-side com Google GenAI Live API (gemini-3.8-live)
      const geminiKey = getEffectiveGeminiKey();
      if (geminiKey && geminiKey.length > 15) {
        console.log('[ClandeX-IA] Conectando diretamente ao Gemini Live (gemini-3.8-live)...');
        const ai = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const systemInstruction = `
Você é a ClandeX-IA em CONVERSA POR VOZ AO VIVO, especialista e mentora institucional de trading em Opções Binárias e Forex para a corretora Hiove.
Mercado atual em tempo real:
- Paridade: ${currentCtx.asset.symbol} (${currentCtx.asset.name})
- Preço Atual: ${currentCtx.asset.currentPrice} | Timeframe: ${currentCtx.timeframe}
- Tendência: ${currentCtx.marketAnalysis?.trend || 'LATERAL'} (Força Compra: ${currentCtx.marketAnalysis?.buyerStrength || 'MODERADA'}, Venda: ${currentCtx.marketAnalysis?.sellerStrength || 'MODERADA'})
- Confluência Técnica: ${currentCtx.confluences?.totalScore ?? 0}% (${currentCtx.confluences?.direction ?? 'NEUTRO'})
- Suportes Técnicos: ${supports.join(', ') || 'dinâmicos'}
- Resistências Técnicas: ${resistances.join(', ') || 'dinâmicas'}
- Calendário: ${upcomingHighImpact ? `${upcomingHighImpact.event} às ${upcomingHighImpact.time}` : 'Sem notícias críticas próximas'}

Diretrizes obrigatórias:
1. Responda em Português do Brasil com tom natural, firme, confiante e amigável.
2. Responda diretamente e de forma concisa (máximo 1 a 2 frases faladas).
3. Não use formatação markdown ou asteriscos, fale de forma limpa como uma pessoa ao microfone.
        `;

        const session = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
            systemInstruction,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              const parts = message.serverContent?.modelTurn?.parts || [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  scheduleAudioChunk(part.inlineData.data);
                }
              }

              const aiTxt = (message.serverContent as any)?.outputAudioTranscription?.text;
              if (aiTxt) {
                currentAiTurnTextRef.current += (currentAiTurnTextRef.current ? ' ' : '') + aiTxt.trim();
                setAiResponseText(currentAiTurnTextRef.current);
              }

              const userTxt = (message.serverContent as any)?.inputAudioTranscription?.text;
              if (userTxt) {
                setUserTranscript(userTxt);
                setLastTurnMessage({
                  id: `user-voice-${Date.now()}`,
                  role: 'user',
                  text: userTxt,
                  timestamp: Date.now(),
                });
              }

              if (message.serverContent?.turnComplete) {
                if (currentAiTurnTextRef.current.trim()) {
                  setLastTurnMessage({
                    id: `model-voice-${Date.now()}`,
                    role: 'model',
                    text: currentAiTurnTextRef.current.trim(),
                    timestamp: Date.now(),
                  });
                  currentAiTurnTextRef.current = '';
                }
              }

              if (message.serverContent?.interrupted) {
                setStatus('listening');
                stopAudioPlayback();
              }
            },
            onclose: () => {
              setStatus('idle');
            },
            onerror: (err: any) => {
              console.warn('[Gemini Live Direct] Erro:', err);
            },
          },
        });

        geminiLiveSessionRef.current = session;
        setActiveEngine('gemini_live');
        activeEngineRef.current = 'gemini_live';
        setStatus('listening');
        console.log('[ClandeX-IA] Gemini Live (gemini-3.8-live) conectado diretamente com sucesso!');
        return;
      }

      // 5. Fallback seguro caso tudo falhe: Saudação e escuta local
      const greeting = `ClandeX-IA conectada por voz. Monitorando ${currentCtx.asset.symbol}. Pode falar comigo!`;
      setLastTurnMessage({
        id: `model-voice-${Date.now()}`,
        role: 'model',
        text: greeting,
        timestamp: Date.now(),
      });
      speakBrowserText(greeting);
    } catch (err: any) {
      console.warn('[ClandeX-IA Voz] Ativando fallback de voz:', err);
      const greeting = `ClandeX-IA conectada por voz. Monitorando ${contextRef.current.asset.symbol}. Pode falar comigo!`;
      speakBrowserText(greeting);
    }
  }, [requestMicrophoneAccess, scheduleAudioChunk, stopAudioPlayback, speakBrowserText]);

  // Disconnect session and release media streams
  const disconnectSession = useCallback(() => {
    stopAudioPlayback();
    stopSpeechRecognition();
    hasSpokenInTurnRef.current = false;
    accumulatedSpeechRef.current = '';

    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    isAiSpeakingRef.current = false;
    currentAiTurnTextRef.current = '';

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    if (geminiLiveSessionRef.current) {
      try {
        geminiLiveSessionRef.current.close();
      } catch {}
      geminiLiveSessionRef.current = null;
    }

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

    setStatus('idle');
    setMicLevel(0);
    setAiSpeechLevel(0);
    setErrorMessage(null);
  }, [stopAudioPlayback, stopSpeechRecognition]);

  // Enviar pergunta de texto diretamente para o Gemini Live responder por voz
  const sendTextMessage = useCallback((textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean) return;

    setUserTranscript(clean);
    setLastTurnMessage({
      id: `user-voice-${Date.now()}`,
      role: 'user',
      text: clean,
      timestamp: Date.now(),
    });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'client_content', text: clean }));
    } else if (geminiLiveSessionRef.current) {
      try {
        geminiLiveSessionRef.current.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: clean }] }],
          turnComplete: true,
        });
      } catch {}
    } else {
      const localReply = answerQuestionLocally(clean);
      setAiResponseText(localReply);
      setLastTurnMessage({
        id: `model-voice-${Date.now()}`,
        role: 'model',
        text: localReply,
        timestamp: Date.now(),
      });
      speakBrowserText(localReply);
    }
  }, [answerQuestionLocally, speakBrowserText]);

  // Interromper fala em tempo real
  const interruptSpeech = useCallback(() => {
    stopAudioPlayback();
    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    isAiSpeakingRef.current = false;
    setStatus('listening');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'interrupted' }));
      } catch {}
    }
    try {
      if (recognitionRef.current && statusRef.current === 'listening') {
        recognitionRef.current.start();
      }
    } catch {}
  }, [stopAudioPlayback]);

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
    activeEngine,
    userTranscript,
    aiResponseText,
    lastTurnMessage,
    sendTextMessage,
    interruptSpeech,
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
  };
}
