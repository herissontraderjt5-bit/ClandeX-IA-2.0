import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Activity,
  Volume2,
  VolumeX,
  Settings,
  Minus,
  X,
  Play,
  Square,
  Sparkles,
  Maximize2,
  ChevronDown,
  Clock,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert,
  HelpCircle,
  Send,
  Zap,
  BarChart3,
  ChevronRight,
  Copy,
  Check,
  Calendar,
  Timer,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  MessageSquare,
  Bot,
  User,
  RotateCcw,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  TrendingUp,
  TrendingDown,
  Gauge,
  SlidersHorizontal,
  Bell,
  Lock,
  ExternalLink,
  Coins,
  LogOut,
  Newspaper,
  Globe,
} from 'lucide-react';
import {
  Asset,
  Candle,
  ConfluenceBreakdown,
  DataSourceInfo,
  MarketAnalysis,
  SignalRecord,
  TimeFrame,
  ExpirationTime,
  AppSettings,
  UserSession,
  StrategyBacktestResult,
} from '../types/trading';
import {
  AVAILABLE_STRATEGIES,
  getStoredActiveStrategies,
  storeActiveStrategies,
  runRealtimeBacktest,
  getStoredAutoFilterProfit,
  storeAutoFilterProfit,
  getProfitableStrategyIds,
} from '../services/strategyEngine';
import { CyberAiAvatar3D } from './CyberAiAvatar3D';
import { LiveVoiceStatus, VoiceEngine, LiveTurnMessage, AssistantUiState } from '../hooks/useLiveVoice';
import {
  getRelevantEconomicEvents,
  getCurrentMarketSession,
  getRealMarketNews,
  getEconomicCalendar,
  MarketNewsItem,
} from '../services/economicCalendar';
import { computeTechnicalOverview, TechnicalOverviewData } from '../services/technicalIndicators';
import { marketDataManager, isForexMarketOpen } from '../services/marketData';
import { signalEngine } from '../services/signalEngine';
import { audioAlerts } from '../services/audioAlerts';
import { formatBrasiliaTime } from '../utils/timeFormat';
import { checkMemberAccessStatus } from '../services/memberService';

interface FloatingHudProps {
  asset: Asset;
  assetsList: Asset[];
  timeframe: TimeFrame;
  expiration: ExpirationTime;
  remainingSeconds: number;
  currentCandle: Candle | null;
  candles?: Candle[];
  marketAnalysis: MarketAnalysis;
  confluences: ConfluenceBreakdown;
  activePreAlert: SignalRecord | null;
  latestConfirmedSignal: SignalRecord | null;
  activeTrade?: SignalRecord | null;
  lastResolvedTrade?: SignalRecord | null;
  lastCancelledSignal?: SignalRecord | null;
  signalsHistory: SignalRecord[];
  dataSource: DataSourceInfo;
  isAnalyzing: boolean;
  settings: AppSettings;
  liveVoice?: {
    status: LiveVoiceStatus;
    assistantState?: AssistantUiState;
    errorMessage: string | null;
    hasMicPermission: boolean | null;
    isMuted: boolean;
    micLevel: number;
    aiSpeechLevel: number;
    isActivatingMic: boolean;
    activeEngine?: VoiceEngine;
    userTranscript?: string;
    aiResponseText?: string;
    lastTurnMessage?: LiveTurnMessage | null;
    voiceHistory?: LiveTurnMessage[];
    volume?: number;
    setVolume?: (v: number) => void;
    voiceAnnouncements?: boolean;
    setVoiceAnnouncements?: (b: boolean) => void;
    isProcessing?: boolean;
    startLiveConversation: () => Promise<void>;
    disconnectSession: () => void;
    toggleMute: () => void;
    requestMicrophoneAccess: () => Promise<void>;
    sendTextMessage?: (text: string) => void;
    interruptSpeech?: () => void;
    clearVoiceHistory?: () => void;
  };
  onSelectAsset: (symbol: string) => void;
  onSelectTimeframe: (tf: TimeFrame) => void;
  onSelectExpiration: (exp: ExpirationTime) => void;
  onToggleAnalysis: () => void;
  onToggleSound: () => void;
  onOpenSettings: () => void;
  onOpenWebhook?: () => void;
  onOpenVoice?: () => void;
  onTriggerAiInsight: () => void;
  onTriggerTestSignal?: () => void;
  onTriggerCancelTest?: () => void;
  isAiLoading: boolean;
  aiInsightText: string | null;
  isAdmin?: boolean;
  userSession?: UserSession | null;
  onRefreshSession?: () => Promise<void>;
  onOpenAdminPanel?: () => void;
  onSelectAnalysisProfile?: (profile: 'CONSERVADORA' | 'MODERADA' | 'AGRESSIVA') => void;
  onLogout?: () => void;
}

function evaluateAiConfluences(tech: TechnicalOverviewData) {
  let callPoints = 0;
  let putPoints = 0;
  const reasons: string[] = [];

  // 1. Tendência Maior
  if (tech.majorTrend.status === 'ALTA') {
    callPoints += 25;
    reasons.push(`Tendência Maior (${tech.timeframe}): ALTA com força ${tech.majorTrend.strength}`);
  } else if (tech.majorTrend.status === 'BAIXA') {
    putPoints += 25;
    reasons.push(`Tendência Maior (${tech.timeframe}): BAIXA com força ${tech.majorTrend.strength}`);
  } else {
    callPoints += 5;
    putPoints += 5;
  }

  // 2. RSI (14)
  if (tech.rsi.condition === 'SOBREVENDIDO') {
    callPoints += 22;
    reasons.push(`RSI Sobrevendido (${tech.rsi.value} pts) - Potencial repique comprador`);
  } else if (tech.rsi.condition === 'SOBRECOMPRADO') {
    putPoints += 22;
    reasons.push(`RSI Sobrecomprado (${tech.rsi.value} pts) - Exaustão compradora`);
  } else if (tech.rsi.signal === 'ALTA') {
    callPoints += 12;
    reasons.push(`RSI (${tech.rsi.value} pts) com inclinação de alta`);
  } else if (tech.rsi.signal === 'BAIXA') {
    putPoints += 12;
    reasons.push(`RSI (${tech.rsi.value} pts) com inclinação de baixa`);
  }

  // 3. MACD
  if (tech.macd.status === 'ALTA') {
    callPoints += 18;
    reasons.push(`MACD em ALTA (Histograma positivo)`);
  } else if (tech.macd.status === 'BAIXA') {
    putPoints += 18;
    reasons.push(`MACD em BAIXA (Histograma negativo)`);
  }

  // 4. Médias Móveis Curtas (EMA 9/21)
  if (tech.maShort.status === 'ALTA') {
    callPoints += 15;
    reasons.push(`Médias Curtas (EMA 9/21): Tendência de ALTA`);
  } else if (tech.maShort.status === 'BAIXA') {
    putPoints += 15;
    reasons.push(`Médias Curtas (EMA 9/21): Tendência de BAIXA`);
  }

  // 5. Médias Móveis Longas (SMA 50/200)
  if (tech.maLong.status === 'ALTA') {
    callPoints += 10;
    reasons.push(`Médias Longas (SMA 50/200): Estrutura de ALTA`);
  } else if (tech.maLong.status === 'BAIXA') {
    putPoints += 10;
    reasons.push(`Médias Longas (SMA 50/200): Estrutura de BAIXA`);
  }

  // 6. Bandas de Bollinger
  if (tech.bollingerBands.status === 'ALTA') {
    callPoints += 10;
    reasons.push(`Bandas de Bollinger: Retração altista na banda inferior`);
  } else if (tech.bollingerBands.status === 'BAIXA') {
    putPoints += 10;
    reasons.push(`Bandas de Bollinger: Rejeição na banda superior`);
  }

  // 7. Delta de Volume
  if (tech.delta.buyerPercent >= 52) {
    callPoints += 14;
    reasons.push(`Delta de Volume: ${tech.delta.buyerPercent}% Comprador`);
  } else if (tech.delta.sellerPercent >= 52) {
    putPoints += 14;
    reasons.push(`Delta de Volume: ${tech.delta.sellerPercent}% Vendedor`);
  }

  // 8. ADX
  if (tech.adx.value >= 22) {
    reasons.push(`ADX (${tech.adx.value} pts): Força direcional confirmada`);
  }

  const direction: 'CALL' | 'PUT' = putPoints > callPoints ? 'PUT' : (callPoints > putPoints ? 'CALL' : (tech.majorTrend.status === 'BAIXA' ? 'PUT' : 'CALL'));
  const dominantPoints = direction === 'CALL' ? callPoints : putPoints;
  const score = Math.min(95, Math.max(76, Math.round(dominantPoints * 0.85 + 18)));

  return { direction, score, reasons };
}

