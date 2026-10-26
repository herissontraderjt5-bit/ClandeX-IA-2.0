import { useState, useRef, useCallback, useEffect } from 'react';
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
  const [voiceHistory, setVoiceHistory] = useState<LiveTurnMessage[]>([]);

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
  const turnDispatchedRef = useRef<boolean>(false);
  const sessionActiveRef = useRef<boolean>(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const startSpeechRecognitionRef = useRef<() => void>(() => {});

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

  // Pré-carrega vozes do navegador para que a voz feminina esteja disponível de imediato
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      };
    }
  }, []);

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

  // Interromper fala em tempo real
  const interruptSpeech = useCallback(() => {
    stopAudioPlayback();
    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    isAiSpeakingRef.current = false;
    turnDispatchedRef.current = false;
    setStatus('listening');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'interrupted' }));
      } catch {}
    }
    try {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    } catch {}
  }, [stopAudioPlayback]);

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
          // Cooldown de 500ms após o fim do áudio para que todo o som ambiente dissipe antes de reabrir o microfone
          speechCooldownTimeoutRef.current = setTimeout(() => {
            isAiSpeakingRef.current = false;
            turnDispatchedRef.current = false;
            setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
            try {
              if (recognitionRef.current && statusRef.current === 'listening') {
                recognitionRef.current.start();
              }
            } catch {}
          }, 500);
        }
      };
    } catch (err) {
      console.error('Error playing 24kHz audio chunk:', err);
    }
  }, []);

  /**
   * Resposta local especializada em Opções Binárias e SMC (Português do Brasil)
   * Cobre saudações, conceitos técnicos, confluências, notícias e gerenciamento.
   */
  const answerQuestionLocally = useCallback((questionText: string): string => {
    const q = questionText.toLowerCase();
    const ctx = contextRef.current;
    const isClosedWeekendForex = ctx.asset.category === 'FOREX' && !isForexMarketOpen();
    const { upcomingHighImpact } = getRelevantEconomicEvents(ctx.asset.symbol);
    const realNews = getRealMarketNews(ctx.asset.symbol);

    // 1. Saudações e Conversa Natural
    if (
      q.includes('oi') ||
      q.includes('olá') ||
      q.includes('ola') ||
      q.includes('bom dia') ||
      q.includes('boa tarde') ||
      q.includes('boa noite') ||
      q.includes('tudo bem') ||
      q.includes('como vai') ||
      q.includes('e aí') ||
      q.includes('e ai')
    ) {
      return `Olá! Estou pronta com o gráfico de ${ctx.asset.symbol}. O que você quer analisar agora?`;
    }

    if (
      q.includes('obrigado') ||
      q.includes('obrigada') ||
      q.includes('valeu') ||
      q.includes('show') ||
      q.includes('top') ||
      q.includes('perfeito') ||
      q.includes('excelente') ||
      q.includes('entendi')
    ) {
      return 'Tamo junto! Mantenha sempre a disciplina e o gerenciamento de risco. Estou atenta ao gráfico para o que você precisar.';
    }

    if (
      q.includes('quem é você') ||
      q.includes('quem e voce') ||
      q.includes('o que você faz') ||
      q.includes('como funciona') ||
      q.includes('quem e clandex')
    ) {
      return 'Sou a ClandeX-IA, sua mentora institucional de trading em Opções Binárias e Forex para a corretora Hiove. Analiso Smart Money Concepts, confluências e notícias para orientar seus trades com segurança.';
    }

    // 2. Conceitos de SMC e Educação Técnica
    if (q.includes('smc') || q.includes('smart money')) {
      return 'Smart Money Concepts rastreia as movimentações dos grandes bancos institucionais, operando nas regiões de liquidez em vez de ruídos do mercado.';
    }

    if (q.includes('bos') || q.includes('quebra de estrutura')) {
      return 'BOS é a quebra de estrutura institucional: ocorre quando o candle rompe uma máxima ou mínima prévia confirmando a continuidade da tendência.';
    }

    if (q.includes('order block') || q.includes('bloco de ordem')) {
      return 'Order Block é a última vela contrária antes de uma explosão de preço institucional, servindo como uma zona de alta probabilidade para novas entradas.';
    }

    if (q.includes('fvg') || q.includes('fair value') || q.includes('desbalanceamento')) {
      return 'Fair Value Gap é uma região de desequilíbrio deixada pelo fluxo rápido dos bancos. O preço costuma retornar a essa zona para rebalancear a liquidez.';
    }

    if (q.includes('gerenciamento') || q.includes('gestão') || q.includes('gestao') || q.includes('banca') || q.includes('stop')) {
      return 'O pilar da consistência é o gerenciamento: arrisque no máximo 1 a 2 por cento da sua banca por operação e respeite rigidamente o seu stop loss diário.';
    }

    if (q.includes('martingale') || q.includes('gale') || q.includes('soros')) {
      return 'Evite Martingale agressivo para proteger sua banca. Dê preferência a entradas com mão fixa ou soros moderado em confluências acima de 75%.';
    }

    if (q.includes('qual o melhor ativo') || q.includes('qual par') || q.includes('qual moeda') || q.includes('cripto') || q.includes('bitcoin')) {
      if (isClosedWeekendForex) {
        return 'No fim de semana o Forex está fechado no mercado à vista. Recomendo operar criptomoedas como Bitcoin e Ethereum, que funcionam 24 horas por dia.';
      }
      return `Atualmente recomendo pares com fluxo direcional limpo. O par ${ctx.asset.symbol} está com pontuação de ${ctx.confluences.totalScore}% em tendência de ${ctx.marketAnalysis.trend}.`;
    }

    // 3. Avisos de Mercado Fechado (Forex no fim de semana)
    if (isClosedWeekendForex && (q.includes('entrar') || q.includes('sinal') || q.includes('compro') || q.includes('vendo') || q.includes('call') || q.includes('put'))) {
      return `Aviso do TradingView: O mercado Forex está fechado neste fim de semana para ${ctx.asset.symbol}. Para sinais e confluências ativas agora, selecione Criptomoedas como Bitcoin ou Ethereum.`;
    }

    // 4. Notícias e Calendário Econômico
    if (
      q.includes('notícia') ||
      q.includes('noticia') ||
      q.includes('calendário') ||
      q.includes('calendario') ||
      q.includes('impacto') ||
      q.includes('evento') ||
      q.includes('payroll')
    ) {
      if (realNews.length > 0) {
        return `Notícia do TradingView: ${realNews[0].title}. O sentimento macroeconômico está ativo para ${ctx.asset.symbol}.`;
      }
      if (upcomingHighImpact) {
        return `Atenção: temos ${upcomingHighImpact.event} da moeda ${upcomingHighImpact.currency} às ${upcomingHighImpact.time}. Impacto alto. Recomendo pausar operações nos minutos próximos.`;
      }
      return `Sem notícias críticas de alto impacto agendadas para os próximos minutos em ${ctx.asset.symbol}. O fluxo técnico está limpo.`;
    }

    // 5. Sinais e Recomendações de Entrada
    if (
      q.includes('entrar') ||
      q.includes('entrada') ||
      q.includes('sinal') ||
      q.includes('compro') ||
      q.includes('vendo') ||
      q.includes('comprar') ||
      q.includes('vender') ||
      q.includes('call') ||
      q.includes('put') ||
      q.includes('vale a pena')
    ) {
      if (ctx.confluences.totalScore >= 75) {
        const dir = ctx.confluences.direction === 'CALL' ? 'COMPRA' : 'VENDA';
        return `Confluência forte de ${ctx.confluences.totalScore}% para ${dir} em ${ctx.asset.symbol}. Principais gatilhos: ${ctx.confluences.reasons.slice(0, 2).join(' e ')}. Aguarde a confirmação da vela e respeite seu gerenciamento.`;
      } else if (ctx.confluences.totalScore >= 60) {
        return `Oportunidade em observação com probabilidade de ${ctx.confluences.totalScore}%. Aguarde a validação do candle antes de executar.`;
      }
      return `Sem confluência suficiente no momento, score de apenas ${ctx.confluences.totalScore}%. Mercado em ruído ou lateral. Preserve sua banca.`;
    }

    // 6. Tendência e Força
    if (q.includes('tendência') || q.includes('tendencia') || q.includes('fluxo') || q.includes('direção') || q.includes('direcao')) {
      return `No timeframe ${ctx.timeframe}, o ativo ${ctx.asset.symbol} está em tendência de ${ctx.marketAnalysis.trend}, com força compradora ${ctx.marketAnalysis.buyerStrength} e força vendedora ${ctx.marketAnalysis.sellerStrength}.`;
    }

    // 7. Suportes e Resistências
    if (
      q.includes('suporte') ||
      q.includes('resistência') ||
      q.includes('resistencia') ||
      q.includes('taxa') ||
      q.includes('preço') ||
      q.includes('preco') ||
      q.includes('nível') ||
      q.includes('nivel')
    ) {
      const keyLevels = ctx.marketAnalysis.keyLevels || [];
      const sup = keyLevels
        .filter((k) => k.type === 'SUPPORT')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      const res = keyLevels
        .filter((k) => k.type === 'RESISTANCE')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      let msg = `O preço atual de ${ctx.asset.symbol} é ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. `;
      if (sup.length > 0) msg += `Suporte em ${sup[0]}. `;
      if (res.length > 0) msg += `Resistência em ${res[0]}.`;
      return msg;
    }

    // Resposta padrão contextualizada e dinâmica
    return `Ativo ${ctx.asset.symbol} cotado a ${ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals)}. Tendência de ${ctx.marketAnalysis.trend} com confluência de ${ctx.confluences.totalScore}% para ${ctx.confluences.direction}. Pode me perguntar sobre sinais, suporte, tendência ou conselhos operacionais!`;
  }, []);

  /**
   * Síntese de fala no navegador com seleção da melhor voz em Português do Brasil
   * e sincronização em tempo real com o visualizador 3D CyberAiAvatar3D
   */
  const speakBrowserText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // Pausa reconhecimento do microfone enquanto a IA fala para evitar eco acústico
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    stopAudioPlayback();
    isAiSpeakingRef.current = true;
    setStatus('speaking');

    const clean = textToSpeak.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/#/g, '').trim();

    const utterance = new SpeechSynthesisUtterance(clean);
    activeUtteranceRef.current = utterance; // Previne garbage collection prematuro no Chrome/Edge
    utterance.lang = 'pt-BR';
    utterance.rate = 1.08; // Fala rápida, fluida e natural
    // Timbre feminino nítido, claro e agradável
    utterance.pitch = 1.18;

    // Seleção estrita de voz feminina em Português (eliminando completamente vozes masculinas como Daniel)
    const pickFemaleVoice = (): SpeechSynthesisVoice | null => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return null;

      const maleExclusions = [
        'daniel', 'antonio', 'antônio', 'felipe', 'fabio', 'fábio',
        'ricardo', 'thiago', 'tiago', 'julio', 'júlio', 'male', 'masculino',
        'man', 'david', 'jorge'
      ];

      // 1. Filtrar vozes brasileiras e portuguesas
      const ptVoices = voices.filter((v) => {
        const lang = (v.lang || '').toLowerCase();
        return lang.startsWith('pt') || lang.includes('br');
      });

      // 2. Nomes femininos prioritários no Windows, Android, Chrome, Edge, iOS
      const femaleKeywords = [
        'francisca', 'maria', 'brenda', 'thalita', 'leticia', 'letícia',
        'heloisa', 'heloísa', 'yara', 'camila', 'luciana', 'joana',
        'fernanda', 'raquel', 'vitória', 'vitoria', 'female', 'feminino',
        'mulher', 'woman'
      ];

      // 2.1 Busca por voz em PT com nome feminino explícito e sem termos masculinos
      for (const kw of femaleKeywords) {
        const found = ptVoices.find((v) => {
          const lower = v.name.toLowerCase();
          return lower.includes(kw) && !maleExclusions.some((m) => lower.includes(m));
        });
        if (found) return found;
      }

      // 2.2 Busca por voz Natural ou Google em português (sem termos masculinos)
      const naturalPt = ptVoices.find((v) => {
        const lower = v.name.toLowerCase();
        return (lower.includes('google') || lower.includes('natural') || lower.includes('online')) &&
          !maleExclusions.some((m) => lower.includes(m));
      });
      if (naturalPt) return naturalPt;

      // 2.3 Qualquer voz em português sem termos masculinos
      const nonMalePt = ptVoices.find((v) => {
        const lower = v.name.toLowerCase();
        return !maleExclusions.some((m) => lower.includes(m));
      });
      if (nonMalePt) return nonMalePt;

      // 2.4 Fallback: primeira voz em português
      return ptVoices[0] || null;
    };

    const chosenVoice = pickFemaleVoice();
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    let hasEnded = false;
    const finishPlayback = () => {
      if (hasEnded) return;
      hasEnded = true;
      activeUtteranceRef.current = null;

      if (speechAnimIntervalRef.current) {
        clearInterval(speechAnimIntervalRef.current);
        speechAnimIntervalRef.current = null;
      }
      setAiSpeechLevel(0);

      // Cooldown de 250ms após fala para dissipar o som antes de reabrir o microfone
      speechCooldownTimeoutRef.current = setTimeout(() => {
        isAiSpeakingRef.current = false;
        turnDispatchedRef.current = false;
        setStatus('listening');
        // REINICIA A ESCUTA DO USUÁRIO IMEDIATAMENTE
        if (sessionActiveRef.current) {
          try {
            startSpeechRecognitionRef.current();
          } catch {}
        }
      }, 250);
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

    // Cancelamento limpo com breve timeout para compatibilidade do Chromium
    try {
      window.speechSynthesis.cancel();
    } catch {}

    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('Erro ao reproduzir voz feminina:', err);
        finishPlayback();
      }
    }, 15);
  }, [stopAudioPlayback]);

  /**
   * Gera resposta inteligente e ultra-rápida (com roteamento instantâneo)
   */
  const generateAiReply = useCallback(
    async (promptText: string): Promise<string> => {
      const cleanPrompt = promptText.trim();
      if (!cleanPrompt) return '';

      const q = cleanPrompt.toLowerCase();
      // Perguntas de mercado frequentes: resposta local com 0ms de latência
      const isDirectQuery =
        q.includes('entrar') ||
        q.includes('sinal') ||
        q.includes('compro') ||
        q.includes('vendo') ||
        q.includes('call') ||
        q.includes('put') ||
        q.includes('vale a pena') ||
        q.includes('tendência') ||
        q.includes('tendencia') ||
        q.includes('suporte') ||
        q.includes('resistência') ||
        q.includes('resistencia') ||
        q.includes('taxa') ||
        q.includes('preço') ||
        q.includes('preco') ||
        q.includes('notícia') ||
        q.includes('noticia') ||
        q.includes('confluência') ||
        q.includes('confluencia') ||
        q.includes('oi') ||
        q.includes('olá') ||
        q.includes('ola') ||
        q.includes('bom dia') ||
        q.includes('boa tarde') ||
        q.includes('boa noite') ||
        q.includes('tudo bem') ||
        q.includes('como vai') ||
        q.includes('smc') ||
        q.includes('gerenciamento') ||
        q.includes('obrigado') ||
        q.includes('valeu');

      if (isDirectQuery) {
        return answerQuestionLocally(cleanPrompt);
      }

      // Para outras perguntas gerais: tenta Gemini com timeout estrito de 1.2s
      const geminiKey = getEffectiveGeminiKey();
      if (geminiKey && geminiKey.length > 15) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const currentCtx = contextRef.current;
          const systemInstruction = `Você é a ClandeX-IA. Responda em Português do Brasil com máxima concisão e rapidez, estritamente 1 frase curta. Sem enrolação. Ativo: ${currentCtx.asset.symbol}, confluência ${currentCtx.confluences?.totalScore}%.`;

          const fetchPromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: cleanPrompt,
            config: {
              systemInstruction,
              temperature: 0.3,
            },
          });

          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200));
          const response: any = await Promise.race([fetchPromise, timeoutPromise]);

          if (response && response.text) {
            const cleanText = response.text.replace(/[*_#`~]/g, '').trim();
            if (cleanText) return cleanText;
          }
        } catch {}
      }

      return answerQuestionLocally(cleanPrompt);
    },
    [answerQuestionLocally]
  );

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

  // Disparo atômico e único de conclusão de turno do usuário
  const dispatchTurn = useCallback(
    async (textQuery?: string) => {
      if (turnDispatchedRef.current || isAiSpeakingRef.current) return;
      turnDispatchedRef.current = true;
      hasSpokenInTurnRef.current = false;

      const q = textQuery?.trim();
      if (!q || q.length < 2) {
        turnDispatchedRef.current = false;
        return;
      }

      console.log('[ClandeX-IA Voz] Turno concluído do trader:', q);
      const userTurn: LiveTurnMessage = {
        id: `user-voice-${Date.now()}`,
        role: 'user',
        text: q,
        timestamp: Date.now(),
      };
      setUserTranscript(q);
      setLastTurnMessage(userTurn);
      setVoiceHistory((prev) => [...prev, userTurn]);

      // Se houver WebSocket ativo (modo servidor local), envia pelo canal:
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'turn_complete', text: q }));
        return;
      }

      // No Vercel ou modo cliente direto: processa a resposta imediatamente
      setStatus('speaking');
      try {
        const reply = await generateAiReply(q);
        if (reply) {
          const modelTurn: LiveTurnMessage = {
            id: `model-voice-${Date.now()}`,
            role: 'model',
            text: reply,
            timestamp: Date.now(),
          };
          setAiResponseText(reply);
          setLastTurnMessage(modelTurn);
          setVoiceHistory((prev) => [...prev, modelTurn]);
          speakBrowserText(reply);
        } else {
          setStatus('listening');
          turnDispatchedRef.current = false;
        }
      } catch (err) {
        console.warn('[ClandeX-IA Voz] Erro ao responder:', err);
        const fallbackReply = answerQuestionLocally(q);
        const modelTurn: LiveTurnMessage = {
          id: `model-voice-${Date.now()}`,
          role: 'model',
          text: fallbackReply,
          timestamp: Date.now(),
        };
        setAiResponseText(fallbackReply);
        setLastTurnMessage(modelTurn);
        setVoiceHistory((prev) => [...prev, modelTurn]);
        speakBrowserText(fallbackReply);
      }
    },
    [generateAiReply, answerQuestionLocally, speakBrowserText]
  );

  // Iniciar reconhecimento de voz contínuo do navegador (PT-BR)
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.warn('[ClandeX-IA] Web SpeechRecognition não disponível neste navegador.');
      return;
    }

    // Se a instância já existir, apenas garante que está gravando
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        // Se a IA estiver falando, ignoramos resultados do microfone para evitar eco e autointerrupção
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

        if (finalChunk.trim()) {
          accumulatedSpeechRef.current = (accumulatedSpeechRef.current + ' ' + finalChunk).trim();
        }

        const display = (accumulatedSpeechRef.current + ' ' + interim).trim();
        if (display) {
          console.log('[ClandeX-IA] Escutou do usuário:', display);
          setUserTranscript(display);
          turnDispatchedRef.current = false;
          hasSpokenInTurnRef.current = true;
          lastVoiceActiveTimeRef.current = Date.now();
        }

        if (speechSilenceTimeoutRef.current) {
          clearTimeout(speechSilenceTimeoutRef.current);
        }

        // Aguarda 280ms de silêncio após a fala para enviar a pergunta imediatamente
        speechSilenceTimeoutRef.current = setTimeout(() => {
          const fullQuestion = (accumulatedSpeechRef.current || display).trim();
          accumulatedSpeechRef.current = '';
          if (fullQuestion && fullQuestion.length > 1) {
            dispatchTurn(fullQuestion);
          }
        }, 280);
      };

      recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[ClandeX-IA SpeechRecognition] Evento:', e.error);
        }
      };

      recognition.onend = () => {
        // Reinício automático para conversação contínua sempre que a sessão estiver ativa e em listening
        if (sessionActiveRef.current && !isAiSpeakingRef.current) {
          setTimeout(() => {
            if (sessionActiveRef.current && !isAiSpeakingRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          }, 150);
        }
      };

      try {
        recognition.start();
      } catch {}
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('[ClandeX-IA] Falha ao iniciar reconhecimento de voz:', err);
    }
  }, [dispatchTurn]);

  // Mantém a ref sincronizada para finishPlayback
  startSpeechRecognitionRef.current = startSpeechRecognition;

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
        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i += 8) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / (inputData.length / 8));
        const currentLevel = Math.min(100, Math.round(rms * 280));

        // Se a IA estiver falando, silencia o medidor para evitar eco das caixas de som
        if (isAiSpeakingRef.current || statusRef.current === 'speaking') {
          setMicLevel(0);
          return;
        }

        if (isMutedRef.current) {
          setMicLevel(0);
          return;
        }

        setMicLevel(currentLevel);

        const now = Date.now();
        // VAD gate: Se o volume for acima do piso de ruído, marca voz ativa
        if (rms > 0.012) {
          lastVoiceActiveTimeRef.current = now;
          hasSpokenInTurnRef.current = true;
          turnDispatchedRef.current = false;
        }

        const isVoiceActive = now - lastVoiceActiveTimeRef.current < 1000;

        // 1. Resample nativo para 16kHz Little-Endian
        const resampled = resampleTo16k(inputData, inputCtx.sampleRate);
        const base64Pcm = pcmToBase64(resampled);

        // 2. Envio via WebSocket (se conectado ao servidor local)
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          if (isVoiceActive) {
            wsRef.current.send(JSON.stringify({ audio: base64Pcm }));
          }

          if (hasSpokenInTurnRef.current && !turnDispatchedRef.current && now - lastVoiceActiveTimeRef.current > 1100) {
            dispatchTurn();
          }
        }

        // 3. Envio direto via Gemini Live Session (se ativo)
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
  }, [dispatchTurn, interruptSpeech]);

  /**
   * Conecta à Voz em Tempo Real oficial da ClandeX-IA
   * 100% compatível com Vercel (cliente autônomo) e servidor local
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
      const geminiKey = getEffectiveGeminiKey();

      // 3. Tenta conexão WebSocket SOMENTE se estiver rodando localmente (localhost ou 127.0.0.1)
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      let wsConnected = false;

      if (isLocalhost) {
        try {
          const wsPort = window.location.port === '3000' || window.location.port === '' ? '3000' : '3000';
          const wsUrl = `ws://${window.location.hostname}:${wsPort}/api/live`;
          const ws = new WebSocket(wsUrl);

          const connectPromise = new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 500);
            ws.onopen = () => {
              clearTimeout(timeout);
              resolve(true);
            };
            ws.onerror = () => {
              clearTimeout(timeout);
              resolve(false);
            };
          });

          wsConnected = await connectPromise;
          if (wsConnected) {
            wsRef.current = ws;
            setActiveEngine('gemini_live');
            activeEngineRef.current = 'gemini_live';

            const { upcomingHighImpact } = getRelevantEconomicEvents(currentCtx.asset.symbol);
            const marketSession = getCurrentMarketSession();
            const keyLevels = Array.isArray(currentCtx.marketAnalysis?.keyLevels) ? currentCtx.marketAnalysis.keyLevels : [];
            const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
            const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);

            ws.send(
              JSON.stringify({
                type: 'start',
                voiceName: 'Aoede',
                marketContext: {
                  asset: currentCtx.asset.symbol,
                  assetName: currentCtx.asset.name,
                  currentPrice: currentCtx.asset.currentPrice,
                  timeframe: currentCtx.timeframe,
                  marketAnalysis: currentCtx.marketAnalysis,
                  confluences: currentCtx.confluences,
                  upcomingHighImpact,
                  marketSession,
                },
              })
            );

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'ready') {
                  setStatus('listening');
                  turnDispatchedRef.current = false;
                  startSpeechRecognition();
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
                  turnDispatchedRef.current = false;
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
                }
              } catch {}
            };

            return;
          } else {
            ws.close();
            wsRef.current = null;
          }
        } catch {}
      }

      // 4. Modo Vercel / Direto no Navegador (Silencioso na ativação, aguardando o usuário falar)
      sessionActiveRef.current = true;
      setStatus('listening');
      setActiveEngine(geminiKey && geminiKey.length > 15 ? 'gemini_live' : 'browser_speech');
      activeEngineRef.current = geminiKey && geminiKey.length > 15 ? 'gemini_live' : 'browser_speech';

      // Inicializa a escuta imediatamente - sem falar nada, aguardando o usuário falar
      startSpeechRecognition();
    } catch (err: any) {
      console.warn('[ClandeX-IA Voz] Inicializando com fallback direto:', err);
      sessionActiveRef.current = true;
      setStatus('listening');
      startSpeechRecognition();
    }
  }, [requestMicrophoneAccess, scheduleAudioChunk, stopAudioPlayback, speakBrowserText, startSpeechRecognition]);

  // Disconnect session and release media streams
  const disconnectSession = useCallback(() => {
    sessionActiveRef.current = false;
    activeUtteranceRef.current = null;
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
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      } catch {}
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

  // Enviar pergunta falada ou chip de voz diretamente para a IA responder por voz
  const sendTextMessage = useCallback(
    async (textToSend: string) => {
      const clean = textToSend.trim();
      if (!clean) return;

      const userTurn: LiveTurnMessage = {
        id: `user-voice-${Date.now()}`,
        role: 'user',
        text: clean,
        timestamp: Date.now(),
      };
      setUserTranscript(clean);
      setLastTurnMessage(userTurn);
      setVoiceHistory((prev) => [...prev, userTurn]);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'client_content', text: clean }));
        return;
      }

      setStatus('speaking');
      try {
        const reply = await generateAiReply(clean);
        const modelTurn: LiveTurnMessage = {
          id: `model-voice-${Date.now()}`,
          role: 'model',
          text: reply,
          timestamp: Date.now(),
        };
        setAiResponseText(reply);
        setLastTurnMessage(modelTurn);
        setVoiceHistory((prev) => [...prev, modelTurn]);
        speakBrowserText(reply);
      } catch {
        const localReply = answerQuestionLocally(clean);
        const modelTurn: LiveTurnMessage = {
          id: `model-voice-${Date.now()}`,
          role: 'model',
          text: localReply,
          timestamp: Date.now(),
        };
        setAiResponseText(localReply);
        setLastTurnMessage(modelTurn);
        setVoiceHistory((prev) => [...prev, modelTurn]);
        speakBrowserText(localReply);
      }
    },
    [generateAiReply, answerQuestionLocally, speakBrowserText]
  );

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
    voiceHistory,
    sendTextMessage,
    interruptSpeech,
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
    clearVoiceHistory: () => setVoiceHistory([]),
  };
}
