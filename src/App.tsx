import React, { useState, useEffect, useCallback } from 'react';
import {
  Asset,
  Candle,
  DataSourceInfo,
  ExpirationTime,
  MarketAnalysis,
  SignalRecord,
  TimeFrame,
  AppSettings,
  ConfluenceBreakdown,
  AnalysisProfile,
  UserSession,
} from './types/trading';
import { INITIAL_ASSETS, getLiveAssets, marketDataManager } from './services/marketData';
import { analyzeMarket, calculateConfluences } from './services/analysisEngine';
import { signalEngine, getExpirationForTimeframe } from './services/signalEngine';
import { audioAlerts } from './services/audioAlerts';
import { webhookDispatcher } from './services/webhookDispatcher';
import { FloatingHud } from './components/FloatingHud';
import { HioveBrokerBackground } from './components/HioveBrokerBackground';
import { SettingsModal } from './components/SettingsModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { WebhookModal } from './components/WebhookModal';
import { AccessGateModal } from './components/AccessGateModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { useLiveVoice } from './hooks/useLiveVoice';
import {
  fetchSettingsFromSupabase,
  saveSettingsToSupabase,
  isSupabaseConfigured,
} from './services/supabaseClient';
import { recordUserHeartbeat, isMemberExpired, checkMemberAccessStatus } from './services/memberService';

const DEFAULT_SETTINGS: AppSettings = {
  weights: {
    marketStructure: 25,
    priceAction: 25,
    supportResistance: 20,
    smc: 20,
    volatility: 10,
  },
  thresholds: {
    observation: 60,
    strong: 75,
    veryStrong: 90,
  },
  soundEnabled: true,
  preAlertSound: true,
  confirmedSound: true,
  autoAiAnalysis: true,
  defaultExpiration: '1m',
  panelMinimized: false,
  panelPosition: { x: 30, y: 75 },
  panelSize: { width: 380, height: 500 },
  activeMode: 'REAL',
  analysisProfile: 'CONSERVADORA',
  webhook: {
    enabled: false,
    url: '',
    format: 'STANDARD_JSON',
    sendPreAlert: false,
    sendConfirmed: true,
    sendResult: true,
  },
};

