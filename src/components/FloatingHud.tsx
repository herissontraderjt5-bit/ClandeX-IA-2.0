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
  Smartphone,
  BellRing,
  Download,
} from 'lucide-react';
import { notificationService } from '../services/notificationService';
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
import { TradingViewWidget } from './TradingViewWidget';
import { LiveLevelChart } from './LiveLevelChart';
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
import { tradingViewScanner, LiveTradingViewData } from '../services/tradingViewScanner';
import { signalEngine } from '../services/signalEngine';
import { audioAlerts } from '../services/audioAlerts';
import { formatBrasiliaTime, formatBrasiliaDate } from '../utils/timeFormat';
import { checkMemberAccessStatus } from '../services/memberService';

// Estilização ultra-visual em destaque para Alta, Baixa e Lateral/Neutro
const getIndicatorCardStyle = (status: string) => {
  const s = (status || '').toUpperCase();
  if (s.includes('ALTA') || s.includes('COMPRA') || s.includes('SOBREVENDA') || (s.includes('FORTE') && !s.includes('VENDA') && !s.includes('BAIXA'))) {
    return {
      border: 'border-2 border-emerald-500/80 shadow-[0_0_16px_rgba(16,185,129,0.3)]',
      bg: 'bg-gradient-to-br from-emerald-950/80 via-emerald-900/30 to-black',
      badge: 'bg-emerald-500 text-black font-black border border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.8)]',
      title: 'text-emerald-300 font-extrabold',
      value: 'text-white font-black',
      sub: 'text-emerald-400 font-semibold',
      tag: '▲ ALTA',
    };
  }
  if (s.includes('BAIXA') || s.includes('VENDA') || s.includes('SOBRECOMPRA')) {
    return {
      border: 'border-2 border-rose-500/80 shadow-[0_0_16px_rgba(244,63,94,0.3)]',
      bg: 'bg-gradient-to-br from-rose-950/80 via-rose-900/30 to-black',
      badge: 'bg-rose-500 text-white font-black border border-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
      title: 'text-rose-300 font-extrabold',
      value: 'text-white font-black',
      sub: 'text-rose-400 font-semibold',
      tag: '▼ BAIXA',
    };
  }
  // LATERAL / NEUTRO
  return {
    border: 'border-2 border-amber-400/80 shadow-[0_0_16px_rgba(251,191,36,0.3)]',
    bg: 'bg-gradient-to-br from-amber-950/80 via-amber-900/30 to-black',
    badge: 'bg-amber-400 text-black font-black border border-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    title: 'text-amber-300 font-extrabold',
    value: 'text-white font-black',
    sub: 'text-amber-400 font-semibold',
    tag: '▬ LATERAL',
  };
};

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
  onOpenExtension,
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

  // HUD Tabs: 'indicadores', 'grafico' e 'voz'
  const [activeTab, setActiveTab] = useState<'indicadores' | 'grafico' | 'voz'>('indicadores');
  const [chartMode, setChartMode] = useState<'NATIVE_SR' | 'TRADINGVIEW'>('NATIVE_SR');
  const [newsImpactFilter, setNewsImpactFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM'>('ALL');

  // Relógio Oficial de Brasília ao Vivo (BRT - UTC-3)
  const [currentBrasiliaClock, setCurrentBrasiliaClock] = useState(() => formatBrasiliaTime());
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentBrasiliaClock(formatBrasiliaTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // PWA (Baixar App no Celular/PC) & Notificações Push de Sinais e Resultados
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(() => notificationService.getPermission());
  const [canInstallPwa, setCanInstallPwa] = useState<boolean>(() => notificationService.canInstallPwa());

  useEffect(() => {
    return notificationService.subscribe(() => {
      setNotifPermission(notificationService.getPermission());
      setCanInstallPwa(notificationService.canInstallPwa());
    });
  }, []);

  const handleRequestNotif = async () => {
    await notificationService.requestPermission();
    setNotifPermission(notificationService.getPermission());
  };

  const handleInstallApp = async () => {
    if (canInstallPwa) {
      await notificationService.promptInstallPwa();
    } else {
      alert(
        '📱 Para instalar o aplicativo ClandeX-IA no seu aparelho:\n\n' +
        '• No Celular Android (Chrome): Toque no menu (3 pontinhos) e escolha "Instalar aplicativo" ou "Adicionar à tela inicial".\n\n' +
        '• No iPhone/iPad (Safari): Toque no botão de Compartilhar (ícone com seta para cima) e escolha "Adicionar à Tela de Início".\n\n' +
        '• No Computador (Chrome/Edge): Clique no ícone de instalar no canto direito da barra de endereços.'
      );
    }
  };

  // Estratégias Separadas e Backtest em Tempo Real com Auto-Filtro IA de Lucro
  const [autoFilterProfitOnly, setAutoFilterProfitOnly] = useState<boolean>(() => {
    return settings.autoFilterProfitOnly !== undefined
      ? settings.autoFilterProfitOnly
      : getStoredAutoFilterProfit();
  });

  const [activeStrategyIds, setActiveStrategyIds] = useState<string[]>(() => {
    const valid = settings.activeStrategies?.filter((id) => AVAILABLE_STRATEGIES.some((s) => s.id === id));
    const initial = (valid && valid.length > 0) ? valid : getStoredActiveStrategies();
    settings.activeStrategies = initial;
    return initial;
  });

  const [backtestList, setBacktestList] = useState<StrategyBacktestResult[]>(() => {
    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      return runRealtimeBacktest(list, activeStrategyIds || [], autoFilterProfitOnly);
    } catch (e) {
      console.error('[FloatingHud] Error initializing backtestList:', e);
      return [];
    }
  });

  // Atualização em tempo real do backtest conforme as velas, ativo e timeframe mudam
  useEffect(() => {
    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      const results = runRealtimeBacktest(list, activeStrategyIds || [], autoFilterProfitOnly);
      setBacktestList(results);

      // A IA SÓ MANTÉM ATIVAS AS ESTRATÉGIAS ACIMA DOS 65% QUANDO O AUTO-FILTRO ESTIVER HABILITADO
      if (autoFilterProfitOnly && results.length > 0) {
        const qualified65Ids = results
          .filter((r) => !r.autoDeactivated && (r.winRate >= 65 || (r.profitStatus === 'AGUARDANDO' && (activeStrategyIds || []).includes(r.id))))
          .map((r) => r.id);
        const safeTargetIds = qualified65Ids.length > 0 ? qualified65Ids : [results[0].id];

        // Sincroniza apenas se houver diferença real com a seleção atual
        const isDifferent =
          safeTargetIds.length !== (activeStrategyIds || []).length ||
          !safeTargetIds.every((id) => (activeStrategyIds || []).includes(id));

        if (isDifferent) {
          setActiveStrategyIds(safeTargetIds);
          storeActiveStrategies(safeTargetIds);
          settings.activeStrategies = safeTargetIds;
        }
      }
    } catch (e) {
      console.error('[FloatingHud] Error updating backtestList:', e);
    }
  }, [candles, asset.symbol, timeframe, autoFilterProfitOnly]);

  const handleToggleAutoFilterProfit = () => {
    const nextVal = !autoFilterProfitOnly;
    setAutoFilterProfitOnly(nextVal);
    storeAutoFilterProfit(nextVal);
    settings.autoFilterProfitOnly = nextVal;

    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      const results = runRealtimeBacktest(list, activeStrategyIds || [], nextVal);
      setBacktestList(results);

      if (nextVal && results.length > 0) {
        const qualified65Ids = results
          .filter((r) => !r.autoDeactivated && (r.winRate >= 65 || r.profitStatus === 'AGUARDANDO'))
          .map((r) => r.id);
        const safeTargetIds = qualified65Ids.length > 0 ? qualified65Ids : [results[0].id];
        setActiveStrategyIds(safeTargetIds);
        storeActiveStrategies(safeTargetIds);
        settings.activeStrategies = safeTargetIds;
      }
    } catch { }
  };

  const handleToggleStrategy = (stratId: string) => {
    const current = activeStrategyIds || [];
    const updated = current.includes(stratId)
      ? current.filter((id) => id !== stratId)
      : [...current, stratId];
    if (updated.length === 0) return; // Mantém pelo menos 1 ativa
    setActiveStrategyIds(updated);
    storeActiveStrategies(updated);
    settings.activeStrategies = updated;

    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      const results = runRealtimeBacktest(list, updated, autoFilterProfitOnly);
      setBacktestList(results);
    } catch { }
  };

  const handleActivateAllStrategies = () => {
    const allIds = AVAILABLE_STRATEGIES.map((s) => s.id);
    // Ao ativar todas manualmente, desliga o auto-filtro de lucro para respeitar a decisão do usuário
    setAutoFilterProfitOnly(false);
    storeAutoFilterProfit(false);
    settings.autoFilterProfitOnly = false;

    setActiveStrategyIds(allIds);
    storeActiveStrategies(allIds);
    settings.activeStrategies = allIds;

    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      const results = runRealtimeBacktest(list, allIds, false);
      setBacktestList(results);
    } catch { }
  };

  const handleActivateTopStrategies = () => {
    setAutoFilterProfitOnly(true);
    storeAutoFilterProfit(true);
    settings.autoFilterProfitOnly = true;

    try {
      const list = marketDataManager.getCandlesForAsset(asset.symbol, timeframe);
      const results = runRealtimeBacktest(list, AVAILABLE_STRATEGIES.map((s) => s.id), true);
      setBacktestList(results);

      const topIds = results
        .filter((b) => !b.autoDeactivated && (b.winRate >= 65 || b.profitStatus === 'AGUARDANDO'))
        .map((b) => b.id);
      const finalIds = topIds.length > 0 ? topIds : [results[0]?.id || AVAILABLE_STRATEGIES[0].id];

      setActiveStrategyIds(finalIds);
      storeActiveStrategies(finalIds);
      settings.activeStrategies = finalIds;
    } catch { }
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

  // Sincronização em tempo real dos dados do TradingView Scanner para o ativo em foco
  const [liveTvData, setLiveTvData] = useState<LiveTradingViewData | null>(() =>
    marketDataManager.getLiveTradingViewData(timeframe)
  );

  useEffect(() => {
    setLiveTvData(marketDataManager.getLiveTradingViewData(timeframe));
    const unsubscribe = tradingViewScanner.subscribe((data) => {
      if (data.symbol === asset.symbol) {
        setLiveTvData({ ...data });
      }
    });
    return unsubscribe;
  }, [asset.symbol, timeframe]);

  // Real-time Technical Overview calculated from current candles, timeframe & asset + live TradingView scanner
  const activeCandles = candles && candles.length > 0 ? candles : marketDataManager.getCandles();
  const technicalData = useMemo(() => {
    return computeTechnicalOverview(activeCandles, timeframe, asset, liveTvData);
  }, [activeCandles, timeframe, asset, liveTvData, currentCandle?.close, asset.currentPrice]);

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

  // Leitura direta e exata de Topo Real (Resistência) e Fundo Real (Suporte) dos pavios das velas recentes
  const srLevels = useMemo(() => {
    const curPrice = currentCandle?.close || technicalData.currentPrice || (asset.category === 'CRYPTO' ? 50000 : 1.1000);
    const pipMultiplier = asset.category === 'CRYPTO' ? 1 : (asset.symbol.includes('JPY') ? 100 : 10000);
    const decimals = asset.pipDecimals || (asset.category === 'CRYPTO' ? (curPrice > 1000 ? 2 : 4) : (asset.symbol.includes('JPY') ? 3 : 5));

    const candleList = activeCandles && activeCandles.length > 0 ? activeCandles.slice(-45) : [];

    let highestWick = -Infinity;
    let lowestWick = Infinity;

    for (const c of candleList) {
      if (c.high > highestWick) highestWick = c.high;
      if (c.low < lowestWick) lowestWick = c.low;
    }

    // Topo (Resistência): máxima mais alta da janela visível
    let topo = highestWick > -Infinity ? highestWick : curPrice * 1.002;
    // Fundo (Suporte): mínima mais baixa da janela visível
    let fundo = lowestWick < Infinity ? lowestWick : curPrice * 0.998;

    topo = Number(topo.toFixed(decimals));
    fundo = Number(fundo.toFixed(decimals));

    const distTopoPips = Math.abs((topo - curPrice) * pipMultiplier);
    const distFundoPips = Math.abs((curPrice - fundo) * pipMultiplier);

    return {
      curPrice,
      decimals,
      topo,
      fundo,
      distTopoPips,
      distFundoPips,
    };
  }, [activeCandles, currentCandle, technicalData.currentPrice, asset]);

  // Format candle countdown string MM:SS
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formattedCountdown = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const alertBadgeClass = 'text-cyan-300 bg-cyan-950/60 border-cyan-500/40';
  const alertStatusText = 'INDICADORES TÉCNICOS & VOZ 3D';
  const glowBorderClass = 'border-cyan-500/25';

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
              <div className="relative inline-flex items-center">
                <select
                  value={asset.symbol}
                  onChange={(e) => onSelectAsset(e.target.value)}
                  className="bg-cyan-950/80 hover:bg-cyan-900/90 text-[10px] text-cyan-300 font-mono font-bold px-1.5 py-0.5 rounded border border-cyan-500/50 cursor-pointer focus:outline-none appearance-none pr-4"
                  title="Clique para alternar o par oficial monitorado pela IA"
                >
                  <optgroup label="Cripto 24/7 (Bybit)">
                    <option value="BTC/USD">BTC/USD (Bitcoin)</option>
                    <option value="ETH/USD">ETH/USD (Ethereum)</option>
                    <option value="SOL/USD">SOL/USD (Solana)</option>
                    <option value="BNB/USD">BNB/USD (BNB)</option>
                    <option value="XRP/USD">XRP/USD (Ripple)</option>
                  </optgroup>
                  <optgroup label="Forex (TradingView OANDA)">
                    <option value="EUR/USD">EUR/USD</option>
                    <option value="GBP/USD">GBP/USD</option>
                    <option value="USD/JPY">USD/JPY</option>
                    <option value="AUD/USD">AUD/USD</option>
                    <option value="USD/CAD">USD/CAD</option>
                    <option value="EUR/JPY">EUR/JPY</option>
                    <option value="GBP/JPY">GBP/JPY</option>
                  </optgroup>
                </select>
                <span className="pointer-events-none absolute right-1 text-[8px] text-cyan-400">▼</span>
              </div>
              <span className="text-[10px] text-cyan-300/80 font-mono font-bold bg-black/40 px-1 py-0.5 rounded border border-cyan-500/30 whitespace-nowrap">
                {timeframe}
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

          {/* Botão Notificações Push Celular/PC */}
          <button
            onClick={handleRequestNotif}
            title={notifPermission === 'granted' ? 'Notificações Ativas (Celular/PC)' : 'Ativar Notificações no Celular/PC'}
            className="w-6 h-6 flex items-center justify-center hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
          >
            {notifPermission === 'granted' ? (
              <BellRing className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Bell className="w-3.5 h-3.5 text-neutral-400 hover:text-cyan-300" />
            )}
          </button>

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

      {/* Minimized Quick Bar with Price & Live Timer */}
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
              <span className="text-[10px] font-mono font-bold text-cyan-300 bg-black/60 px-2 py-0.5 rounded border border-neutral-800">
                {technicalData.currentPrice.toFixed(asset.category === 'CRYPTO' ? 2 : 5)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            {!isDepositLocked && (
              <span className="font-mono text-cyan-300 text-xs flex items-center gap-1">
                <Clock className="w-3 h-3 text-cyan-400" />
                {formattedCountdown}
              </span>
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
          {/* Navigation Tabs Bar - INDICADORES, GRÁFICO & VOZ 3D */}
          <div className="flex items-center px-2 pt-2 pb-1.5 border-b border-neutral-800/80 bg-neutral-950/70 gap-1.5">
            <button
              onClick={() => setActiveTab('indicadores')}
              className={`flex-1 py-2 px-2 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'indicadores'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
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
              onClick={() => setActiveTab('grafico')}
              className={`flex-1 py-2 px-2 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'grafico'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Gráfico & Níveis</span>
            </button>

            <button
              onClick={() => setActiveTab('voz')}
              className={`flex-1 py-2 px-2 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap min-w-0 ${activeTab === 'voz'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
                }`}
            >
              <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>IA Voz 3D</span>
              {liveVoice && liveVoice.status !== 'idle' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 shrink-0" />
              )}
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
            
            {/* TAB EXCLUSIVA 1: INDICADORES TÉCNICOS & ANÁLISE INSTITUCIONAL */}
            {activeTab === 'indicadores' && (
              <div className="space-y-3 font-mono">
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
                        <optgroup label="⚡ CRIPTOMOEDAS (Bybit 24/7)">
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

                {/* 2. Termômetro de Consenso Geral Institucional (Ultra Visual) */}
                <div
                  className={`p-3.5 rounded-2xl border-2 transition-all ${indicatorConsensus.bias === 'CALL'
                    ? 'bg-gradient-to-r from-emerald-950 via-emerald-900/40 to-black border-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.35)]'
                    : indicatorConsensus.bias === 'PUT'
                      ? 'bg-gradient-to-r from-rose-950 via-rose-900/40 to-black border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.35)]'
                      : 'bg-gradient-to-r from-amber-950 via-amber-900/40 to-black border-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.35)]'
                    }`}
                >
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-2.5">
                      {indicatorConsensus.bias === 'CALL' && (
                        <div className="p-1.5 rounded-xl bg-emerald-500 text-black font-black border border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.8)] animate-pulse">
                          <TrendingUp className="w-4 h-4 stroke-[3]" />
                        </div>
                      )}
                      {indicatorConsensus.bias === 'PUT' && (
                        <div className="p-1.5 rounded-xl bg-rose-500 text-white font-black border border-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.8)] animate-pulse">
                          <TrendingDown className="w-4 h-4 stroke-[3]" />
                        </div>
                      )}
                      {indicatorConsensus.bias === 'NEUTRO' && (
                        <div className="p-1.5 rounded-xl bg-amber-400 text-black font-black border border-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.8)]">
                          <Gauge className="w-4 h-4 stroke-[3]" />
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] text-neutral-300 uppercase font-bold tracking-wider">
                          VEREDITO INSTITUCIONAL (10 INDICADORES)
                        </div>
                        <div
                          className={`text-sm font-black tracking-wider uppercase drop-shadow-md ${indicatorConsensus.bias === 'CALL'
                            ? 'text-emerald-300'
                            : indicatorConsensus.bias === 'PUT'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                            }`}
                        >
                          {indicatorConsensus.verdict}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-black text-white">
                        {indicatorConsensus.bias === 'CALL'
                          ? `${indicatorConsensus.callPercent}% ALTA`
                          : indicatorConsensus.bias === 'PUT'
                            ? `${indicatorConsensus.putPercent}% BAIXA`
                            : `${indicatorConsensus.neutralPercent}% NEUTRO`}
                      </div>
                      <div className="text-[10px] text-neutral-300 font-bold">
                        {indicatorConsensus.callCount}C / {indicatorConsensus.neutralCount}N / {indicatorConsensus.putCount}V
                      </div>
                    </div>
                  </div>

                  {/* Barra de Distribuição Visual do Consenso */}
                  <div className="w-full bg-neutral-950 rounded-full h-2.5 overflow-hidden flex border border-white/20 p-0.5">
                    <div
                      className="bg-emerald-400 transition-all duration-500 shadow-[0_0_10px_rgba(52,211,153,0.8)] rounded-l-full"
                      style={{ width: `${indicatorConsensus.callPercent}%` }}
                    />
                    <div
                      className="bg-amber-400 transition-all duration-500 shadow-[0_0_10px_rgba(251,191,36,0.8)]"
                      style={{ width: `${indicatorConsensus.neutralPercent}%` }}
                    />
                    <div
                      className="bg-rose-500 transition-all duration-500 shadow-[0_0_10px_rgba(244,63,94,0.8)] rounded-r-full"
                      style={{ width: `${indicatorConsensus.putPercent}%` }}
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                    <span className="text-emerald-400 flex items-center gap-1 drop-shadow">
                      ▲ {indicatorConsensus.callCount} ALTA ({indicatorConsensus.callPercent}%)
                    </span>
                    <span className="text-amber-400 flex items-center gap-1 drop-shadow">
                      ▬ {indicatorConsensus.neutralCount} LATERAL / NEUTRO
                    </span>
                    <span className="text-rose-400 flex items-center gap-1 drop-shadow">
                      ▼ {indicatorConsensus.putCount} BAIXA ({indicatorConsensus.putPercent}%)
                    </span>
                  </div>
                </div>

                {/* 3. Order Flow Delta (Ultra Visual) */}
                <div className="p-3 bg-neutral-950 border-2 border-neutral-800 rounded-2xl space-y-2 shadow-lg">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-neutral-200 font-black tracking-wider flex items-center gap-1.5 uppercase">
                      <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                      ORDER FLOW (PRESSÃO DELTA)
                    </span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${technicalData.delta.status === 'ALTA'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                      : technicalData.delta.status === 'BAIXA'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      }`}>
                      {technicalData.delta.netDelta > 0 ? `+${technicalData.delta.netDelta}% NET DELTA` : `${technicalData.delta.netDelta}% NET DELTA`}
                    </span>
                  </div>

                  <div className="w-full bg-neutral-900 rounded-full h-2.5 overflow-hidden flex border border-neutral-700 p-0.5">
                    <div
                      className="bg-emerald-500 transition-all duration-300 shadow-[0_0_8px_rgba(16,185,129,0.8)] rounded-l-full"
                      style={{ width: `${technicalData.delta.buyerPercent}%` }}
                    />
                    <div
                      className="bg-rose-500 transition-all duration-300 shadow-[0_0_8px_rgba(244,63,94,0.8)] rounded-r-full"
                      style={{ width: `${technicalData.delta.sellerPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-emerald-400">{technicalData.delta.buyerPercent}% Força Compradora</span>
                    <span className="text-rose-400">{technicalData.delta.sellerPercent}% Força Vendedora</span>
                  </div>
                </div>

                {/* 4. Grid de Indicadores Ultra Visual (10 Indicadores em Alto Contraste) */}
                <div className="grid grid-cols-2 gap-2">
                  {/* RSI */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.rsi.signal);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>RSI (14)</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-sm font-black text-white">{technicalData.rsi.value} <span className="text-[8px] text-neutral-400">pts</span></span>
                          <span className={`text-[9px] ${style.sub} truncate`}>{technicalData.rsi.statusLabel}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* MACD */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.macd.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>MACD</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className={`text-sm font-black ${technicalData.macd.histogram >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {technicalData.macd.histogram >= 0 ? `+${technicalData.macd.histogram}` : technicalData.macd.histogram}
                          </span>
                          <span className={`text-[9px] ${style.sub} truncate`}>Histograma</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* EMA 9 / 21 */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.maShort.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>EMA (9/21)</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-xs font-black text-white truncate">
                            {technicalData.maShort.status === 'ALTA' ? 'EMA 9 > 21' : technicalData.maShort.status === 'BAIXA' ? 'EMA 9 < 21' : 'Alinhadas'}
                          </span>
                          <span className={`text-[9px] ${style.sub}`}>Curto Prazo</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* SMA 50 / 200 */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.maLong.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>SMA (50/200)</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-xs font-black text-white truncate">
                            {technicalData.maLong.status === 'ALTA' ? '50 > 200' : technicalData.maLong.status === 'BAIXA' ? '50 < 200' : 'Cruzadas'}
                          </span>
                          <span className={`text-[9px] ${style.sub}`}>Longo Prazo</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Bollinger */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.bollingerBands.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>Bollinger</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-sm font-black text-white">
                            {(technicalData.bollingerBands.percentB * 100).toFixed(0)}%
                          </span>
                          <span className={`text-[9px] ${style.sub} truncate`}>
                            {technicalData.bollingerBands.percentB > 0.85 ? 'Banda Superior' : technicalData.bollingerBands.percentB < 0.15 ? 'Banda Inferior' : 'Meio Canal'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Estocástico */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.stochastic.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>Estocástico</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-xs font-black text-white">
                            K:{technicalData.stochastic.kValue.toFixed(0)} / D:{technicalData.stochastic.dValue.toFixed(0)}
                          </span>
                          <span className={`text-[9px] ${style.sub} truncate`}>
                            {technicalData.stochastic.kValue > 80 ? 'Sobrecompra' : technicalData.stochastic.kValue < 20 ? 'Sobrevenda' : 'Neutro'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ADX */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.adx.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>ADX Força</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-sm font-black text-white">{technicalData.adx.value.toFixed(1)} <span className="text-[8px] text-neutral-400">pts</span></span>
                          <span className={`text-[9px] ${style.sub} truncate`}>
                            {technicalData.adx.value > 25 ? 'Tendência Forte' : 'Consolidação'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Volume */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.volume.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>Volume</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-sm font-black text-white">{technicalData.volume.ratio.toFixed(1)}x</span>
                          <span className={`text-[9px] ${style.sub}`}>
                            {technicalData.volume.ratio >= 1.2 ? 'Volume Alto' : 'Médio/Normal'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ATR */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.atr.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>ATR</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-sm font-black text-white">{technicalData.atr.pips.toFixed(1)} <span className="text-[8px] text-neutral-400">pips</span></span>
                          <span className={`text-[9px] ${style.sub}`}>Volatilidade</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Tendência Macro */}
                  {(() => {
                    const style = getIndicatorCardStyle(technicalData.majorTrend.status);
                    return (
                      <div className={`p-2.5 rounded-xl flex flex-col justify-between transition-all ${style.bg} ${style.border}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${style.title}`}>Macro ({timeframe})</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-md ${style.badge}`}>
                            {style.tag}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1.5">
                          <span className="text-xs font-black text-white truncate">{technicalData.majorTrend.status}</span>
                          <span className={`text-[9px] ${style.sub} font-semibold truncate`}>{technicalData.majorTrend.strength}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 5. Veredito Rápido Resumido */}
                <div className="p-2.5 rounded-xl bg-black/80 border-2 border-cyan-500/40 text-[10px] text-neutral-200 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
                    <span>Confluência: <strong className="text-emerald-400">{indicatorConsensus.callCount} CALL</strong> vs <strong className="text-rose-400">{indicatorConsensus.putCount} PUT</strong></span>
                  </div>
                  <span className={`font-black px-2.5 py-1 rounded-lg text-[9.5px] uppercase tracking-wider ${indicatorConsensus.bias === 'CALL'
                    ? 'bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.8)] border border-emerald-300'
                    : indicatorConsensus.bias === 'PUT'
                      ? 'bg-rose-500 text-white shadow-[0_0_10px_rgba(244,63,94,0.8)] border border-rose-300'
                      : 'bg-amber-400 text-black shadow-[0_0_10px_rgba(251,191,36,0.8)] border border-amber-200'
                    }`}>
                    {indicatorConsensus.verdict}
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: PÁGINA DE GRÁFICO EM TEMPO REAL COM SUPORTE E RESISTÊNCIA DESTACADOS */}
            {activeTab === 'grafico' && (
              <div className="space-y-3 font-mono">
                {/* 1. Header do Gráfico: Ativo, Timeframe e Cotação ao Vivo + Seletor de Modo de Gráfico */}
                <div className="p-3 bg-gradient-to-r from-[#0c1322] via-[#09101f] to-neutral-950 border border-cyan-500/40 rounded-2xl space-y-2.5 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
                        <BarChart3 className="w-4 h-4 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-white tracking-wider">{asset.symbol}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                            {timeframe}
                          </span>
                        </div>
                        <span className="text-[9.5px] text-neutral-400">
                          {asset.category === 'CRYPTO' ? '⚡ Bybit Spot (24/7)' : '🌐 OANDA / Forex'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        <span className="text-[14px] font-black font-mono text-cyan-300 tracking-wider">
                          {srLevels.curPrice.toFixed(srLevels.decimals)}
                        </span>
                      </div>
                      <span className="text-[9px] text-neutral-400 uppercase">Cotação Atual</span>
                    </div>
                  </div>

                  {/* Botões para alternar o modo do gráfico */}
                  <div className="flex items-center gap-1.5 p-1 bg-black/70 rounded-xl border border-neutral-800">
                    <button
                      onClick={() => setChartMode('TRADINGVIEW')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${chartMode === 'TRADINGVIEW'
                        ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30'
                        : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                      <span>🌐 TradingView (Topos & Fundos S/R)</span>
                    </button>
                    <button
                      onClick={() => setChartMode('NATIVE_SR')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${chartMode === 'NATIVE_SR'
                        ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30'
                        : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                      <span>🎯 Gráfico Linhas S/R</span>
                    </button>
                  </div>
                </div>

                {/* 2. Container do Gráfico */}
                {chartMode === 'TRADINGVIEW' ? (
                  <div className="w-full h-[380px] rounded-2xl overflow-hidden border-2 border-neutral-800 bg-neutral-950 shadow-2xl relative">
                    <TradingViewWidget
                      symbol={asset.tvSymbol}
                      timeframe={timeframe}
                      mode="CHART"
                      className="w-full h-full"
                    />
                    <div className="absolute top-2 right-2 z-10 pointer-events-none flex items-center gap-2 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-neutral-700/80 text-[10px] font-mono shadow-xl">
                      <span className="text-rose-400 font-bold">TOPO: {srLevels.topo.toFixed(srLevels.decimals)}</span>
                      <span className="text-neutral-600">|</span>
                      <span className="text-emerald-400 font-bold">FUNDO: {srLevels.fundo.toFixed(srLevels.decimals)}</span>
                    </div>
                  </div>
                ) : (
                  <LiveLevelChart
                    candles={activeCandles}
                    asset={asset}
                    timeframe={timeframe}
                    currentPrice={srLevels.curPrice}
                    resistance={srLevels.topo}
                    support={srLevels.fundo}
                    height={380}
                  />
                )}

                {/* 3. Região de Suporte e Resistência com Cotações Reais de Topos e Fundos */}
                <div className="p-3.5 bg-neutral-950/90 border border-neutral-800 rounded-2xl space-y-2.5 shadow-xl">
                  <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-black text-white uppercase tracking-wider">
                        SUPORTE & RESISTÊNCIA • MARCAÇÃO DE TOPO E FUNDO
                      </span>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-700 text-cyan-300">
                      Pavio Real
                    </span>
                  </div>

                  {/* CARD RESISTÊNCIA (TOPO REAL) */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-r from-rose-950/80 via-rose-900/30 to-black border-2 border-rose-500/80 shadow-[0_0_20px_rgba(244,63,94,0.25)] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                        <span className="text-xs font-black text-rose-300 uppercase tracking-wider">
                          🔴 RESISTÊNCIA (TOPO)
                        </span>
                      </div>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                        +{srLevels.distTopoPips.toFixed(1)} PIPS ACIMA
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <span className="text-2xl font-black font-mono text-white tracking-wider">
                        {srLevels.topo.toFixed(srLevels.decimals)}
                      </span>
                      <span className="text-[10px] text-rose-300/80 font-bold">
                        Pavio Máximo
                      </span>
                    </div>
                  </div>

                  {/* CARD SUPORTE (FUNDO REAL) */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/80 via-emerald-900/30 to-black border-2 border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.25)] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                          🟢 SUPORTE (FUNDO)
                        </span>
                      </div>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded bg-emerald-500 text-black shadow-[0_0_8px_rgba(16,185,129,0.6)]">
                        -{srLevels.distFundoPips.toFixed(1)} PIPS ABAIXO
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <span className="text-2xl font-black font-mono text-white tracking-wider">
                        {srLevels.fundo.toFixed(srLevels.decimals)}
                      </span>
                      <span className="text-[10px] text-emerald-300/80 font-bold">
                        Pavio Mínimo
                      </span>
                    </div>
                  </div>
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
