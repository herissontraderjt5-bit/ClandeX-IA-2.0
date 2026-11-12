import {
  AppSettings,
  Candle,
  ConfluenceBreakdown,
  MarketAnalysis,
  SignalRecord,
  SignalStage,
  TradeResult,
  TimeFrame,
  ExpirationTime,
  StrategyBacktestResult,
  SignalDirection,
} from '../types/trading';
import { audioAlerts } from './audioAlerts';
import { isForexMarketOpen, marketDataManager, getTimeframeSeconds } from './marketData';
import { formatBrasiliaTime } from '../utils/timeFormat';
import {
  runRealtimeBacktest,
  getBestActiveStrategySignal,
  getStoredActiveStrategies,
  getStoredAutoFilterProfit,
  AVAILABLE_STRATEGIES,
} from './strategyEngine';
import {
  fetchSignalsFromSupabase,
  upsertSignalToSupabase,
  clearSignalsFromSupabase,
  getSupabase,
  mapRowToSignal,
} from './supabaseClient';
import { notificationService } from './notificationService';
import { computeTechnicalOverview } from './technicalIndicators';

export function getExpirationForTimeframe(tf: TimeFrame): ExpirationTime {
  switch (tf) {
    case 'M1': return '1m';
    case 'M2': return '2m';
    case 'M5': return '5m';
    case 'M15': return '15m';
    case 'M30': return '30m';
    case 'H1': return '1h';
    default: return '1m';
  }
}

export function getSecondsForExpiration(exp?: ExpirationTime, tf?: TimeFrame): number {
  if (tf) {
    const tfSec = getTimeframeSeconds(tf);
    if (tfSec > 0) return tfSec;
  }
  switch (exp) {
    case '1m': return 60;
    case '2m': return 120;
    case '5m': return 300;
    case '15m': return 900;
    case '30m': return 1800;
    case '1h': return 3600;
    default: return 60;
  }
}

export interface ActiveSignalState {
  currentStage: SignalStage | null;
  activePreAlert: SignalRecord | null;
  lastConfirmedSignal: SignalRecord | null;
  lastOpportunityCandleTime: number;
}