export default function App() {
  const [asset, setAsset] = useState<Asset>(() => marketDataManager.getCurrentAsset());
  const [timeframe, setTimeframe] = useState<TimeFrame>('M1');
  const [expiration, setExpiration] = useState<ExpirationTime>('1m');
  const [candles, setCandles] = useState<Candle[]>(() => marketDataManager.getCandles());
  const [currentCandle, setCurrentCandle] = useState<Candle | null>(() => {
    const list = marketDataManager.getCandles();
    return list.length > 0 ? list[list.length - 1] : null;
  });
  const [remainingSeconds, setRemainingSeconds] = useState<number>(60);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Signals state
  const [activePreAlert, setActivePreAlert] = useState<SignalRecord | null>(null);
  const [signalsHistory, setSignalsHistory] = useState<SignalRecord[]>([]);
  const [latestConfirmed, setLatestConfirmed] = useState<SignalRecord | null>(null);
  const [activePendingTrade, setActivePendingTrade] = useState<SignalRecord | null>(null);
  const [lastResolvedTrade, setLastResolvedTrade] = useState<SignalRecord | null>(null);
  const [lastCancelledSignal, setLastCancelledSignal] = useState<SignalRecord | null>(null);

  // Data Source & Latency
  const [dataSource, setDataSource] = useState<DataSourceInfo>({
    providerName: 'Interbank Spot Feed / Open Rates',
    sourceType: 'REAL_FEED',
    status: 'CONNECTED',
    latencyMs: 24,
    lastTickTime: Date.now(),
    disclaimer: 'Cotações de referência interbancária para a Hiove.',
  });

  // Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('clandex_app_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          weights: { ...DEFAULT_SETTINGS.weights, ...(parsed.weights || {}) },
          thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(parsed.thresholds || {}) },
          webhook: { ...DEFAULT_SETTINGS.webhook, ...(parsed.webhook || {}) },
        };
      }
    } catch { }
    return DEFAULT_SETTINGS;
  });

  // Modals & Drawers
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  // User Auth & Hiove Validation Session
  const [userSession, setUserSession] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('clandex_user_session');
      if (saved) return JSON.parse(saved);
    } catch { }
    return null;
  });

  // Master Admin Status - Exclusively for herisson.trader.jt5@gmail.com
  const isAdmin = React.useMemo(() => {
    if (!userSession) return false;
    const emailClean = (userSession.email || '').trim().toLowerCase();
    return emailClean === 'herisson.trader.jt5@gmail.com' || userSession.isAdmin === true;
  }, [userSession]);

  // AI Commentary State (Gemini)
  const [aiInsightText, setAiInsightText] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Sync settings with Supabase Cloud
  useEffect(() => {
    fetchSettingsFromSupabase().then((remoteSettings) => {
      if (remoteSettings) {
        setSettings((prev) => ({
          ...prev,
          ...remoteSettings,
          weights: { ...prev.weights, ...(remoteSettings.weights || {}) },
          thresholds: { ...prev.thresholds, ...(remoteSettings.thresholds || {}) },
          webhook: { ...prev.webhook, ...(remoteSettings.webhook || {}) },
        }));
      }
    });
  }, []);

  // Sync sound settings with audio manager
  useEffect(() => {
    audioAlerts.setSoundEnabled(settings.soundEnabled);
  }, [settings.soundEnabled]);

  // Heartbeat do usuário para o painel Master ADM (presença online em tempo real) & Checagem de expiração e liberação manual
  useEffect(() => {
    if (!userSession?.email) return;

    if (!isAdmin && isMemberExpired(userSession)) {
      const expiredSession: UserSession = {
        ...userSession,
        hasAccess: false,
        status: 'EXPIRED',
      };
      setUserSession(expiredSession);
      try {
        localStorage.setItem('clandex_user_session', JSON.stringify(expiredSession));
      } catch { }
      return;
    }

    // Sincroniza periodicamente com o Supabase para detectar se o Administrador liberou manualmente o acesso (ex: teste 24h)
    const syncStatusWithAdmin = async () => {
      try {
        const statusCheck = await checkMemberAccessStatus(userSession.email);
        if (statusCheck.allowed && statusCheck.member && statusCheck.member.status === 'ACTIVE') {
          const mem = statusCheck.member;
          const isManuallyGranted = mem.source === 'ADMIN_MANUAL' || mem.source === 'ADMIN_BYPASS';
          if (
            userSession.status !== 'ACTIVE' ||
            !userSession.hasAccess ||
            !userSession.hasDeposit ||
            (isManuallyGranted && userSession.source !== mem.source)
          ) {
            const updatedSession: UserSession = {
              ...userSession,
              hasAccess: true,
              hasDeposit: true,
              status: 'ACTIVE',
              isAdmin: mem.isAdmin ?? false,
              source: mem.source || 'ADMIN_MANUAL',
              accessDays: mem.accessDays || userSession.accessDays || 1,
              expiresAt: mem.expiresAt || userSession.expiresAt,
            };
            setUserSession(updatedSession);
            try {
              localStorage.setItem('clandex_user_session', JSON.stringify(updatedSession));
            } catch { }
          }
        }
      } catch { }
    };

    syncStatusWithAdmin();
    recordUserHeartbeat(userSession).catch(() => { });

    // Heartbeat contínuo a cada 15 segundos para atualizar a presença no Painel ADM
    const interval = setInterval(() => {
      if (!isAdmin && isMemberExpired(userSession)) {
        const expSession: UserSession = {
          ...userSession,
          hasAccess: false,
          status: 'EXPIRED',
        };
        setUserSession(expSession);
        try {
          localStorage.setItem('clandex_user_session', JSON.stringify(expSession));
        } catch { }
      } else {
        syncStatusWithAdmin();
        recordUserHeartbeat(userSession).catch(() => { });
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recordUserHeartbeat(userSession).catch(() => { });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userSession, isAdmin]);

  // Vincula o placar exclusivo ao usuário autenticado atual
  useEffect(() => {
    signalEngine.setCurrentUser(userSession?.email || null);
    setSignalsHistory(signalEngine.getHistory());
  }, [userSession?.email]);

  // Hook Webhook Dispatcher to Signal Events
  useEffect(() => {
    signalEngine.setOnSignalEvent((sig, event) => {
      if (settings.webhook?.enabled) {
        webhookDispatcher.dispatchSignal(sig, event, settings.webhook);
      }
    });
  }, [settings.webhook]);

  // Derived market analysis and confluences (com dados reais TradingView no timeframe selecionado)
  const marketAnalysis: MarketAnalysis = React.useMemo(() => {
    return analyzeMarket(candles, marketDataManager.getLiveTradingViewData(timeframe));
  }, [candles, asset.currentPrice, timeframe]);

  const confluences: ConfluenceBreakdown = React.useMemo(() => {
    return calculateConfluences(marketAnalysis, settings);
  }, [marketAnalysis, settings]);

  // Persistent Live Voice Session (Active across all tabs and dashboard views)
  const liveVoice = useLiveVoice({
    asset,
    timeframe,
    marketAnalysis,
    confluences,
    userName: userSession?.name || userSession?.email?.split('@')[0] || 'Trader',
  });

  // Listen for signals history and lifecycle changes from engine
  useEffect(() => {
    signalEngine.setCallback((history, preAlert, activeTrade, lastResolved, lastCancelled, confirmedSignal) => {
      setSignalsHistory([...history]);
      setActivePreAlert(preAlert ? { ...preAlert } : null);
      setActivePendingTrade(activeTrade ? { ...activeTrade } : null);
      setLastResolvedTrade(lastResolved ? { ...lastResolved } : null);
      setLastCancelledSignal(lastCancelled ? { ...lastCancelled } : null);
      setLatestConfirmed(confirmedSignal ? { ...confirmedSignal } : null);
    });
    setSignalsHistory(signalEngine.getHistory());
  }, []);

  // Initialize Market Data Manager
  useEffect(() => {
    marketDataManager.setCallbacks(
      (candle, remainingSec, currentAssetObj) => {
        setRemainingSeconds(remainingSec);
        setCurrentCandle({ ...candle });
        setCandles(marketDataManager.getCandles());
        setAsset((prev) => (prev.currentPrice !== currentAssetObj.currentPrice || prev.symbol !== currentAssetObj.symbol ? { ...currentAssetObj } : prev));

        const currentCandles = marketDataManager.getCandles();

        // Process candle open capturing and expiration resolution continuously on every tick
        signalEngine.onMarketTick(
          candle,
          remainingSec,
          currentAssetObj.currentPrice,
          currentAssetObj.symbol,
          timeframe,
          currentCandles
        );

        // If analyzing is active, evaluate confluences for AI and indicators
        if (isAnalyzing) {
          analyzeMarket(currentCandles, marketDataManager.getLiveTradingViewData(timeframe));
        }
      },
      (sourceInfo) => {
        setDataSource(sourceInfo);
      }
    );

    marketDataManager.setManualOffsetSec(settings.timerOffsetSeconds || 0);
    marketDataManager.start();

    return () => {
      marketDataManager.stop();
    };
  }, [settings, isAnalyzing, timeframe]);

  // Handle Asset change
  const handleSelectAsset = useCallback(async (symbol: string) => {
    await marketDataManager.setAsset(symbol);
    const newAsset = marketDataManager.getCurrentAsset();
    const freshCandles = marketDataManager.getCandles();
    setAsset({ ...newAsset });
    setCandles([...freshCandles]);
    setCurrentCandle(freshCandles.length > 0 ? { ...freshCandles[freshCandles.length - 1] } : null);
    setAiInsightText(null);
  }, []);

  // Handle Timeframe change
  const handleSelectTimeframe = useCallback(async (tf: TimeFrame) => {
    setTimeframe(tf);
    const exp = getExpirationForTimeframe(tf);
    setExpiration(exp);
    setSettings((prev) => ({ ...prev, defaultExpiration: exp }));
    await marketDataManager.setTimeframe(tf);
    const freshCandles = marketDataManager.getCandles();
    setCandles([...freshCandles]);
    setCurrentCandle(freshCandles.length > 0 ? { ...freshCandles[freshCandles.length - 1] } : null);
    setAiInsightText(null);
  }, []);

  // Handle Expiration change
  const handleSelectExpiration = useCallback(
    (exp: ExpirationTime) => {
      setExpiration(exp);
      const newSettings = { ...settings, defaultExpiration: exp };
      setSettings(newSettings);
      try {
        localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
      } catch { }
      saveSettingsToSupabase(newSettings);
    },
    [settings]
  );

  // Se o usuário não tiver feito depósito, a análise fica bloqueada com cadeado.
  // REGRA MASTER: Se o administrador liberou manualmente o cliente no Painel ADM (ex: teste 24h ou dias liberados),
  // o cliente NÃO precisa de depósito nem de cadastro pelo link de afiliado!
  const isDepositLocked = React.useMemo(() => {
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

  // Toggle Analysis ON/OFF
  const handleToggleAnalysis = useCallback(() => {
    if (isDepositLocked) return;
    setIsAnalyzing((prev) => {
      const next = !prev;
      if (!next) {
        signalEngine.cancelPreAlert('Análise pausada pelo operador.');
      }
      return next;
    });
  }, [isDepositLocked]);

  // Atualiza a sessão para checar se o depósito foi confirmado na Hiove ou se o Admin liberou no painel
  const handleRefreshSession = useCallback(async () => {
    if (!userSession?.email) return;

    // 1. Primeiro verifica se o Administrador liberou manualmente no Supabase (ex: teste 24h ou dias concedidos)
    try {
      const statusCheck = await checkMemberAccessStatus(userSession.email);
      if (statusCheck.allowed && statusCheck.member && statusCheck.member.status === 'ACTIVE') {
        const mem = statusCheck.member;
        const updated: UserSession = {
          ...userSession,
          hasAccess: true,
          hasDeposit: true,
          status: 'ACTIVE',
          isAdmin: mem.isAdmin ?? false,
          accessDays: mem.accessDays || 1,
          expiresAt: mem.expiresAt,
          source: mem.source || 'ADMIN_MANUAL',
        };
        setUserSession(updated);
        try {
          localStorage.setItem('clandex_user_session', JSON.stringify(updated));
        } catch { }
        return;
      }
    } catch { }

    // 2. Se não estiver liberado manualmente, consulta a API Hiove
    try {
      const response = await fetch('/api/auth/validate-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userSession.email }),
      });
      const data = await response.json();
      if (data.access === true || data.status === 'ACTIVE') {
        const updated: UserSession = {
          ...userSession,
          hasAccess: true,
          hasDeposit: true,
          status: 'ACTIVE',
          isAdmin: data.isAdmin ?? false,
          source: data.cached ? 'CACHE' : 'HIOVE_API',
        };
        setUserSession(updated);
        try {
          localStorage.setItem('clandex_user_session', JSON.stringify(updated));
        } catch { }
      }
    } catch { }
  }, [userSession]);

  // Toggle Sound
  const handleToggleSound = useCallback(() => {
    const updated = !settings.soundEnabled;
    const newSettings = { ...settings, soundEnabled: updated };
    setSettings(newSettings);
    audioAlerts.setSoundEnabled(updated);
    try {
      localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
    } catch { }
    saveSettingsToSupabase(newSettings);
  }, [settings]);

  // Save Settings
  const handleSaveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    marketDataManager.setDemoMode(newSettings.activeMode === 'DEMO');
    try {
      localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
    } catch { }
    saveSettingsToSupabase(newSettings);
  }, []);

  // Analysis Profile Selector (Conservadora, Moderada, Agressiva)
  const handleSelectAnalysisProfile = useCallback((profile: AnalysisProfile) => {
    const newSettings: AppSettings = {
      ...settings,
      analysisProfile: profile,
    };
    setSettings(newSettings);
    try {
      localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
    } catch { }
    saveSettingsToSupabase(newSettings);
  }, [settings]);

  // Logout / Switch User Session
  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem('clandex_user_session');
    } catch { }
    setUserSession(null);
    setIsAdminModalOpen(false);
  }, []);

  // Clear Signals History
  const handleClearHistory = useCallback(() => {
    signalEngine.clearHistory();
    setSignalsHistory([]);
    setLatestConfirmed(null);
  }, []);

  // Consult Gemini AI for Deep Institutional Technical Commentary
  const handleTriggerAiInsight = async () => {
    if (isAiLoading) return;
    setIsAiLoading(true);
    try {
      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: asset.symbol,
          timeframe,
          currentPrice: asset.currentPrice,
          confluences,
          marketAnalysis: {
            ...marketAnalysis,
            tradingView: {
              ...marketAnalysis.tradingView,
              symbol: asset.tvSymbol,
            },
          },
        }),
      });
      const data = await response.json();
      if (data.success && data.analysis) {
        setAiInsightText(data.analysis);
      } else {
        setAiInsightText('Análise baseada nas confluências determinísticas calculadas.');
      }
    } catch {
      setAiInsightText('Análise institucional baseada em estrutura Price Action e SMC.');
    } finally {
      setIsAiLoading(false);
    }
  };

  // Trigger simulation signal for immediate user testing and validation
  const handleTriggerTestSignal = useCallback(() => {
    const dir = confluences.direction === 'PUT' ? 'PUT' : 'CALL';
    signalEngine.triggerSimulationSignal(dir, asset.symbol, asset.currentPrice, timeframe);
  }, [confluences.direction, asset.symbol, asset.currentPrice, timeframe]);

  // Trigger test for cancelled signal (Protection simulation)
  const handleTriggerCancelTest = useCallback(() => {
    const dir = confluences.direction === 'PUT' ? 'PUT' : 'CALL';
    signalEngine.triggerSimulationCancel(dir, asset.symbol, asset.currentPrice);
  }, [confluences.direction, asset.symbol, asset.currentPrice]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#08090c] text-neutral-100 select-none">
      {/* BACKGROUND: Fullscreen Hiove Broker Trading Platform */}
      <HioveBrokerBackground
        currentAsset={asset}
        assetsList={getLiveAssets()}
        timeframe={timeframe}
        expiration={expiration}
        candles={candles}
        remainingSeconds={remainingSeconds}
        isAdmin={isAdmin}
        soundEnabled={settings.soundEnabled}
        isDepositLocked={isDepositLocked}
        onSelectAsset={handleSelectAsset}
        onSelectTimeframe={handleSelectTimeframe}
        onSelectExpiration={handleSelectExpiration}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => {
          if (isDepositLocked) return;
          setIsSettingsOpen(true);
        }}
        onOpenWebhook={() => {
          if (isDepositLocked) return;
          setIsWebhookModalOpen(true);
        }}
        onOpenAdminPanel={() => setIsAdminModalOpen(true)}
        onToggleSound={handleToggleSound}
      />

      {/* FOREGROUND: Floating Draggable ClandeX-IA HUD */}
      <FloatingHud
        asset={asset}
        assetsList={getLiveAssets()}
        timeframe={timeframe}
        expiration={expiration}
        remainingSeconds={remainingSeconds}
        currentCandle={currentCandle}
        candles={candles}
        marketAnalysis={marketAnalysis}
        confluences={confluences}
        activePreAlert={activePreAlert}
        latestConfirmedSignal={latestConfirmed}
        activeTrade={activePendingTrade}
        lastResolvedTrade={lastResolvedTrade}
        lastCancelledSignal={lastCancelledSignal}
        signalsHistory={signalsHistory}
        dataSource={dataSource}
        isAnalyzing={isAnalyzing}
        settings={settings}
        liveVoice={liveVoice}
        isAdmin={isAdmin}
        userSession={userSession}
        onLogout={handleLogout}
        onRefreshSession={handleRefreshSession}
        onOpenAdminPanel={() => setIsAdminModalOpen(true)}
        onSelectAnalysisProfile={handleSelectAnalysisProfile}
        onSelectAsset={handleSelectAsset}
        onSelectTimeframe={handleSelectTimeframe}
        onSelectExpiration={handleSelectExpiration}
        onToggleAnalysis={handleToggleAnalysis}
        onToggleSound={handleToggleSound}
        onOpenSettings={() => {
          if (isDepositLocked) return;
          setIsSettingsOpen(true);
        }}
        onOpenWebhook={() => {
          if (isDepositLocked) return;
          setIsWebhookModalOpen(true);
        }}
        onTriggerAiInsight={handleTriggerAiInsight}
        onTriggerTestSignal={handleTriggerTestSignal}
        onTriggerCancelTest={handleTriggerCancelTest}
        isAiLoading={isAiLoading}
        aiInsightText={aiInsightText}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen && !isDepositLocked}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        isAdmin={isAdmin}
        onOpenAdminPanel={() => setIsAdminModalOpen(true)}
      />



      {/* Signal History Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        signals={signalsHistory}
        onClearHistory={handleClearHistory}
      />

      {/* Webhook Automation Modal */}
      <WebhookModal
        isOpen={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        config={settings.webhook}
        onSaveConfig={(newWebhook) => handleSaveSettings({ ...settings, webhook: newWebhook })}
      />

      {/* Access Gate Modal (Hiove Authentication Gate) */}
      <AccessGateModal
        isOpen={!userSession || !userSession.hasAccess || userSession.status !== 'ACTIVE'}
        onSuccess={(session) => {
          setUserSession(session);
        }}
      />

      {/* Master Admin Panel (Only for herisson.trader.jt5@gmail.com) */}
      <AdminPanelModal
        isOpen={isAdminModalOpen && isAdmin}
        onClose={() => setIsAdminModalOpen(false)}
        adminEmail={userSession?.email || 'herisson.trader.jt5@gmail.com'}
        onLogout={handleLogout}
      />
    </div>
  );
}
