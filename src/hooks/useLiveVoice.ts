import { useState, useRef, useCallback, useEffect } from 'react';
import { Asset, TimeFrame, MarketAnalysis, ConfluenceBreakdown } from '../types/trading';
import { getRelevantEconomicEvents, getCurrentMarketSession, getRealMarketNews } from '../services/economicCalendar';
import { isForexMarketOpen } from '../services/marketData';
import { tradingContextAdapter } from '../services/voice/TradingContextAdapter';
import { signalEventBridge } from '../services/voice/SignalEventBridge';
import { signalEngine } from '../services/signalEngine';
import { normalizeTradingPronunciation } from '../services/voice/pronunciationNormalizer';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';
export type AssistantUiState = 'DESCONECTADO' | 'CONECTANDO' | 'OUVINDO' | 'PROCESSANDO' | 'FALANDO' | 'ERRO';
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
  if (!envKey) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        envKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
      }
    } catch {}
  }

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

// Filtro de Fala Humana: Rejeita ruídos breves, murmúrios, estalos e sons não-verbais
const NOISE_NON_SPEECH = new Set([
  '', 'a', 'e', 'é', 'o', 'u', 'i', 'ah', 'eh', 'oh', 'uh', 'um', 'hm', 'humm', 'hmm',
  'shh', 'psst', 'ã', 'ãn', 'éé', 'ok'
]);

