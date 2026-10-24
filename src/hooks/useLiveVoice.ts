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
  const [activeEngine, setActiveEngine] = useState<VoiceEngine>('browser_speech');
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiResponseText, setAiResponseText] = useState<string>('');

  const statusRef = useRef<LiveVoiceStatus>('idle');
  statusRef.current = status;

  // Ref de motor ativo para evitar closures desatualizadas
  const activeEngineRef = useRef<VoiceEngine>('browser_speech');

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

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

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

    if (
      q.includes('notícia') ||
      q.includes('noticia') ||
      q.includes('calendário') ||
      q.includes('calendario') ||
      q.includes('impacto')
    ) {
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
    utterance.pitch = 1.02;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(
      (v) =>
        (v.lang.startsWith('pt') || v.lang.includes('BR')) &&
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Luciana') || v.name.includes('Francisca'))
    ) || voices.find((v) => v.lang.startsWith('pt') || v.lang.includes('BR'));

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

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  }, [stopAudioPlayback]);

  /**
   * Processa a pergunta do microfone usando Gemini (se chave válida disponível) ou fallback local
   */
  const handleUserSpokenInput = useCallback(async (transcript: string) => {
    console.log('[ClandeX-IA Voz] Pergunta capturada pelo microfone:', transcript);
    setUserTranscript(transcript);

    // 1. Se Gemini Live estiver conectado, envia via sendClientContent com turnComplete
    if (geminiLiveSessionRef.current) {
      try {
        geminiLiveSessionRef.current.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [{ text: transcript }],
            },
          ],
          turnComplete: true,
        });
        return;
      } catch (liveErr) {
        console.warn('[ClandeX-IA] Falha ao enviar texto no Gemini Live:', liveErr);
      }
    }

    // 2. Se Gemini Live não estiver ativo, consulta Gemini 3.7 Flash REST e fala com voz nativa
    let geminiKey = '';
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        geminiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
      }
    } catch {}
    if (!geminiKey && typeof window !== 'undefined') {
      geminiKey = localStorage.getItem('clandex_gemini_api_key') || '';
    }

    const isLeaked = geminiKey.trim() === 'AIzaSyDlckr22NxUjJXWVp9ENtPFxuDoBy2LFZ4';

    if (geminiKey && geminiKey.length > 15 && !isLeaked) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const ctx = contextRef.current;
        const prompt = `
Você é a ClandeX-IA em mentoria ao vivo de Opções Binárias e Forex para corretora Hiove.
Contexto do mercado atual:
- Paridade: ${ctx.asset.symbol} (${ctx.asset.name})
- Preço: ${ctx.asset.currentPrice}
- Tendência: ${ctx.marketAnalysis.trend} (Força Compra: ${ctx.marketAnalysis.buyerStrength}, Venda: ${ctx.marketAnalysis.sellerStrength})
- Confluência Técnica: ${ctx.confluences.totalScore}% para ${ctx.confluences.direction}

Pergunta do trader por voz: "${transcript}"

Responda em português brasileiro de forma direta, clara e concisa (máximo de 1 a 2 frases faladas). Nunca use formatação markdown ou asteriscos, fale de forma natural e fluida.
        `;

        const resp = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: prompt,
        });

        if (resp && resp.text) {
          setAiResponseText(resp.text);
          speakBrowserText(resp.text);
          return;
        }
      } catch (e: any) {
        console.warn('[ClandeX-IA] Gemini REST falhou, respondendo com motor técnico local:', e?.message || e);
      }
    }

    // Fallback para o motor local instantâneo
    const localAnswer = answerQuestionLocally(transcript);
    setAiResponseText(localAnswer);
    speakBrowserText(localAnswer);
  }, [speakBrowserText]);

  /**
   * Inicia o receptor contínuo de reconhecimento de fala (PT-BR)
   */
  const startSpeechRecognitionListener = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[ClandeX-IA] SpeechRecognition não suportado neste navegador.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        if (isMutedRef.current) return;
        const lastIdx = event.results.length - 1;
        const transcript = event.results[lastIdx]?.[0]?.transcript?.trim();
        if (transcript) {
          console.log('[ClandeX-IA Voz] Fala capturada:', transcript);
          handleUserSpokenInput(transcript);
        }
      };

      recognition.onerror = (err: any) => {
        if (err.error !== 'no-speech' && err.error !== 'aborted') {
          console.warn('[ClandeX-IA Voz] Reconhecimento aviso:', err.error);
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current && !isMutedRef.current && statusRef.current !== 'idle') {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('[ClandeX-IA] Reconhecimento contínuo não pôde iniciar imediatamente:', e);
    }
  }, [handleUserSpokenInput]);

  /**
   * Ativa modo de voz inteligente com reconhecimento de fala nativo (PT-BR)
   */
  const startBrowserSpeechFallback = useCallback(() => {
    activeEngineRef.current = 'browser_speech';
    setActiveEngine('browser_speech');
    setStatus('listening');
    setHasMicPermission(true);

    startSpeechRecognitionListener();

    const assetSym = contextRef.current.asset.symbol;
    speakBrowserText(`ClandeX-IA conectada por voz. Monitorando ${assetSym}. Pode falar comigo!`);
  }, [speakBrowserText, startSpeechRecognitionListener]);

  // Request Microphone Permissions & Audio Processing
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

        // Se Gemini Live estiver conectado, envia PCM direto
        if (geminiLiveSessionRef.current) {
          try {
            geminiLiveSessionRef.current.sendRealtimeInput({
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64Pcm }],
            });
          } catch (liveSendErr) {
            console.warn('[Gemini Live] Falha no envio de áudio do microfone:', liveSendErr);
          }
        } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
        }
      };

      // Mute gain node para evitar microfonia/eco nos alto-falantes
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

  // Connect to Live Voice: Tenta Gemini Live se chave disponível, senão ativa voz inteligente imediatamente
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      } else if (outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }
      const outputCtx = outputAudioCtxRef.current;
      audioPlaybackStateRef.current = { nextStartTime: outputCtx.currentTime, activeSources: [] };

      // Chave do Gemini
      let geminiKey = '';
      try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
          geminiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
        }
      } catch {}
      if (!geminiKey && typeof window !== 'undefined') {
        geminiKey = localStorage.getItem('clandex_gemini_api_key') || '';
      }

      const isKnownLeakedKey = geminiKey.trim() === 'AIzaSyDlckr22NxUjJXWVp9ENtPFxuDoBy2LFZ4';
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      let directConnected = false;

      // 1. TENTATIVA GEMINI LIVE (apenas com chave válida não bloqueada)
      if (geminiKey && geminiKey.length > 15 && !isKnownLeakedKey) {
        try {
          console.log('[ClandeX-IA] Conectando diretamente ao Gemini Live...');
          const ai = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: { apiVersion: 'v1alpha' },
          });

          const currentCtx = contextRef.current;
          const { upcomingHighImpact } = getRelevantEconomicEvents(currentCtx.asset.symbol);
          const marketSession = getCurrentMarketSession();

          const keyLevels = Array.isArray(currentCtx.marketAnalysis?.keyLevels) ? currentCtx.marketAnalysis.keyLevels : [];
          const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
          const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);

          const systemInstruction = `
Você é a ClandeX-IA em CONVERSA POR VOZ AO VIVO, mentora institucional e robô de trading de Opções Binárias e Forex para a corretora Hiove.
Mercado atual em tempo real:
- Ativo: ${currentCtx.asset.symbol} (${currentCtx.asset.name})
- Preço Atual: ${currentCtx.asset.currentPrice}
- Tendência: ${currentCtx.marketAnalysis?.trend || 'LATERAL'}
- Confluência Técnica: ${currentCtx.confluences?.totalScore ?? 0}% (${currentCtx.confluences?.direction ?? 'NEUTRO'})
- Suportes Técnicos: ${supports.join(', ') || 'dinâmicos'}
- Resistências Técnicas: ${resistances.join(', ') || 'dinâmicas'}
- Sessão: ${marketSession?.currentSession || 'Aberto'}
- Notícias: ${upcomingHighImpact ? `${upcomingHighImpact.event} às ${upcomingHighImpact.time}` : 'Sem notícias críticas próximas'}

Diretrizes de Conversação:
1. Responda em Português do Brasil com tom natural, firme, confiante e amigável.
2. Seja rápida e concisa (máximo 1 a 2 frases faladas por resposta), pois o trader está operando.
3. Não use formatações de texto ou asteriscos, fale de forma limpa.
          `;

          const liveModels = [
            'gemini-3.8-live',
            'gemini-3.1-flash-live-preview',
            'gemini-2.5-flash-native-audio-latest',
          ];
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
                    const parts = message.serverContent?.modelTurn?.parts || [];
                    for (const part of parts) {
                      if (part.inlineData?.data) {
                        setStatus('speaking');
                        scheduleAudioChunk(part.inlineData.data);
                      }
                    }
                    const aiTxt = (message.serverContent as any)?.outputTranscription?.text;
                    if (aiTxt) {
                      setAiResponseText((prev) => prev ? prev + ' ' + aiTxt : aiTxt);
                    }
                    if (message.serverContent?.interrupted) {
                      setStatus('listening');
                      stopAudioPlayback();
                    }
                  },
                  onclose: () => {
                    if (activeEngineRef.current === 'gemini_live') {
                      startBrowserSpeechFallback();
                    }
                  },
                  onerror: (err: any) => {
                    console.warn(`[Gemini Live] Erro:`, err);
                    if (err?.message?.includes('leaked') || err?.status === 403) {
                      setErrorMessage('Sua chave do Gemini precisa ser atualizada no Google AI Studio.');
                    }
                  },
                },
              });

              geminiLiveSessionRef.current = liveSession;
              directConnected = true;
              activeEngineRef.current = 'gemini_live';
              setActiveEngine('gemini_live');
              setStatus('listening');
              console.log(`[ClandeX-IA] Gemini Live conectado no modelo ${m}!`);
              break;
            } catch (liveErr) {
              console.warn(`[Gemini Live] Falha com ${m}:`, liveErr);
            }
          }

          if (directConnected && geminiLiveSessionRef.current) {
            startSpeechRecognitionListener();
            await requestMicrophoneAccess();

            // Dispara início da conversa para a IA cumprimentar o trader na hora
            try {
              const currentCtx = contextRef.current;
              geminiLiveSessionRef.current.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `Olá! Eu sou o trader. Apresente-se agora por voz como a ClandeX-IA em português do Brasil, diga que está ao vivo analisando o ativo ${currentCtx.asset.symbol} e pergunte em que pode me ajudar agora nas operações. Seja concisa.`,
                      },
                    ],
                  },
                ],
                turnComplete: true,
              });
            } catch (greetErr) {
              console.warn('[Gemini Live] Aviso saudação inicial:', greetErr);
            }
            return;
          }
        } catch (directErr: any) {
          console.warn('[ClandeX-IA] Conexão Gemini Live não pôde ser estabelecida:', directErr);
          if (directErr?.message?.includes('leaked') || directErr?.status === 403) {
            setErrorMessage('Chave Gemini bloqueada pela Google (leaked). Usando Voz Local Inteligente.');
          }
        }
      } else if (isKnownLeakedKey) {
        setErrorMessage('Aviso: Sua chave anterior foi revogada pela Google. Conectando com Voz Local Inteligente (PT-BR). Adicione uma nova chave nas Configurações.');
      }

      // 2. TENTATIVA WEBSOCKET LOCAL (APENAS SE ESTIVER NO LOCALHOST)
      if (isLocalhost) {
        try {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          let hostToUse = window.location.host;
          if (window.location.port !== '3000' && window.location.port !== '') {
            hostToUse = `${window.location.hostname}:3000`;
          }
          const wsUrl = `${protocol}//${hostToUse}/api/live`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onopen = () => {
            activeEngineRef.current = 'gemini_live';
            setActiveEngine('gemini_live');
            ws.send(JSON.stringify({ type: 'start', voiceName: 'Kore' }));
          };

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'ready') setStatus('listening');
              else if (msg.type === 'audio') {
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
            startBrowserSpeechFallback();
          };

          ws.onclose = () => {
            if (activeEngineRef.current === 'gemini_live') {
              startBrowserSpeechFallback();
            }
          };

          startSpeechRecognitionListener();
          await requestMicrophoneAccess();
          return;
        } catch {}
      }

      // 3. FALLBACK SEGURO E GARANTIDO: Voz Inteligente Nativa do Navegador (PT-BR)
      startBrowserSpeechFallback();
      await requestMicrophoneAccess();
    } catch (err: any) {
      console.warn('[ClandeX-IA Voz] Ativando modo de segurança:', err);
      startBrowserSpeechFallback();
    }
  }, [
    scheduleAudioChunk,
    stopAudioPlayback,
    requestMicrophoneAccess,
    startBrowserSpeechFallback,
    startSpeechRecognitionListener,
  ]);

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

    activeEngineRef.current = 'browser_speech';
    setStatus('idle');
    setMicLevel(0);
    setAiSpeechLevel(0);
    setErrorMessage(null);
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
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
  };
}