export const FloatingHud: React.FC<FloatingHudProps> = ({
  asset,
  assetsList,
  timeframe,
  expiration,
  remainingSeconds,
  currentCandle,
  candles,
  marketAnalysis,
  confluences,
  activePreAlert,
  latestConfirmedSignal,
  activeTrade,
  lastResolvedTrade,
  lastCancelledSignal,
  signalsHistory,
  dataSource,
  isAnalyzing,
  settings,
  liveVoice,
  onSelectAsset,
  onSelectTimeframe,
  onSelectExpiration,
  onToggleAnalysis,
  onToggleSound,
  onOpenSettings,
  onOpenWebhook,
  onOpenVoice,
  onTriggerAiInsight,
  onTriggerTestSignal,
  onTriggerCancelTest,
  isAiLoading,
  aiInsightText,
  isAdmin,
  userSession,
  onLogout,
  onRefreshSession,
  onOpenAdminPanel,
  onSelectAnalysisProfile,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isCheckingDeposit, setIsCheckingDeposit] = useState(false);
  const [depositCheckSuccess, setDepositCheckSuccess] = useState<string | null>(null);
  const [depositCheckError, setDepositCheckError] = useState<string | null>(null);

  // Trava de ativação da ferramenta por cadeado: se a pessoa não tiver feito depósito mínimo de $10
  // EXCEÇÃO: Se o administrador liberou manualmente o cliente no Painel ADM (ex: teste 24h ou dias concedidos),
  // o cliente NÃO precisa de depósito nem de cadastro pelo link de afiliado!
  const isDepositLocked = useMemo(() => {
    if (isAdmin) return false;
    if (!userSession) return false;

    // Se o acesso foi liberado manualmente pelo administrador no painel ADM:
    const isManuallyGrantedByAdmin =
      userSession.source === 'ADMIN_MANUAL' ||
      userSession.source === 'ADMIN_BYPASS' ||
      (userSession.hasAccess && userSession.status === 'ACTIVE' && (userSession.accessDays || 0) > 0);

    if (isManuallyGrantedByAdmin) {
      return false; // Totalmente isento de exigência de depósito/link!
    }

    return !userSession.hasDeposit || userSession.status === 'PENDING_DEPOSIT';
  }, [isAdmin, userSession]);

  const handlePerformLogout = () => {
    try {
      localStorage.removeItem('clandex_user_session');
    } catch { }
    if (onLogout) {
      onLogout();
    } else {
      window.location.reload();
    }
  };

  const handleCheckDeposit = async () => {
    setIsCheckingDeposit(true);
    setDepositCheckSuccess(null);
    setDepositCheckError(null);
    try {
      if (onRefreshSession) {
        await onRefreshSession();
      }
      if (userSession?.email) {
        // 1. Verifica se o Administrador liberou manualmente no Supabase
        const statusCheck = await checkMemberAccessStatus(userSession.email);
        if (statusCheck.allowed && statusCheck.member && statusCheck.member.status === 'ACTIVE') {
          setDepositCheckSuccess('Acesso liberado com sucesso pelo Administrador! Desbloqueando...');
          if (onRefreshSession) await onRefreshSession();
          setTimeout(() => {
            window.location.reload();
          }, 800);
          return;
        }

        // 2. Consulta API Hiove
        const resp = await fetch('/api/auth/validate-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userSession.email }),
        });
        const data = await resp.json();
        if (data.status === 'ACTIVE' || data.hasDeposit === true || data.access === true) {
          setDepositCheckSuccess('Depósito confirmado com sucesso! Todas as funções foram desbloqueadas.');
          setTimeout(() => {
            window.location.reload();
          }, 800);
          return;
        }
      }
      setDepositCheckError('Depósito ainda não identificado ou liberação pendente. Se acabou de realizar, aguarde 1 a 2 minutos para compensação e tente novamente.');
    } catch {
      setDepositCheckError('Não foi possível verificar no momento. Tente novamente em instantes.');
    } finally {
      setIsCheckingDeposit(false);
    }
  };
  const [position, setPosition] = useState({ x: 24, y: 84 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 24,
    posY: 84,
  });

  // Restore position from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('clandex_hud_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          setPosition(parsed);
          dragRef.current.posX = parsed.x;
          dragRef.current.posY = parsed.y;
        }
      }
    } catch { }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    setIsDragging(true);
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.posX = position.x;
    dragRef.current.posY = position.y;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(10, Math.min(window.innerWidth - 420, dragRef.current.posX + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, dragRef.current.posY + dy));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        try {
          localStorage.setItem('clandex_hud_pos', JSON.stringify(position));
        } catch { }
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position]);

  // HUD Tabs: 'sinal' | 'analise' | 'indicadores' | 'voz' | 'chat'
  const [activeTab, setActiveTab] = useState<'sinal' | 'analise' | 'indicadores' | 'voz' | 'chat'>('sinal');
  const [copiedSignal, setCopiedSignal] = useState(false);
  const [newsImpactFilter, setNewsImpactFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM'>('ALL');

  // Relógio Oficial de Brasília ao Vivo (BRT - UTC-3)
  const [currentBrasiliaClock, setCurrentBrasiliaClock] = useState(() => formatBrasiliaTime());
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentBrasiliaClock(formatBrasiliaTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Estratégias Separadas e Backtest em Tempo Real com Auto-Filtro IA de Lucro
  const [autoFilterProfitOnly, setAutoFilterProfitOnly] = useState<boolean>(() => {
    return settings.autoFilterProfitOnly !== undefined
      ? settings.autoFilterProfitOnly
      : getStoredAutoFilterProfit();
  });

  const [activeStrategyIds, setActiveStrategyIds] = useState<string[]>(() => {
    return settings.activeStrategies && settings.activeStrategies.length > 0
      ? settings.activeStrategies
      : getStoredActiveStrategies();
  });

  const [backtestList, setBacktestList] = useState<StrategyBacktestResult[]>(() => {
    try {
      const list = candles && candles.length > 0 ? candles : marketDataManager.getCandles();
      return runRealtimeBacktest(list, activeStrategyIds || [], autoFilterProfitOnly);
    } catch (e) {
      console.error('[FloatingHud] Error initializing backtestList:', e);
      return [];
    }
  });

  // Atualização em tempo real do backtest conforme as velas chegam
  useEffect(() => {
    try {
      const list = candles && candles.length > 0 ? candles : marketDataManager.getCandles();
      const results = runRealtimeBacktest(list, activeStrategyIds || [], autoFilterProfitOnly);
      setBacktestList(results);

      // A IA SELECIONA E DESATIVA AUTOMATICAMENTE AS ESTRATÉGIAS EM PREJUÍZO
      if (autoFilterProfitOnly && results.length > 0) {
        const profitableIds = results
          .filter((r) => r.isProfitable && !r.autoDeactivated)
          .map((r) => r.id);
        const safeTargetIds = profitableIds.length > 0 ? profitableIds : [results[0].id];

        // Se houver discrepância com as ativas atuais, sincroniza
        const needsSync =
          safeTargetIds.length !== activeStrategyIds.length ||
          !safeTargetIds.every((id) => activeStrategyIds.includes(id));

        if (needsSync) {
          setActiveStrategyIds(safeTargetIds);
          storeActiveStrategies(safeTargetIds);
          settings.activeStrategies = safeTargetIds;
        }
      }
    } catch (e) {
      console.error('[FloatingHud] Error updating backtestList:', e);
    }
  }, [candles, activeStrategyIds, autoFilterProfitOnly]);

  const handleToggleAutoFilterProfit = () => {
    const nextVal = !autoFilterProfitOnly;
    setAutoFilterProfitOnly(nextVal);
    storeAutoFilterProfit(nextVal);
    settings.autoFilterProfitOnly = nextVal;

    if (nextVal && backtestList.length > 0) {
      const profitableIds = backtestList
        .filter((r) => r.isProfitable && !r.autoDeactivated)
        .map((r) => r.id);
      const safeTargetIds = profitableIds.length > 0 ? profitableIds : [backtestList[0].id];
      setActiveStrategyIds(safeTargetIds);
      storeActiveStrategies(safeTargetIds);
      settings.activeStrategies = safeTargetIds;
    }
  };

  const handleToggleStrategy = (stratId: string) => {
    const updated = activeStrategyIds.includes(stratId)
      ? activeStrategyIds.filter((id) => id !== stratId)
      : [...activeStrategyIds, stratId];
    if (updated.length === 0) return; // Mantém pelo menos 1 ativa
    setActiveStrategyIds(updated);
    storeActiveStrategies(updated);
    settings.activeStrategies = updated;
  };

  const handleActivateAllStrategies = () => {
    const allIds = AVAILABLE_STRATEGIES.map((s) => s.id);
    setActiveStrategyIds(allIds);
    storeActiveStrategies(allIds);
    settings.activeStrategies = allIds;
  };

  const handleActivateTopStrategies = () => {
    const topIds = backtestList
      .filter((b) => b.winRate >= 65 && b.isProfitable)
      .map((b) => b.id);
    const finalIds = topIds.length > 0 ? topIds : AVAILABLE_STRATEGIES.slice(0, 3).map((s) => s.id);
    setActiveStrategyIds(finalIds);
    storeActiveStrategies(finalIds);
    settings.activeStrategies = finalIds;
  };

  // Market status & Economic News
  const isForexOpen = isForexMarketOpen();
  const isForexClosed = asset.category === 'FOREX' && !isForexOpen;
  const realNewsList = useMemo(() => getRealMarketNews(asset.symbol), [asset.symbol]);
  const economicEvents = useMemo(() => getEconomicCalendar(asset.symbol), [asset.symbol]);
  const currentSession = useMemo(() => getCurrentMarketSession(), []);
  const relevantEvents = useMemo(() => getRelevantEconomicEvents(asset.symbol), [asset.symbol]);
  const filteredEconomicEvents = useMemo(() => {
    if (newsImpactFilter === 'HIGH') {
      return economicEvents.filter((e) => e.impact === 'HIGH');
    }
    if (newsImpactFilter === 'MEDIUM') {
      return economicEvents.filter((e) => e.impact === 'MEDIUM');
    }
    return economicEvents;
  }, [economicEvents, newsImpactFilter]);

  // Real-time Technical Overview calculated from current candles, timeframe & asset + live TradingView scanner
  const activeCandles = candles && candles.length > 0 ? candles : marketDataManager.getCandles();
  const liveTvData = marketDataManager.getLiveTradingViewData(timeframe);
  const technicalData = useMemo(() => {
    return computeTechnicalOverview(activeCandles, timeframe, asset, liveTvData);
  }, [activeCandles, timeframe, asset, liveTvData, currentCandle?.close]);

  // Consenso Institucional Geral dos 10 Indicadores Técnicos
  const indicatorConsensus = useMemo(() => {
    const indicators = [
      { name: 'Tendência Maior', signal: technicalData.majorTrend.status === 'LATERAL' ? 'NEUTRO' : technicalData.majorTrend.status },
      { name: 'RSI (14)', signal: technicalData.rsi.signal },
      { name: 'MACD', signal: technicalData.macd.status },
      { name: 'Médias Rápidas (EMA 9/21)', signal: technicalData.maShort.status === 'LATERAL' ? 'NEUTRO' : technicalData.maShort.status },
      { name: 'Médias Longas (SMA 50/200)', signal: technicalData.maLong.status === 'LATERAL' ? 'NEUTRO' : technicalData.maLong.status },
      { name: 'Bandas de Bollinger', signal: technicalData.bollingerBands.status },
      { name: 'Estocástico (14,3,3)', signal: technicalData.stochastic.status },
      { name: 'ADX (14)', signal: technicalData.adx.status },
      { name: 'Volume Institucional', signal: technicalData.volume.status },
      { name: 'Delta de Pressão', signal: technicalData.delta.status },
    ];

    let callCount = 0;
    let putCount = 0;
    let neutralCount = 0;

    for (const ind of indicators) {
      if (ind.signal === 'ALTA') callCount++;
      else if (ind.signal === 'BAIXA') putCount++;
      else neutralCount++;
    }

    const total = indicators.length;
    const callPercent = Math.round((callCount / total) * 100);
    const putPercent = Math.round((putCount / total) * 100);
    const neutralPercent = Math.max(0, 100 - callPercent - putPercent);

    let verdict: 'FORTE COMPRA' | 'COMPRA' | 'NEUTRO' | 'VENDA' | 'FORTE VENDA' = 'NEUTRO';
    let bias: 'CALL' | 'PUT' | 'NEUTRO' = 'NEUTRO';

    if (callCount >= 7) {
      verdict = 'FORTE COMPRA';
      bias = 'CALL';
    } else if (callCount >= 5 && callCount > putCount) {
      verdict = 'COMPRA';
      bias = 'CALL';
    } else if (putCount >= 7) {
      verdict = 'FORTE VENDA';
      bias = 'PUT';
    } else if (putCount >= 5 && putCount > callCount) {
      verdict = 'VENDA';
      bias = 'PUT';
    } else {
      verdict = 'NEUTRO';
      bias = 'NEUTRO';
    }

    return {
      indicators,
      callCount,
      putCount,
      neutralCount,
      callPercent,
      putPercent,
      neutralPercent,
      verdict,
      bias,
    };
  }, [technicalData]);

  // Chat IA State
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: 'user' | 'model'; text: string; timestamp: number }>>([
    {
      id: 'welcome',
      role: 'model',
      text: `Olá! Sou a ClandeX-IA. Estou monitorando ${asset.symbol} em tempo real.\n\nPergunte-me qualquer dúvida sobre:\n• Próxima notícia de alto impacto e horário de divulgação\n• Regiões de suporte e resistência atuais\n• Força da tendência maior (compradores x vendedores)\n• Order Blocks e Fair Value Gaps (FVG)\n• Momento ideal para entrar em CALL ou PUT`,
      timestamp: Date.now(),
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeTab, isChatLoading]);

  // Envio de mensagem puramente textual no Chat (a IA responde em texto sem falar em voz alta)
  const handleSendChatMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || chatInput).trim();
    if (!textToSend || isChatLoading) return;

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      text: textToSend,
      timestamp: Date.now(),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setIsChatLoading(true);

    // Compute active economic calendar events for the asset
    const { upcomingHighImpact, relevantEvents } = getRelevantEconomicEvents(asset.symbol);
    const marketSession = getCurrentMarketSession();
    const isForexClosed = asset.category === 'FOREX' && !isForexMarketOpen();
    const realNewsList = getRealMarketNews(asset.symbol);
    const lower = textToSend.toLowerCase();
    let fallbackText = '';

    try {
      let replyText = '';

      // 1. Chamada Direta no Cliente via SDK @google/genai (Compatível com Vercel)
      let clientApiKey = '';
      try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
          clientApiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
        }
      } catch { }
      if (!clientApiKey && typeof window !== 'undefined') {
        clientApiKey = localStorage.getItem('clandex_gemini_api_key') || '';
      }
      if (clientApiKey && clientApiKey.includes('AIzaSyDlckr22NxUjJXWVp9ENtPFxuDoBy2LFZ4')) {
        try {
          localStorage.removeItem('clandex_gemini_api_key');
        } catch { }
        clientApiKey = '';
      }

      if (clientApiKey && clientApiKey.length > 15) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: clientApiKey });
          const supList = marketAnalysis.keyLevels?.filter((k) => k.type === 'SUPPORT').map((k) => k.price.toFixed(asset.pipDecimals)) || [];
          const resList = marketAnalysis.keyLevels?.filter((k) => k.type === 'RESISTANCE').map((k) => k.price.toFixed(asset.pipDecimals)) || [];

          const topNews = realNewsList[0];
          const marketStatusStr = isForexClosed
            ? 'MERCADO FOREX FECHADO (FIM DE SEMANA NO TRADINGVIEW). Oriente o trader a operar Criptomoedas 24/7 (BTC, ETH, SOL).'
            : 'MERCADO ABERTO EM TEMPO REAL NO TRADINGVIEW.';

          const prompt = `
Você é a ClandeX-IA, mentora institucional e analista quantitativa de Opções Binárias e Forex para a corretora Hiove com base direta nos dados do TradingView.
Mercado em Tempo Real (TradingView):
- Ativo: ${asset.symbol} (${asset.name}) | Símbolo TradingView: ${asset.tvSymbol}
- Status do Mercado: ${marketStatusStr}
- Preço Atual: ${asset.currentPrice} | Timeframe: ${timeframe}
- Tendência: ${marketAnalysis.trend} (Força Compra: ${marketAnalysis.buyerStrength}, Venda: ${marketAnalysis.sellerStrength})
- Resistência Imediata (Teto acima do preço): ${resList[0] || (asset.currentPrice * 1.002).toFixed(asset.pipDecimals)}
- Suporte Imediato (Piso abaixo do preço): ${supList[0] || (asset.currentPrice * 0.998).toFixed(asset.pipDecimals)}
- Todas as Resistências: ${resList.join(', ') || 'dinâmicas'}
- Todos os Suportes: ${supList.join(', ') || 'dinâmicos'}
- Confluência: ${confluences.totalScore}% para ${confluences.direction}
- Banco de Notícias Reais: ${topNews ? `"${topNews.title}" (${topNews.source} - Impacto: ${topNews.impact})` : 'Sem eventos de risco no momento'}
- Calendário Econômico: ${upcomingHighImpact ? `${upcomingHighImpact.event} (${upcomingHighImpact.currency}) às ${upcomingHighImpact.time}` : 'Sem notícias críticas imediatas'}

Pergunta do Trader: "${textToSend}"

DIRETRIZ CRÍTICA DE SUPORTE E RESISTÊNCIA:
Se o trader perguntar sobre suporte, resistência ou taxas, NUNCA omita a resistência. Se ele perguntar especificamente sobre a resistência, informe a taxa da resistência imediatamente. Se perguntar sobre ambos ou sobre taxas em geral, informe tanto a resistência quanto o suporte com os valores exatos informados acima.

Responda em português brasileiro de forma direta, clara, profissional e motivadora. Se o mercado Forex estiver fechado no fim de semana, lembre o trader e sugira os pares de criptomoedas 24/7. Seja concisa e objetiva.
          `;

          const candidateModels = [
            'gemini-3.1-flash-lite',
            (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_LIVE_MODEL) || 'gemini-3.8-live',
            'gemini-3.8-flash',
            'gemini-3.5-flash-lite',
            'gemini-3.5-flash',
          ];
          for (const modelName of candidateModels) {
            try {
              const resp = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                  temperature: 0.4,
                },
              });
              if (resp && resp.text) {
                replyText = resp.text;
                break;
              }
            } catch { }
          }
        } catch (directClientErr) {
          console.warn('[ClandeX-IA Chat] Tentativa direta falhou, tentando fallback:', directClientErr);
        }
      }

      // 2. Se não obteve via SDK direto, tenta backend local (se existir)
      if (!replyText) {
        try {
          const response = await fetch('/api/gemini/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: newHistory.map((m) => ({ role: m.role, text: m.text })),
              marketContext: {
                asset: asset.symbol,
                assetName: asset.name,
                currentPrice: asset.currentPrice,
                spread: asset.spread,
                timeframe,
                marketAnalysis,
                confluences,
                upcomingHighImpact,
                relevantEvents: relevantEvents.slice(0, 6),
                marketSession,
              },
            }),
          });
          const data = await response.json();
          if (data && data.success && data.reply) {
            replyText = data.reply;
          }
        } catch { }
      }

      if (replyText) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `model-${Date.now()}`,
            role: 'model' as const,
            text: replyText,
            timestamp: Date.now(),
          },
        ]);
      } else {
        throw new Error('Falha ao obter resposta');
      }
    } catch {
      if (isForexClosed) {
        fallbackText = `Aviso do TradingView: O mercado Forex está fechado neste fim de semana para ${asset.symbol} (reabre domingo às 18:00 BRT). Não há formação de novas velas no mercado à vista agora. Para sinais ao vivo e confluências ativas, selecione Criptomoedas como BTC/USD ou ETH/USD, que operam 24 horas por dia!`;
      } else if (lower.includes('notic') || lower.includes('notíc') || lower.includes('calend') || lower.includes('impacto')) {
        const topNews = realNewsList[0];
        if (topNews) {
          fallbackText = `Banco de Notícias Reais TradingView: "${topNews.title}" (${topNews.source}). ${topNews.summary}`;
        } else if (upcomingHighImpact) {
          fallbackText = `Próxima notícia de alto impacto para ${asset.symbol}: ${upcomingHighImpact.event} (${upcomingHighImpact.currency}) agendada para ${upcomingHighImpact.time}. Impacto alto. Evite operar nos 5 minutos antes e depois.`;
        } else {
          fallbackText = `Não há notícias de alto impacto imediatas previstas para os próximos minutos em ${asset.symbol}. O mercado técnico no TradingView está limpo para confluências.`;
        }
      } else if (lower.includes('resistencia') || lower.includes('resistência')) {
        const supList = marketAnalysis.keyLevels?.filter((k) => k.type === 'SUPPORT').map((k) => k.price.toFixed(asset.pipDecimals)) || [];
        const resList = marketAnalysis.keyLevels?.filter((k) => k.type === 'RESISTANCE').map((k) => k.price.toFixed(asset.pipDecimals)) || [];
        fallbackText = `🎯 Níveis Chave de ${asset.symbol}:\n• Resistência Mais Próxima: ${resList[0] || (asset.currentPrice * 1.002).toFixed(asset.pipDecimals)}\n• Suporte Mais Próximo: ${supList[0] || (asset.currentPrice * 0.998).toFixed(asset.pipDecimals)}\n• Preço Atual: ${asset.currentPrice.toFixed(asset.pipDecimals)} (Tendência: ${marketAnalysis.trend})`;
      } else {
        const supList = marketAnalysis.keyLevels?.filter((k) => k.type === 'SUPPORT').map((k) => k.price.toFixed(asset.pipDecimals)) || [];
        const resList = marketAnalysis.keyLevels?.filter((k) => k.type === 'RESISTANCE').map((k) => k.price.toFixed(asset.pipDecimals)) || [];
        fallbackText = `Análise TradingView de ${asset.symbol} (${asset.tvSymbol}): Tendência ${marketAnalysis.trend}. Força compradora ${marketAnalysis.buyerStrength} e vendedora ${marketAnalysis.sellerStrength}.\n• Resistência Imediata: ${resList[0] || 'Zonas dinâmicas'}\n• Suporte Imediato: ${supList[0] || 'Zonas dinâmicas'}\n• Todas Resistências: ${resList.length > 0 ? resList.join(', ') : 'Zonas dinâmicas'}\n• Todos Suportes: ${supList.length > 0 ? supList.join(', ') : 'Zonas dinâmicas'}\nConfluência técnica de ${confluences.totalScore}% para ${confluences.direction}.`;
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `model-${Date.now()}`,
          role: 'model' as const,
          text: fallbackText,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Placar do Dia (Hoje) - Estatísticas dinâmicas dos sinais de hoje
  const todayDateString = useMemo(() => {
    return new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }, []);

  const todaySignals = useMemo(() => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const curDate = now.getDate();
    return signalsHistory.filter((s) => {
      const d = new Date(s.resolvedAt || s.timestamp);
      return (
        d.getDate() === curDate &&
        d.getMonth() === curMonth &&
        d.getFullYear() === curYear
      );
    });
  }, [signalsHistory]);

  const todayWins = todaySignals.filter((s) => s.result === 'WIN').length;
  const todayLosses = todaySignals.filter((s) => s.result === 'LOSS').length;
  const todayTies = todaySignals.filter((s) => s.result === 'EMPATE').length;
  const totalFinishedToday = todayWins + todayLosses;
  const todayWinRate = totalFinishedToday > 0 ? ((todayWins / totalFinishedToday) * 100).toFixed(1) : '100.0';

  const nowSec = Math.floor(Date.now() / 1000);

  // Operação em andamento (inicia estritamente a partir da abertura da vela do sinal!)
  const isTradeRunning = !!activeTrade && activeTrade.result === 'PENDING' && (!activeTrade.entryTimestamp || nowSec >= activeTrade.entryTimestamp);
  const remainingExpSec = isTradeRunning ? Math.max(0, (activeTrade?.expirationTimestamp || 0) - nowSec) : 0;
  const expMins = Math.floor(remainingExpSec / 60);
  const expSecs = remainingExpSec % 60;
  const formattedExpCountdown = `${String(expMins).padStart(2, '0')}:${String(expSecs).padStart(2, '0')}`;

  // Se o cronômetro zerou (00:00) na tela E a operação cumpriu seu tempo integral, aciona a apuração no fechamento
  useEffect(() => {
    if (
      activeTrade &&
      activeTrade.result === 'PENDING' &&
      isTradeRunning &&
      activeTrade.expirationTimestamp &&
      nowSec >= activeTrade.expirationTimestamp &&
      remainingExpSec <= 0
    ) {
      const expSec = (activeTrade.timeframe === 'M2' || activeTrade.expiration === '2m') ? 120 : ((activeTrade.timeframe === 'M1' || activeTrade.expiration === '1m') ? 60 : 300);
      const tradeElapsed = activeTrade.entryTimestamp ? (nowSec - activeTrade.entryTimestamp) : Math.floor((Date.now() - activeTrade.timestamp) / 1000);
      if (tradeElapsed >= expSec - 3) {
        signalEngine.forceResolveTrade(activeTrade.id, asset.currentPrice, marketDataManager.getCandles());
      }
    }
  }, [activeTrade, isTradeRunning, remainingExpSec, asset.currentPrice, nowSec]);

  // Confirmação recente aguardando a abertura da vela do sinal
  const isWaitingEntry = !!latestConfirmedSignal && !isTradeRunning && (
    (latestConfirmedSignal.entryTimestamp ? nowSec < latestConfirmedSignal.entryTimestamp : Date.now() - latestConfirmedSignal.timestamp < 15000)
  );
  const secondsToCandleOpen = latestConfirmedSignal?.entryTimestamp ? Math.max(0, latestConfirmedSignal.entryTimestamp - nowSec) : remainingSeconds;

  // Live PnL check during active trade
  const isCallTrade = activeTrade?.direction === 'CALL';
  const tradeRefOpen = (currentCandle && activeTrade?.entryTimestamp && Math.abs(currentCandle.time - activeTrade.entryTimestamp) < 20 && currentCandle.open > 0)
    ? currentCandle.open
    : (activeTrade?.candleOpenPrice || activeTrade?.entryPrice || 0);
  const livePrice = currentCandle?.close || asset.currentPrice;
  const isWinning = isTradeRunning
    ? isCallTrade
      ? livePrice > tradeRefOpen
      : livePrice < tradeRefOpen
    : false;
  const isTied = isTradeRunning ? livePrice === tradeRefOpen : false;
  const diffPips = isTradeRunning && activeTrade
    ? Math.abs(livePrice - tradeRefOpen) * (asset.pipDecimals === 5 ? 10000 : 100)
    : 0;

  // Has recently resolved trade (exibe por 7 segundos completos para visualização clara do WIN/LOSS)
  const hasResolvedTrade = !!lastResolvedTrade && Date.now() - (lastResolvedTrade.resolvedAt || lastResolvedTrade.timestamp || 0) < 7000;

  // Has recently cancelled signal (within 4 seconds)
  const hasCancelledSignal = !!lastCancelledSignal && Date.now() - (lastCancelledSignal.cancelledAt || lastCancelledSignal.timestamp || 0) < 4000;

  // Confirmed signal entry window
  const hasConfirmed = isWaitingEntry;
  const hasPreAlert = !!activePreAlert && !isWaitingEntry && !isTradeRunning;

  // Format candle countdown string MM:SS
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formattedCountdown = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Card header styling based on alert state
  let alertBadgeClass = 'text-neutral-400 bg-neutral-900 border-neutral-700/60';
  let alertStatusText = 'MONITORANDO MERCADO';
  let glowBorderClass = 'border-cyan-500/25';

  if (isTradeRunning && activeTrade) {
    alertStatusText = `⏳ OPERAÇÃO ABERTA • AGUARDANDO RESULTADO (${activeTrade.direction})`;
    alertBadgeClass = isWinning
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 animate-pulse'
      : 'bg-rose-500/20 text-rose-300 border-rose-500/60 animate-pulse';
    glowBorderClass = isWinning ? 'glow-call border-emerald-500/60' : 'glow-put border-rose-500/60';
  } else if (hasConfirmed && latestConfirmedSignal) {
    alertStatusText = `🚀 CONFIRMADO [ENTRADA EM 00:${String(secondsToCandleOpen).padStart(2, '0')}s]`;
    alertBadgeClass = latestConfirmedSignal.direction === 'CALL'
      ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400 animate-pulse shadow-sm'
      : 'bg-rose-500/25 text-rose-300 border-rose-400 animate-pulse shadow-sm';
    glowBorderClass = latestConfirmedSignal.direction === 'CALL' ? 'glow-call border-emerald-500/60' : 'glow-put border-rose-500/60';
  } else if (hasResolvedTrade && lastResolvedTrade) {
    if (lastResolvedTrade.result === 'WIN') {
      alertStatusText = '🏆 VITÓRIA (WIN)!';
      alertBadgeClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 animate-pulse';
      glowBorderClass = 'glow-call border-emerald-500/60';
    } else if (lastResolvedTrade.result === 'LOSS') {
      alertStatusText = '❌ OPERAÇÃO FINALIZADA: LOSS';
      alertBadgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/60 animate-pulse';
      glowBorderClass = 'glow-put border-rose-500/60';
    } else {
      alertStatusText = '⚪ OPERAÇÃO FINALIZADA: EMPATE';
      alertBadgeClass = 'bg-neutral-800 text-neutral-300 border-neutral-700';
    }
  } else if (hasCancelledSignal && lastCancelledSignal) {
    alertStatusText = '🛡️ CANCELADO [PROTEÇÃO DE BANCA]';
    alertBadgeClass = 'bg-rose-500/25 text-rose-300 border-rose-500/70 shadow-sm';
    glowBorderClass = 'glow-put border-rose-500/50';
  } else if (hasPreAlert && activePreAlert) {

    alertStatusText = `⚡ PRÉ-ALERTA: ${activePreAlert.direction} (ABERTURA EM ${formattedCountdown})`;
    alertBadgeClass = 'bg-amber-500/25 text-amber-300 border-amber-500/70 animate-pulse shadow-sm';
    glowBorderClass = 'glow-alert border-amber-500/50';
  } else if (confluences.classification === 'CONFLUÊNCIA MUITO FORTE') {
    alertStatusText = 'VARREDURA INSTITUCIONAL: ALTA FORÇA';
    alertBadgeClass = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50';
  }

  // Active directional hero selection
  const activeDirection = activeTrade?.direction || latestConfirmedSignal?.direction || activePreAlert?.direction || lastCancelledSignal?.direction || null;
  const isCall = activeDirection === 'CALL';
  const isPut = activeDirection === 'PUT';

  // Copy signal to clipboard
  const handleCopySignal = () => {
    const dir = isCall ? 'CALL (COMPRA) ↗' : isPut ? 'PUT (VENDA) ↘' : confluences.direction;
    const signalTime = activeTrade?.entryTimeFormatted || latestConfirmedSignal?.entryTimeFormatted || activePreAlert?.entryTimeFormatted || formatBrasiliaTime();
    const text = `🎯 CLANDEX-IA SIGNAL
📊 Par: ${asset.symbol}
⏱️ Timeframe: ${timeframe}
⏳ Expiração: ${expiration}
📈 Direção: ${dir}
💵 Cotação: ${asset.currentPrice.toFixed(asset.pipDecimals)}
⭐ Confluência: ${confluences.totalScore}% (${confluences.classification})
📅 Placar Hoje: ${todayWins} WIN x ${todayLosses} LOSS (${todayWinRate}%)
⏰ Horário da Entrada: ${signalTime} (Horário Oficial de Brasília - BRT)`;
    try {
      navigator.clipboard.writeText(text);
      setCopiedSignal(true);
      setTimeout(() => setCopiedSignal(false), 2000);
    } catch { }
  };

  if (isClosed) {
    return (
      <button
        onClick={() => setIsClosed(false)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-neutral-900/90 border border-cyan-500/50 rounded-xl text-cyan-300 font-medium text-xs shadow-2xl backdrop-blur-md hover:bg-neutral-800 transition-all glow-cyan cursor-pointer"
      >
        <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
        Restaurar Painel ClandeX-IA
      </button>
    );
  }

  return (
    <div
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className={`fixed z-40 w-[390px] sm:w-[410px] md:w-[420px] max-w-[98vw] bg-neutral-950/95 backdrop-blur-xl border rounded-2xl shadow-2xl transition-shadow duration-300 select-none overflow-hidden ${glowBorderClass}`}
    >
      {/* HUD Draggable Titlebar - Ajustado com precisão milimétrica, sem estourar para fora */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between px-3 py-2 bg-neutral-900/90 border-b border-neutral-800/80 rounded-t-2xl cursor-grab active:cursor-grabbing gap-2 select-none"
      >
        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isDepositLocked ? 'bg-amber-400 animate-pulse' : 'bg-cyan-400 animate-ping'}`} />
          <span className="font-extrabold tracking-wider text-xs text-white whitespace-nowrap">CLANDEX-IA</span>
          {isDepositLocked ? (
            <span className="text-[10px] text-amber-300 font-mono font-bold bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/40 flex items-center gap-1 whitespace-nowrap">
              <Lock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
              <span>DEPÓSITO PENDENTE</span>
            </span>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-cyan-300 font-mono font-bold bg-cyan-950/70 px-1.5 py-0.5 rounded border border-cyan-500/40 whitespace-nowrap">
                {asset.symbol} • {timeframe}
              </span>
              <span
                title="Horário Oficial de Brasília (BRT - UTC-3)"
                className="hidden xs:inline-flex sm:inline-flex items-center gap-1 text-[10px] text-cyan-200 font-mono font-bold bg-black/60 px-1.5 py-0.5 rounded border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.2)] whitespace-nowrap"
              >
                <Clock className="w-2.5 h-2.5 text-cyan-400 animate-pulse shrink-0" />
                <span>{currentBrasiliaClock} BRT</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-neutral-400">
          {/* Botão rápido para Voltar ao Login */}
          {isDepositLocked && (
            <button
              onClick={handlePerformLogout}
              title="Voltar ao Login (Trocar E-mail)"
              className="w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-neutral-400 hover:text-amber-300" />
            </button>
          )}

          <button
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expandir' : 'Minimizar'}
            className="w-6 h-6 flex items-center justify-center hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsClosed(true)}
            title="Fechar Painel"
            className="w-6 h-6 flex items-center justify-center hover:text-rose-400 rounded hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Minimized Quick Bar with Placar do Dia & Live Timer */}
      {isMinimized ? (
        <div className="p-3 flex items-center justify-between text-xs">
          {isDepositLocked ? (
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="font-mono font-bold text-amber-300 text-[11px]">
                DEPÓSITO PENDENTE ($10 HIOVE)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-white">{asset.symbol}</span>
              <span className="text-[11px] font-mono text-cyan-400">{timeframe}</span>
              {/* Placar do Dia Compacto */}
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-[10px] font-mono font-bold flex items-center gap-1">
                <span className="text-emerald-400">{todayWins}W</span>
                <span className="text-neutral-500">x</span>
                <span className="text-rose-400">{todayLosses}L</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            {!isDepositLocked && (
              isTradeRunning ? (
                <span className="text-amber-300 font-mono font-bold text-[11px] flex items-center gap-1 bg-amber-950/40 border border-amber-500/40 px-2 py-0.5 rounded-lg animate-pulse">
                  <Clock className="w-3 h-3 text-amber-400" />
                  {formattedExpCountdown}
                </span>
              ) : (
                <span className="font-mono text-neutral-300 text-xs">{formattedCountdown}</span>
              )
            )}
            <button
              onClick={() => setIsMinimized(false)}
              className="text-neutral-400 hover:text-white p-1 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : isDepositLocked ? (
        /* ========================================================
           TELA DE BLOQUEIO POR FALTA DE DEPÓSITO MÍNIMO ($10)
           O usuário NÃO tem acesso a nenhuma aba (Sinais, Técnica, Voz 3D, Chat)
           Exibe APENAS: Cadeado, Botão Voltar ao Login e Ativação do Depósito
           ======================================================== */
        <div className="p-5 flex flex-col items-center text-center space-y-4">
          {/* Top Animated Padlock */}
          <div className="relative mt-1">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-b from-amber-500/20 via-amber-950/30 to-black border-2 border-amber-500/60 shadow-[0_0_35px_rgba(245,158,11,0.4)] flex items-center justify-center">
              <Lock className="w-8 h-8 text-amber-300 stroke-[2.5] animate-pulse" />
            </div>
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 animate-ping opacity-75" />
          </div>

          {/* Title & Status */}
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[10px] font-mono font-black text-amber-300 tracking-wider uppercase">
              <span>●</span>
              <span>Ativação Requerida</span>
            </div>
            <h3 className="text-sm font-black font-mono tracking-wider text-white">
              FERRAMENTA BLOQUEADA
            </h3>
            <p className="text-[11px] font-mono text-neutral-400">
              Conta Hiove: <strong className="text-cyan-300">{userSession?.email || 'Cadastrada'}</strong>
            </p>
          </div>

          {/* Notice Card */}
          <div className="w-full p-3 bg-neutral-900/80 border border-amber-500/30 rounded-xl space-y-2 text-left">
            <p className="text-[11px] font-mono leading-relaxed text-neutral-300 text-center">
              Sua conta na corretora Hiove foi identificada! Para liberar o acesso às abas de <strong className="text-white">Sinais M1/M2/M5</strong>, <strong className="text-white">Análise Técnica</strong>, <strong className="text-white">IA Voz 3D</strong>, <strong className="text-white">Chat</strong> e <strong className="text-white">Configurações</strong>, realize o depósito mínimo de <strong className="text-amber-400 font-bold">$10 USD</strong> na Hiove.
            </p>

            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] font-mono text-neutral-400">
              <div className="p-1.5 bg-black/50 rounded border border-neutral-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Aba Sinal: Bloqueada</span>
              </div>
              <div className="p-1.5 bg-black/50 rounded border border-neutral-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Aba Técnica: Bloqueada</span>
              </div>
              <div className="p-1.5 bg-black/50 rounded border border-neutral-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Aba Voz 3D: Bloqueada</span>
              </div>
              <div className="p-1.5 bg-black/50 rounded border border-neutral-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Chat & Config: Bloqueado</span>
              </div>
            </div>
          </div>

          {/* Alerts if any */}
          {depositCheckSuccess && (
            <div className="w-full p-2.5 bg-emerald-950/60 border border-emerald-500/60 rounded-xl text-[11px] font-mono text-emerald-300 flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{depositCheckSuccess}</span>
            </div>
          )}
          {depositCheckError && (
            <div className="w-full p-2.5 bg-amber-950/60 border border-amber-500/60 rounded-xl text-[11px] font-mono text-amber-300 flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{depositCheckError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="w-full space-y-2 pt-1">
            {/* BOTÃO 1: ATIVAÇÃO DO DEPÓSITO */}
            <a
              href="https://hiove.io/gSBstV"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500 hover:from-amber-400 hover:via-emerald-400 hover:to-amber-400 text-neutral-950 font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.35)] transition-all cursor-pointer group active:scale-98 text-center"
            >
              <span>FAZER ATIVAÇÃO DO DEPÓSITO ($10 NA HIOVE)</span>
              <ExternalLink className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>

            {/* BOTÃO 2: VERIFICAR DEPÓSITO */}
            <button
              onClick={handleCheckDeposit}
              disabled={isCheckingDeposit}
              className="w-full py-2.5 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-cyan-400 text-cyan-300 font-mono font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isCheckingDeposit ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span>CONSULTANDO CORRETORA HIOVE...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>🔄 JÁ REALIZEI O DEPÓSITO • VERIFICAR AGORA</span>
                </>
              )}
            </button>

            {/* BOTÃO 3: VOLTAR AO LOGIN */}
            <button
              onClick={handlePerformLogout}
              className="w-full py-2.5 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-white font-mono font-semibold text-[11px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>← VOLTAR AO LOGIN (TROCAR E-MAIL)</span>
            </button>
          </div>

          <p className="text-[10px] font-mono text-neutral-500">
            O valor de $10 fica 100% disponível no seu saldo da Hiove para você operar.
          </p>
        </div>
      ) : (
        /* Expanded HUD Content with Clean Separate Tabs */
        <div>
          {/* Navigation Tabs Bar */}
          <div className="flex items-center px-2 pt-2 pb-1.5 border-b border-neutral-800/80 bg-neutral-950/70 gap-1">
            <button
              onClick={() => setActiveTab('sinal')}
              className={`flex-1 py-1.5 px-1 sm:px-1.5 rounded-lg font-mono text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'sinal'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Sinal</span>
              {isTradeRunning && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping shrink-0" />}
              {activePreAlert && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />}
              {hasConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />}
            </button>

            <button
              onClick={() => setActiveTab('analise')}
              className={`flex-1 py-1.5 px-1 sm:px-1.5 rounded-lg font-mono text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'analise'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Técnica</span>
            </button>

            <button
              onClick={() => setActiveTab('indicadores')}
              className={`flex-1 py-1.5 px-1 sm:px-1.5 rounded-lg font-mono text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'indicadores'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Indicadores</span>
              {indicatorConsensus.verdict.includes('COMPRA') && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
              )}
              {indicatorConsensus.verdict.includes('VENDA') && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping shrink-0" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('voz')}
              className={`flex-1 py-1.5 px-1 sm:px-1.5 rounded-lg font-mono text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'voz'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Voz 3D</span>
              {liveVoice && liveVoice.status !== 'idle' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 shrink-0" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 px-1 sm:px-1.5 rounded-lg font-mono text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'chat'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>Chat</span>
            </button>
          </div>

          {/* Persistent Live Voice Audio Dock: Active across all tabs when turned on */}
          {liveVoice && liveVoice.status !== 'idle' && (
            <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-cyan-950/90 via-[#0a1222] to-neutral-950 border-b border-cyan-500/30 text-[10px] font-mono">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${liveVoice.status === 'speaking'
                    ? 'bg-cyan-400 animate-ping'
                    : liveVoice.status === 'listening'
                      ? liveVoice.isMuted
                        ? 'bg-amber-400'
                        : 'bg-emerald-400 animate-pulse'
                      : 'bg-amber-400 animate-pulse'
                    }`}
                />
                <span className="font-bold text-white tracking-wide">
                  {liveVoice.status === 'speaking'
                    ? 'IA FALANDO...'
                    : liveVoice.status === 'listening'
                      ? liveVoice.isMuted
                        ? 'MIC MUTADO'
                        : 'IA OUVINDO...'
                      : 'CONECTANDO...'}
                </span>
                <div className="flex items-center gap-0.5 h-2.5">
                  {[6, 12, 16, 10, 6, 14, 8].map((h, i) => {
                    const lvl = liveVoice.status === 'speaking' ? liveVoice.aiSpeechLevel : liveVoice.micLevel;
                    const barH = Math.max(2.5, Math.round((h * Math.max(20, lvl)) / 100));
                    return (
                      <span
                        key={i}
                        className={`w-0.5 rounded-full transition-all duration-75 ${liveVoice.status === 'speaking' ? 'bg-cyan-400' : 'bg-emerald-400'
                          }`}
                        style={{ height: `${barH}px` }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {liveVoice.status === 'listening' && (
                  <button
                    onClick={liveVoice.toggleMute}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer ${liveVoice.isMuted
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:text-white'
                      }`}
                  >
                    {liveVoice.isMuted ? 'Desmutar' : 'Mutar'}
                  </button>
                )}
                <button
                  onClick={liveVoice.disconnectSession}
                  className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[9px] font-bold cursor-pointer transition-colors"
                >
                  DESLIGAR
                </button>
              </div>
            </div>
          )}

          <div className="p-3.5 space-y-3 text-xs max-h-[76vh] overflow-y-auto custom-scrollbar">
            {/* TAB 1: SINAL (ÁREA DO SINAL LIMPA E RESUMIDA COM PLACAR DO DIA) */}
            {activeTab === 'sinal' && (
              <div className="space-y-3">
                {/* AVISO DE MERCADO FOREX FECHADO NO FIM DE SEMANA (COM BOTÃO RÁPIDO PARA CRIPTO 24/7) */}
                {isForexClosed && (
                  <div className="p-3 bg-gradient-to-r from-rose-950/70 via-neutral-900 to-rose-950/70 border border-rose-500/60 rounded-2xl shadow-xl space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-rose-300 font-mono font-bold text-xs">
                        <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
                        <span>MERCADO FOREX FECHADO</span>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-rose-300 bg-rose-950 px-2 py-0.5 rounded-full border border-rose-500/50">
                        TRADINGVIEW FIM DE SEMANA
                      </span>
                    </div>

                    <p className="text-[10px] text-neutral-300 font-mono leading-relaxed">
                      O par <strong>{asset.symbol}</strong> fecha aos fins de semana (sexta 18h até domingo 18h BRT). A ClandeX-IA pausou novos sinais nesta paridade para proteger sua banca.
                    </p>

                    <button
                      onClick={() => onSelectAsset('BTC/USD')}
                      className="w-full py-2 px-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-neutral-950 font-mono font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-500/20 active:scale-[0.99]"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Alternar para BTC/USD (Cripto 24/7 Ativo)</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* 1. PLACAR DO DIA COM A DATA DE HOJE E QUANTIDADE DE WIN E LOSS */}
                <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl shadow-xl space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800/80">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white font-mono">
                      <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                      <span>PLACAR DO DIA</span>
                      <span className="text-[10px] text-cyan-400 font-semibold">({todayDateString})</span>
                      <button
                        onClick={() => signalEngine.clearHistory()}
                        title="Zerar placar do dia"
                        className="ml-1 text-neutral-400 hover:text-cyan-300 p-1 rounded hover:bg-neutral-800 transition-colors cursor-pointer flex items-center gap-0.5 text-[9px]"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span className="text-[8px] opacity-70">Zerar</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        title="Horário Oficial de Brasília (BRT - UTC-3)"
                        className="text-[10px] font-mono font-bold text-cyan-200 bg-black/60 px-2 py-0.5 rounded-lg border border-cyan-500/40 flex items-center gap-1 shadow-[0_0_8px_rgba(6,182,212,0.2)]"
                      >
                        <Clock className="w-2.5 h-2.5 text-cyan-400 animate-pulse" />
                        <span>{currentBrasiliaClock} BRT</span>
                      </span>
                      <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-500/40">
                        {todayWinRate}% ASSERTIVO
                      </span>
                    </div>
                  </div>

                  {/* Scoreboard Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2 text-center font-mono">
                    <div className="p-2 bg-emerald-950/25 border border-emerald-500/40 rounded-xl">
                      <span className="text-[9px] text-emerald-400/90 block font-bold uppercase tracking-wider">
                        WIN
                      </span>
                      <span className="font-extrabold text-base text-emerald-300 flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        {todayWins}
                      </span>
                    </div>

                    <div className="p-2 bg-rose-950/25 border border-rose-500/40 rounded-xl">
                      <span className="text-[9px] text-rose-400/90 block font-bold uppercase tracking-wider">
                        LOSS
                      </span>
                      <span className="font-extrabold text-base text-rose-300 flex items-center justify-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        {todayLosses}
                      </span>
                    </div>

                    <div className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl">
                      <span className="text-[9px] text-neutral-400 block font-bold uppercase tracking-wider">
                        TOTAL
                      </span>
                      <span className="font-bold text-base text-white">
                        {totalFinishedToday + todayTies}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. MAIN SIGNAL CARD (RESUMIDO COM EFEITOS VISUAIS TECNOLÓGICOS) */}
                <div
                  className={`p-3.5 rounded-2xl border transition-all duration-300 shadow-xl relative overflow-hidden backdrop-blur-md ${isTradeRunning
                    ? isWinning
                      ? 'bg-gradient-to-b from-emerald-950/60 via-[#07121b] to-black border-emerald-400/70 shadow-[0_0_25px_rgba(16,185,129,0.25)]'
                      : 'bg-gradient-to-b from-rose-950/60 via-[#180a12] to-black border-rose-500/70 shadow-[0_0_25px_rgba(244,63,94,0.25)]'
                    : hasResolvedTrade
                      ? lastResolvedTrade?.result === 'WIN'
                        ? 'bg-gradient-to-b from-emerald-950/50 via-[#061214] to-black border-emerald-400/70 shadow-[0_0_25px_rgba(16,185,129,0.3)]'
                        : 'bg-gradient-to-b from-rose-950/50 via-[#140810] to-black border-rose-500/70 shadow-[0_0_25px_rgba(244,63,94,0.3)]'
                      : hasConfirmed
                        ? latestConfirmedSignal?.direction === 'CALL'
                          ? 'bg-gradient-to-b from-emerald-950/50 via-[#07131a] to-black border-emerald-400/80 shadow-[0_0_30px_rgba(16,185,129,0.35)]'
                          : 'bg-gradient-to-b from-rose-950/50 via-[#180812] to-black border-rose-500/80 shadow-[0_0_30px_rgba(244,63,94,0.35)]'
                        : hasPreAlert
                          ? 'bg-gradient-to-b from-amber-950/50 via-[#140e07] to-black border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.25)]'
                          : 'bg-[#090e18]/90 border-cyan-500/25 shadow-inner'
                    }`}
                >
                  {/* Holographic background cyber line effect */}
                  <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:18px_18px] opacity-15 pointer-events-none" />

                  {/* Header do Card Tecnológico */}
                  <div className="flex items-center justify-between mb-2.5 relative z-10">
                    <span
                      className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-sm ${alertBadgeClass}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isTradeRunning
                          ? 'bg-cyan-400 animate-ping'
                          : hasConfirmed
                            ? 'bg-emerald-400 animate-ping'
                            : hasPreAlert
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-cyan-400 animate-pulse'
                          }`}
                      />
                      {alertStatusText}
                    </span>

                    {/* Copy signal button */}
                    <button
                      onClick={handleCopySignal}
                      title="Copiar dados do sinal"
                      className="flex items-center gap-1 text-[10px] font-mono text-cyan-300 hover:text-white px-2 py-0.5 rounded-lg bg-black/60 border border-cyan-500/40 hover:border-cyan-400 transition-all cursor-pointer backdrop-blur-sm"
                    >
                      {copiedSignal ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-cyan-400" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* ESTÁGIO 1: OPERAÇÃO EM ANDAMENTO (CRONÔMETRO DE EXPIRAÇÃO ATÉ O ZERO!) */}
                  {isTradeRunning && activeTrade ? (
                    <div className="space-y-2.5 relative z-10">
                      <div
                        className={`p-2.5 rounded-xl border flex items-center justify-between ${isCallTrade
                          ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
                          : 'bg-rose-500/15 border-rose-500/60 text-rose-300'
                          }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`p-2 rounded-lg ${isCallTrade ? 'bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 text-white shadow-[0_0_10px_rgba(244,63,94,0.5)]'
                              }`}
                          >
                            {isCallTrade ? (
                              <ArrowUpRight className="w-5 h-5 stroke-[3]" />
                            ) : (
                              <ArrowDownRight className="w-5 h-5 stroke-[3]" />
                            )}
                          </div>
                          <div>
                            <div className="text-[9px] uppercase font-bold tracking-wider text-cyan-400 animate-pulse flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                              <span>OPERAÇÃO ABERTA NA HIOVE • AGUARDANDO RESULTADO</span>
                            </div>
                            <div className="text-base font-black font-mono tracking-wide">
                              {isCallTrade ? 'CALL (COMPRA)' : 'PUT (VENDA)'}
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-[9px] opacity-75">EXPIRAÇÃO</div>
                          <div className="text-xs font-bold text-white">{activeTrade.expiration.toUpperCase()}</div>
                        </div>
                      </div>

                      {/* Horário Oficial da Compra/Venda e Preço Oficial de Abertura */}
                      <div className="p-2.5 bg-gradient-to-r from-cyan-950/70 via-black to-neutral-950 rounded-xl border border-cyan-500/50 space-y-1.5 font-mono shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-neutral-300">
                            <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                            <span className="font-bold text-neutral-400">Entrada (Brasília):</span>
                          </div>
                          <span className="text-cyan-300 font-black text-sm bg-black/80 px-2.5 py-0.5 rounded-lg border border-cyan-400/60 shadow-[0_0_10px_rgba(6,182,212,0.4)]">
                            {activeTrade.entryTimeFormatted || activeTrade.formattedTime} <span className="text-[10px] text-neutral-400">BRT</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-neutral-800 text-neutral-300">
                          <span>Abertura: <strong className="text-white">{(tradeRefOpen > 0 ? tradeRefOpen : (activeTrade.candleOpenPrice || activeTrade.entryPrice)).toFixed(asset.pipDecimals)}</strong></span>
                          <span>Término: <strong className="text-emerald-300">{activeTrade.expirationTimeFormatted || 'Fechamento'} BRT</strong></span>
                        </div>
                      </div>

                      {/* Estratégia Utilizada na Operação */}
                      {(activeTrade.strategyBadge || activeTrade.strategyName) && (
                        <div className="p-2 bg-black/60 rounded-xl border border-cyan-500/30 flex items-center justify-between text-[10px] font-mono">
                          <span className="text-neutral-400">Estratégia:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-cyan-300 font-bold">{activeTrade.strategyBadge || activeTrade.strategyName}</span>
                            {activeTrade.strategyWinRate !== undefined && activeTrade.strategyWinRate > 0 && (
                              <span className="text-[9px] text-emerald-400 bg-emerald-950/70 px-1.5 py-0.2 rounded border border-emerald-500/40 font-bold">
                                {activeTrade.strategyWinRate}% Backtest
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Cronômetro de Expiração Tecnológico */}
                      <div className="p-2.5 bg-black/70 rounded-xl border border-cyan-500/50 text-center space-y-0.5 shadow-[inset_0_0_15px_rgba(6,182,212,0.15)]">
                        <div className="flex items-center justify-center gap-1.5 text-[9px] font-mono text-cyan-400 uppercase tracking-wider font-bold">
                          <Clock className="w-3 h-3 animate-spin" />
                          <span>EXPIRAÇÃO AO VIVO:</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-cyan-300 tracking-wider">
                          {formattedExpCountdown}
                        </div>
                      </div>

                      {/* Status Dinâmico Resumido */}
                      <div
                        className={`p-1.5 rounded-lg text-center font-mono font-bold text-[11px] flex items-center justify-center gap-1.5 border ${remainingExpSec === 0
                          ? 'bg-cyan-950/50 border-cyan-500/60 text-cyan-300 animate-pulse'
                          : isWinning
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                            : isTied
                              ? 'bg-neutral-900 border-neutral-700 text-neutral-300'
                              : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                          }`}
                      >
                        {remainingExpSec === 0 ? (
                          <span>FECHAMENTO DA VELA • REGISTRANDO RESULTADO FINAL...</span>
                        ) : isWinning ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>NO LUCRO (WIN PROVISÓRIO) • +{diffPips.toFixed(1)} pips</span>
                          </>
                        ) : isTied ? (
                          <span>NO EMPATE • 0.0 pips</span>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            <span>NO PREJUÍZO (LOSS PROVISÓRIO) • -{diffPips.toFixed(1)} pips</span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : hasConfirmed && latestConfirmedSignal ? (
                    /* ESTÁGIO 2: ENTRADA CONFIRMADA NA ABERTURA DA VELA */
                    <div className="space-y-2.5 relative z-10 animate-in zoom-in-95 duration-200">
                      <div
                        className={`p-3 rounded-xl border flex items-center justify-between ${latestConfirmedSignal.direction === 'CALL'
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                          : 'bg-rose-500/25 border-rose-400 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                          }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`p-2 rounded-lg ${latestConfirmedSignal.direction === 'CALL' ? 'bg-emerald-400 text-black shadow-lg shadow-emerald-400/50' : 'bg-rose-500 text-white shadow-lg shadow-rose-500/50'
                              }`}
                          >
                            {latestConfirmedSignal.direction === 'CALL' ? (
                              <ArrowUpRight className="w-6 h-6 stroke-[3]" />
                            ) : (
                              <ArrowDownRight className="w-6 h-6 stroke-[3]" />
                            )}
                          </div>
                          <div>
                            <div className="text-[9px] uppercase font-bold tracking-wider text-emerald-300 animate-pulse flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              <span>SINAL CONFIRMADO!</span>
                            </div>
                            <div className="text-xl font-black font-mono tracking-wide text-white">
                              {latestConfirmedSignal.direction === 'CALL' ? 'CALL (COMPRA)' : 'PUT (VENDA)'}
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-[9px] opacity-75">EXPIRAÇÃO</div>
                          <div className="text-xs font-bold text-white">{latestConfirmedSignal.expiration.toUpperCase()}</div>
                        </div>
                      </div>

                      {/* Horário Oficial da Compra ou Venda (Horário de Brasília com Super Destaque) */}
                      <div className="p-3 bg-gradient-to-r from-cyan-950 via-[#0a1828] to-emerald-950 rounded-2xl border-2 border-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center justify-between font-mono">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-cyan-400 text-xs font-black uppercase tracking-wider">
                            <Clock className="w-4 h-4 animate-spin text-cyan-400" />
                            <span>ENTRADA NA VELA DAS:</span>
                          </div>
                          <div className="text-[10px] text-cyan-200/80 font-bold">
                            Horário Oficial de Brasília (BRT)
                          </div>
                        </div>
                        <div className="text-center px-4 py-1 bg-black/85 rounded-xl border-2 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.6)]">
                          <span className="text-2xl font-black text-cyan-300 tracking-wider font-mono">
                            {latestConfirmedSignal.entryTimeFormatted || latestConfirmedSignal.formattedTime}
                          </span>
                        </div>
                      </div>

                      {/* Contador até abertura da vela do sinal */}
                      <div className="p-2.5 bg-black/80 rounded-xl border border-cyan-500/50 text-center space-y-1 shadow-[inset_0_0_15px_rgba(6,182,212,0.2)]">
                        <div className="text-[10px] font-mono font-bold text-cyan-300 flex items-center justify-center gap-1.5 uppercase tracking-wider">
                          <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                          <span>CONFIRMADO FALTANDO 10s • ENTRADA EM:</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-white tracking-widest flex items-center justify-center gap-1">
                          <span className="text-cyan-400">00:</span>
                          <span className="text-emerald-400">{String(secondsToCandleOpen).padStart(2, '0')}</span>
                        </div>
                        <div className="text-[9.5px] font-mono text-neutral-200">
                          Prepare sua boleta na corretora. Clique às <strong className="text-cyan-300">{latestConfirmedSignal.entryTimeFormatted || latestConfirmedSignal.formattedTime} (Brasília)</strong> na abertura da vela!
                        </div>
                      </div>

                      <div className="p-2 bg-emerald-950/40 border border-emerald-500/40 rounded-xl flex items-center justify-between text-[11px] font-mono">
                        <span className="text-neutral-300">Preço Ref: <strong className="text-white">{latestConfirmedSignal.entryPrice.toFixed(asset.pipDecimals)}</strong></span>
                        <span className="text-emerald-400 font-bold">Confluência: {latestConfirmedSignal.confluenceScore}%</span>
                      </div>

                      {/* Identificação da Estratégia no Sinal Confirmado */}
                      {(latestConfirmedSignal.strategyBadge || latestConfirmedSignal.strategyName) && (
                        <div className="p-2 bg-black/70 rounded-xl border border-cyan-400/40 flex items-center justify-between text-[10px] font-mono shadow-sm">
                          <span className="text-neutral-400 font-medium">Estratégia:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-cyan-300 font-black">{latestConfirmedSignal.strategyBadge || latestConfirmedSignal.strategyName}</span>
                            {latestConfirmedSignal.strategyWinRate !== undefined && latestConfirmedSignal.strategyWinRate > 0 && (
                              <span className="text-[9px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/50 font-black">
                                {latestConfirmedSignal.strategyWinRate}% Backtest
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : hasResolvedTrade && lastResolvedTrade ? (
                    /* ESTÁGIO 3: RESULTADO APURADO (DURAÇÃO DE 7s COM APURAÇÃO EXATA) */
                    <div className="space-y-2 py-1 relative z-10 animate-in fade-in zoom-in-95 duration-200">
                      <div
                        className={`p-3 rounded-xl border text-center space-y-1.5 ${lastResolvedTrade.result === 'WIN'
                          ? 'bg-emerald-950/40 border-emerald-500/70 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                          : lastResolvedTrade.result === 'LOSS'
                            ? 'bg-rose-950/40 border-rose-500/70 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.3)]'
                            : 'bg-neutral-900 border-neutral-700 text-neutral-300'
                          }`}
                      >
                        <div className="text-base font-black font-mono tracking-wider flex items-center justify-center gap-2">
                          {lastResolvedTrade.result === 'WIN' ? (
                            <>
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 animate-bounce" />
                              <span>VITÓRIA CONFIRMADA (WIN)!</span>
                            </>
                          ) : lastResolvedTrade.result === 'LOSS' ? (
                            <>
                              <XCircle className="w-5 h-5 text-rose-400" />
                              <span>OPERAÇÃO FINALIZADA: LOSS</span>
                            </>
                          ) : (
                            <span>OPERAÇÃO EMPATADA</span>
                          )}
                        </div>

                        <div className="flex items-center justify-center gap-3 text-[11px] font-mono text-neutral-200 bg-black/40 py-1.5 px-3 rounded-lg border border-white/10">
                          <span>Abertura da Vela: <strong>{(lastResolvedTrade.candleOpenPrice || lastResolvedTrade.entryPrice).toFixed(asset.pipDecimals)}</strong></span>
                          <span>➔</span>
                          <span>Fechamento da Vela: <strong>{(lastResolvedTrade.candleClosePrice || lastResolvedTrade.exitPrice || asset.currentPrice).toFixed(asset.pipDecimals)}</strong></span>
                        </div>

                        <div className="p-2.5 bg-gradient-to-r from-cyan-950/70 via-black to-neutral-950 rounded-xl border border-cyan-500/50 flex items-center justify-between font-mono shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                          <div className="flex items-center gap-1.5 text-neutral-300">
                            <Clock className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-[11px] text-neutral-400 font-bold">Entrada (Brasília):</span>
                            <span className="text-cyan-300 font-black text-xs bg-black/80 px-2 py-0.5 rounded border border-cyan-400/50 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                              {lastResolvedTrade.entryTimeFormatted || lastResolvedTrade.formattedTime}
                            </span>
                          </div>
                          <span className="text-[11px] text-neutral-300">Duração: <strong className="text-white">{lastResolvedTrade.expiration.toUpperCase()}</strong></span>
                        </div>

                        {/* Estratégia do Trade Resolvido */}
                        {(lastResolvedTrade.strategyBadge || lastResolvedTrade.strategyName) && (
                          <div className="p-2 bg-black/60 rounded-xl border border-neutral-800 flex items-center justify-between text-[10px] font-mono">
                            <span className="text-neutral-400">Estratégia:</span>
                            <span className="text-cyan-300 font-bold">{lastResolvedTrade.strategyBadge || lastResolvedTrade.strategyName}</span>
                          </div>
                        )}

                        <div className="text-[10px] font-mono text-cyan-300 font-bold flex items-center justify-center gap-1.5 pt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                          <span>{lastResolvedTrade.result === 'WIN' ? '+1 WIN no Placar' : '+1 LOSS no Placar'} • Resultado apurado com precisão</span>
                        </div>
                      </div>
                    </div>
                  ) : hasCancelledSignal && lastCancelledSignal ? (
                    /* ESTÁGIO 4: SINAL CANCELADO (PROTEÇÃO DE BANCA - DURAÇÃO DE 5s) */
                    <div className="space-y-2 py-1 relative z-10 animate-in fade-in duration-200">
                      <div className="p-2.5 bg-rose-500/15 border border-rose-500/60 rounded-xl text-rose-300 flex items-center justify-between shadow-[0_0_15px_rgba(244,63,94,0.25)]">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-rose-500 text-white">
                            <ShieldAlert className="w-5 h-5 stroke-[2.5]" />
                          </div>
                          <div>
                            <div className="text-[9px] uppercase font-bold tracking-wider text-rose-400">
                              PROTEÇÃO DE BANCA (CONFIRMAÇÃO ABORTADA)
                            </div>
                            <div className="text-sm font-black font-mono tracking-wide text-white">
                              SINAL CANCELADO • NÃO ENTRAR
                            </div>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/40">
                          5s auto-limpeza
                        </span>
                      </div>

                      <div className="p-2 bg-black/60 border border-rose-500/30 rounded-xl text-[10px] font-mono text-neutral-300">
                        <div className="text-rose-400 font-bold mb-0.5 flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          <span>Motivo da Invalidação:</span>
                        </div>
                        <div>{lastCancelledSignal.cancelReason || 'Confluência insuficiente na abertura. Ordem abortada.'}</div>
                      </div>
                    </div>
                  ) : hasPreAlert && activePreAlert ? (
                    /* ESTÁGIO 5: PRÉ-ALERTA GERADO PELA IA (COM CONFLUÊNCIAS TÉCNICAS E CONTAGEM) */
                    <div className="space-y-2.5 relative z-10 animate-in fade-in duration-200">
                      <div className="p-3 bg-amber-500/20 border border-amber-500/60 rounded-xl text-amber-300 flex items-center justify-between shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-amber-500 text-black shadow-lg shadow-amber-500/40">
                            {activePreAlert.direction === 'CALL' ? (
                              <ArrowUpRight className="w-5 h-5 stroke-[3]" />
                            ) : (
                              <ArrowDownRight className="w-5 h-5 stroke-[3]" />
                            )}
                          </div>
                          <div>
                            <div className="text-[9px] uppercase font-bold tracking-wider text-amber-400 animate-pulse">
                              PRÉ-ALERTA DA IA • CONFIRMAÇÃO FALTANDO 10s
                            </div>
                            <div className="text-lg font-black font-mono tracking-wide text-white">
                              {activePreAlert.direction === 'CALL' ? 'CALL (COMPRA)' : 'PUT (VENDA)'}
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-[9px] opacity-75">EXPIRAÇÃO</div>
                          <div className="text-xs font-bold text-white">{activePreAlert.expiration.toUpperCase()}</div>
                        </div>
                      </div>

                      {/* Horário Previsto da Compra/Venda (Horário de Brasília com Destaque) */}
                      <div className="p-2.5 bg-gradient-to-r from-amber-950/70 via-black to-neutral-950 rounded-2xl border-2 border-amber-500/60 flex items-center justify-between font-mono shadow-[0_0_15px_rgba(245,158,11,0.25)]">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider">
                            <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                            <span>ENTRADA PREVISTA (BRT):</span>
                          </div>
                          <div className="text-[10px] text-amber-200/80 font-bold">
                            Horário de Brasília • Confirma aos 10s
                          </div>
                        </div>
                        <div className="px-3.5 py-1 bg-black/85 rounded-xl border border-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.4)]">
                          <span className="text-xl font-black text-amber-300 font-mono tracking-wider">
                            {activePreAlert.entryTimeFormatted || 'Próxima Vela'}
                          </span>
                        </div>
                      </div>

                      {/* Identificação da Estratégia no Pré-Alerta */}
                      {(activePreAlert.strategyBadge || activePreAlert.strategyName) && (
                        <div className="p-2 bg-black/70 rounded-xl border border-amber-500/40 flex items-center justify-between text-[10px] font-mono shadow-sm">
                          <span className="text-neutral-400 font-medium">Estratégia:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-amber-300 font-black">{activePreAlert.strategyBadge || activePreAlert.strategyName}</span>
                            {activePreAlert.strategyWinRate !== undefined && activePreAlert.strategyWinRate > 0 && (
                              <span className="text-[9px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/50 font-black">
                                {activePreAlert.strategyWinRate}% Backtest
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Contagem regressiva até a confirmação nos 10s finais */}
                      <div className="p-2.5 bg-black/80 border border-amber-500/50 rounded-xl text-center space-y-1 shadow-[inset_0_0_15px_rgba(245,158,11,0.15)]">
                        <div className="text-[10px] font-mono text-amber-300 uppercase font-bold flex items-center justify-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                          <span>CONFIRMAÇÃO NOS 10s FINAIS EM:</span>
                        </div>
                        <div className="text-2xl font-black font-mono text-white tracking-widest flex items-center justify-center gap-1">
                          <span className="text-amber-400">{formattedCountdown}</span>
                        </div>
                        <div className="text-[9.5px] text-neutral-200 font-mono">
                          Prepare sua boleta. Se o padrão confirmar faltando 10s, o alarme tocará para entrada às <strong className="text-amber-300">{activePreAlert.entryTimeFormatted || '00:00'} (Brasília)</strong>.
                        </div>
                      </div>

                      {/* Botão de Cancelamento de Pré-Alerta */}
                      <div className="pt-1">
                        <button
                          onClick={() => signalEngine.cancelPreAlert('Cancelado pelo operador.')}
                          className="w-full py-2 px-3 rounded-xl bg-rose-950/30 hover:bg-rose-900/50 border border-rose-500/40 text-rose-300 font-mono text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span>CANCELAR PRÉ-ALERTA</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ESTÁGIO 6: MONITORAMENTO DO MERCADO EM TEMPO REAL */
                    <div className="py-7 px-4 text-center space-y-3 relative z-10 flex flex-col items-center justify-center min-h-[160px] overflow-hidden">
                      {isDepositLocked ? (
                        /* ESTÁGIO DE CADEADO: CONTA CADASTRADA MAS SEM DEPÓSITO */
                        <div className="space-y-3 relative z-10 flex flex-col items-center justify-center p-2">
                          <div className="relative flex items-center justify-center">
                            <div className="w-13 h-13 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                              <Lock className="w-6 h-6 text-amber-300 stroke-[2.5] animate-pulse" />
                            </div>
                            <div className="absolute -inset-1.5 rounded-full border border-amber-500/30 animate-pulse pointer-events-none" />
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs font-black font-mono tracking-wider text-amber-300 flex items-center justify-center gap-1.5">
                              <Lock className="w-3.5 h-3.5 text-amber-400" />
                              <span>FERRAMENTA COM CADEADO</span>
                            </div>
                            <div className="text-[10px] font-mono text-neutral-300 max-w-[280px] leading-relaxed">
                              Conta Hiove vinculada! Para ativar o algoritmo de sinais e confluências, realize o depósito mínimo de <strong className="text-amber-300">$10 USD</strong> na corretora.
                            </div>
                          </div>

                          <button
                            onClick={() => setIsDepositModalOpen(true)}
                            className="py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-mono font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer active:scale-98"
                          >
                            <span>LIBERAR COM DEPÓSITO ($10) ↗</span>
                          </button>
                        </div>
                      ) : isAnalyzing ? (
                        <>
                          {/* Laser scanning line effect */}
                          <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] animate-pulse pointer-events-none" />

                          {/* Sonar / Radar Pulse Rings */}
                          <div className="relative flex items-center justify-center">
                            <div className="w-14 h-14 rounded-full bg-cyan-500/15 border border-cyan-400/60 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                              <Activity className="w-6 h-6 animate-pulse" />
                            </div>
                            <div className="absolute inset-0 rounded-full border border-cyan-400/50 animate-ping pointer-events-none" style={{ animationDuration: '2s' }} />
                            <div className="absolute -inset-2 rounded-full border border-cyan-500/20 animate-pulse pointer-events-none" />
                          </div>

                          <div className="space-y-1">
                            <div className="text-sm font-black font-mono tracking-wider text-cyan-300 flex items-center justify-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                              <span>ANALISANDO MERCADO...</span>
                            </div>
                            <div className="text-[10px] font-mono text-neutral-300">
                              Monitorando <strong className="text-white">{asset.symbol}</strong> ({timeframe}) em frequência contínua
                            </div>
                            <div className="text-[9px] font-mono text-cyan-400/80">
                              Aguardando confluência com alta probabilidade...
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Standby State */}
                          <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-700/80 flex items-center justify-center text-neutral-400 shadow-inner">
                            <Activity className="w-5 h-5 text-neutral-500" />
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs font-bold font-mono tracking-wider text-neutral-300">
                              ANÁLISE PAUSADA
                            </div>
                            <div className="text-[10px] font-mono text-neutral-400 max-w-[240px]">
                              Clique em <strong>INICIAR ANÁLISE</strong> abaixo para a IA monitorar o mercado em frequência contínua até achar uma probabilidade.
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Webhook notification badge */}
                  {settings.webhook?.enabled && (
                    <div className="mt-2 flex items-center justify-between px-2.5 py-1 bg-emerald-950/30 border border-emerald-500/30 rounded-lg text-[9px] font-mono text-emerald-300 relative z-10">
                      <div className="flex items-center gap-1.5">
                        <Send className="w-2.5 h-2.5 text-emerald-400" />
                        <span>Webhook de Automação: Ativo</span>
                      </div>
                      <span className="opacity-80">Automático</span>
                    </div>
                  )}
                </div>

                {/* 3. BOTÃO DE INICIAR / PARAR ANÁLISE (OU CADEADO DE DEPÓSITO) */}
                <div className="pt-1">
                  {isDepositLocked ? (
                    <button
                      onClick={() => setIsDepositModalOpen(true)}
                      className="w-full relative group overflow-hidden py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-mono font-black text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 shadow-[0_0_25px_rgba(245,158,11,0.45)] hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer border-2 border-amber-400"
                    >
                      <Lock className="w-4 h-4 fill-current stroke-[2.5] text-neutral-950 animate-pulse" />
                      <span>🔒 ATIVAÇÃO BLOQUEADA (DEPÓSITO MÍNIMO $10)</span>
                    </button>
                  ) : isAnalyzing ? (
                    <button
                      onClick={onToggleAnalysis}
                      className="w-full relative group overflow-hidden py-3.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-500 text-white font-mono font-black text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 shadow-[0_0_25px_rgba(244,63,94,0.45)] hover:shadow-[0_0_35px_rgba(244,63,94,0.7)] hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer border border-rose-400"
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                      <Square className="w-4 h-4 fill-current stroke-[2]" />
                      <span>PARAR ANÁLISE</span>
                    </button>
                  ) : (
                    <button
                      onClick={onToggleAnalysis}
                      className="w-full relative group overflow-hidden py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-cyan-400 hover:from-cyan-400 hover:to-emerald-400 text-neutral-950 font-mono font-black text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2.5 shadow-[0_0_25px_rgba(6,182,212,0.45)] hover:shadow-[0_0_35px_rgba(16,185,129,0.7)] hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer border border-cyan-300"
                    >
                      <Play className="w-4 h-4 fill-current stroke-[2]" />
                      <span>INICIAR ANÁLISE</span>
                    </button>
                  )}
                </div>
              </div>
            )}



            {/* TAB 2: PÁGINA TÉCNICA - SELEÇÃO DE ATIVO / TIMEFRAME E INDICADORES ESTRUTURADOS */}
            {activeTab === 'analise' && (
              <div className="space-y-3">
                {/* 1. SELEÇÃO DE ATIVO E TIMEFRAME (APENAS ESTES CONTROLES NO TOPO) */}
                <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl space-y-2.5 shadow-lg">
                  {/* Ativo Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3 h-3 text-cyan-400" />
                        SELECIONAR ATIVO
                      </label>
                      <span className="text-[9px] font-mono text-cyan-300 font-bold">
                        {asset.category === 'FOREX' ? '🌐 Mercado Forex' : '⚡ Criptomoeda (24/7)'}
                      </span>
                    </div>
                    <div className="relative">
                      <select
                        value={asset.symbol}
                        onChange={(e) => onSelectAsset(e.target.value)}
                        className="w-full bg-black/60 border border-neutral-700/80 hover:border-cyan-500/60 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold appearance-none focus:outline-none transition-colors cursor-pointer"
                      >
                        <optgroup label="🌐 MERCADO FOREX (Pares Globais)">
                          {assetsList
                            .filter((a) => a.category === 'FOREX')
                            .map((a) => {
                              const isClosed = !isForexOpen;
                              return (
                                <option key={a.symbol} value={a.symbol} className="bg-neutral-950 text-white font-mono">
                                  {isClosed ? '🔴 [FOREX FECHADO] ' : '🟢 [FOREX] '}{a.symbol} — {a.name}
                                </option>
                              );
                            })}
                        </optgroup>
                        <optgroup label="⚡ CRIPTOMOEDAS (Abertas 24/7)">
                          {assetsList
                            .filter((a) => a.category === 'CRYPTO')
                            .map((a) => (
                              <option key={a.symbol} value={a.symbol} className="bg-neutral-950 text-white font-mono">
                                🟢 [24/7 CRIPTO] {a.symbol} — {a.name}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                      <ChevronDown className="w-4 h-4 text-cyan-400 absolute right-3 top-2.5 pointer-events-none" />
                    </div>

                    {isForexClosed && (
                      <div className="mt-2 p-2 rounded-xl bg-rose-950/40 border border-rose-500/50 text-[10px] font-mono text-rose-300 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>Forex fechado no TradingView no fim de semana</span>
                        </div>
                        <button
                          onClick={() => onSelectAsset('BTC/USD')}
                          className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded text-[9px] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Ir p/ BTC/USD (24/7)
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Timeframe Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-bold font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        TIMEFRAME
                      </label>
                      <span className="text-[9px] font-mono text-neutral-400">
                        Ativo no gráfico: <strong className="text-white">{timeframe}</strong>
                      </span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                      {(['M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as TimeFrame[]).map((tf) => {
                        const isSelected = timeframe === tf;
                        return (
                          <button
                            key={tf}
                            onClick={() => onSelectTimeframe(tf)}
                            className={`py-1.5 rounded-lg font-mono text-[11px] font-bold transition-all cursor-pointer text-center ${isSelected
                              ? 'bg-cyan-500 text-neutral-950 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                              : 'bg-neutral-950/80 text-neutral-400 border border-neutral-800 hover:text-white hover:border-neutral-700'
                              }`}
                          >
                            {tf}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 2. MODO OPERACIONAL / ANÁLISE TÉCNICA (CONSERVADORA / MODERADA / AGRESSIVA) */}
                <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl space-y-2.5 shadow-lg">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      MODO OPERACIONAL / ANÁLISE TÉCNICA
                    </label>
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                      {settings.analysisProfile || 'MODERADA'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {/* CONSERVADORA (Sniper) */}
                    <button
                      onClick={() => onSelectAnalysisProfile && onSelectAnalysisProfile('CONSERVADORA')}
                      className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${(settings.analysisProfile || 'MODERADA') === 'CONSERVADORA'
                        ? 'bg-gradient-to-b from-cyan-950/70 to-black border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                        : 'bg-black/40 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                        }`}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-mono font-black text-cyan-300">
                        <span>🎯 Sniper</span>
                      </div>
                      <div className="text-[10px] font-bold text-white mt-0.5">Conservadora</div>
                      <div className="text-[9px] text-neutral-400 mt-1 leading-tight">
                        Confluência 72%+. Entradas cirúrgicas em taxas de S/R e Order Blocks.
                      </div>
                    </button>

                    {/* MODERADA (Mediana) */}
                    <button
                      onClick={() => onSelectAnalysisProfile && onSelectAnalysisProfile('MODERADA')}
                      className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${(settings.analysisProfile || 'MODERADA') === 'MODERADA'
                        ? 'bg-gradient-to-b from-emerald-950/70 to-black border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                        : 'bg-black/40 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                        }`}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-mono font-black text-emerald-300">
                        <span>⚖️ Mediana</span>
                      </div>
                      <div className="text-[10px] font-bold text-white mt-0.5">Moderada</div>
                      <div className="text-[9px] text-neutral-400 mt-1 leading-tight">
                        Confluência 64%+. Equilíbrio calibrado (a cada 3-5 velas) e assertividade 80%+.
                      </div>
                    </button>

                    {/* AGRESSIVA (Alavancagem) */}
                    <button
                      onClick={() => onSelectAnalysisProfile && onSelectAnalysisProfile('AGRESSIVA')}
                      className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${(settings.analysisProfile || 'MODERADA') === 'AGRESSIVA'
                        ? 'bg-gradient-to-b from-amber-950/70 to-black border-amber-400 text-white shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                        : 'bg-black/40 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                        }`}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-mono font-black text-amber-300">
                        <span>⚡ Alavancagem</span>
                      </div>
                      <div className="text-[10px] font-bold text-white mt-0.5">Agressiva</div>
                      <div className="text-[9px] text-neutral-400 mt-1 leading-tight">
                        Confluência 55%+. Entradas frequentes (a cada 1 a 3 velas) para alavancagem rápida.
                      </div>
                    </button>
                  </div>
                </div>

                {/* 3. ESTRATÉGIAS SEPARADAS & BACKTEST EM TEMPO REAL COM AUTO-FILTRO IA */}
                <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl space-y-2.5 shadow-xl font-mono">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <div>
                        <div className="text-[11px] font-black text-white flex items-center gap-1.5">
                          <span>ESTRATÉGIAS & BACKTEST REAL</span>
                          <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/70 border border-cyan-500/40 px-1.5 py-0.2 rounded-full">
                            {activeStrategyIds.length} Ativas
                          </span>
                        </div>
                        <div className="text-[9.5px] text-neutral-400">
                          Backtest vela a vela no gráfico de {asset.symbol}.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Banner do Auto-Filtro IA de Lucro */}
                  <div className="p-2.5 rounded-xl bg-black/60 border border-neutral-800/90 flex items-center justify-between gap-2 shadow-inner">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`p-1.5 rounded-lg border shrink-0 ${
                        autoFilterProfitOnly
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                      }`}>
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold text-white flex items-center gap-1.5">
                          <span>Auto-Filtro IA de Lucro</span>
                          <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                            autoFilterProfitOnly
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                          }`}>
                            {autoFilterProfitOnly ? 'ATIVADO' : 'DESLIGADO'}
                          </span>
                        </div>
                        <div className="text-[9px] text-neutral-400 truncate">
                          A IA desativa automaticamente estratégias em prejuízo (&lt;55% de acerto).
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleAutoFilterProfit}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer shrink-0 ${
                        autoFilterProfitOnly
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                          : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-white'
                      }`}
                    >
                      {autoFilterProfitOnly ? '✓ LIGADO' : 'DESLIGADO'}
                    </button>
                  </div>

                  {/* Quick Filter Buttons */}
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <button
                      onClick={handleActivateTopStrategies}
                      className="flex-1 py-1 px-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      <span>🎯 Top Lucrativas (&gt;65%)</span>
                    </button>
                    <button
                      onClick={handleActivateAllStrategies}
                      className="py-1 px-2 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/40 text-cyan-300 font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                    >
                      <span>⚡ Ativar Todas</span>
                    </button>
                  </div>

                  {/* List of Strategy Cards - Resumido e Limpo */}
                  <div className="space-y-1.5">
                    {(backtestList || []).map((strat) => {
                      if (!strat) return null;
                      const isActive = (activeStrategyIds || []).includes(strat.id);
                      const winRate = Number(strat.winRate) || 0;
                      const isHighAssertive = winRate >= 65;
                      const isDecent = winRate >= 55 && winRate < 65;
                      const isLow = strat.totalTrades > 0 && winRate < 55;

                      return (
                        <div
                          key={strat.id}
                          onClick={() => handleToggleStrategy(strat.id)}
                          className={`p-2 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between gap-2 ${
                            isActive
                              ? isHighAssertive
                                ? 'bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-black border-emerald-500/40 shadow-sm hover:border-emerald-400'
                                : 'bg-gradient-to-r from-cyan-950/30 via-neutral-900 to-black border-cyan-500/40 shadow-sm hover:border-cyan-400'
                              : 'bg-black/40 border-neutral-800/80 opacity-60 hover:opacity-90 hover:border-neutral-700'
                          }`}
                        >
                          {/* Left: Nome & Placar Real */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate">
                                {strat.badge || strat.name}
                              </span>
                              {strat.autoDeactivated && (
                                <span className="text-[8.5px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0">
                                  ✕ DESATIVADA PELA IA
                                </span>
                              )}
                            </div>
                            <div className="text-[9.5px] text-neutral-400 flex items-center gap-2 mt-0.5">
                              <span>Placar: <strong className="text-emerald-400">{strat.wins || 0}W</strong> - <strong className="text-rose-400">{strat.losses || 0}L</strong></span>
                              <span>•</span>
                              <span>Velas: <strong className="text-neutral-300">{strat.totalTrades || 0}</strong></span>
                              {(strat.consecutiveWins || 0) > 0 && (
                                <span className="text-amber-400 font-bold flex items-center gap-0.5">
                                  <Flame className="w-2.5 h-2.5 inline" /> {strat.consecutiveWins}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right: Assertividade & Botão */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                                isHighAssertive
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                  : isDecent
                                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                    : isLow
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              {winRate}%
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStrategy(strat.id);
                              }}
                              className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-cyan-400 text-black shadow-sm shadow-cyan-400/30'
                                  : 'bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-700'
                              }`}
                            >
                              {isActive ? 'ATIVA' : 'PAUSADA'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ATALHO RÁPIDO PARA O PAINEL INSTITUCIONAL DE INDICADORES */}
                <div
                  onClick={() => setActiveTab('indicadores')}
                  className="p-3 bg-gradient-to-r from-cyan-950/40 via-neutral-900 to-black border border-cyan-500/30 hover:border-cyan-400 rounded-2xl flex items-center justify-between cursor-pointer transition-all shadow-md group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-2">
                        <span>Painel Completo de Indicadores</span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                            indicatorConsensus.bias === 'CALL'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : indicatorConsensus.bias === 'PUT'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                          }`}
                        >
                          {indicatorConsensus.verdict}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        RSI, MACD, Médias Móveis, Bollinger, Estocástico, ADX, Volume e Delta de Pressão
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            )}

            {/* TAB EXCLUSIVA: INDICADORES TÉCNICOS RESUMIDOS & CONFLUÊNCIA */}
            {activeTab === 'indicadores' && (
              <div className="space-y-2.5 font-mono">
                {/* 1. Header Compacto */}
                <div className="p-2.5 bg-gradient-to-b from-[#0e172a] via-[#09101f] to-neutral-950 border border-cyan-500/30 rounded-2xl flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white tracking-wider uppercase">
                        PAINEL DE INDICADORES
                      </h4>
                      <span className="text-[9.5px] text-neutral-400">
                        {asset.symbol} • {timeframe} • Scanner 1:1
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      AO VIVO
                    </span>
                    <span className="text-[10px] font-bold text-white bg-black/60 px-2 py-0.5 rounded-lg border border-neutral-800">
                      {technicalData.currentPrice.toFixed(asset.category === 'CRYPTO' ? 2 : 5)}
                    </span>
                  </div>
                </div>

                {/* 2. Termômetro de Consenso Geral Institucional (Compacto) */}
                <div
                  className={`p-3 rounded-xl border transition-all ${
                    indicatorConsensus.bias === 'CALL'
                      ? 'bg-gradient-to-r from-emerald-950/60 via-neutral-900 to-black border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                      : indicatorConsensus.bias === 'PUT'
                        ? 'bg-gradient-to-r from-rose-950/60 via-neutral-900 to-black border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                        : 'bg-gradient-to-r from-amber-950/40 via-neutral-900 to-black border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between pb-1.5">
                    <div className="flex items-center gap-2">
                      {indicatorConsensus.bias === 'CALL' && (
                        <div className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
                          <TrendingUp className="w-3.5 h-3.5" />
                        </div>
                      )}
                      {indicatorConsensus.bias === 'PUT' && (
                        <div className="p-1 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
                          <TrendingDown className="w-3.5 h-3.5" />
                        </div>
                      )}
                      {indicatorConsensus.bias === 'NEUTRO' && (
                        <div className="p-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40">
                          <Gauge className="w-3.5 h-3.5" />
                        </div>
                      )}
                      <div>
                        <div className="text-[9px] text-neutral-400 uppercase font-semibold">
                          Veredito Consolidado (10 Indicadores)
                        </div>
                        <div
                          className={`text-xs font-black tracking-wider ${
                            indicatorConsensus.bias === 'CALL'
                              ? 'text-emerald-400'
                              : indicatorConsensus.bias === 'PUT'
                                ? 'text-rose-400'
                                : 'text-amber-400'
                          }`}
                        >
                          {indicatorConsensus.verdict}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-bold text-white">
                        {indicatorConsensus.bias === 'CALL'
                          ? `${indicatorConsensus.callPercent}% ALTA`
                          : indicatorConsensus.bias === 'PUT'
                            ? `${indicatorConsensus.putPercent}% BAIXA`
                            : `${indicatorConsensus.neutralPercent}% NEUTRO`}
                      </div>
                      <div className="text-[9px] text-neutral-400">
                        {indicatorConsensus.callCount}C / {indicatorConsensus.neutralCount}N / {indicatorConsensus.putCount}V
                      </div>
                    </div>
                  </div>

                  {/* Barra de Distribuição Visual do Consenso */}
                  <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden flex border border-white/10">
                    <div
                      className="bg-emerald-500 transition-all duration-500"
                      style={{ width: `${indicatorConsensus.callPercent}%` }}
                    />
                    <div
                      className="bg-amber-500/60 transition-all duration-500"
                      style={{ width: `${indicatorConsensus.neutralPercent}%` }}
                    />
                    <div
                      className="bg-rose-500 transition-all duration-500"
                      style={{ width: `${indicatorConsensus.putPercent}%` }}
                    />
                  </div>

                  <div className="pt-1.5 flex items-center justify-between text-[8.5px]">
                    <span className="text-emerald-400 font-bold">▲ {indicatorConsensus.callCount} Alta</span>
                    <span className="text-neutral-400">▬ {indicatorConsensus.neutralCount} Neutro</span>
                    <span className="text-rose-400 font-bold">▼ {indicatorConsensus.putCount} Baixa</span>
                  </div>
                </div>

                {/* 3. Order Flow Delta & Tendência Macro Integrados (Compacto) */}
                <div className="p-2.5 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-neutral-300 font-bold flex items-center gap-1">
                      <Gauge className="w-3 h-3 text-cyan-400" />
                      ORDER FLOW (DELTA)
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                      technicalData.delta.status === 'ALTA'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : technicalData.delta.status === 'BAIXA'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-neutral-800 text-neutral-300'
                    }`}>
                      {technicalData.delta.netDelta > 0 ? `+${technicalData.delta.netDelta}% NET` : `${technicalData.delta.netDelta}% NET`}
                    </span>
                  </div>

                  <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden flex border border-neutral-800">
                    <div
                      className="bg-emerald-500 transition-all duration-300"
                      style={{ width: `${technicalData.delta.buyerPercent}%` }}
                    />
                    <div
                      className="bg-rose-500 transition-all duration-300"
                      style={{ width: `${technicalData.delta.sellerPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-neutral-400">
                    <span className="text-emerald-400 font-semibold">{technicalData.delta.buyerPercent}% Compra</span>
                    <span className="text-rose-400 font-semibold">{technicalData.delta.sellerPercent}% Venda</span>
                  </div>
                </div>

                {/* 4. Grid de Indicadores Resumidos (2 Colunas, Super Clean) */}
                <div className="grid grid-cols-2 gap-1.5">
                  {/* RSI */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">RSI (14)</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.rsi.signal === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.rsi.signal === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.rsi.signal}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">{technicalData.rsi.value} <span className="text-[8px] text-neutral-500">pts</span></span>
                      <span className="text-[8.5px] text-neutral-400 truncate">{technicalData.rsi.statusLabel}</span>
                    </div>
                  </div>

                  {/* MACD */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">MACD</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.macd.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.macd.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.macd.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className={`text-xs font-black ${technicalData.macd.histogram >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {technicalData.macd.histogram >= 0 ? `+${technicalData.macd.histogram}` : technicalData.macd.histogram}
                      </span>
                      <span className="text-[8.5px] text-neutral-400 truncate">Hist.</span>
                    </div>
                  </div>

                  {/* EMA 9 / 21 */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">EMA (9/21)</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.maShort.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.maShort.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.maShort.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">
                        {technicalData.maShort.status === 'ALTA' ? 'EMA 9 > 21' : technicalData.maShort.status === 'BAIXA' ? 'EMA 9 < 21' : 'Alinhadas'}
                      </span>
                      <span className="text-[8.5px] text-neutral-400">Curto</span>
                    </div>
                  </div>

                  {/* SMA 50 / 200 */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">SMA (50/200)</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.maLong.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.maLong.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.maLong.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">
                        {technicalData.maLong.status === 'ALTA' ? '50 > 200' : technicalData.maLong.status === 'BAIXA' ? '50 < 200' : 'Neutras'}
                      </span>
                      <span className="text-[8.5px] text-neutral-400">Longo</span>
                    </div>
                  </div>

                  {/* Bollinger */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">Bollinger</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.bollingerBands.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.bollingerBands.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.bollingerBands.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">
                        %B: {(technicalData.bollingerBands.percentB * 100).toFixed(0)}%
                      </span>
                      <span className="text-[8.5px] text-neutral-400 truncate">
                        {technicalData.bollingerBands.percentB > 0.85 ? 'Topo' : technicalData.bollingerBands.percentB < 0.15 ? 'Fundo' : 'Canal'}
                      </span>
                    </div>
                  </div>

                  {/* Estocástico */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">Estocástico</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.stochastic.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.stochastic.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.stochastic.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">
                        {technicalData.stochastic.kValue.toFixed(0)} / {technicalData.stochastic.dValue.toFixed(0)}
                      </span>
                      <span className="text-[8.5px] text-neutral-400 truncate">
                        {technicalData.stochastic.kValue > 80 ? 'Sobrecompra' : technicalData.stochastic.kValue < 20 ? 'Sobrevenda' : 'Neutro'}
                      </span>
                    </div>
                  </div>

                  {/* ADX */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">ADX</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.adx.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.adx.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.adx.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">{technicalData.adx.value.toFixed(1)} <span className="text-[8px] text-neutral-500">pts</span></span>
                      <span className="text-[8.5px] text-neutral-400 truncate">
                        {technicalData.adx.value > 25 ? 'Forte' : 'Fraco'}
                      </span>
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">Volume</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.volume.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.volume.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.volume.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">{technicalData.volume.ratio.toFixed(1)}x</span>
                      <span className="text-[8.5px] text-neutral-400">
                        {technicalData.volume.ratio >= 1.2 ? 'Alto' : 'Normal'}
                      </span>
                    </div>
                  </div>

                  {/* ATR */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">ATR</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.atr.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.atr.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.atr.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">{technicalData.atr.pips.toFixed(1)} <span className="text-[8px] text-neutral-500">pips</span></span>
                      <span className="text-[8.5px] text-neutral-400">Volatilidade</span>
                    </div>
                  </div>

                  {/* Tendência Macro */}
                  <div className="p-2 bg-neutral-900/80 border border-neutral-800/90 rounded-xl flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] text-neutral-400 font-semibold">Macro ({timeframe})</span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded ${
                        technicalData.majorTrend.status === 'ALTA' ? 'bg-emerald-500/20 text-emerald-300' :
                        technicalData.majorTrend.status === 'BAIXA' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-300'
                      }`}>
                        {technicalData.majorTrend.status}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xs font-black text-white">{technicalData.majorTrend.status}</span>
                      <span className="text-[8.5px] text-neutral-400 font-semibold">{technicalData.majorTrend.strength}</span>
                    </div>
                  </div>
                </div>

                {/* 5. Veredito Rápido Resumido */}
                <div className="p-2 rounded-xl bg-black/60 border border-neutral-800 text-[10px] text-neutral-300 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>Confluência: <strong className="text-emerald-400">{indicatorConsensus.callCount} CALL</strong> vs <strong className="text-rose-400">{indicatorConsensus.putCount} PUT</strong></span>
                  </div>
                  <span className={`font-bold px-2 py-0.5 rounded text-[9px] ${
                    indicatorConsensus.bias === 'CALL' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                    indicatorConsensus.bias === 'PUT' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-neutral-800 text-neutral-400'
                  }`}>
                    {indicatorConsensus.verdict}
                  </span>
                </div>
              </div>
            )}

{/* TAB 3: IA VOZ 3D - Conversa Normal ao Vivo (ETAPAS 2, 3, 4, 5, 6, 7) */}
            {activeTab === 'voz' && (
              <div className="space-y-3">
                {/* Voz 3D Top Banner */}
                <div className="p-2.5 bg-[#0f1422] border border-[#1b253d] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                      <Mic className="w-4 h-4 text-cyan-400 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-xs">CandleX-IA Voz ao Vivo</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${(liveVoice?.assistantState === 'FALANDO' || liveVoice?.status === 'speaking')
                            ? 'bg-cyan-400 animate-ping'
                            : (liveVoice?.assistantState === 'PROCESSANDO' || liveVoice?.isProcessing)
                              ? 'bg-purple-400 animate-pulse'
                              : (liveVoice?.assistantState === 'OUVINDO' || liveVoice?.status === 'listening')
                                ? 'bg-emerald-400 animate-pulse'
                                : (liveVoice?.assistantState === 'CONECTANDO' || liveVoice?.status === 'connecting')
                                  ? 'bg-amber-400 animate-ping'
                                  : 'bg-neutral-500'
                            }`}
                        />
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        {asset.symbol} • {timeframe} • R$ {asset.currentPrice.toFixed(asset.pipDecimals)}
                      </div>
                    </div>
                  </div>

                  <div className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300">
                    {liveVoice?.activeEngine === 'gemini_live' ? 'Gemini 3.8 Live' : 'Voz PT-BR'}
                  </div>
                </div>

                {/* 3D Cyber Sound Frequency Visualizer Container (Immersive & Large) */}
                <div className="relative w-full h-[300px] rounded-2xl bg-gradient-to-b from-[#0a1020]/90 via-[#050811] to-[#0a1020]/90 border border-cyan-500/30 shadow-[inset_0_0_35px_rgba(6,182,212,0.18)] overflow-hidden flex items-center justify-center">
                  <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:18px_18px] opacity-20 pointer-events-none" />

                  {/* Corner Status Badge com Estados Oficiais da ETAPA 3 */}
                  <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-[9px] font-mono text-cyan-300 backdrop-blur-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span>AVATAR 3D CANDLEX</span>
                  </div>

                  {/* Top Right Controls & Formal States: DESCONECTADO, CONECTANDO, OUVINDO, PROCESSANDO, FALANDO, ERRO */}
                  <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
                    {(liveVoice?.status === 'speaking' || liveVoice?.assistantState === 'FALANDO') && (
                      <button
                        onClick={liveVoice?.interruptSpeech}
                        className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-600/90 hover:bg-rose-500 border border-rose-400 text-[9px] font-mono font-bold text-white transition-all cursor-pointer shadow-md shadow-rose-900/50 animate-pulse"
                        title="Interromper fala da IA em tempo real (Barge-in)"
                      >
                        <Square className="w-2.5 h-2.5 fill-white text-white" />
                        <span>INTERROMPER</span>
                      </button>
                    )}

                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9px] font-mono backdrop-blur-sm ${(liveVoice?.assistantState === 'FALANDO' || liveVoice?.status === 'speaking')
                        ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
                        : (liveVoice?.assistantState === 'PROCESSANDO' || liveVoice?.isProcessing)
                          ? 'bg-purple-950/80 border-purple-500/60 text-purple-300'
                          : (liveVoice?.isMuted || liveVoice?.assistantState === 'MUTADO')
                            ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                            : (liveVoice?.assistantState === 'OUVINDO' || liveVoice?.status === 'listening')
                              ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                              : (liveVoice?.assistantState === 'CONECTANDO' || liveVoice?.status === 'connecting')
                                ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                                : liveVoice?.status === 'error'
                                  ? 'bg-rose-950/80 border-rose-500/60 text-rose-300'
                                  : 'bg-neutral-900/80 border-neutral-700/80 text-neutral-400'
                        }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${(liveVoice?.assistantState === 'FALANDO' || liveVoice?.status === 'speaking')
                          ? 'bg-cyan-400 animate-ping'
                          : (liveVoice?.assistantState === 'PROCESSANDO' || liveVoice?.isProcessing)
                            ? 'bg-purple-400 animate-pulse'
                            : (liveVoice?.isMuted || liveVoice?.assistantState === 'MUTADO')
                              ? 'bg-amber-400'
                              : (liveVoice?.assistantState === 'OUVINDO' || liveVoice?.status === 'listening')
                                ? 'bg-emerald-400 animate-pulse'
                                : (liveVoice?.assistantState === 'CONECTANDO' || liveVoice?.status === 'connecting')
                                  ? 'bg-amber-400 animate-ping'
                                  : liveVoice?.status === 'error'
                                    ? 'bg-rose-400'
                                    : 'bg-neutral-500'
                          }`}
                      />
                      <span>
                        {liveVoice?.isMuted
                          ? 'MUTADO'
                          : liveVoice?.assistantState ||
                          (liveVoice?.status === 'speaking'
                            ? 'FALANDO'
                            : liveVoice?.isProcessing
                              ? 'PROCESSANDO'
                              : liveVoice?.status === 'listening'
                                ? 'OUVINDO'
                                : liveVoice?.status === 'connecting'
                                  ? 'CONECTANDO'
                                  : liveVoice?.status === 'error'
                                    ? 'ERRO'
                                    : 'DESCONECTADO')}
                      </span>
                    </div>
                  </div>

                  <CyberAiAvatar3D
                    status={liveVoice?.status || 'idle'}
                    speechLevel={liveVoice?.aiSpeechLevel || 0}
                    micLevel={liveVoice?.micLevel || 0}
                    isAnalyzing={isAnalyzing}
                    className="w-full h-full"
                  />
                </div>

                {/* Voice Controls: Iniciar conversa / Encerrar conversa / Silenciar áudio */}
                <div className="space-y-2">
                  {isDepositLocked ? (
                    <button
                      onClick={() => setIsDepositModalOpen(true)}
                      className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all cursor-pointer border border-amber-400 active:scale-98"
                    >
                      <Lock className="w-4 h-4 text-neutral-950 stroke-[2.5]" />
                      <span>🔒 IA BLOQUEADA • REALIZE O DEPÓSITO ($10) PARA ATIVAR</span>
                    </button>
                  ) : (!liveVoice || liveVoice.status === 'idle') ? (
                    <button
                      onClick={liveVoice?.startLiveConversation}
                      className="w-full py-3 px-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400 text-neutral-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all cursor-pointer active:scale-98"
                    >
                      <Radio className="w-4 h-4 text-neutral-950 animate-pulse" />
                      <span>INICIAR CONVERSA (FALE AO MICROFONE)</span>
                    </button>
                  ) : null}

                  {liveVoice && liveVoice.status === 'connecting' && (
                    <div className="flex items-center gap-2">
                      <button
                        disabled
                        className="flex-1 py-3 px-4 bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-wait"
                      >
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                        <span>CONECTANDO À IA...</span>
                      </button>
                      <button
                        onClick={liveVoice.disconnectSession}
                        className="py-3 px-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold rounded-xl text-xs cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  {liveVoice && (liveVoice.status === 'listening' || liveVoice.status === 'speaking' || liveVoice.isProcessing) && (
                    <div className="flex items-center gap-2">
                      {liveVoice.hasMicPermission ? (
                        <button
                          onClick={liveVoice.toggleMute}
                          className={`flex-1 py-3 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${liveVoice.isMuted
                            ? 'bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                            : 'bg-[#141b2c] hover:bg-[#1b243b] text-neutral-200 border border-[#222d48]'
                            }`}
                        >
                          {liveVoice.isMuted ? (
                            <MicOff className="w-4 h-4 text-amber-400 animate-pulse" />
                          ) : (
                            <Mic className="w-4 h-4 text-emerald-400" />
                          )}
                          <span>{liveVoice.isMuted ? 'Microfone Mutado (Clique p/ Ativar)' : 'Microfone Ativo (Silenciar)'}</span>
                        </button>
                      ) : (
                        <button
                          onClick={liveVoice.requestMicrophoneAccess}
                          disabled={liveVoice.isActivatingMic}
                          className="flex-1 py-3 px-3 rounded-xl font-bold text-xs bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <Mic className="w-4 h-4 text-cyan-400 animate-pulse" />
                          <span>{liveVoice.isActivatingMic ? 'Ativando...' : 'Ativar Microfone'}</span>
                        </button>
                      )}

                      <button
                        onClick={liveVoice.disconnectSession}
                        className="py-3 px-5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/30 transition-all cursor-pointer active:scale-98"
                      >
                        <PhoneOff className="w-4 h-4" />
                        <span>ENCERRAR</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Controles de Áudio: Volume e Avisos por Voz de Sinais (ETAPAS 3 e 6) */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Volume Control */}
                  <div className="p-2 bg-[#0c1220] border border-[#1b253d] rounded-xl flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1 text-[11px] font-mono text-neutral-300">
                      <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Volume:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={liveVoice?.volume ?? 100}
                        onChange={(e) => liveVoice?.setVolume && liveVoice.setVolume(Number(e.target.value))}
                        className="w-16 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        title="Controle de volume da voz da IA"
                      />
                      <span className="text-[10px] font-mono text-cyan-300 w-6 text-right">
                        {liveVoice?.volume ?? 100}%
                      </span>
                    </div>
                  </div>

                  {/* Avisos Falados de Sinais (ETAPA 6) */}
                  <div className="p-2 bg-[#0c1220] border border-[#1b253d] rounded-xl flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1 text-[11px] font-mono text-neutral-300">
                      <Bell className={`w-3.5 h-3.5 ${liveVoice?.voiceAnnouncements ? 'text-emerald-400' : 'text-neutral-500'} shrink-0`} />
                      <span className="truncate">Avisos Sinais:</span>
                    </div>
                    <button
                      onClick={() => liveVoice?.setVoiceAnnouncements && liveVoice.setVoiceAnnouncements(!liveVoice.voiceAnnouncements)}
                      className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer transition-all ${liveVoice?.voiceAnnouncements
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                        }`}
                      title="Ativar/Desativar avisos por voz para sinais confirmados e cancelamentos"
                    >
                      {liveVoice?.voiceAnnouncements ? 'LIGADO' : 'DESLIG'}
                    </button>
                  </div>
                </div>

                {/* Real-time Dynamic Audio Feedback Strip (No Chat, Pure Audio Status) */}
                {liveVoice && liveVoice.isMuted && (liveVoice.status === 'listening' || liveVoice.assistantState === 'MUTADO' || liveVoice.assistantState === 'OUVINDO') && (
                  <div className="p-3 bg-amber-950/30 border border-amber-500/40 rounded-xl flex items-center justify-between gap-2 text-xs font-mono text-amber-300">
                    <div className="flex items-center gap-2">
                      <MicOff className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="font-bold">Microfone silenciado (IA não está ouvindo)</span>
                    </div>
                    <span className="text-[10px] text-amber-400/80">Clique em Ativar para falar</span>
                  </div>
                )}

                {liveVoice && !liveVoice.isMuted && (liveVoice.status === 'listening' || liveVoice.assistantState === 'OUVINDO') && (
                  <div className="p-3 bg-[#0c1220] border border-emerald-500/30 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <Mic className={`w-3.5 h-3.5 ${liveVoice.micLevel > 5 ? 'text-emerald-400 animate-pulse' : 'text-neutral-500'}`} />
                      <span className="text-emerald-300 font-bold">Ouvindo você:</span>
                      <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-75 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(4, liveVoice.micLevel))}%` }}
                        />
                      </div>
                      <span className="text-neutral-400 text-[10px] font-mono w-8 text-right">{liveVoice.micLevel}%</span>
                    </div>

                    {liveVoice.userTranscript ? (
                      <div className="text-[11px] font-mono text-cyan-200 bg-cyan-950/60 border border-cyan-500/30 rounded-lg px-2.5 py-1.5 animate-pulse">
                        "{liveVoice.userTranscript}"
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-neutral-400 italic">
                        Fale sua dúvida ao microfone... CandleX responderá por voz.
                      </div>
                    )}
                  </div>
                )}

                {/* Animação e feedback de PROCESSANDO */}
                {liveVoice && (liveVoice.isProcessing || liveVoice.assistantState === 'PROCESSANDO') && (
                  <div className="p-3 bg-purple-950/40 border border-purple-500/40 rounded-xl flex items-center gap-2 text-xs font-mono text-purple-200 animate-pulse">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-purple-400 border-t-transparent animate-spin shrink-0" />
                    <span>CandleX consultando confluências técnicas do gráfico...</span>
                  </div>
                )}

                {/* Animação de Ondas Sonoras e feedback de FALANDO */}
                {liveVoice && (liveVoice.status === 'speaking' || liveVoice.assistantState === 'FALANDO') && (
                  <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-xl flex items-center justify-between gap-2 text-xs font-mono text-cyan-200 animate-pulse">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span className="font-bold">CandleX falando ao vivo...</span>
                    </div>
                    {/* Equalizer Waveform Bars */}
                    <div className="flex items-center gap-0.5 h-3">
                      {[6, 14, 20, 10, 16, 8, 18, 12, 19, 7].map((h, i) => (
                        <div
                          key={i}
                          className="w-1 bg-cyan-400 rounded-full transition-all duration-75"
                          style={{
                            height: `${Math.max(4, Math.min(18, (h * (liveVoice.aiSpeechLevel || 40)) / 35))}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(!liveVoice || liveVoice.status === 'idle') && (
                  <div className="p-2.5 bg-neutral-900/60 border border-neutral-800/80 rounded-xl text-center">
                    <p className="text-[11px] text-neutral-400 font-mono">
                      Conversa falada e contínua em tempo real. Inicie a conversa e fale livremente com a CandleX.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CHAT DE TEXTO (LEITURA SILENCIOSA, SEM ÁUDIO) */}
            {activeTab === 'chat' && (
              <div className="space-y-3">
                {/* Chat Top Banner with active Asset context */}
                <div className="p-2.5 bg-[#0f1422] border border-[#1b253d] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                      <MessageSquare className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-xs">Chat de Texto com a IA</span>
                        <span className="text-[9px] text-cyan-400/80 font-mono">(Leitura Silenciosa)</span>
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        {asset.symbol} • R$ {asset.currentPrice.toFixed(asset.pipDecimals)} • {timeframe}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setChatMessages([
                        {
                          id: `welcome-${Date.now()}`,
                          role: 'model',
                          text: `Chat reiniciado para ${asset.symbol}. Envie sua pergunta por texto abaixo para receber a análise por texto.`,
                          timestamp: Date.now(),
                        },
                      ])
                    }
                    title="Reiniciar histórico de texto"
                    className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Notice that voice does NOT read this chat */}
                <div className="px-2.5 py-1 rounded-lg bg-neutral-900/60 border border-neutral-800/60 text-[10px] font-mono text-neutral-400 flex items-center justify-between">
                  <span>💡 Respostas escritas para leitura (sem som ou leitura de voz).</span>
                  <button
                    onClick={() => setActiveTab('voz')}
                    className="text-cyan-400 hover:text-cyan-300 font-bold underline cursor-pointer"
                  >
                    Ir para Voz 3D
                  </button>
                </div>

                {/* Chat Messages Container */}
                <div className="h-[240px] overflow-y-auto space-y-2.5 p-2.5 bg-neutral-950/80 border border-neutral-800/80 rounded-xl custom-scrollbar">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1 mb-0.5 text-[9px] text-neutral-500 font-mono">
                        {msg.role === 'user' ? (
                          <>
                            <span>Você</span>
                            <User className="w-2.5 h-2.5" />
                          </>
                        ) : (
                          <>
                            <Bot className="w-2.5 h-2.5 text-cyan-400" />
                            <span className="text-cyan-400 font-semibold">ClandeX-IA</span>
                          </>
                        )}
                        <span>
                          {formatBrasiliaTime(msg.timestamp, false)}
                        </span>
                      </div>

                      <div
                        className={`max-w-[92%] p-2.5 rounded-2xl text-[11px] leading-relaxed select-text ${msg.role === 'user'
                          ? 'bg-gradient-to-r from-cyan-600/30 to-blue-600/30 border border-cyan-500/40 text-cyan-100 rounded-tr-xs'
                          : 'bg-[#101522] border border-[#1c273e] text-neutral-200 rounded-tl-xs whitespace-pre-wrap'
                          }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}

                  {isChatLoading && (
                    <div className="flex items-start gap-2 p-2 bg-[#101522] border border-cyan-500/30 rounded-xl max-w-[85%] text-xs text-cyan-300">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="text-[11px] font-mono">Consultando confluências, SMC e notícias...</span>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={chatBottomRef} />
                </div>

                {/* Perguntas Rápidas de Texto */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[10px] font-mono">
                  {[
                    { icon: '📈', label: 'Tendência Maior', query: `Como está a tendência maior do ativo ${asset.symbol}?` },
                    { icon: '🎯', label: 'Suportes & Resistências', query: `Quais são as taxas de suporte e resistência do ${asset.symbol}?` },
                    { icon: '📢', label: 'Próxima Notícia', query: `Qual é a próxima notícia de alto impacto no calendário econômico?` },
                    { icon: '⚡', label: 'Entrar Agora?', query: `Vale a pena entrar em uma operação agora no ${asset.symbol}?` },
                    { icon: '🔍', label: 'Confluência', query: `Qual é o score e direção das confluências do robô agora?` },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleSendChatMessage(chip.query)}
                      className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#111728] hover:bg-cyan-950/80 border border-[#1d2740] hover:border-cyan-500/50 text-neutral-300 hover:text-cyan-300 transition-all cursor-pointer flex items-center gap-1 shadow-sm shrink-0 active:scale-95"
                    >
                      <span>{chip.icon}</span>
                      <span>{chip.label}</span>
                    </button>
                  ))}
                </div>

                {/* Input Form de Texto */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChatMessage();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Digite sua dúvida sobre o mercado para receber a análise por texto..."
                    disabled={isChatLoading}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isChatLoading}
                    className="p-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:hover:from-cyan-600 disabled:hover:to-blue-600 text-white rounded-xl transition-all cursor-pointer shadow-md shadow-cyan-500/20"
                    title="Enviar pergunta por texto"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE DESBLOQUEIO POR DEPÓSITO MÍNIMO ($10 NA HIOVE) */}
      {isDepositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md p-6 bg-gradient-to-b from-[#121829] via-[#0c1220] to-black border-2 border-amber-500/50 rounded-3xl shadow-[0_0_50px_rgba(245,158,11,0.3)] space-y-4">
            {/* Top Accent Line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-400 to-amber-500 rounded-t-3xl" />

            {/* Close Button */}
            <button
              onClick={() => setIsDepositModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="text-center space-y-2 pt-1">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/20 border-2 border-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.4)]">
                <Lock className="w-7 h-7 text-amber-300 stroke-[2.5] animate-pulse" />
              </div>
              <h3 className="text-lg font-black font-mono tracking-wider text-white">
                LIBERAÇÃO DA FERRAMENTA <span className="text-amber-400">CANDLEX-IA</span>
              </h3>
              <p className="text-xs font-mono text-neutral-300">
                Conta Hiove: <strong className="text-cyan-300">{userSession?.email || 'Cadastrada'}</strong>
              </p>
            </div>

            {/* Card Explicativo */}
            <div className="p-3.5 bg-black/60 border border-amber-500/30 rounded-2xl space-y-2 text-xs font-mono text-neutral-300">
              <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Ativação com Depósito Mínimo</span>
              </div>
              <p className="text-[11px] leading-relaxed text-neutral-300">
                Sua conta na corretora Hiove foi identificada com sucesso! Para desbloquear o monitoramento contínuo de confluências, sinais M1/M2/M5 ao vivo e a IA por voz, é necessário realizar o depósito mínimo de <strong className="text-amber-400 font-bold">$10 USD</strong> na sua conta.
              </p>
            </div>

            {/* Status alerts if any */}
            {depositCheckSuccess && (
              <div className="p-3 bg-emerald-950/50 border border-emerald-500/60 rounded-xl text-xs font-mono text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{depositCheckSuccess}</span>
              </div>
            )}
            {depositCheckError && (
              <div className="p-3 bg-amber-950/50 border border-amber-500/60 rounded-xl text-xs font-mono text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{depositCheckError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-1">
              <a
                href="https://hiove.io/gSBstV"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500 hover:from-amber-400 hover:via-emerald-400 hover:to-amber-400 text-neutral-950 font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(245,158,11,0.4)] transition-all cursor-pointer group active:scale-98 text-center"
              >
                <span>FAZER DEPÓSITO DE $10 NA HIOVE</span>
                <ExternalLink className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>

              <button
                onClick={handleCheckDeposit}
                disabled={isCheckingDeposit}
                className="w-full py-3 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-cyan-400 text-cyan-300 font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isCheckingDeposit ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    <span>CONSULTANDO CORRETORA HIOVE...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                    <span>JÁ REALIZEI O DEPÓSITO • VERIFICAR AGORA</span>
                  </>
                )}
              </button>

              <button
                onClick={handlePerformLogout}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-white font-mono font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>← VOLTAR AO LOGIN (TROCAR E-MAIL)</span>
              </button>
            </div>

            <div className="text-center text-[10px] font-mono text-neutral-500 pt-1">
              Depósito 100% creditado na sua banca da Hiove para você operar.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