export function isLegitimateHumanSpeech(text: string): boolean {
  if (!text) return false;
  const clean = text.trim().toLowerCase();
  if (clean.length < 3) return false;
  if (NOISE_NON_SPEECH.has(clean)) return false;
  // Rejeita repetições monótonas de vogal/consoante isoladas (ex: "aaaa", "eeee", "hmmmm")
  if (/^(.)\1+$/.test(clean)) return false;
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1 && words[0].length < 3) return false;
  return true;
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
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [lastTurnMessage, setLastTurnMessage] = useState<LiveTurnMessage | null>(null);
  const [voiceHistory, setVoiceHistory] = useState<LiveTurnMessage[]>([]);
  const voiceHistoryRef = useRef<LiveTurnMessage[]>([]);
  voiceHistoryRef.current = voiceHistory;

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('candlex_voice_volume');
      if (saved !== null) return Number(saved);
    }
    return 100;
  });
  const volumeRef = useRef<number>(volume);
  volumeRef.current = volume;

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    if (typeof window !== 'undefined') {
      localStorage.setItem('candlex_voice_volume', String(clamped));
    }
  }, []);

  const [voiceAnnouncements, setVoiceAnnouncementsState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('candlex_voice_announcements');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const voiceAnnouncementsRef = useRef<boolean>(voiceAnnouncements);
  voiceAnnouncementsRef.current = voiceAnnouncements;

  const setVoiceAnnouncements = useCallback((enabled: boolean) => {
    setVoiceAnnouncementsState(enabled);
    voiceAnnouncementsRef.current = enabled;
    signalEventBridge.setEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('candlex_voice_announcements', String(enabled));
    }
  }, []);

  const statusRef = useRef<LiveVoiceStatus>('idle');
  statusRef.current = status;

  // Supressão de eco acústico e controle estrito de turnos
  const isAiSpeakingRef = useRef<boolean>(false);
  const speechCooldownTimeoutRef = useRef<any>(null);
  const resumeHeartbeatIntervalRef = useRef<any>(null);
  const watchdogTimeoutRef = useRef<any>(null);
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
  const lastMicUpdateRef = useRef<number>(0);

  // Keep latest context in ref so live conversation has up-to-date market data
  const contextRef = useRef({ asset, timeframe, marketAnalysis, confluences });
  contextRef.current = { asset, timeframe, marketAnalysis, confluences };

  // Sincroniza o contrato de trading context em tempo real (ETAPA 4 & 5)
  useEffect(() => {
    tradingContextAdapter.setTimeframe(timeframe);
    tradingContextAdapter.setAnalysis(marketAnalysis, confluences);
  }, [timeframe, marketAnalysis, confluences]);

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
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
    if (resumeHeartbeatIntervalRef.current) {
      clearInterval(resumeHeartbeatIntervalRef.current);
      resumeHeartbeatIntervalRef.current = null;
    }
    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    if (typeof window !== 'undefined') {
      (window as any).__candlex_active_utterance = null;
      try {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      } catch {}
    }
    activeUtteranceRef.current = null;
    setAiSpeechLevel(0);
    isAiSpeakingRef.current = false;
    turnDispatchedRef.current = false;
    accumulatedSpeechRef.current = '';
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
   * Resposta local inteligente e especializada em Opções Binárias e SMC (Português do Brasil)
   * Compreende intenções naturais: audição/presença, opiniões de mercado, entradas,
   * direção de candles, notícias, conselhos de risco e síntese dinâmica de perguntas.
   */
  const answerQuestionLocally = useCallback((questionText: string): string => {
    const cleanPrompt = (questionText || '').trim();
    const q = cleanPrompt.toLowerCase();
    const ctx = contextRef.current;
    const isClosedWeekendForex = ctx.asset.category === 'FOREX' && !isForexMarketOpen();
    const { upcomingHighImpact } = getRelevantEconomicEvents(ctx.asset.symbol);
    const realNews = getRealMarketNews(ctx.asset.symbol);
    const dir = ctx.confluences.direction === 'CALL' ? 'COMPRA' : ctx.confluences.direction === 'PUT' ? 'VENDA' : 'NEUTRO';
    const score = ctx.confluences.totalScore;
    const trend = ctx.marketAnalysis.trend;

    // 1. Reclamação de repetição ou pergunta sobre não responder o que foi perguntado
    if (
      q.includes('só fala uma coisa') ||
      q.includes('so fala uma coisa') ||
      q.includes('não me responde') ||
      q.includes('nao me responde') ||
      q.includes('não responde o que') ||
      q.includes('nao responde o que') ||
      q.includes('só repete') ||
      q.includes('so repete') ||
      q.includes('mesma coisa') ||
      q.includes('para de repetir') ||
      q.includes('não perguntei isso') ||
      q.includes('nao perguntei isso') ||
      q.includes('não foi isso') ||
      q.includes('nao foi isso')
    ) {
      return `Peço desculpas pela repetição anterior! O sistema de voz foi totalmente atualizado. Agora estou conectada e pronta para responder diretamente qualquer dúvida sua sobre o gráfico de ${ctx.asset.symbol}, tendência, suportes ou conselhos operacionais. Pode me perguntar!`;
    }

    // 2. Presença, microfone e audição ("tá me ouvindo?")
    if (
      q.includes('tá me ouvindo') ||
      q.includes('ta me ouvindo') ||
      q.includes('está me ouvindo') ||
      q.includes('esta me ouvindo') ||
      q.includes('consegue me ouvir') ||
      q.includes('tá aí') ||
      q.includes('ta ai') ||
      q.includes('fala comigo') ||
      q.includes('alô') ||
      q.includes('alo') ||
      q.includes('me ouve') ||
      q.includes('ouviu')
    ) {
      const hearingOptions = [
        `Tô te ouvindo perfeitamente e em alto e bom som! Pode falar.`,
        `Sim, na escuta total! Qual a sua dúvida sobre o gráfico de ${ctx.asset.symbol}?`,
        `Ouvindo cristalino! Manda ver, o que você quer ver agora?`
      ];
      return hearingOptions[Math.floor(Math.random() * hearingOptions.length)];
    }

    // 3. Saudações, bem-estar e conversa casual (100% natural e variada)
    if (
      q.includes('como você está') ||
      q.includes('como voce esta') ||
      q.includes('tudo bem') ||
      q.includes('como vai') ||
      q.includes('beleza') ||
      q.includes('tranquilo') ||
      q.includes('bom dia') ||
      q.includes('boa tarde') ||
      q.includes('boa noite') ||
      q.includes('oi') ||
      q.includes('olá') ||
      q.includes('ola') ||
      q.includes('e aí') ||
      q.includes('e ai')
    ) {
      const greetingOptions = [
        `Oi! Tudo ótimo por aqui. E com você, pronto pra gente operar hoje?`,
        `Tudo na paz! Tô com o olho colado no gráfico de ${ctx.asset.symbol}. Como tão as operações por aí?`,
        `Tudo bem demais! Gráfico de ${ctx.asset.symbol} tá bem ativo. O que você quer analisar agora?`,
        `Opa, tudo certo! Prontíssima pra acompanhar suas entradas. Como você tá?`
      ];
      return greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
    }

    // 4. Agradecimentos e confirmações
    if (
      q.includes('obrigado') ||
      q.includes('obrigada') ||
      q.includes('valeu') ||
      q.includes('show') ||
      q.includes('top') ||
      q.includes('perfeito') ||
      q.includes('excelente') ||
      q.includes('entendi') ||
      q.includes('tchau') ||
      q.includes('até mais')
    ) {
      return 'Tamo junto! Mantenha sempre a disciplina e o gerenciamento de risco. Estou atenta ao gráfico para o que você precisar.';
    }

    // 5. Identidade da IA (ETAPA 7)
    if (
      q.includes('quem é você') ||
      q.includes('quem e voce') ||
      q.includes('o que você faz') ||
      q.includes('como funciona') ||
      q.includes('quem e candlex') ||
      q.includes('quem e clandex')
    ) {
      return 'Sou a CandleX, sua assistente inteligente e mentora de trading em Opções Binárias e Forex para o aplicativo CandleX-IA. Analiso Price Action, fluxo de candles e confluências para orientar suas entradas com segurança.';
    }

    // 6. Opinião geral e visão do mercado ("o que você acha?", "como tá o mercado?")
    if (
      q.includes('o que você acha') ||
      q.includes('o que voce acha') ||
      q.includes('como tá o mercado') ||
      q.includes('como ta o mercado') ||
      q.includes('como está o mercado') ||
      q.includes('como esta o mercado') ||
      q.includes('como tá o gráfico') ||
      q.includes('como ta o grafico') ||
      q.includes('qual sua visão') ||
      q.includes('qual sua visao') ||
      q.includes('qual sua opinião') ||
      q.includes('qual sua opiniao') ||
      q.includes('como estão as coisas')
    ) {
      return `O par ${ctx.asset.symbol} está em tendência de ${trend} no timeframe ${ctx.timeframe}. A força compradora está em ${ctx.marketAnalysis.buyerStrength} e vendedora em ${ctx.marketAnalysis.sellerStrength}, com confluência geral em ${score}%.`;
    }

    // 7. Direção de Candles e Previsão ("vai subir ou descer?")
    if (
      q.includes('vai subir') ||
      q.includes('vai descer') ||
      q.includes('vai cair') ||
      q.includes('sobe ou desce') ||
      q.includes('alta ou baixa')
    ) {
      const pred = trend === 'ALTA' ? 'continuidade de alta' : trend === 'BAIXA' ? 'continuidade de baixa' : 'movimento lateral';
      return `Pelo fluxo institucional dos candles, a maior probabilidade técnica aponta para ${pred}, com ${score}% de confluência para ${dir}.`;
    }

    // 8. Dicas e Estratégia ("o que fazer?", "me dá uma dica")
    if (
      q.includes('me dá uma dica') ||
      q.includes('me da uma dica') ||
      q.includes('o que fazer') ||
      q.includes('ajuda') ||
      q.includes('qual o conselho') ||
      q.includes('dica')
    ) {
      return `Minha principal dica agora: opere a favor da tendência de ${trend} e nunca arrisque mais de 2 por cento da sua banca em uma única entrada.`;
    }

    // 9. Timeframe e Velas
    if (
      q.includes('tempo gráfico') ||
      q.includes('tempo grafico') ||
      q.includes('timeframe') ||
      q.includes('qual vela') ||
      q.includes('m1') ||
      q.includes('m5')
    ) {
      return `Estamos analisando o timeframe ${ctx.timeframe} do par ${ctx.asset.symbol}. Para opções binárias, aguarde a expiração coincidir exatamente com o fim da vela.`;
    }

    // 10. Avisos de Mercado Fechado (Forex no fim de semana)
    if (isClosedWeekendForex && (q.includes('entrar') || q.includes('sinal') || q.includes('compro') || q.includes('vendo') || q.includes('call') || q.includes('put') || q.includes('operar'))) {
      return `Aviso do TradingView: O mercado Forex à vista está fechado neste fim de semana para ${ctx.asset.symbol}. Para operar com sinais ao vivo agora, selecione uma Criptomoeda como Bitcoin ou Ethereum.`;
    }

    // 11. Sinais e Recomendações de Entrada
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
      q.includes('vale a pena') ||
      q.includes('devo entrar') ||
      q.includes('posso entrar') ||
      q.includes('entro') ||
      q.includes('entro agora')
    ) {
      if (score >= 75) {
        return `Confluência forte de ${score}% para ${dir} em ${ctx.asset.symbol}. Principais gatilhos: ${ctx.confluences.reasons.slice(0, 2).join(' e ')}. Aguarde a confirmação da vela e respeite seu gerenciamento.`;
      } else if (score >= 60) {
        return `Oportunidade moderada com probabilidade de ${score}% para ${dir}. Aguarde a validação do candle antes de executar.`;
      }
      return `Sem confluência suficiente no momento, score de apenas ${score}%. Mercado em ruído ou lateral. Preserve sua banca.`;
    }

    // 12. Notícias e Calendário Econômico
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

    // 13. Tendência e Força
    if (q.includes('tendência') || q.includes('tendencia') || q.includes('fluxo') || q.includes('direção') || q.includes('direcao')) {
      return `No timeframe ${ctx.timeframe}, o ativo ${ctx.asset.symbol} está em tendência de ${trend}, com força compradora ${ctx.marketAnalysis.buyerStrength} e força vendedora ${ctx.marketAnalysis.sellerStrength}.`;
    }

    // 14. Cotação Oficial e Análise Direta do TradingView
    const asksQuoteOrTradingView =
      q.includes('tradingview') ||
      q.includes('trading view') ||
      q.includes('cotação') ||
      q.includes('cotacao') ||
      q.includes('quanto tá') ||
      q.includes('quanto ta') ||
      q.includes('qual o valor') ||
      q.includes('qual o preco') ||
      q.includes('qual o preço') ||
      q.includes('preço atual') ||
      q.includes('preco atual') ||
      q.includes('cotação errada') ||
      q.includes('cotacao errada') ||
      q.includes('cotação certa') ||
      q.includes('cotacao certa');

    if (asksQuoteOrTradingView) {
      const currentPriceStr = ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals);
      const tvRec = ctx.marketAnalysis.tradingView?.recommendation || (score >= 70 ? 'COMPRA' : score <= 30 ? 'VENDA' : 'NEUTRO');
      const tvRsi = ctx.marketAnalysis.tradingView?.rsi !== undefined ? ctx.marketAnalysis.tradingView.rsi.toFixed(1) : '50.0';
      return `A cotação oficial do TradingView para ${ctx.asset.name} é ${currentPriceStr}. O scanner em tempo real indica recomendação de ${tvRec} com RSI em ${tvRsi}.`;
    }

    // 15. Suportes e Resistências
    const asksResistance = q.includes('resistência') || q.includes('resistencia');
    const asksSupport = q.includes('suporte');
    const asksGeneralLevels =
      q.includes('taxa') ||
      q.includes('preço') ||
      q.includes('preco') ||
      q.includes('nível') ||
      q.includes('nivel') ||
      q.includes('piso') ||
      q.includes('teto');

    if (asksResistance || asksSupport || asksGeneralLevels) {
      const keyLevels = ctx.marketAnalysis.keyLevels || [];
      const sup = keyLevels
        .filter((k) => k.type === 'SUPPORT')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));
      const res = keyLevels
        .filter((k) => k.type === 'RESISTANCE')
        .map((k) => k.price.toFixed(ctx.asset.pipDecimals));

      const currentPriceStr = ctx.asset.currentPrice.toFixed(ctx.asset.pipDecimals);
      const resImmediate = res[0] || (ctx.asset.currentPrice * 1.002).toFixed(ctx.asset.pipDecimals);
      const supImmediate = sup[0] || (ctx.asset.currentPrice * 0.998).toFixed(ctx.asset.pipDecimals);

      // Se o usuário perguntou ESPECIFICAMENTE sobre resistência
      if (asksResistance && !asksSupport) {
        return `A resistência mais próxima de ${ctx.asset.symbol} está na taxa ${resImmediate}. O preço atual é ${currentPriceStr} e o suporte está em ${supImmediate}.`;
      }

      // Se o usuário perguntou ESPECIFICAMENTE sobre suporte
      if (asksSupport && !asksResistance) {
        return `O suporte mais próximo de ${ctx.asset.symbol} está na taxa ${supImmediate}. O preço atual é ${currentPriceStr} e a resistência está em ${resImmediate}.`;
      }

      // Se perguntou sobre ambos ou sobre taxas em geral
      return `No ${ctx.asset.symbol}, o preço atual é ${currentPriceStr}. Temos resistência imediata em ${resImmediate} e suporte imediato em ${supImmediate}.`;
    }

    // 15. Conceitos de SMC e Educação Técnica
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
      return `Atualmente recomendo pares com fluxo direcional limpo. O par ${ctx.asset.symbol} está com pontuação de ${score}% em tendência de ${trend}.`;
    }

    // 16. Fallback Inteligente e Dinâmico — Personalizado para o que o usuário falou (NUNCA repetitivo)
    const cleanSubject = cleanPrompt.replace(/[?!.]/g, '').trim();
    if (cleanSubject.length > 2) {
      return `Sobre "${cleanSubject}": no ${ctx.asset.symbol}, a tendência é de ${trend} com score de ${score}%. Me pergunte se vale a pena entrar agora, as taxas de suporte e resistência ou a previsão do próximo candle!`;
    }
    return `Estou atenta ao par ${ctx.asset.name}. A tendência atual é de ${trend} com confluência de ${score}%. Pode me perguntar sobre sinais, suporte e resistência ou conselhos operacionais!`;
  }, []);

  /**
   * Síntese de fala no navegador com seleção da melhor voz em Português do Brasil
   * e sincronização em tempo real com o visualizador 3D CyberAiAvatar3D
   */
  const speakBrowserText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    let clean = normalizeTradingPronunciation(textToSpeak);
    if (!clean) return;

    // Garante respostas estritamente concisas (no máximo 2 frases para fala limpa sem engasgos)
    const sentences = clean.split(/(?<=[.?!])\s+/);
    clean = sentences.slice(0, 2).join(' ');

    // Registra a fala da IA para o filtro anti-eco acústico
    currentAiTurnTextRef.current = clean;

    // Cancela imediatamente qualquer transcrição em andamento no microfone
    accumulatedSpeechRef.current = '';
    if (speechSilenceTimeoutRef.current) {
      clearTimeout(speechSilenceTimeoutRef.current);
      speechSilenceTimeoutRef.current = null;
    }

    // Pausa e aborta reconhecimento do microfone enquanto a IA fala para evitar eco acústico
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    // Limpa timers anteriores
    if (speechCooldownTimeoutRef.current) {
      clearTimeout(speechCooldownTimeoutRef.current);
      speechCooldownTimeoutRef.current = null;
    }
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
    if (resumeHeartbeatIntervalRef.current) {
      clearInterval(resumeHeartbeatIntervalRef.current);
      resumeHeartbeatIntervalRef.current = null;
    }
    if (speechAnimIntervalRef.current) {
      clearInterval(speechAnimIntervalRef.current);
      speechAnimIntervalRef.current = null;
    }

    // Cancela com segurança qualquer reprodução anterior
    try {
      window.speechSynthesis.cancel();
    } catch {}

    isAiSpeakingRef.current = true;
    setStatus('speaking');

    const utterance = new SpeechSynthesisUtterance(clean);
    // CRÍTICO: Previne garbage collection prematuro do V8 no Chrome/Edge que corta a fala no meio
    activeUtteranceRef.current = utterance;
    (window as any).__candlex_active_utterance = utterance;

    utterance.lang = 'pt-BR';
    utterance.rate = 1.05; // Fala fluida e natural
    utterance.pitch = 1.1;  // Timbre feminino nítido e agradável
    utterance.volume = Math.max(0, Math.min(1, volumeRef.current / 100));

    // Seleção estrita de voz feminina em Português
    const pickFemaleVoice = (): SpeechSynthesisVoice | null => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return null;

      const maleExclusions = [
        'daniel', 'antonio', 'antônio', 'felipe', 'fabio', 'fábio',
        'ricardo', 'thiago', 'tiago', 'julio', 'júlio', 'male', 'masculino',
        'man', 'david', 'jorge'
      ];

      const ptVoices = voices.filter((v) => {
        const lang = (v.lang || '').toLowerCase();
        return lang.startsWith('pt') || lang.includes('br');
      });

      const femaleKeywords = [
        'francisca', 'maria', 'brenda', 'thalita', 'leticia', 'letícia',
        'heloisa', 'heloísa', 'yara', 'camila', 'luciana', 'joana',
        'fernanda', 'raquel', 'vitória', 'vitoria', 'female', 'feminino',
        'mulher', 'woman'
      ];

      for (const kw of femaleKeywords) {
        const found = ptVoices.find((v) => {
          const lower = v.name.toLowerCase();
          return lower.includes(kw) && !maleExclusions.some((m) => lower.includes(m));
        });
        if (found) return found;
      }

      const naturalPt = ptVoices.find((v) => {
        const lower = v.name.toLowerCase();
        return (lower.includes('google') || lower.includes('natural') || lower.includes('online')) &&
          !maleExclusions.some((m) => lower.includes(m));
      });
      if (naturalPt) return naturalPt;

      const nonMalePt = ptVoices.find((v) => {
        const lower = v.name.toLowerCase();
        return !maleExclusions.some((m) => lower.includes(m));
      });
      if (nonMalePt) return nonMalePt;

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

      if (watchdogTimeoutRef.current) {
        clearTimeout(watchdogTimeoutRef.current);
        watchdogTimeoutRef.current = null;
      }
      if (resumeHeartbeatIntervalRef.current) {
        clearInterval(resumeHeartbeatIntervalRef.current);
        resumeHeartbeatIntervalRef.current = null;
      }
      if (speechAnimIntervalRef.current) {
        clearInterval(speechAnimIntervalRef.current);
        speechAnimIntervalRef.current = null;
      }

      setAiSpeechLevel(0);
      activeUtteranceRef.current = null;
      (window as any).__candlex_active_utterance = null;
      accumulatedSpeechRef.current = '';

      if (speechCooldownTimeoutRef.current) {
        clearTimeout(speechCooldownTimeoutRef.current);
        speechCooldownTimeoutRef.current = null;
      }

      // Cooldown de 850ms após o fim completo da fala para dissipar o som ambiente e eco
      speechCooldownTimeoutRef.current = setTimeout(() => {
        isAiSpeakingRef.current = false;
        turnDispatchedRef.current = false;
        accumulatedSpeechRef.current = '';
        setStatus('listening');

        // Reabre o microfone com segurança apenas após o término total da fala
        if (sessionActiveRef.current) {
          try {
            startSpeechRecognitionRef.current();
          } catch {}
        }
      }, 850);
    };

    utterance.onstart = () => {
      isAiSpeakingRef.current = true;
      setStatus('speaking');

      // Animação da boca do avatar 3D no ritmo da fala
      if (speechAnimIntervalRef.current) clearInterval(speechAnimIntervalRef.current);
      let phase = 0;
      speechAnimIntervalRef.current = setInterval(() => {
        phase += 0.35;
        const baseLevel = 45 + Math.sin(phase * 4.2) * 25 + Math.sin(phase * 8.5) * 15;
        setAiSpeechLevel(Math.max(25, Math.min(95, Math.round(baseLevel))));
      }, 70);

      // Limpa qualquer heartbeat residual
      if (resumeHeartbeatIntervalRef.current) {
        clearInterval(resumeHeartbeatIntervalRef.current);
        resumeHeartbeatIntervalRef.current = null;
      }
    };

    utterance.onend = () => {
      finishPlayback();
    };

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[CandleX-IA] Erro na síntese de voz:', e.error);
      }
      finishPlayback();
    };

    // Watchdog de 30s apenas caso a API de fala do navegador trave
    watchdogTimeoutRef.current = setTimeout(() => {
      if (!hasEnded && isAiSpeakingRef.current) {
        console.warn('[CandleX-IA] Watchdog: liberando estado travado de fala');
        finishPlayback();
      }
    }, 30000);

    // Timeout seguro de 70ms após cancel() para dar tempo do Chrome reiniciar o pipeline de áudio
    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[CandleX-IA] Erro ao reproduzir fala:', err);
        finishPlayback();
      }
    }, 70);
  }, [stopAudioPlayback]);

  /**
   * Gera resposta inteligente e ultra-rápida.
   * Utiliza o modelo ativo do Gemini (gemini-3.8-live / gemini-3.8-flash) com contexto em tempo real,
   * e fallback instantâneo para o motor local com síntese dinâmica.
   */
  const generateAiReply = useCallback(
    async (promptText: string): Promise<string> => {
      const cleanPrompt = (promptText || '').trim();
      if (!cleanPrompt) return '';

      const q = cleanPrompt.toLowerCase();

      // Checagens de conectividade / microfone imediatas (0ms de latência)
      if (
        q === 'tá me ouvindo' ||
        q === 'ta me ouvindo' ||
        q === 'está me ouvindo' ||
        q === 'esta me ouvindo' ||
        q === 'alô' ||
        q === 'alo' ||
        q === 'fala comigo'
      ) {
        return answerQuestionLocally(cleanPrompt);
      }

      // Tenta Gemini com modelos ativos (gemini-3.8-live e gemini-3.8-flash)
      setIsProcessing(true);
      try {
        const geminiKey = getEffectiveGeminiKey();
        if (geminiKey && geminiKey.length > 15) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const contextSummary = tradingContextAdapter.getContextSummary();
            const recentTurns = voiceHistoryRef.current
              .slice(-4)
              .map((h) => `${h.role === 'user' ? 'Trader' : 'CandleX'}: ${h.text}`)
              .join('\n');

            const systemInstruction = `Você é a CandleX, assistente e parceira de trading institucional de Opções Binárias e Forex no app CandleX-IA.
Você está conversando por voz em tempo real diretamente com o trader via microfone.

DIRETRIZES DE CONVERSAÇÃO (100% NATURAL, HUMANA E ESPONTÂNEA):
1. Converse normalmente como uma parceira de trading real brasileira: calorosa, fluida, descontraída, simpática e inteligente.
2. NUNCA dê respostas pré-fabricadas, decoradas ou engessadas. Responda diretamente e de forma pessoal ao que o trader falou.
3. Se ele cumprimentar (ex: "olá, tudo bem?", "oi", "e aí"), responda de forma leve, simpática e natural ("Tudo ótimo por aqui! Pronta pra gente operar. Qual gráfico vamos analisar?", "Oi, tudo na paz! Tô com o olho no mercado. Como cê tá?").
4. Se ele perguntar sobre o mercado ou gráficos, analise com base nos dados reais do painel com autoridade e clareza.
5. Responda sempre em 1 a 2 frases curtas faladas (máximo 30 a 40 palavras). Perfeito para um diálogo de voz ágil, sem atrasos e sem enrolação.
6. NUNCA use formatação markdown, asteriscos, tópicos ou numerações.
7. PRONÚNCIA: Fale sempre nomes normais ("Euro USD", "GBP USD", "Bitcoin", "Dólar Iene"). NUNCA soletre letra por letra.
8. SUPORTE E RESISTÊNCIA: Quando o trader perguntar sobre suporte, resistência ou taxas, NUNCA ignore ou omita a resistência. Se ele perguntar especificamente sobre a resistência, informe a taxa da resistência imediatamente. Se perguntar sobre suporte e resistência, cite AMBOS claramente com os valores exatos do painel.
9. COTAÇÃO E TRADINGVIEW: Todas as cotações, preços e dados técnicos são sincronizados em tempo real diretamente do TradingView oficial. Quando o trader perguntar sobre preço ou cotação, informe a cotação oficial do TradingView informada no painel com precisão.

DADOS EM TEMPO REAL DO CANDLEX-IA NO PAINEL:
${contextSummary}

MEMÓRIA RECENTE DA CONVERSA:
${recentTurns || 'Início da sessão de voz.'}`;

            const candidateModels = [
              'gemini-3.1-flash-lite',
              'gemini-3.5-flash-lite',
              'gemini-flash-latest',
              'gemini-3.5-flash',
            ];
            for (const modelName of candidateModels) {
              try {
                const fetchPromise = ai.models.generateContent({
                  model: modelName,
                  contents: cleanPrompt,
                  config: {
                    systemInstruction,
                    temperature: 0.7,
                    maxOutputTokens: 90,
                  },
                });

                const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
                const response: any = await Promise.race([fetchPromise, timeoutPromise]);

                if (response && response.text) {
                  const cleanText = normalizeTradingPronunciation(response.text);
                  if (cleanText) {
                    setIsProcessing(false);
                    return cleanText;
                  }
                }
              } catch (modelErr) {
                console.warn(`[CandleX-IA Voz] Falha no modelo ${modelName}:`, modelErr);
              }
            }
          } catch (genAiErr) {
            console.warn('[CandleX-IA Voz] Erro ao instanciar Gemini:', genAiErr);
          }
        }
      } catch (overallErr) {
        console.warn('[CandleX-IA Voz] Exceção em generateAiReply:', overallErr);
      } finally {
        setIsProcessing(false);
      }

      // Fallback local robusto caso Gemini não responda em 2.8s ou sem chave
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
      if (turnDispatchedRef.current || isAiSpeakingRef.current || isProcessing) return;
      turnDispatchedRef.current = true;
      hasSpokenInTurnRef.current = false;

      const q = textQuery?.trim();
      if (!q || !isLegitimateHumanSpeech(q)) {
        turnDispatchedRef.current = false;
        return;
      }

      // FILTRO ANTI-ECO ACÚSTICO:
      // Se o que o microfone ouviu for parte da própria fala recente da IA, descarta!
      const lastAiSpeech = (currentAiTurnTextRef.current || '').toLowerCase().trim();
      const candidateUser = q.toLowerCase().trim();
      if (lastAiSpeech && candidateUser.length >= 4) {
        const cleanAi = lastAiSpeech.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanUser = candidateUser.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanAi && (cleanAi.includes(cleanUser) || cleanUser.includes(cleanAi))) {
          console.warn('[CandleX-IA Anti-Eco] Descartando áudio que veio das caixas de som:', q);
          turnDispatchedRef.current = false;
          accumulatedSpeechRef.current = '';
          return;
        }
      }

      console.log('[CandleX-IA Voz] Turno concluído do trader:', q);
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
        console.warn('[CandleX-IA Voz] Erro ao responder:', err);
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
    [generateAiReply, answerQuestionLocally, speakBrowserText, isProcessing]
  );

  // Iniciar reconhecimento de voz contínuo do navegador (PT-BR)
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.warn('[CandleX-IA] Web SpeechRecognition não disponível neste navegador.');
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
        // BLOQUEIO TOTAL DE ECO ACÚSTICO:
        // Se a IA estiver falando, aguardando resposta ou no período de cooldown,
        // descarta 100% de qualquer som do microfone para que a IA NUNCA ouça a si mesma!
        if (isAiSpeakingRef.current || statusRef.current === 'speaking' || isProcessing) {
          accumulatedSpeechRef.current = '';
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
          console.log('[CandleX-IA] Escutou do usuário:', display);
          setUserTranscript(display);
          turnDispatchedRef.current = false;
          hasSpokenInTurnRef.current = true;
          lastVoiceActiveTimeRef.current = Date.now();
        }

        if (speechSilenceTimeoutRef.current) {
          clearTimeout(speechSilenceTimeoutRef.current);
        }

        // Aguarda 450ms de silêncio após a fala para resposta ágil e imediata
        speechSilenceTimeoutRef.current = setTimeout(() => {
          const fullQuestion = (accumulatedSpeechRef.current || display).trim();
          accumulatedSpeechRef.current = '';
          if (fullQuestion && isLegitimateHumanSpeech(fullQuestion)) {
            dispatchTurn(fullQuestion);
          }
        }, 450);
      };

      recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[CandleX-IA SpeechRecognition] Evento:', e.error);
        }
      };

      recognition.onend = () => {
        // Reinício automático para conversação contínua apenas se a IA NÃO estiver falando
        if (sessionActiveRef.current && !isAiSpeakingRef.current && statusRef.current !== 'speaking') {
          setTimeout(() => {
            if (sessionActiveRef.current && !isAiSpeakingRef.current && statusRef.current !== 'speaking') {
              try {
                recognition.start();
              } catch {}
            }
          }, 250);
        }
      };

      try {
        recognition.start();
      } catch {}
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('[CandleX-IA] Falha ao iniciar reconhecimento de voz:', err);
    }
  }, [dispatchTurn, isProcessing]);

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

      // 1. Filtro Passa-Alta vocal (elimina rumbles < 90Hz)
      const highpass = inputCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 90;

      // 2. Filtro Passa-Baixa vocal (elimina ruído de fundo > 3400Hz)
      const lowpass = inputCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3400;

      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      const VOICE_RMS_THRESHOLD = 0.024;
      let voiceFramesCount = 0;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i += 8) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / (inputData.length / 8));

        // Se a IA estiver falando, silencia o medidor para evitar eco das caixas de som
        if (isAiSpeakingRef.current || statusRef.current === 'speaking' || isProcessing) {
          setMicLevel(0);
          voiceFramesCount = 0;
          return;
        }

        if (isMutedRef.current) {
          setMicLevel(0);
          voiceFramesCount = 0;
          return;
        }

        // Filtro de ruído ambiente: se menor que o piso vocal, suprime ruídos não-humanos
        if (rms < VOICE_RMS_THRESHOLD) {
          voiceFramesCount = Math.max(0, voiceFramesCount - 1);
          setMicLevel(0);
          return;
        }

        voiceFramesCount++;
        const currentLevel = Math.min(100, Math.round(rms * 280));
        
        // Throttling: Atualiza estado do React no máximo a cada 100ms para evitar travamentos da interface e do 3D
        const now = Date.now();
        if (now - lastMicUpdateRef.current >= 100) {
          lastMicUpdateRef.current = now;
          setMicLevel(currentLevel);
        }

        // VAD persistente: apenas sons sustentados (voz humana) ativam o canal
        if (voiceFramesCount >= 2) {
          lastVoiceActiveTimeRef.current = now;
          hasSpokenInTurnRef.current = true;
          turnDispatchedRef.current = false;
        }

        const isVoiceActive = now - lastVoiceActiveTimeRef.current < 800;

        // Processa áudio PCM apenas se houver WebSocket ou sessão Gemini Live ativa
        const hasLiveWs = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
        const hasLiveSession = !!geminiLiveSessionRef.current;

        if (hasLiveWs || hasLiveSession) {
          const resampled = resampleTo16k(inputData, inputCtx.sampleRate);
          const base64Pcm = pcmToBase64(resampled);

          if (hasLiveWs && isVoiceActive && voiceFramesCount >= 2) {
            wsRef.current?.send(JSON.stringify({ audio: base64Pcm }));
          }

          if (hasLiveSession && isVoiceActive) {
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

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(processor);
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
                userName: 'Herisson',
                marketContext: {
                  asset: currentCtx.asset.symbol,
                  assetName: currentCtx.asset.name,
                  currentPrice: currentCtx.asset.currentPrice,
                  timeframe: currentCtx.timeframe,
                  marketAnalysis: currentCtx.marketAnalysis,
                  confluences: currentCtx.confluences,
                  supports,
                  resistances,
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

  // Conecta avisos falados de novos sinais e cancelamentos (ETAPA 6)
  useEffect(() => {
    signalEventBridge.setUserSpeakingCheck(
      () => isAiSpeakingRef.current || statusRef.current === 'speaking' || isProcessing
    );

    const onSignal = (signal: any, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') => {
      if (voiceAnnouncementsRef.current && sessionActiveRef.current) {
        // Ignora aviso sonoro se a IA já estiver falando ou processando uma pergunta
        if (isAiSpeakingRef.current || statusRef.current === 'speaking' || isProcessing) {
          return;
        }
        if (event === 'CONFIRMED' && signal) {
          const dir = signal.direction === 'CALL' ? 'CALL, compra' : 'PUT, venda';
          const spoken = `Atenção! O CandleX-IA identificou um sinal de ${dir} no par ${signal.asset}, timeframe ${signal.timeframe}. Confluência de ${signal.confluenceScore} por cento.`;
          speakBrowserText(spoken);
        } else if (event === 'CANCELLED' && signal) {
          const spoken = `Atenção: sinal no par ${signal.asset} cancelado por proteção do algoritmo CandleX-IA.`;
          speakBrowserText(spoken);
        }
      }
    };

    signalEngine.addOnSignalEvent(onSignal);
  }, [speakBrowserText, isProcessing]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const assistantState: AssistantUiState =
    status === 'idle'
      ? 'DESCONECTADO'
      : status === 'connecting'
      ? 'CONECTANDO'
      : status === 'error'
      ? 'ERRO'
      : status === 'speaking'
      ? 'FALANDO'
      : isProcessing
      ? 'PROCESSANDO'
      : 'OUVINDO';

  return {
    status,
    assistantState,
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
    volume,
    setVolume,
    voiceAnnouncements,
    setVoiceAnnouncements,
    isProcessing,
    sendTextMessage,
    interruptSpeech,
    startLiveConversation,
    disconnectSession,
    toggleMute,
    requestMicrophoneAccess,
    clearVoiceHistory: () => setVoiceHistory([]),
  };
}
