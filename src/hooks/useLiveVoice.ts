import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
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

  // Se a chave no localStorage for a antiga vazada revogada, remove para evitar 403
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
  const [activeEngine, setActiveEngine] = useState<VoiceEngine>('browser_speech');
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [lastTurnMessage, setLastTurnMessage] = useState<LiveTurnMessage | null>(null);

  const statusRef = useRef<LiveVoiceStatus>('idle');
  statusRef.current = status;

  // Supressão de eco acústico e controle estrito de turnos
  const isAiSpeakingRef = useRef<boolean>(false);
  const speechCooldownTimeoutRef = useRef<any>(null);
  const silenceTimerRef = useRef<any>(null);
  const accumulatedTranscriptRef = useRef<string>('');
  const lastAiSpokenPhraseRef = useRef<string>('');
  const lastProcessedQuestionRef = useRef<string>('');
  const lastProcessedTimeRef = useRef<number>(0);

  // Audio Refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Recognition & TTS Refs
  const recognitionRef = useRef<any>(null);
  const speechAnimIntervalRef = useRef<any>(null);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

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
   * Encerra a escuta do microfone de forma limpa sem deixar instâncias presas
   */
  const stopListeningCleanly = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
  }, []);

  // Forward declarations via ref
  const handleUserSpokenInputRef = useRef<any>(null);

  /**
   * Inicia o receptor de fala com uma NOVA instância limpa a cada ciclo
   */
  const startListeningCleanly = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[ClandeX-IA] SpeechRecognition não suportado neste navegador.');
      return;
    }

    // Limpa qualquer sessão anterior
    stopListeningCleanly();

    // Se estiver mutado pelo usuário ou a IA estiver falando, não abre o microfone
    if (isMutedRef.current || isAiSpeakingRef.current) {
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        if (isAiSpeakingRef.current || isMutedRef.current) return;

        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalChunk += text + ' ';
          } else {
            interim += text;
          }
        }

        if (finalChunk.trim()) {
          accumulatedTranscriptRef.current += (accumulatedTranscriptRef.current ? ' ' : '') + finalChunk.trim();
        }

        const currentLive = (accumulatedTranscriptRef.current + ' ' + interim).trim();
        if (!currentLive) return;

        // Anti-echo acústico: se o microfone captar a própria fala da IA do alto-falante
        if (lastAiSpokenPhraseRef.current) {
          const normAi = lastAiSpokenPhraseRef.current.toLowerCase().replace(/[^a-z0-9]/g, '');
          const normUser = currentLive.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normAi.length > 5 && normUser.length > 5 && (normAi.includes(normUser) || normUser.includes(normAi))) {
            return;
          }
        }

        setUserTranscript(currentLive);

        // Reinicia debounce de silêncio: 900ms para aguardar término da fala do trader
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        silenceTimerRef.current = setTimeout(() => {
          const fullSentence = (accumulatedTranscriptRef.current + ' ' + interim).trim();
          accumulatedTranscriptRef.current = '';
          silenceTimerRef.current = null;

          if (fullSentence.length >= 2 && !isAiSpeakingRef.current && statusRef.current === 'listening') {
            console.log('[ClandeX-IA Voz] Pergunta do usuário identificada:', fullSentence);
            stopListeningCleanly();
            if (handleUserSpokenInputRef.current) {
              handleUserSpokenInputRef.current(fullSentence);
            }
          }
        }, 900);
      };

      recognition.onerror = (err: any) => {
        if (err.error !== 'no-speech' && err.error !== 'aborted') {
          console.warn('[ClandeX-IA Voz] Reconhecimento evento:', err.error);
        }
      };

      recognition.onend = () => {
        // Se ainda estiver no modo de escuta e a IA não estiver falando, reinicia uma nova sessão
        if (statusRef.current === 'listening' && !isAiSpeakingRef.current && !isMutedRef.current) {
          setTimeout(() => {
            if (statusRef.current === 'listening' && !isAiSpeakingRef.current && !isMutedRef.current) {
              startListeningCleanly();
            }
          }, 150);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setStatus('listening');
      console.log('[ClandeX-IA Voz] Microfone ativo e escutando continuamente...');
    } catch (e) {
      console.warn('[ClandeX-IA] Falha ao instanciar SpeechRecognition:', e);
    }
  }, [stopListeningCleanly]);

  /**
   * Fala a resposta em português do Brasil e anima o avatar com supressão total de eco
   */
  const speakBrowserText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // Fecha a escuta imediatamente para nunca captar o som do alto-falante
    stopListeningCleanly();
    isAiSpeakingRef.current = true;
    setStatus('speaking');

    const clean = textToSpeak.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
    lastAiSpokenPhraseRef.current = clean;

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

      // Cooldown de 600ms após o som cessar para dissipar ecos do ambiente antes de reabrir o microfone
      if (speechCooldownTimeoutRef.current) {
        clearTimeout(speechCooldownTimeoutRef.current);
      }
      speechCooldownTimeoutRef.current = setTimeout(() => {
        isAiSpeakingRef.current = false;
        if (statusRef.current !== 'idle') {
          setStatus('listening');
          startListeningCleanly();
        }
      }, 600);
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

    // Proteção contra travamento nativo do SpeechSynthesis no Chromium:
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
  }, [stopListeningCleanly, startListeningCleanly]);

  /**
   * Processa a pergunta do microfone do trader de forma natural
   */
  const handleUserSpokenInput = useCallback(async (transcript: string) => {
    const clean = transcript.trim();
    if (!clean || clean.length < 2) return;

    if (isAiSpeakingRef.current) {
      return;
    }

    const now = Date.now();
    if (
      clean.toLowerCase() === lastProcessedQuestionRef.current.toLowerCase() &&
      now - lastProcessedTimeRef.current < 3000
    ) {
      return;
    }
    lastProcessedQuestionRef.current = clean;
    lastProcessedTimeRef.current = now;

    console.log('[ClandeX-IA Voz] Pergunta do usuário:', clean);
    setUserTranscript(clean);

    setLastTurnMessage({
      id: `user-voice-${now}`,
      role: 'user',
      text: clean,
      timestamp: now,
    });

    setStatus('connecting');

    const ctx = contextRef.current;
    const { upcomingHighImpact } = getRelevantEconomicEvents(ctx.asset.symbol);
    const keyLevels = Array.isArray(ctx.marketAnalysis?.keyLevels) ? ctx.marketAnalysis.keyLevels : [];
    const supList = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price.toFixed(ctx.asset.pipDecimals));
    const resList = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price.toFixed(ctx.asset.pipDecimals));
    const isClosedWeekendForex = ctx.asset.category === 'FOREX' && !isForexMarketOpen();
    const realNews = getRealMarketNews(ctx.asset.symbol);

    const marketPrompt = `
Você é a ClandeX-IA em CONVERSA POR VOZ AO VIVO com o trader de Opções Binárias e Forex na corretora Hiove, com análise direta baseada no TradingView.
Mercado atual em tempo real (TradingView):
- Paridade: ${ctx.asset.symbol} | Símbolo TradingView: ${ctx.asset.tvSymbol}
- Status do Mercado: ${isClosedWeekendForex ? 'Mercado Forex Fechado no fim de semana no TradingView (reabertura domingo 18h BRT). Se perguntarem sobre operar agora, recomende criptomoedas 24/7 (BTC, ETH).' : 'Mercado Aberto ao vivo no TradingView.'}
- Preço Atual: ${ctx.asset.currentPrice} | Timeframe: ${ctx.timeframe}
- Tendência: ${ctx.marketAnalysis.trend} (Força Compra: ${ctx.marketAnalysis.buyerStrength}, Venda: ${ctx.marketAnalysis.sellerStrength})
- Confluência Técnica: ${ctx.confluences.totalScore}% para ${ctx.confluences.direction}
- Suportes Técnicos: ${supList.slice(0, 2).join(', ') || 'dinâmicos'}
- Resistências Técnicos: ${resList.slice(0, 2).join(', ') || 'dinâmicos'}
- Notícia Real Mais Recente: ${realNews[0] ? `"${realNews[0].title}" (${realNews[0].source})` : 'Sem eventos de alto risco'}
- Calendário: ${upcomingHighImpact ? `${upcomingHighImpact.event} às ${upcomingHighImpact.time}` : 'Sem notícias críticas imediatas'}

Pergunta do trader por voz: "${clean}"

Diretrizes obrigatórias:
1. Responda em Português do Brasil com tom natural, firme e amigável.
2. Responda diretamente à pergunta em no máximo 1 a 2 frases faladas.
3. Não use formatação markdown, nunca use asteriscos (**), fale como uma pessoa de verdade falando ao microfone.
4. Se o par Forex estiver fechado no fim de semana, avise o trader e recomende Criptomoedas 24/7.
5. Responda exatamente o que o trader perguntou. Ao terminar, pare de falar e aguarde em silêncio.
    `;

    // 1. Tenta Gemini REST com os modelos mais rápidos e compatíveis
    const geminiKey = getEffectiveGeminiKey();
    if (geminiKey && geminiKey.length > 15) {
      const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-3.7-flash'];
      for (const m of modelsToTry) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const resp = await ai.models.generateContent({
            model: m,
            contents: marketPrompt,
          });

          if (resp && resp.text) {
            const cleanAnswer = resp.text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
            setAiResponseText(cleanAnswer);
            setLastTurnMessage({
              id: `model-voice-${Date.now()}`,
              role: 'model',
              text: cleanAnswer,
              timestamp: Date.now(),
            });
            speakBrowserText(cleanAnswer);
            return;
          }
        } catch (e: any) {
          console.warn(`[ClandeX-IA] Modelo ${m} falhou:`, e?.message || e);
        }
      }
    }

    // 2. Fallback imediato e garantido: Motor institucional local ClandeX-IA
    const localAnswer = answerQuestionLocally(clean);
    setAiResponseText(localAnswer);
    setLastTurnMessage({
      id: `model-voice-${Date.now()}`,
      role: 'model',
      text: localAnswer,
      timestamp: Date.now(),
    });
    speakBrowserText(localAnswer);
  }, [answerQuestionLocally, speakBrowserText]);

  handleUserSpokenInputRef.current = handleUserSpokenInput;

  // Request Microphone Permissions & Audio Processing para Visualização do Nível do Microfone
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
        if (isMutedRef.current || isAiSpeakingRef.current || statusRef.current === 'speaking' || statusRef.current === 'connecting') {
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

  // Connect to Live Voice: Inicia conversa com saudação e escuta ativa
  const startLiveConversation = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');
      setActiveEngine('browser_speech');

      // 1. Inicia AudioContext para saídas sonoras
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      } else if (outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }

      // 2. Solicita acesso ao microfone (para medição visual e permissões)
      await requestMicrophoneAccess();

      // 3. Dispara saudação inicial falada com microfone pausado
      const assetSym = contextRef.current.asset.symbol;
      const greeting = `ClandeX-IA conectada por voz. Monitorando ${assetSym}. Pode falar comigo!`;
      setLastTurnMessage({
        id: `model-voice-${Date.now()}`,
        role: 'model',
        text: greeting,
        timestamp: Date.now(),
      });

      // Fala saudação. Quando terminar (+ 600ms cooldown), startListeningCleanly() abre o microfone automaticamente!
      speakBrowserText(greeting);
    } catch (err: any) {
      console.warn('[ClandeX-IA Voz] Ativando modo de escuta direta:', err);
      setStatus('listening');
      startListeningCleanly();
    }
  }, [requestMicrophoneAccess, speakBrowserText, startListeningCleanly]);

  // Disconnect session and release media streams
  const disconnectSession = useCallback(() => {
    stopListeningCleanly();

    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    isAiSpeakingRef.current = false;
    lastProcessedQuestionRef.current = '';
    accumulatedTranscriptRef.current = '';

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
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
  }, [stopListeningCleanly]);

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        stopListeningCleanly();
      } else {
        if (!isAiSpeakingRef.current && statusRef.current === 'listening') {
          startListeningCleanly();
        }
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
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
  };
}