export class SignalEngine {
  private currentUserEmail: string | null = null;
  private activePreAlert: SignalRecord | null = null;
  private lastCancelledSignal: SignalRecord | null = null;
  private lastCancelledTime = 0;
  private latestConfirmedSignal: SignalRecord | null = null;
  private latestConfirmedTime = 0;
  private pendingTrades: SignalRecord[] = [];
  private signalHistory: SignalRecord[] = [];
  private lastResolvedTrade: SignalRecord | null = null;
  private lastResolvedTime = 0;
  private lastEvaluatedCandleTime = 0;
  private lastConfirmedCandleTime = 0;
  // Cooldown anti-sinal seguido: registra o momento (ms) em que o último sinal foi confirmado
  // e impede novo sinal até o intervalo mínimo por perfil expirar.
  private lastSignalConfirmedAt = 0;
  private backtestResults: StrategyBacktestResult[] = [];
  private onBacktestUpdatedCallback: ((results: StrategyBacktestResult[]) => void) | null = null;
  private onSignalsUpdated: ((
    history: SignalRecord[],
    preAlert: SignalRecord | null,
    activeTrade: SignalRecord | null,
    lastResolved: SignalRecord | null,
    lastCancelled: SignalRecord | null,
    latestConfirmed: SignalRecord | null
  ) => void) | null = null;
  private onSignalEventCallback: ((signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') => void) | null = null;
  private signalEventListeners: ((signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') => void)[] = [];

  constructor() {
    this.loadHistory();
  }

  private getNowSec(): number {
    return marketDataManager.getServerTimeSec();
  }

  /**
   * Vincula o placar estritamente ao usuário atual para que cada cliente tenha seu próprio placar privado
   */
  public setCurrentUser(email: string | null) {
    const clean = email ? email.toLowerCase().trim() : null;
    if (this.currentUserEmail === clean) return;
    this.currentUserEmail = clean;
    this.loadHistory();
    this.notify();
  }

  private getStorageKey(): string {
    if (this.currentUserEmail) {
      const safe = this.currentUserEmail.replace(/[^a-z0-9_]/g, '_');
      return `clandex_signal_history_${safe}`;
    }
    return 'clandex_signal_history_guest';
  }

  public setCallback(
    cb: (
      history: SignalRecord[],
      preAlert: SignalRecord | null,
      activeTrade: SignalRecord | null,
      lastResolved: SignalRecord | null,
      lastCancelled: SignalRecord | null,
      latestConfirmed: SignalRecord | null
    ) => void
  ) {
    this.onSignalsUpdated = cb;
  }

  public setOnSignalEvent(cb: (signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') => void) {
    this.onSignalEventCallback = cb;
  }

  public addOnSignalEvent(cb: (signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') => void) {
    this.signalEventListeners.push(cb);
  }

  public dispatchSignalEvent(signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') {
    if (this.onSignalEventCallback) {
      try { this.onSignalEventCallback(signal, event); } catch { }
    }
    this.signalEventListeners.forEach((listener) => {
      try { listener(signal, event); } catch { }
    });

    // Notificações Push nativas no Celular e PC
    try {
      if (event === 'PRE_ALERT') {
        notificationService.notifyPreAlert(signal);
      } else if (event === 'CONFIRMED') {
        notificationService.notifySignalConfirmed(signal);
      } else if (event === 'RESULT') {
        notificationService.notifySignalResult(signal);
      } else if (event === 'CANCELLED') {
        notificationService.notifySignalCancelled(signal);
      }
    } catch { }
  }

  public getHistory(): SignalRecord[] {
    return [...this.signalHistory];
  }

  public getBacktestResults(): StrategyBacktestResult[] {
    return [...this.backtestResults];
  }

  public setOnBacktestUpdated(cb: (results: StrategyBacktestResult[]) => void) {
    this.onBacktestUpdatedCallback = cb;
  }

  public getActivePreAlert(): SignalRecord | null {
    return this.activePreAlert;
  }

  public getLastCancelledSignal(): SignalRecord | null {
    if (this.lastCancelledSignal && Date.now() - this.lastCancelledTime < 3000) {
      return this.lastCancelledSignal;
    }
    return null;
  }

  public getLatestConfirmedSignal(): SignalRecord | null {
    if (!this.latestConfirmedSignal) return null;
    const nowSec = this.getNowSec();
    // Mantém a confirmação visível até a abertura da vela do sinal (+3s de margem visual)
    if (this.latestConfirmedSignal.entryTimestamp && nowSec < this.latestConfirmedSignal.entryTimestamp + 3) {
      return this.latestConfirmedSignal;
    }
    if (Date.now() - this.latestConfirmedTime < 5000) {
      return this.latestConfirmedSignal;
    }
    return null;
  }

  public getActiveTrade(): SignalRecord | null {
    if (this.pendingTrades.length === 0) return null;
    const nowSec = this.getNowSec();
    // A contagem e status de operação em andamento inicia estritamente a partir da abertura da vela do sinal (nowSec >= entryTimestamp)
    const active = this.pendingTrades.find(
      (t) => (!t.entryTimestamp || nowSec >= t.entryTimestamp) && t.result === 'PENDING'
    );
    return active || null;
  }

  public getLastResolvedTrade(): SignalRecord | null {
    if (this.lastResolvedTrade && Date.now() - this.lastResolvedTime < 7000) {
      return this.lastResolvedTrade;
    }
    return null;
  }

  public clearHistory() {
    this.signalHistory = [];
    this.pendingTrades = [];
    this.lastResolvedTrade = null;
    this.lastCancelledSignal = null;
    this.activePreAlert = null;
    this.latestConfirmedSignal = null;
    this.lastSignalConfirmedAt = 0; // Zera o cooldown ao resetar o placar
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(this.getStorageKey());
        localStorage.removeItem('clandex_signal_history_v2');
        localStorage.removeItem('clandex_ai_signals_history');
        localStorage.removeItem('clandex_signals_history');
        localStorage.removeItem('clandex_signal_history_guest');
        localStorage.removeItem('clandex_scoreboard');
      }
    } catch { }
    this.notify();
  }

  /**
   * Continuous Tick Handler: Chamado a CADA TICK (500ms) independentemente de isAnalyzing.
   * Garante:
   * 1. Captura da ABERTURA DA VELA no momento exato em que a vela do sinal abre (segundo 00).
   * 2. Captura do FECHAMENTO DA VELA e apuração rigorosa de WIN ou LOSS estritamente na abertura e fechamento da vela do sinal.
   * 3. Atualização precisa e contínua do Placar do Dia.
   */
  public onMarketTick(
    currentCandle: Candle,
    remainingSec: number,
    currentPrice: number,
    assetSymbol: string,
    timeframe: TimeFrame,
    allCandles?: Candle[]
  ) {
    const nowSec = this.getNowSec();

    if (this.pendingTrades.length > 0) {
      let updatedEntry = false;
      this.pendingTrades.forEach((trade) => {
        // Quando a vela do sinal abre (segundo 00:00 da vela oficial de entrada):
        // Trava a taxa oficial de abertura com o preço REAL do tick
        if (!trade.isEntered) {
          if (trade.entryTimestamp && nowSec >= trade.entryTimestamp) {
            trade.isEntered = true;
            // Trava taxa atômica de abertura
            const openRate = currentPrice > 0 ? currentPrice : (currentCandle?.open || trade.entryPrice);
            trade.entryPrice = openRate;
            trade.candleOpenPrice = openRate;
            updatedEntry = true;
          }
        } else {
          // Enquanto a vela está em andamento (antes da expiração), registra a cotação ao vivo
          if (!trade.expirationTimestamp || nowSec < trade.expirationTimestamp) {
            trade.candleClosePrice = currentPrice;
          }
        }

        if (updatedEntry) {
          const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
          if (histIndex !== -1) {
            this.signalHistory[histIndex] = { ...trade };
          }
        }
      });

      if (updatedEntry) {
        this.saveHistory();
        this.notify();
      }

      // Apuração rigorosa no fechamento da vela
      this.resolvePendingTrades(
        currentPrice,
        nowSec,
        remainingSec,
        allCandles,
        currentCandle
      );
    }

    // Limpeza de estados temporários após 7s completos de exibição do resultado
    if (this.lastResolvedTrade && Date.now() - this.lastResolvedTime >= 7000) {
      this.lastResolvedTrade = null;
      this.notify();
    }
    if (this.lastCancelledSignal && Date.now() - this.lastCancelledTime >= 4000) {
      this.lastCancelledSignal = null;
      this.notify();
    }
  }

  /**
   * Process tick evaluation
   */
  public evaluate(
    currentCandle: Candle,
    remainingSec: number,
    confluences: ConfluenceBreakdown,
    settings: AppSettings,
    assetSymbol: string,
    timeframe: TimeFrame,
    marketAnalysis?: MarketAnalysis,
    allCandles?: Candle[]
  ) {
    const now = this.getNowSec();
    const formattedTime = formatBrasiliaTime();

    // 0. Configuração dinâmica dos limiares de acordo com o PERFIL DE ANÁLISE selecionado na Aba Técnica
    const profile = settings.analysisProfile || 'MODERADA';
    let preAlertMinScore = 52;
    let confirmMinScore = 58;

    // 0.1 Calcula indicadores técnicos institucionais e a TENDÊNCIA MAIOR em tempo real
    const liveTv = marketDataManager.getLiveTradingViewData(timeframe);
    const currentAsset = marketDataManager.getCurrentAsset();
    const technicalOverview = computeTechnicalOverview(
      allCandles && allCandles.length > 0 ? allCandles : [currentCandle],
      timeframe,
      currentAsset,
      liveTv
    );
    const majorTrend = technicalOverview.majorTrend.status; // 'ALTA' | 'BAIXA' | 'LATERAL'
    const majorStrength = technicalOverview.majorTrend.strength;
    const majorDesc = technicalOverview.majorTrend.description;

    // Cooldown ágil entre sinais confirmados por perfil para evitar sinais seguidos (1 a 3 minutos):
    // CONSERVADORA (Sniper): 120s (2 min) | MODERADA: 90s (1.5 min) | AGRESSIVA: 60s (1 min)
    let signalCooldownMs = 90_000;

    if (profile === 'CONSERVADORA') {
      // Análise Conservadora (Sniper):
      preAlertMinScore = 58;
      confirmMinScore = 64;
      signalCooldownMs = 15_000; // 15 segundos
    } else if (profile === 'AGRESSIVA') {
      // Análise Agressiva (Alavancagem / Alta Frequência):
      preAlertMinScore = 45;
      confirmMinScore = 50;
      signalCooldownMs = 5_000; // 5 segundos
    } else {
      // Moderada (Mediana):
      preAlertMinScore = 50;
      confirmMinScore = 55;
      signalCooldownMs = 10_000; // 10 segundos
    }

    // Atualização contínua do Backtest em Tempo Real de todas as estratégias
    if (allCandles && allCandles.length >= 20) {
      const autoFilter = settings.autoFilterProfitOnly !== undefined ? settings.autoFilterProfitOnly : getStoredAutoFilterProfit();
      this.backtestResults = runRealtimeBacktest(allCandles, settings.activeStrategies || getStoredActiveStrategies(), autoFilter);
      if (this.onBacktestUpdatedCallback) {
        this.onBacktestUpdatedCallback(this.backtestResults);
      }
    }

    // Se for ativo de Forex e for final de semana (sábado ou domingo), o mercado está 100% FECHADO no TradingView!
    const isCrypto = assetSymbol.includes('BTC') || assetSymbol.includes('ETH') || assetSymbol.includes('SOL') || assetSymbol.includes('BNB') || assetSymbol.includes('XRP');
    if (!isCrypto && !isForexMarketOpen()) {
      if (this.activePreAlert) {
        this.activePreAlert = null;
        this.notify();
      }
      return;
    }

    // 1. Resolve pending trades STRICTLY when trade.expirationTimestamp is reached or candle closes!
    this.resolvePendingTrades(currentCandle.close, now, remainingSec, allCandles, currentCandle);

    // 2. Limpeza de estados temporários
    if (this.lastResolvedTrade && Date.now() - this.lastResolvedTime >= 7000) {
      this.lastResolvedTrade = null;
    }
    if (this.lastCancelledSignal && Date.now() - this.lastCancelledTime >= 4000) {
      this.lastCancelledSignal = null;
    }
    // Confirmação aguardando abertura: permanece na tela até a vela do sinal abrir (now >= entryTimestamp)
    if (this.latestConfirmedSignal) {
      if (this.latestConfirmedSignal.entryTimestamp && now >= this.latestConfirmedSignal.entryTimestamp) {
        this.latestConfirmedSignal = null;
        this.notify();
      }
    }

    if (this.pendingTrades.length > 0) {
      this.notify();
    }

    const activeRunningTrade = this.getActiveTrade();
    const tfSec = getTimeframeSeconds(timeframe);
    // Vincula a expiração do sinal estritamente ao timeframe selecionado no gráfico!
    const activeExpiration: ExpirationTime = getExpirationForTimeframe(timeframe);
    const expirationSeconds = tfSec;
    const candleBoundary = currentCandle?.time || (now - (((now % tfSec) + tfSec) % tfSec));

    // Momento exato da CONFIRMAÇÃO OU CANCELAMENTO: ENTRE 10 E 3 SEGUNDOS RESTANTES
    // Garante disparo perfeito e sincronizado com o cronômetro da corretora Hiove
    const isConfirmationWindow = remainingSec <= 10 && remainingSec >= 3;
    const isNewCandleConfirmation = this.lastConfirmedCandleTime !== currentCandle.time;

    // REGRA OBRIGATÓRIA CANDLEX-IA PARA OPÇÕES BINÁRIAS:
    // A confirmação ocorre entre 10s e 5s da vela de setup (candleBoundary).
    // A entrada da operação ocorre na abertura da vela do sinal (targetEntryTimestamp = candleBoundary + tfSec),
    // e expira no fechamento integral dessa mesma vela (targetExpirationTimestamp = targetEntryTimestamp + expirationSeconds).
    const targetEntryTimestamp = candleBoundary + tfSec;
    const targetExpirationTimestamp = targetEntryTimestamp + expirationSeconds;
    const entryTimeFormatted = formatBrasiliaTime(targetEntryTimestamp);
    const expirationTimeFormatted = formatBrasiliaTime(targetExpirationTimestamp);

    // Cooldown anti-sinal seguido: exige 1 a 3 minutos de espera após término ou confirmação de operação
    const isCooldownActive =
      (this.lastSignalConfirmedAt > 0 && Date.now() - this.lastSignalConfirmedAt < signalCooldownMs) ||
      (this.lastResolvedTime > 0 && Date.now() - this.lastResolvedTime < signalCooldownMs);

    // 3. CONFIRMAÇÃO OFICIAL ENTRE 10 E 5 SEGUNDOS DA PRÓPRIA VELA DE ENTRADA
    if (isConfirmationWindow && isNewCandleConfirmation && !activeRunningTrade && !isCooldownActive) {
      if (this.activePreAlert) {
        // REGRA ESTRITA DO USUÁRIO PARA CANCELAMENTO:
        // "no cancelamento do sinal so e para cancelar se estiver um pavio de rejeição esse pavio tem que ser maior que o corpo da vela"
        const body = Math.abs(currentCandle.close - currentCandle.open);
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;

        let hasOpposingRejectionWick = false;
        let cancelReason = '';

        if (this.activePreAlert.direction === 'CALL') {
          // Para CALL: cancela se houver pavio SUPERIOR de rejeição estritamente MAIOR que o corpo da vela
          // OU se a tendência maior dos indicadores for de BAIXA (proteção institucional)
          // OU se a vela do Padrão 2 estiver fechando vermelha contrária à compra
          if (upperWick > body && upperWick > 0.00001) {
            hasOpposingRejectionWick = true;
            cancelReason = `Pavio superior de rejeição (${upperWick.toFixed(5)}) maior que o corpo da vela (${body.toFixed(5)}). Entrada abortada.`;
          } else if (majorTrend === 'BAIXA') {
            hasOpposingRejectionWick = true;
            cancelReason = 'Tendência Maior dos Indicadores virou para BAIXA. Operação de COMPRA abortada para proteção.';
          } else if (this.activePreAlert.strategyId === 'padrao_2_fluxo_call' && currentCandle.close < currentCandle.open) {
            hasOpposingRejectionWick = true;
            cancelReason = 'Vela vermelha contrária ao fluxo de alta. Padrão 2 (Fluxo da 3ª Vela de Alta) invalidado para proteção de banca.';
          } else if (profile === 'CONSERVADORA' && currentCandle.close < currentCandle.open) {
            hasOpposingRejectionWick = true;
            cancelReason = 'Modo Sniper: Vela vermelha contrária à compra (CALL). Entrada abortada para proteção cirúrgica.';
          }
        } else if (this.activePreAlert.direction === 'PUT') {
          // Para PUT: cancela se houver pavio INFERIOR de rejeição estritamente MAIOR que o corpo da vela
          // OU se a tendência maior dos indicadores for de ALTA (proteção institucional)
          // OU se a vela do Padrão 1 estiver fechando verde contrária à venda
          if (lowerWick > body && lowerWick > 0.00001) {
            hasOpposingRejectionWick = true;
            cancelReason = `Pavio inferior de rejeição (${lowerWick.toFixed(5)}) maior que o corpo da vela (${body.toFixed(5)}). Entrada abortada.`;
          } else if (majorTrend === 'ALTA') {
            hasOpposingRejectionWick = true;
            cancelReason = 'Tendência Maior dos Indicadores virou para ALTA. Operação de VENDA abortada para proteção.';
          } else if (this.activePreAlert.strategyId === 'padrao_1_fluxo_put' && currentCandle.close > currentCandle.open) {
            hasOpposingRejectionWick = true;
            cancelReason = 'Vela verde contrária ao fluxo de baixa. Padrão 1 (Fluxo 3ª Vela Baixa) invalidado para proteção de banca.';
          } else if (profile === 'CONSERVADORA' && currentCandle.close > currentCandle.open) {
            hasOpposingRejectionWick = true;
            cancelReason = 'Modo Sniper: Vela verde contrária à venda (PUT). Entrada abortada para proteção cirúrgica.';
          }
        }

        if (hasOpposingRejectionWick) {
          // CANCELAMENTO FALTANDO 10 SEGUNDOS (PROTEÇÃO DE BANCA VIA PAVIO DE REJEIÇÃO)
          const cancelled: SignalRecord = {
            ...this.activePreAlert,
            stage: 'CANCELLED',
            cancelledAt: Date.now(),
            cancelReason,
          };
          this.lastCancelledSignal = cancelled;
          this.lastCancelledTime = Date.now();
          this.lastConfirmedCandleTime = currentCandle.time;
          this.activePreAlert = null;

          audioAlerts.playCancelAlert();
          if (this.onSignalEventCallback) {
            this.onSignalEventCallback(cancelled, 'CANCELLED');
          }
          this.notify();
          return;
        }

        // REGRA ESTRITA DO USUÁRIO: Pavio de rejeição não superou o corpo da vela -> CONFIRMAÇÃO PROSSEGUE
        const confirmed: SignalRecord = {
          ...this.activePreAlert,
          id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          stage: 'CONFIRMED',
          timestamp: Date.now(),
          formattedTime,
          entryTimeFormatted,
          expirationTimeFormatted,
          timeframe,
          expiration: activeExpiration,
          entryPrice: 0, // Será capturado estritamente no segundo :00 na abertura da vela do sinal
          candleOpenPrice: 0,
          isEntered: false, // Inicia oficialmente no segundo 00 da vela de entrada
          confluenceScore: this.activePreAlert.confluenceScore || confluences.totalScore,
          strategyId: this.activePreAlert.strategyId,
          strategyName: this.activePreAlert.strategyName,
          strategyBadge: this.activePreAlert.strategyBadge,
          strategyWinRate: this.activePreAlert.strategyWinRate,
          reasons: this.activePreAlert.reasons.length > 0 ? [...this.activePreAlert.reasons] : confluences.reasons,
          result: 'PENDING',
          candleCloseTime: targetEntryTimestamp,
          entryTimestamp: targetEntryTimestamp,
          expirationTimestamp: targetExpirationTimestamp,
          isEstimatedResult: false,
        };

        this.lastConfirmedCandleTime = currentCandle.time;
        this.latestConfirmedSignal = confirmed;
        this.latestConfirmedTime = Date.now();
        this.activePreAlert = null;
        this.lastCancelledSignal = null;
        this.lastResolvedTrade = null;
        // Registra cooldown: impede sinal imediato logo após a confirmação
        this.lastSignalConfirmedAt = Date.now();

        if (settings.confirmedSound) {
          if (confirmed.direction === 'CALL') {
            audioAlerts.playCallSignal();
          } else {
            audioAlerts.playPutSignal();
          }
        }

        this.dispatchSignalEvent(confirmed, 'CONFIRMED');

        this.pendingTrades.push(confirmed);
        this.signalHistory.unshift(confirmed);
        this.saveHistory(confirmed);
        this.notify();
        return;
      } else {
        // Confirmação direta instantânea de alta convicção faltando 10 segundos
        // EXCLUSIVO para os 6 Padrões Oficiais CandleX-IA
        const activeStrategies = (settings.activeStrategies && settings.activeStrategies.length > 0)
          ? settings.activeStrategies.filter((id) => AVAILABLE_STRATEGIES.some((s) => s.id === id))
          : getStoredActiveStrategies();

        const stratDecision = getBestActiveStrategySignal(
          allCandles && allCandles.length > 0 ? allCandles : [currentCandle],
          activeStrategies.length > 0 ? activeStrategies : getStoredActiveStrategies(),
          this.backtestResults,
          profile,
          majorTrend
        );

        let activeDecision = stratDecision;
        if (!activeDecision && confluences && confluences.bias && confluences.bias !== 'NEUTRO' && confluences.totalScore >= confirmMinScore) {
          // Bloqueio rigoroso de tendência maior
          const isConflict = (majorTrend === 'ALTA' && confluences.bias === 'PUT') || (majorTrend === 'BAIXA' && confluences.bias === 'CALL');
          if (!isConflict) {
            activeDecision = {
              strategy: {
                id: 'estrategia_confluencia_ia',
                name: 'IA Confluência Técnica Avançada',
                badge: `IA ${confluences.bias === 'CALL' ? 'ALTA' : 'BAIXA'}`,
                category: 'ALGORITMICA',
                description: 'Confluência múltipla TradingView (RSI, MACD, Estocástico, Bollinger)',
                minProfile: 'MODERADA',
              },
              direction: confluences.bias,
              score: confluences.totalScore,
              reasons: confluences.reasons.length > 0 ? [...confluences.reasons] : ['Confluência Técnica Múltipla TradingView'],
            };
          }
        }

        if (activeDecision) {
          const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
          const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
          const body = Math.abs(currentCandle.close - currentCandle.open);

          const isHardResistanceBlock = activeDecision.strategy.id !== 'estrategia_suporte_resistencia' && activeDecision.direction === 'CALL' && marketAnalysis?.nearResistance && upperWick > body;
          const isHardSupportBlock = activeDecision.strategy.id !== 'estrategia_suporte_resistencia' && activeDecision.direction === 'PUT' && marketAnalysis?.nearSupport && lowerWick > body;

          if (!isHardResistanceBlock && !isHardSupportBlock) {
            const bRes = this.backtestResults.find((b) => b.id === activeDecision!.strategy.id);
            const confirmed: SignalRecord = {
              id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              timestamp: Date.now(),
              formattedTime,
              entryTimeFormatted,
              expirationTimeFormatted,
              asset: assetSymbol,
              timeframe,
              expiration: activeExpiration,
              direction: activeDecision.direction,
              stage: 'CONFIRMED',
              entryPrice: 0, // Será capturado estritamente no segundo :00 na abertura da vela do sinal
              candleOpenPrice: 0,
              isEntered: false, // Inicia oficialmente no segundo 00 da vela de entrada
              confluenceScore: activeDecision.score,
              strategyId: activeDecision.strategy.id,
              strategyName: activeDecision.strategy.name,
              strategyBadge: activeDecision.strategy.badge,
              strategyWinRate: bRes?.winRate,
              reasons: [...activeDecision.reasons],
              result: 'PENDING',
              candleCloseTime: targetEntryTimestamp,
              entryTimestamp: targetEntryTimestamp,
              expirationTimestamp: targetExpirationTimestamp,
              isEstimatedResult: false,
            };

            this.lastConfirmedCandleTime = currentCandle.time;
            this.latestConfirmedSignal = confirmed;
            this.latestConfirmedTime = Date.now();
            this.lastCancelledSignal = null;
            this.lastResolvedTrade = null;
            this.lastSignalConfirmedAt = Date.now();

            if (settings.confirmedSound) {
              if (confirmed.direction === 'CALL') {
                audioAlerts.playCallSignal();
              } else {
                audioAlerts.playPutSignal();
              }
            }

            this.dispatchSignalEvent(confirmed, 'CONFIRMED');

            this.pendingTrades.push(confirmed);
            this.signalHistory.unshift(confirmed);
            this.saveHistory(confirmed);
            this.notify();
            return;
          }
        }
      }
    }

    // 4. REGRA ESTRITA DO USUÁRIO: O pré-alerta NUNCA cancela no meio da vela (quando remainingSec > 10).
    // Toda e qualquer decisão de CONFIRMAR OU CANCELAR ocorre APENAS ENTRE 10 A 5 SEGUNDOS RESTANTES.
    // Se a vela atingir menos de 5 segundos (remainingSec < 5) sem confirmação, cancela para não entrar atrasado na abertura:
    if (this.activePreAlert && remainingSec < 5) {
      const cancelled: SignalRecord = {
        ...this.activePreAlert,
        stage: 'CANCELLED',
        cancelledAt: Date.now(),
        cancelReason: 'Janela estrita de 10 a 5 segundos finalizada sem confirmação.',
      };
      this.lastCancelledSignal = cancelled;
      this.lastCancelledTime = Date.now();
      this.activePreAlert = null;
      audioAlerts.playCancelAlert();
      this.dispatchSignalEvent(cancelled, 'CANCELLED');
      this.notify();
      return;
    }

    // 5. STAGE 1: PRÉ-ALERTA (Aviso prévio durante o corpo da vela atual para confirmação faltando 10s a 5s)
    // EXCLUSIVO para os 6 Padrões Oficiais CandleX-IA
    const activeStrategies = (settings.activeStrategies && settings.activeStrategies.length > 0)
      ? settings.activeStrategies.filter((id) => AVAILABLE_STRATEGIES.some((s) => s.id === id))
      : getStoredActiveStrategies();

    const stratDecision = getBestActiveStrategySignal(
      allCandles && allCandles.length > 0 ? allCandles : [currentCandle],
      activeStrategies.length > 0 ? activeStrategies : getStoredActiveStrategies(),
      this.backtestResults,
      profile,
      majorTrend
    );

    let signalDirection: SignalDirection | null = null;
    let signalScore = 0;
    let signalReasons: string[] = [];
    let stratId: string | undefined = undefined;
    let stratName: string | undefined = undefined;
    let stratBadge: string | undefined = undefined;
    let stratWinRate: number | undefined = undefined;

    if (stratDecision) {
      // Trava de Rejeição Extrema: não compra contra teto de resistência com pavio superior maior que metade do corpo
      const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
      const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
      const body = Math.abs(currentCandle.close - currentCandle.open);

      const isHardResistanceBlock = stratDecision.strategy.id !== 'estrategia_suporte_resistencia' && stratDecision.direction === 'CALL' && marketAnalysis?.nearResistance && upperWick > body;
      const isHardSupportBlock = stratDecision.strategy.id !== 'estrategia_suporte_resistencia' && stratDecision.direction === 'PUT' && marketAnalysis?.nearSupport && lowerWick > body;

      if (!isHardResistanceBlock && !isHardSupportBlock) {
        signalDirection = stratDecision.direction;
        signalScore = stratDecision.score;
        signalReasons = [
          ...stratDecision.reasons,
          `Tendência Maior dos Indicadores: ${majorTrend} (${majorStrength})`,
        ];
        stratId = stratDecision.strategy.id;
        stratName = stratDecision.strategy.name;
        stratBadge = stratDecision.strategy.badge;
        const bRes = this.backtestResults.find((b) => b.id === stratDecision.strategy.id);
        stratWinRate = bRes?.winRate;
      }
    }

    // Fallback de Pré-Alerta via Confluência Técnica Multidimensional (quando nenhum padrão de vela estiver ativo)
    if (!signalDirection && confluences && confluences.bias && confluences.bias !== 'NEUTRO' && confluences.totalScore >= preAlertMinScore) {
      // Bloqueio rigoroso de tendência maior
      const isConflict = (majorTrend === 'ALTA' && confluences.bias === 'PUT') || (majorTrend === 'BAIXA' && confluences.bias === 'CALL');
      if (!isConflict) {
        signalDirection = confluences.bias;
        signalScore = confluences.totalScore;
        signalReasons = [
          ...(confluences.reasons.length > 0 ? confluences.reasons : ['Confluência Técnica Múltipla TradingView']),
          `Tendência Maior dos Indicadores: ${majorTrend} (${majorStrength})`,
        ];
        stratId = 'estrategia_confluencia_ia';
        stratName = 'IA Confluência Técnica Avançada';
        stratBadge = `IA ${confluences.bias === 'CALL' ? 'ALTA' : 'BAIXA'}`;
        stratWinRate = Math.min(94, Math.max(72, confluences.totalScore));
      }
    }

    if (
      signalDirection &&
      remainingSec < tfSec - 4 &&
      remainingSec > 10 &&
      !this.activePreAlert &&
      !activeRunningTrade &&
      this.lastEvaluatedCandleTime !== currentCandle.time &&
      !isCooldownActive
    ) {
      // Pré-alerta ancorado para a próxima vela (a vela oficial de entrada)
      const targetCandleTime = candleBoundary + tfSec;
      const targetExpTime = targetCandleTime + expirationSeconds;
      const preEntryTimeFormatted = formatBrasiliaTime(targetCandleTime);
      const preExpTimeFormatted = formatBrasiliaTime(targetExpTime);

      const preAlert: SignalRecord = {
        id: `sig_pre_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        formattedTime,
        entryTimeFormatted: preEntryTimeFormatted,
        expirationTimeFormatted: preExpTimeFormatted,
        asset: assetSymbol,
        timeframe,
        expiration: activeExpiration,
        direction: signalDirection,
        stage: 'PRE_ALERT',
        confluenceScore: signalScore,
        entryPrice: currentCandle.close,
        candleOpenPrice: currentCandle.close,
        isEntered: false,
        result: 'PENDING',
        reasons: signalReasons,
        strategyId: stratId,
        strategyName: stratName,
        strategyBadge: stratBadge,
        strategyWinRate: stratWinRate,
        candleCloseTime: targetCandleTime,
        entryTimestamp: targetCandleTime,
        expirationTimestamp: targetExpTime,
        isEstimatedResult: false,
      };

      this.activePreAlert = preAlert;
      this.lastCancelledSignal = null;
      this.lastResolvedTrade = null;
      this.lastEvaluatedCandleTime = currentCandle.time;

      if (settings.preAlertSound) {
        audioAlerts.playPreAlert();
      }
      this.dispatchSignalEvent(preAlert, 'PRE_ALERT');
      this.notify();
      return;
    }
  }

  /**
   * Apura operações rigorosamente no fechamento da vela do sinal (segundo :00 de expiração),
   * calculando WIN ou LOSS estritamente com base na ABERTURA e FECHAMENTO da vela oficial.
   */
  private resolvePendingTrades(
    currentPrice: number,
    nowSec: number,
    remainingSec?: number,
    allCandles?: Candle[],
    currentCandle?: Candle
  ) {
    if (this.pendingTrades.length === 0) return;

    let updated = false;
    this.pendingTrades = this.pendingTrades.filter((trade) => {
      // 1. Se a vela de entrada ainda não começou, mantém a operação pendente
      if (trade.entryTimestamp && nowSec < trade.entryTimestamp) {
        return true;
      }

      // 2. Se a vela de expiração ainda não terminou (não atingiu expirationTimestamp), mantém a operação pendente
      // Não apura antes do fechamento oficial!
      if (trade.expirationTimestamp && nowSec < trade.expirationTimestamp) {
        return true;
      }

      // 3. APURAÇÃO DEFINITIVA NO FECHAMENTO DA VELA
      // Taxa oficial de abertura: travada no momento em que a vela abriu
      const officialOpen = (trade.candleOpenPrice && trade.candleOpenPrice > 0)
        ? trade.candleOpenPrice
        : (trade.entryPrice > 0 ? trade.entryPrice : currentPrice);

      // Taxa oficial de fechamento: preço no término da vela
      const officialClose = (currentPrice > 0)
        ? currentPrice
        : ((trade.candleClosePrice && trade.candleClosePrice > 0) ? trade.candleClosePrice : officialOpen);

      const diff = officialClose - officialOpen;
      const EPSILON = 1e-8;

      // REGRA OFICIAL DE OPÇÕES BINÁRIAS:
      // CALL (COMPRA):
      // - Fechamento > Abertura (diff > 0) => WIN
      // - Fechamento < Abertura (diff < 0) => LOSS
      // - Fechamento == Abertura => EMPATE
      //
      // PUT (VENDA):
      // - Fechamento < Abertura (diff < 0) => WIN
      // - Fechamento > Abertura (diff > 0) => LOSS
      // - Fechamento == Abertura => EMPATE
      let outcome: TradeResult = 'EMPATE';
      if (trade.direction === 'CALL') {
        if (diff > EPSILON) {
          outcome = 'WIN';
        } else if (diff < -EPSILON) {
          outcome = 'LOSS';
        } else {
          outcome = 'EMPATE';
        }
      } else if (trade.direction === 'PUT') {
        if (diff < -EPSILON) {
          outcome = 'WIN';
        } else if (diff > EPSILON) {
          outcome = 'LOSS';
        } else {
          outcome = 'EMPATE';
        }
      }

      trade.result = outcome;
      trade.entryPrice = officialOpen;
      trade.candleOpenPrice = officialOpen;
      trade.exitPrice = officialClose;
      trade.candleClosePrice = officialClose;
      trade.resolvedAt = Date.now();

      // Armazena para exibição destacada de 7 segundos no HUD
      this.lastResolvedTrade = { ...trade };
      this.lastResolvedTime = Date.now();

      console.log(
        `[SignalEngine] 🎯 RESULTADO APURADO: ${trade.asset} ${trade.direction} -> ${outcome} | Abertura: ${officialOpen} ➔ Fechamento: ${officialClose} (Dif: ${diff > 0 ? '+' : ''}${diff.toFixed(6)})`
      );

      // Atualiza no histórico
      const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
      if (histIndex !== -1) {
        this.signalHistory[histIndex] = { ...trade };
      } else {
        this.signalHistory.unshift({ ...trade });
      }

      // Alerta sonoro oficial
      if (outcome === 'WIN') audioAlerts.playWin();
      if (outcome === 'LOSS') audioAlerts.playLoss();

      // Dispara evento completo para notificações push, imagem/banner e webhooks
      this.dispatchSignalEvent(trade, 'RESULT');

      updated = true;
      return false; // Remove da lista de pendentes
    });

    if (updated) {
      this.saveHistory(this.lastResolvedTrade || undefined);
      this.notify();
    }
  }

  /**
   * Forçar apuração apenas se o tempo de expiração já foi atingido
   */
  public forceResolveTrade(tradeId: string, currentPrice: number, allCandles?: Candle[]) {
    const trade = this.pendingTrades.find((t) => t.id === tradeId);
    if (!trade) return;
    const nowSec = this.getNowSec();

    // Proteção absoluta: nunca apurar antes da expiração oficial da vela
    if (trade.expirationTimestamp && nowSec < trade.expirationTimestamp) {
      return;
    }

    const activeCandle = allCandles && allCandles.length > 0 ? allCandles[allCandles.length - 1] : undefined;
    this.resolvePendingTrades(currentPrice, nowSec, 0, allCandles, activeCandle);
  }

  /**
   * Generates a Pré-Alerta on demand when the user clicks START for AI confluence analysis
   */
  public generateAiPreAlert(
    assetSymbol: string,
    timeframe: TimeFrame,
    currentPrice: number,
    direction: 'CALL' | 'PUT',
    confluenceScore: number,
    reasons: string[],
    expiration: ExpirationTime = '1m',
    remainingSec: number = 45
  ): SignalRecord {
    const now = this.getNowSec();
    const formattedTime = formatBrasiliaTime();
    const tfSec = (timeframe === 'M2') ? 120 : ((timeframe === 'M1') ? 60 : 300);
    const expirationSeconds = (expiration === '2m' || timeframe === 'M2') ? 120 : ((expiration === '1m' || timeframe === 'M1') ? 60 : 300);
    const currentBoundary = now - (((now % tfSec) + tfSec) % tfSec);
    const targetCandleTime = currentBoundary + tfSec;

    const preAlert: SignalRecord = {
      id: `sig_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      formattedTime,
      asset: assetSymbol,
      timeframe,
      expiration,
      direction,
      stage: 'PRE_ALERT',
      confluenceScore: Math.max(65, Math.min(96, confluenceScore)),
      entryPrice: currentPrice,
      result: 'PENDING',
      reasons: reasons && reasons.length > 0 ? reasons : ['Confluência Técnica Múltipla Identificada'],
      candleCloseTime: targetCandleTime,
      entryTimestamp: targetCandleTime,
      expirationTimestamp: targetCandleTime + expirationSeconds,
      isEstimatedResult: false,
    };

    this.activePreAlert = preAlert;
    this.lastCancelledSignal = null;

    audioAlerts.playPreAlert();
    this.dispatchSignalEvent(preAlert, 'PRE_ALERT');
    this.notify();
    return preAlert;
  }

  /**
   * Cancel the active Pré-Alerta manually or programmatically
   */
  public cancelPreAlert(reason = 'Cancelado para nova análise.') {
    if (this.activePreAlert) {
      const cancelled: SignalRecord = {
        ...this.activePreAlert,
        stage: 'CANCELLED',
        cancelledAt: Date.now(),
        cancelReason: reason,
      };
      this.lastCancelledSignal = cancelled;
      this.lastCancelledTime = Date.now();
      this.activePreAlert = null;
      audioAlerts.playCancelAlert();
      this.dispatchSignalEvent(cancelled, 'CANCELLED');
      this.notify();
    }
  }

  /**
   * Helper to trigger a realistic simulation signal for testing flow:
   * 1. Pré-Alerta (5s) -> 2. Confirmação (Entry) -> 3. Expiração ao vivo -> 4. WIN apurado após zerar cronômetro
   */
  public triggerSimulationSignal(
    direction: 'CALL' | 'PUT' = 'CALL',
    assetSymbol = 'EUR/USD',
    currentPrice = 1.08450,
    timeframe: TimeFrame = 'M1'
  ) {
    const now = this.getNowSec();
    const formattedTime = formatBrasiliaTime();
    // For test simulation, use 25s expiration so user doesn't have to wait 5 minutes
    const simulationExpSec = 25;

    this.lastCancelledSignal = null;

    // 1. Iniciar Pré-Alerta
    const preAlert: SignalRecord = {
      id: `sig_sim_${Date.now()}`,
      timestamp: Date.now(),
      formattedTime,
      asset: assetSymbol,
      timeframe,
      expiration: '1m',
      direction,
      stage: 'PRE_ALERT',
      confluenceScore: 88,
      entryPrice: currentPrice,
      result: 'PENDING',
      reasons: ['Confluência Forte (TradingView + RSI)', 'Rejeição em Order Block', 'Fluxo Institucional Comprador'],
      candleCloseTime: now + 5,
      expirationTimestamp: now + 5 + simulationExpSec,
      isEstimatedResult: false,
    };

    this.activePreAlert = preAlert;
    audioAlerts.playPreAlert();
    this.dispatchSignalEvent(preAlert, 'PRE_ALERT');
    this.notify();

    // 2. Após 5 segundos: Confirmar faltando 10s para a abertura da vela
    setTimeout(() => {
      const confirmedNow = this.getNowSec();
      const entryTimestamp = confirmedNow + 10; // 10 segundos de preparação até a abertura
      const targetExpTimestamp = entryTimestamp + simulationExpSec;
      const entryTimeFormatted = formatBrasiliaTime(entryTimestamp);
      const expirationTimeFormatted = formatBrasiliaTime(targetExpTimestamp);

      const confirmed: SignalRecord = {
        ...preAlert,
        stage: 'CONFIRMED',
        timestamp: Date.now(),
        formattedTime: formatBrasiliaTime(),
        entryTimeFormatted,
        expirationTimeFormatted,
        entryPrice: currentPrice,
        candleOpenPrice: currentPrice,
        isEntered: false,
        entryTimestamp,
        candleCloseTime: entryTimestamp,
        expirationTimestamp: targetExpTimestamp,
      };

      this.activePreAlert = null;
      this.latestConfirmedSignal = confirmed;
      this.latestConfirmedTime = Date.now();

      if (direction === 'CALL') audioAlerts.playCallSignal();
      else audioAlerts.playPutSignal();

      this.dispatchSignalEvent(confirmed, 'CONFIRMED');

      this.pendingTrades.push(confirmed);
      this.signalHistory.unshift(confirmed);
      this.saveHistory();
      this.notify();
    }, 5000);
  }

  /**
   * Helper to trigger a realistic cancellation simulation for testing:
   * 1. Pré-Alerta (4s) -> 2. Invalidação -> 3. SINAL CANCELADO (Proteção de banca)
   */
  public triggerSimulationCancel(
    direction: 'CALL' | 'PUT' = 'CALL',
    assetSymbol = 'EUR/USD',
    currentPrice = 1.08450
  ) {
    const now = this.getNowSec();
    const formattedTime = formatBrasiliaTime();

    const preAlert: SignalRecord = {
      id: `sig_sim_cancel_${Date.now()}`,
      timestamp: Date.now(),
      formattedTime,
      asset: assetSymbol,
      timeframe: 'M1',
      expiration: '1m',
      direction,
      stage: 'PRE_ALERT',
      confluenceScore: 71,
      entryPrice: currentPrice,
      result: 'PENDING',
      reasons: ['Tentativa de rompimento em zona de liquidez'],
      candleCloseTime: now + 4,
      expirationTimestamp: now + 64,
      isEstimatedResult: false,
    };

    this.activePreAlert = preAlert;
    this.lastCancelledSignal = null;
    audioAlerts.playPreAlert();
    this.notify();

    setTimeout(() => {
      const cancelled: SignalRecord = {
        ...preAlert,
        stage: 'CANCELLED',
        cancelledAt: Date.now(),
        cancelReason: 'Confluência enfraqueceu para 48% antes do fechamento. Ordem cancelada para proteção da banca.',
      };
      this.activePreAlert = null;
      this.lastCancelledSignal = cancelled;
      this.lastCancelledTime = Date.now();
      audioAlerts.playCancelAlert();
      this.notify();
    }, 4000);
  }

  private notify() {
    if (this.onSignalsUpdated) {
      this.onSignalsUpdated(
        this.signalHistory,
        this.activePreAlert,
        this.getActiveTrade(),
        this.getLastResolvedTrade(),
        this.getLastCancelledSignal(),
        this.getLatestConfirmedSignal()
      );
    }
  }

  private saveHistory(signalToUpsert?: SignalRecord) {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(this.signalHistory.slice(0, 150)));
      }
    } catch { }

    if (signalToUpsert) {
      upsertSignalToSupabase(signalToUpsert);
    }
  }

  private loadHistory() {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(this.getStorageKey());
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const nowSec = this.getNowSec();
            // Filtrar apenas sinais legítimos executados (eliminando sinais fictícios gerados por seeds anteriores)
            let cleaned = parsed.filter((s) => !s.id.startsWith('seed-'));
            // Recalibra e assegura precisão absoluta em operações expiradas
            cleaned = cleaned.map((s) => {
              const entry = s.candleOpenPrice || s.entryPrice || 0;
              const exit = s.candleClosePrice || s.exitPrice || 0;
              // Se estava pendente mas já expirou antes do app carregar
              if (s.result === 'PENDING' && s.expirationTimestamp && s.expirationTimestamp <= nowSec) {
                if (entry > 0 && exit > 0) {
                  const diff = exit - entry;
                  const EPSILON = 1e-8;
                  let outcome: TradeResult = 'EMPATE';
                  if (s.direction === 'CALL') {
                    outcome = diff > EPSILON ? 'WIN' : (diff < -EPSILON ? 'LOSS' : 'EMPATE');
                  } else if (s.direction === 'PUT') {
                    outcome = diff < -EPSILON ? 'WIN' : (diff > EPSILON ? 'LOSS' : 'EMPATE');
                  }
                  return { ...s, result: outcome, resolvedAt: s.resolvedAt || (s.expirationTimestamp * 1000) };
                }
              }
              if (entry > 0 && exit > 0 && (s.result === 'WIN' || s.result === 'LOSS')) {
                const diff = exit - entry;
                const EPSILON = 1e-8;
                let correctResult = s.result;
                if (s.direction === 'CALL') {
                  correctResult = diff > EPSILON ? 'WIN' : (diff < -EPSILON ? 'LOSS' : 'EMPATE');
                } else if (s.direction === 'PUT') {
                  correctResult = diff < -EPSILON ? 'WIN' : (diff > EPSILON ? 'LOSS' : 'EMPATE');
                }
                if (correctResult !== s.result) {
                  return { ...s, result: correctResult };
                }
              }
              return s;
            });
            this.signalHistory = cleaned;
            this.pendingTrades = this.signalHistory.filter(
              (s) => s.result === 'PENDING' && s.expirationTimestamp > nowSec
            );
            return;
          }
        }
      }
    } catch { }
    this.signalHistory = [];
    this.pendingTrades = [];
  }
}

function generateInitialSeedSignals(): SignalRecord[] {
  return [];
}

export const signalEngine = new SignalEngine();

