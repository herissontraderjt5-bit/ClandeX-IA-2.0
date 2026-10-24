import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Asset, TimeFrame, MarketAnalysis, ConfluenceBreakdown } from '../types/trading';
import { getRelevantEconomicEvents, getCurrentMarketSession } from '../services/economicCalendar';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';
export type VoiceEngine = 'gemini_live' | 'browser_speech';

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
  const [activeEngine, setActiveEngine] = useState<VoiceEngine>('gemini_live');

  // Direct Client-Side Gemini Live Session Ref (Funciona 100% na Vercel e Web)
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

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

  // Resampler for Gemini Live (16kHz PCM)
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
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const scheduleAudioChunk = useCallback((base64Audio: string) => {
    try {
      const pcmData = base64ToPcm(base64Audio);
      const ctx = outputAudioCtxRef.current;
      if (!ctx) return;

      let sum = 0;
      for (let i = 0; i < pcmData.length; i += 16) {
        sum += Math.abs(pcmData[i]);
      }
      const avg = sum / (pcmData.length / 16);
      const level = Math.min(100, Math.round(avg * 320));
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

  /**
   * Resposta local especializada em Opções Binárias e SMC (Português do Brasil)
   */
  const answerQuestionLocally = (questionText: string): string => {
    const q = questionText.toLowerCase();
    const ctx = contextRef.current;
    const { upcomingHighImpact } = getRelevantEconomicEvents(ctx.asset.symbol);

    if (q.includes('notícia') || q.includes('noticia') || q.includes('calendário') || q.includes('calendario') || q.includes('impacto')) {
      if (upcomingHighImpact) {
        return `Atenção: temos ${upcomingHighImpact.event} da moeda ${upcomingHighImpact.currency} às ${upcomingHighImpact.time}. Impacto alto. Recomendo prudência ou pausar operações.`;
      }
      return 'Sem notícias críticas de alto impacto agendadas para os próximos minutos nesta paridade. O fluxo técnico está limpo.';
    }

    if (q.includes('entrar') || q.includes('entrada') || q.includes('sinal') || q.includes('compro') || q.includes('vendo') || q.includes('call') || q.includes('put')) {
      if (ctx.confluences.totalScore >= 75) {
        const dir = ctx.confluences.direction === 'CALL' ? 'COMPRA' : 'VENDA';
        return `Confluência forte de ${ctx.confluences.totalScore}% para ${dir}. Principais gatilhos: ${ctx.confluences.reasons.slice(0, 2).join(' e ')}. Respeite o gerenciamento.`;
      } else if (ctx.confluences.totalScore >= 60) {
        return `Oportunidade em observação com probabilidade de ${ctx.confluences.totalScore}%. Aguarde a validação do candle.`;
      }
      return `Sem confluência suficiente no momento, pontuação de apenas ${ctx.confluences.totalScore}%. Mercado lateral ou em ruído. Preserve sua banca.`;
    }

    if (q.includes('tendência') || q.includes('tendencia') || q.includes('fluxo')) {
      return `No timeframe ${ctx.timeframe}, o ativo ${ctx.asset.symbol} está em tendência de ${ctx.marketAnalysis.trend}, com força compradora ${ctx.marketAnalysis.buyerStrength} e força vendedora ${ctx.marketAnalysis.sellerStrength}.`;
    }

    if (q.includes('suporte') || q.includes('resistência') || q.includes('resistencia') || q.includes('taxa') || q.includes('preço') || q.includes('preco')) {
      const keyLevels = ctx.marketAnalysis.keyLevels || [];
      const sup = keyLevels.filter((k) => k.type === 'SUPPORT').map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      const res = keyLevels.filter((k) => k.type === 'RESISTANCE').map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      let msg = `O preço atual do ${ctx.asset.symbol} é ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. `;
      if (sup.length > 0) msg += `Suporte em ${sup[0]}. `;
      if (res.length > 0) msg += `Resistência em ${res[0]}.`;
      return msg;
    }

    return `Ativo ${ctx.asset.symbol} operando a ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. Tendência de ${ctx.marketAnalysis.trend} com confluência ${ctx.confluences.direction} de ${ctx.confluences.totalScore}%. Pode perguntar sobre tendência, confluência ou notícias.`;
  };

  /**
   * Fala a resposta em português do Brasil e anima o avatar
   */
  const speakBrowserText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    stopAudioPlayback();
    setStatus('speaking');

    const clean = textToSpeak.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    utterance.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang.startsWith('pt') || v.lang.includes('BR'));
    if (ptVoice) utterance.voice = ptVoice;

    utterance.onstart = () => {
      let phase = 0;
      speechAnimIntervalRef.current = setInterval(() => {
        phase += 0.35;
        const baseLevel = 45 + Math.sin(phase * 4.2) * 25 + Math.sin(phase * 8.5) * 15;
        setAiSpeechLevel(Math.max(25, Math.min(95, Math.round(baseLevel))));
      }, 70);
    };

    utterance.onend = () => {
      stopAudioPlayback();
      setStatus('listening');
    };

    utterance.onerror = () => {
      stopAudioPlayback();
      setStatus('listening');
    };

    window.speechSynthesis.speak(utterance);
  }, [stopAudioPlayback]);

  /**
   * Ativa modo de voz inteligente do navegador com reconhecimento de fala nativo (PT-BR)
   */
  const startBrowserSpeechFallback = useCallback(() => {
    setActiveEngine('browser_speech');
    setErrorMessage(null);
    setStatus('listening');
    setHasMicPermission(true);

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'pt-BR';
        recognition.continuous = true;
        recognition.interimResults = false;

        recognition.onresult = (event: any) => {
          if (isMutedRef.current) return;
          const lastIdx = event.results.length - 1;
          const transcript = event.results[lastIdx]?.[0]?.transcript?.trim();
          if (transcript) {
            console.log('[ClandeX-IA Voz] Pergunta recebida:', transcript);
            const answer = answerQuestionLocally(transcript);
            speakBrowserText(answer);
          }
        };

        recognition.onerror = (err: any) => {
          if (err.error !== 'no-speech') {
            console.warn('[ClandeX-IA Voz] Reconhecimento aviso:', err.error);
          }
        };

        recognition.onend = () => {
          if (recognitionRef.current && !isMutedRef.current) {
            try {
              recognition.start();
            } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.warn('[ClandeX-IA] Falha ao iniciar SpeechRecognition:', e);
      }
    }

    const assetSym = contextRef.current.asset.symbol;
    speakBrowserText(`ClandeX-IA conectada por voz. Monitorando ${assetSym}. Pode falar comigo!`);
  }, [speakBrowserText]);

  // Disconnect WebSocket, Direct Session and media streams
  const disconnectSession = useCallback(() => {
    stopAudioPlayback();

    if (geminiLiveSessionRef.current) {
      try {
        geminiLiveSessionRef.current.close();
      } catch {}
      geminiLiveSessionRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
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

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('idle');
    setMicLevel(0);
    setAiSpeechLevel(0);
    setErrorMessage(null);
  }, [stopAudioPlayback]);

  // Request Microphone Permissions
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
        if (isMutedRef.current) {
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

        // Envio direto para o Gemini Live na nuvem (Vercel ou Local)
        if (geminiLiveSessionRef.current) {
          try {
            geminiLiveSessionRef.current.sendRealtimeInput({
              audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' },
            });
          } catch {}
        } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
        }
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

  // Connect to Gemini Live: Funciona na Vercel (Direto via SDK) ou via WebSocket local
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;
      audioPlaybackStateRef.current = { nextStartTime: outputCtx.currentTime, activeSources: [] };

      // Chave do Gemini (Lê do .env / Vercel Environment Variables / LocalStorage)
      let geminiKey = '';
      try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
          geminiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
        }
      } catch {}
      if (!geminiKey && typeof window !== 'undefined') {
        geminiKey = localStorage.getItem('clandex_gemini_api_key') || 'AIzaSyDlckr22NxUjJXWVp9ENtPFxuDoBy2LFZ4';
      }

      const currentCtx = contextRef.current;
      const { upcomingHighImpact, relevantEvents } = getRelevantEconomicEvents(currentCtx.asset.symbol);
      const marketSession = getCurrentMarketSession();

      const keyLevels = Array.isArray(currentCtx.marketAnalysis?.keyLevels) ? currentCtx.marketAnalysis.keyLevels : [];
      const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
      const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);

      const systemInstruction = `
Você é a ClandeX-IA em CONVERSA POR VOZ AO VIVO, especialista e mentora institucional de trading em Opções Binárias e Forex para a corretora Hiove.
Você está conversando por voz em tempo real diretamente com o trader humano.

DADOS EM TEMPO REAL DO MERCADO ATUAL:
- Ativo: ${currentCtx.asset.symbol} (${currentCtx.asset.name})
- Timeframe: ${currentCtx.timeframe}
- Preço Atual: ${currentCtx.asset.currentPrice}
- Tendência Principal: ${currentCtx.marketAnalysis?.trend || 'LATERAL'}
- Força Compradora: ${currentCtx.marketAnalysis?.buyerStrength || 'MODERADA'} | Força Vendedora: ${currentCtx.marketAnalysis?.sellerStrength || 'MODERADA'}
- Suportes Técnicos: ${supports.length > 0 ? supports.join(', ') : 'Zonas dinâmicas de fundo'}
- Resistências Técnicas: ${resistances.length > 0 ? resistances.join(', ') : 'Zonas dinâmicas de topo'}
- TradingView Recomendação: ${currentCtx.marketAnalysis?.tradingView?.recommendation || 'NEUTRO'}
- Confluência do Robô: ${currentCtx.confluences?.totalScore ?? 0}/100 (${currentCtx.confluences?.direction ?? 'NEUTRO'})
- Sessão do Mercado: ${marketSession?.currentSession || 'Mercado Aberto'} (Brasília: ${marketSession?.currentTimeBrasilia || 'N/A'})

DIRETRIZES PARA A CONVERSA POR VOZ:
1. Fale sempre em Português do Brasil com tom natural, firme, confiante e amigável.
2. Seja objetivo e conciso (máximo de 1 a 3 frases faladas por resposta), pois o trader está operando.
3. Não use markdown, asteriscos ou formatações no áudio, fale fluidamente.
4. Ao falar de suporte e resistência, mencione os valores das taxas.
5. Se perguntar se vale a pena entrar agora, oriente com base na confluência e gerenciamento.
6. Nunca garanta lucros certos.
      `;

      // 1. TENTATIVA DIRETA CLIENTE -> GEMINI LIVE (IDEAL PARA VERCEL)
      if (geminiKey && geminiKey.length > 10) {
        try {
          console.log('[ClandeX-IA] Conectando diretamente ao Gemini Live (Vercel/Web)...');
          const ai = new GoogleGenAI({ apiKey: geminiKey });

          const liveModels = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-2.5-flash'];
          let directConnected = false;

          for (const m of liveModels) {
            try {
              const liveSession = await ai.live.connect({
                model: m,
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
                    const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    if (audio) {
                      setStatus('speaking');
                      scheduleAudioChunk(audio);
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
                    console.warn(`[Gemini Live Client] Erro com ${m}:`, err);
                  },
                },
              });

              geminiLiveSessionRef.current = liveSession;
              directConnected = true;
              setActiveEngine('gemini_live');
              setStatus('listening');
              console.log(`[ClandeX-IA] Gemini Live direto conectado com sucesso no modelo ${m}!`);
              break;
            } catch (liveErr) {
              console.warn(`[Gemini Live Client] Tentativa ${m} falhou:`, liveErr);
            }
          }

          if (directConnected) {
            await requestMicrophoneAccess();
            return;
          }
        } catch (directErr) {
          console.warn('[ClandeX-IA] Conexão direta falhou, tentando fallback...', directErr);
        }
      }

      // 2. TENTATIVA VIA WEBSOCKET LOCAL (Se estiver rodando server.ts local)
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
      let ws: WebSocket | null = null;
      try {
        ws = new WebSocket(wsUrl);
      } catch {}

      if (ws) {
        wsRef.current = ws;
        let didOpen = false;

        ws.onopen = () => {
          didOpen = true;
          setActiveEngine('gemini_live');
          ws?.send(
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
              startBrowserSpeechFallback();
            }
          } catch {}
        };

        ws.onerror = () => {
          if (!didOpen) startBrowserSpeechFallback();
        };

        ws.onclose = () => {
          if (activeEngine === 'gemini_live') setStatus('idle');
        };

        await requestMicrophoneAccess();
        return;
      }

      // 3. FALLBACK FINAL: Voz inteligente nativa do navegador
      startBrowserSpeechFallback();
      await requestMicrophoneAccess();
    } catch {
      startBrowserSpeechFallback();
    }
  }, [
    scheduleAudioChunk,
    stopAudioPlayback,
    requestMicrophoneAccess,
    startBrowserSpeechFallback,
    activeEngine,
  ]);

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
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
  };
}
