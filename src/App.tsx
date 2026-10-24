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
} from './types/trading';
import { INITIAL_ASSETS, marketDataManager } from './services/marketData';
import { analyzeMarket, calculateConfluences } from './services/analysisEngine';
import { signalEngine } from './services/signalEngine';
import { audioAlerts } from './services/audioAlerts';
import { webhookDispatcher } from './services/webhookDispatcher';
import { FloatingHud } from './components/FloatingHud';
import { HioveBrokerBackground } from './components/HioveBrokerBackground';
import { SettingsModal } from './components/SettingsModal';
import { ExtensionModal } from './components/ExtensionModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { WebhookModal } from './components/WebhookModal';
import { useLiveVoice } from './hooks/useLiveVoice';
import {
  fetchSettingsFromSupabase,
  saveSettingsToSupabase,
  isSupabaseConfigured,
} from './services/supabaseClient';

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
  const [asset, setAsset] = useState<Asset>(INITIAL_ASSETS[0]);
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
    } catch {}
    return DEFAULT_SETTINGS;
  });

  // Modals & Drawers
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);

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

  // Hook Webhook Dispatcher to Signal Events
  useEffect(() => {
    signalEngine.setOnSignalEvent((sig, event) => {
      if (settings.webhook?.enabled) {
        webhookDispatcher.dispatchSignal(sig, event, settings.webhook);
      }
    });
  }, [settings.webhook]);

  // Derived market analysis and confluences
  const marketAnalysis: MarketAnalysis = React.useMemo(() => {
    return analyzeMarket(candles);
  }, [candles]);

  const confluences: ConfluenceBreakdown = React.useMemo(() => {
    return calculateConfluences(marketAnalysis, settings);
  }, [marketAnalysis, settings]);

  // Persistent Live Voice Session (Active across all tabs and dashboard views)
  const liveVoice = useLiveVoice({
    asset,
    timeframe,
    marketAnalysis,
    confluences,
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
        setAsset({ ...currentAssetObj });

        // If analyzing is active, evaluate confluences in the signal engine
        if (isAnalyzing) {
          const liveAnalysis = analyzeMarket(marketDataManager.getCandles());
          const liveConfluences = calculateConfluences(liveAnalysis, settings);
          signalEngine.evaluate(
            candle,
            remainingSec,
            liveConfluences,
            settings,
            currentAssetObj.symbol,
            timeframe,
            liveAnalysis
          );
        }
      },
      (sourceInfo) => {
        setDataSource(sourceInfo);
      }
    );

    marketDataManager.start();

    return () => {
      marketDataManager.stop();
    };
  }, [settings, isAnalyzing, timeframe]);

  // Handle Asset change
  const handleSelectAsset = useCallback((symbol: string) => {
    marketDataManager.setAsset(symbol);
    const newAsset = marketDataManager.getCurrentAsset();
    setAsset({ ...newAsset });
    setCandles(marketDataManager.getCandles());
    setAiInsightText(null);
  }, []);

  // Handle Timeframe change
  const handleSelectTimeframe = useCallback((tf: TimeFrame) => {
    setTimeframe(tf);
    marketDataManager.setTimeframe(tf);
    setCandles(marketDataManager.getCandles());
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
      } catch {}
      saveSettingsToSupabase(newSettings);
    },
    [settings]
  );

  // Toggle Analysis ON/OFF
  const handleToggleAnalysis = useCallback(() => {
    setIsAnalyzing((prev) => {
      const next = !prev;
      if (!next) {
        signalEngine.cancelPreAlert('Análise pausada pelo operador.');
      }
      return next;
    });
  }, []);

  // Toggle Sound
  const handleToggleSound = useCallback(() => {
    const updated = !settings.soundEnabled;
    const newSettings = { ...settings, soundEnabled: updated };
    setSettings(newSettings);
    audioAlerts.setSoundEnabled(updated);
    try {
      localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
    } catch {}
    saveSettingsToSupabase(newSettings);
  }, [settings]);

  // Save Settings
  const handleSaveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    marketDataManager.setDemoMode(newSettings.activeMode === 'DEMO');
    try {
      localStorage.setItem('clandex_app_settings', JSON.stringify(newSettings));
    } catch {}
    saveSettingsToSupabase(newSettings);
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
        assetsList={INITIAL_ASSETS}
        timeframe={timeframe}
        expiration={expiration}
        candles={candles}
        remainingSeconds={remainingSeconds}
        onSelectAsset={handleSelectAsset}
        onSelectTimeframe={handleSelectTimeframe}
        onSelectExpiration={handleSelectExpiration}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWebhook={() => setIsWebhookModalOpen(true)}
      />

      {/* FOREGROUND: Floating Draggable ClandeX-IA HUD */}
      <FloatingHud
        asset={asset}
        assetsList={INITIAL_ASSETS}
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
        onSelectAsset={handleSelectAsset}
        onSelectTimeframe={handleSelectTimeframe}
        onSelectExpiration={handleSelectExpiration}
        onToggleAnalysis={handleToggleAnalysis}
        onToggleSound={handleToggleSound}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWebhook={() => setIsWebhookModalOpen(true)}
        onTriggerAiInsight={handleTriggerAiInsight}
        onTriggerTestSignal={handleTriggerTestSignal}
        onTriggerCancelTest={handleTriggerCancelTest}
        isAiLoading={isAiLoading}
        aiInsightText={aiInsightText}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />

      {/* Chrome Extension Modal */}
      <ExtensionModal
        isOpen={isExtensionModalOpen}
        onClose={() => setIsExtensionModalOpen(false)}
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
    </div>
  );
}
