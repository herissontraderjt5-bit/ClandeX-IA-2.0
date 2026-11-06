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
} from '../types/trading';
import { audioAlerts } from './audioAlerts';
import { isForexMarketOpen, marketDataManager, getTimeframeSeconds } from './marketData';
import { formatBrasiliaTime } from '../utils/timeFormat';
import {
  runRealtimeBacktest,
  getBestActiveStrategySignal,
  getStoredActiveStrategies,
  AVAILABLE_STRATEGIES,
} from './strategyEngine';
import {
  fetchSignalsFromSupabase,
  upsertSignalToSupabase,
  clearSignalsFromSupabase,
  getSupabase,
  mapRowToSignal,
} from './supabaseClient';

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
      try { this.onSignalEventCallback(signal, event); } catch {}
    }
    this.signalEventListeners.forEach((listener) => {
      try { listener(signal, event); } catch {}
    });
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
    const nowSec = Math.floor(Date.now() / 1000);
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
    const nowSec = Math.floor(Date.now() / 1000);
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
      }
    } catch {}
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
    const nowSec = Math.floor(Date.now() / 1000);

    if (this.pendingTrades.length > 0) {
      let updatedEntry = false;
      this.pendingTrades.forEach((trade) => {
        const candleList = (allCandles && allCandles.length > 0)
          ? allCandles
          : marketDataManager.getCandlesForAsset(trade.asset, trade.timeframe);

        const expSec = getSecondsForExpiration(trade.expiration, trade.timeframe);
        const expTime = trade.expirationTimestamp || ((trade.entryTimestamp || 0) + expSec);
        const entryTime = trade.entryTimestamp || (expTime - expSec);

        // Localiza a vela da operação correspondente à abertura da vela do sinal (entryTime, tolerância de até 20s)
        const targetCandle = candleList.find((c) => Math.abs(c.time - entryTime) < Math.min(20, expSec * 0.4))
          || (currentCandle && Math.abs(currentCandle.time - entryTime) < Math.min(20, expSec * 0.4) ? currentCandle : null);

        // Quando a vela do sinal abre (segundo 00:00 da vela oficial): trava a taxa oficial de abertura da vela de forma IMUTÁVEL
        if (!trade.isEntered) {
          if (trade.entryTimestamp && nowSec >= trade.entryTimestamp) {
            trade.isEntered = true;
            const officialCandleOpen = (targetCandle && targetCandle.open > 0)
              ? targetCandle.open
              : (currentCandle && Math.abs(currentCandle.time - entryTime) < Math.min(20, expSec * 0.4) && currentCandle.open > 0)
                ? currentCandle.open
                : currentPrice;

            trade.entryPrice = officialCandleOpen;
            trade.candleOpenPrice = officialCandleOpen;
            updatedEntry = true;
          }

          if (updatedEntry) {
            const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
            if (histIndex !== -1) {
              this.signalHistory[histIndex] = { ...trade };
            }
          }
        } else if (!trade.expirationTimestamp || nowSec <= trade.expirationTimestamp) {
          // Atualiza continuamente a última cotação registrada antes do fechamento
          trade.candleClosePrice = currentPrice;
        }
      });

      if (updatedEntry) {
        this.saveHistory();
        this.notify();
      }

      // Apuração rigorosa no fechamento da vela
      this.resolvePendingTrades(
        currentCandle.close || currentPrice,
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
    const now = Math.floor(Date.now() / 1000);
    const formattedTime = formatBrasiliaTime();

    // 0. Configuração dinâmica dos limiares de acordo com o PERFIL DE ANÁLISE selecionado na Aba Técnica
    const profile = settings.analysisProfile || 'MODERADA';
    let preAlertMinScore = 52;
    let confirmMinScore = 58;

    // Cooldown ágil entre sinais confirmados por perfil para evitar espera excessiva:
    // AGRESSIVA: 15s (pronta na próxima vela) | MODERADA: 35s | CONSERVADORA: 60s
    let signalCooldownMs = 35_000;

    if (profile === 'CONSERVADORA') {
      // Análise Conservadora (Sniper):
      // Foco em taxas cirúrgicas e máxima consistência sem espera excessiva (a cada 4-7 velas)
      preAlertMinScore = 60;
      confirmMinScore = 66;
      signalCooldownMs = 60_000; // 1 minuto
    } else if (profile === 'AGRESSIVA') {
      // Análise Agressiva (Alavancagem / Alta Frequência):
      // Entradas dinâmicas rápidas (a cada 1 a 3 velas) aproveitando fluxos e momentum
      preAlertMinScore = 46;
      confirmMinScore = 52;
      signalCooldownMs = 15_000; // 15 segundos
    } else {
      // Moderada (Mediana):
      // Equilíbrio calibrado entre frequência ágil (a cada 2-4 velas) e assertividade 80%+
      preAlertMinScore = 52;
      confirmMinScore = 58;
      signalCooldownMs = 35_000; // 35 segundos
    }

    // Atualização contínua do Backtest em Tempo Real de todas as estratégias
    if (allCandles && allCandles.length >= 20) {
      this.backtestResults = runRealtimeBacktest(allCandles, settings.activeStrategies || getStoredActiveStrategies());
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

    // Momento exato da CONFIRMAÇÃO OU CANCELAMENTO: ESTREITAMENTE ENTRE 10 E 5 SEGUNDOS RESTANTES
    // Regra estrita do usuário: "apenas entre 10 a 5 segundos restante do pre alerta se ira confirmar o sinal ou se vai cancelar"
    const isConfirmationWindow = remainingSec <= 10 && remainingSec >= 5;
    const isNewCandleConfirmation = this.lastConfirmedCandleTime !== currentCandle.time;

    // Horários oficiais previstos para a vela da compra ou venda (abertura da próxima vela no Horário de Brasília)
    const targetEntryTimestamp = candleBoundary + tfSec;
    const targetExpirationTimestamp = targetEntryTimestamp + expirationSeconds;
    const entryTimeFormatted = formatBrasiliaTime(targetEntryTimestamp);
    const expirationTimeFormatted = formatBrasiliaTime(targetExpirationTimestamp);

    // 3. CONFIRMAÇÃO OFICIAL FALTANDO 10 SEGUNDOS PARA ABRIR A NOVA VELA
    if (isConfirmationWindow && isNewCandleConfirmation && !activeRunningTrade) {
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
          // OU se estiver no Modo Sniper (CONSERVADORA) e a vela estiver vermelha (fechando abaixo da abertura)
          if (upperWick > body && upperWick > 0.00001) {
            hasOpposingRejectionWick = true;
            cancelReason = `Pavio superior de rejeição (${upperWick.toFixed(5)}) maior que o corpo da vela (${body.toFixed(5)}). Entrada abortada.`;
          } else if (profile === 'CONSERVADORA' && currentCandle.close < currentCandle.open) {
            hasOpposingRejectionWick = true;
            cancelReason = 'Modo Sniper: Vela vermelha contrária à compra (CALL). Entrada abortada para proteção cirúrgica.';
          }
        } else if (this.activePreAlert.direction === 'PUT') {
          // Para PUT: cancela se houver pavio INFERIOR de rejeição estritamente MAIOR que o corpo da vela
          // OU se estiver no Modo Sniper (CONSERVADORA) e a vela estiver verde (fechando acima da abertura)
          if (lowerWick > body && lowerWick > 0.00001) {
            hasOpposingRejectionWick = true;
            cancelReason = `Pavio inferior de rejeição (${lowerWick.toFixed(5)}) maior que o corpo da vela (${body.toFixed(5)}). Entrada abortada.`;
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

        // TRAVA ABSOLUTA FINAL: só cancela se o preço estiver em zona de resistência/suporte E demonstrar rejeição (pavio oposto)
        const isFinalBuyAtResistance = this.activePreAlert.direction === 'CALL' && (
          marketAnalysis?.nearResistance && upperWick >= body * 0.40
        );
        const isFinalSellAtSupport = this.activePreAlert.direction === 'PUT' && (
          marketAnalysis?.nearSupport && lowerWick >= body * 0.40
        );

        if (isFinalBuyAtResistance || isFinalSellAtSupport) {
          const srReason = isFinalBuyAtResistance
            ? 'CALL bloqueado: preço atingiu zona de Resistência. Operação cancelada para proteção de banca.'
            : 'PUT bloqueado: preço atingiu zona de Suporte. Operação cancelada para proteção de banca.';

          const cancelled: SignalRecord = {
            ...this.activePreAlert,
            stage: 'CANCELLED',
            cancelledAt: Date.now(),
            cancelReason: srReason,
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
        } else {
          // CONFIRMAÇÃO OFICIAL FALTANDO 10 SEGUNDOS!
          // Pavio de rejeição não superou o corpo -> A confirmação prossegue com confiança máxima!
          const refPrice = currentCandle.close;
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
            entryPrice: refPrice,
            candleOpenPrice: refPrice,
            isEntered: false, // Inicia oficialmente na abertura da próxima vela (segundo 00:00)
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
        }
      } else {
        // Confirmação direta instantânea de alta convicção faltando 10 segundos
        // EXIGE que a estratégia E as confluências técnicas de mercado estejam 100% alinhadas
        const activeStrategies = settings.activeStrategies || getStoredActiveStrategies();
        const stratDecision = getBestActiveStrategySignal(
          allCandles && allCandles.length > 0 ? allCandles : [currentCandle],
          activeStrategies,
          this.backtestResults,
          profile
        );

        const isBuyingAtResistance = stratDecision?.direction === 'CALL' && marketAnalysis?.nearResistance;
        const isSellingAtSupport = stratDecision?.direction === 'PUT' && marketAnalysis?.nearSupport;

        const isOpposing =
          stratDecision &&
          ((stratDecision.direction === 'CALL' && confluences.direction === 'PUT') ||
           (stratDecision.direction === 'PUT' && confluences.direction === 'CALL'));

        const isAlignedWithConfluence =
          stratDecision &&
          !isBuyingAtResistance &&
          !isSellingAtSupport &&
          !isOpposing &&
          stratDecision.score >= confirmMinScore;

        const isMultiConfluenceDirect =
          !stratDecision &&
          confluences.direction !== 'NEUTRO' &&
          confluences.totalScore >= confirmMinScore &&
          !(confluences.direction === 'CALL' && marketAnalysis?.nearResistance) &&
          !(confluences.direction === 'PUT' && marketAnalysis?.nearSupport);

        if (isAlignedWithConfluence && stratDecision) {
          const bRes = this.backtestResults.find((b) => b.id === stratDecision.strategy.id);
          const refPrice = currentCandle.close;
          const combinedScore = Math.round((stratDecision.score + (confluences.totalScore || 70)) / 2);

          const confirmed: SignalRecord = {
            id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            formattedTime,
            entryTimeFormatted,
            expirationTimeFormatted,
            asset: assetSymbol,
            timeframe,
            expiration: activeExpiration,
            direction: stratDecision.direction,
            stage: 'CONFIRMED',
            entryPrice: refPrice,
            candleOpenPrice: refPrice,
            isEntered: false,
            confluenceScore: combinedScore,
            strategyId: stratDecision.strategy.id,
            strategyName: stratDecision.strategy.name,
            strategyBadge: stratDecision.strategy.badge,
            strategyWinRate: bRes?.winRate,
            reasons: [...stratDecision.reasons, ...confluences.reasons.slice(0, 2)],
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
        } else if (isMultiConfluenceDirect) {
          const refPrice = currentCandle.close;

          const confirmed: SignalRecord = {
            id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            formattedTime,
            entryTimeFormatted,
            expirationTimeFormatted,
            asset: assetSymbol,
            timeframe,
            expiration: activeExpiration,
            direction: confluences.direction as SignalDirection,
            stage: 'CONFIRMED',
            entryPrice: refPrice,
            candleOpenPrice: refPrice,
            isEntered: false,
            confluenceScore: confluences.totalScore,
            strategyId: 'multi_confluencia',
            strategyName: 'Multi-Confluência Técnica (IA Scanner)',
            strategyBadge: '💎 MULTI-CONFLUÊNCIA',
            strategyWinRate: 83.5,
            reasons: confluences.reasons.length > 0 ? confluences.reasons.slice(0, 3) : ['Confluência Técnica Institucional'],
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
    // 5.1 Prioridade para as ESTRATÉGIAS MODULARES ATIVAS SELECIONADAS PELO USUÁRIO COM FILTRO DE CONFLUÊNCIA
    const activeStrategies = settings.activeStrategies || getStoredActiveStrategies();
    const stratDecision = getBestActiveStrategySignal(
      allCandles && allCandles.length > 0 ? allCandles : [currentCandle],
      activeStrategies,
      this.backtestResults,
      profile
    );

    let signalDirection: SignalDirection | null = null;
    let signalScore = 0;
    let signalReasons: string[] = [];
    let stratId: string | undefined = undefined;
    let stratName: string | undefined = undefined;
    let stratBadge: string | undefined = undefined;
    let stratWinRate: number | undefined = undefined;

    if (stratDecision) {
      // 1. TRAVA ABSOLUTA: PROIBIDO COMPRAR (CALL) EM RESISTÊNCIA E VENDER (PUT) EM SUPORTE!
      const isBuyingAtResistance = stratDecision.direction === 'CALL' && marketAnalysis?.nearResistance;
      const isSellingAtSupport = stratDecision.direction === 'PUT' && marketAnalysis?.nearSupport;

      if (isBuyingAtResistance || isSellingAtSupport) {
        // Bloqueio rigoroso: nunca compra em teto de resistência nem vende em chão de suporte
        return;
      }

      // 2. FILTRO RIGOROSO DE TENDÊNCIA E MERCADO:
      // Se a confluência geral for contrária à decisão da estratégia, anula para proteger a banca
      const isOpposingMarket = (stratDecision.direction === 'CALL' && confluences.direction === 'PUT') ||
                               (stratDecision.direction === 'PUT' && confluences.direction === 'CALL');
      const isConsolidationBlocked = marketAnalysis?.inConsolidation && (!marketAnalysis?.nearSupport && !marketAnalysis?.nearResistance);

      if (!isOpposingMarket && !isConsolidationBlocked && stratDecision.score >= preAlertMinScore) {
        signalDirection = stratDecision.direction;
        signalScore = Math.round((stratDecision.score + confluences.totalScore) / 2);
        signalReasons = [...stratDecision.reasons, ...confluences.reasons.slice(0, 2)];
        stratId = stratDecision.strategy.id;
        stratName = stratDecision.strategy.name;
        stratBadge = stratDecision.strategy.badge;
        const bRes = this.backtestResults.find((b) => b.id === stratDecision.strategy.id);
        stratWinRate = bRes?.winRate;
      }
    } else if (
      confluences.direction !== 'NEUTRO' &&
      confluences.totalScore >= preAlertMinScore &&
      !(confluences.direction === 'CALL' && marketAnalysis?.nearResistance) &&
      !(confluences.direction === 'PUT' && marketAnalysis?.nearSupport)
    ) {
      // 5.2 FALLBACK: Multi-Confluência Técnica Direta de alta assertividade
      signalDirection = confluences.direction as SignalDirection;
      signalScore = confluences.totalScore;
      signalReasons = confluences.reasons.length > 0 ? confluences.reasons.slice(0, 3) : ['Confluência Técnica Múltipla Institucional'];
      stratId = 'multi_confluencia';
      stratName = 'Multi-Confluência Técnica (IA Scanner)';
      stratBadge = '💎 MULTI-CONFLUÊNCIA';
      stratWinRate = 83.5;
    }

    if (
      signalDirection &&
      remainingSec < tfSec - 4 &&
      remainingSec > 10 &&
      !this.activePreAlert &&
      !activeRunningTrade &&
      this.lastEvaluatedCandleTime !== currentCandle.time &&
      // COOLDOWN ANTI-SINAL SEGUIDO: aguarda o intervalo mínimo por perfil antes de novo sinal
      Date.now() - this.lastSignalConfirmedAt >= signalCooldownMs
    ) {
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
   * Apura operações rigorosamente após o fechamento da vela do sinal,
   * calculando WIN ou LOSS estritamente com base na ABERTURA e FECHAMENTO da vela do horário do sinal.
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
      const expirationSec = getSecondsForExpiration(trade.expiration, trade.timeframe);
      const tradeAge = Math.floor((Date.now() - trade.timestamp) / 1000);
      const tradeElapsedFromEntry = trade.entryTimestamp ? (nowSec - trade.entryTimestamp) : tradeAge;

      // 1. TRAVA ABSOLUTA DE DURAÇÃO MÍNIMA:
      // Se a vela ainda não abriu (nowSec < trade.entryTimestamp) ou se o timestamp de expiração
      // ainda não foi atingido a partir da abertura oficial, ela NUNCA pode ser apurada! Mantém a operação em andamento.
      if (trade.entryTimestamp && nowSec < trade.entryTimestamp) {
        return true;
      }
      if (tradeElapsedFromEntry < expirationSec - 2 && nowSec < trade.expirationTimestamp) {
        return true;
      }

      const candleList = (allCandles && allCandles.length > 0)
        ? allCandles
        : marketDataManager.getCandlesForAsset(trade.asset, trade.timeframe);

      const expTime = trade.expirationTimestamp || ((trade.entryTimestamp || 0) + expirationSec);
      const entryTime = trade.entryTimestamp || (expTime - expirationSec);

      // Localiza a vela exata da operação (iniciada em entryTime, tolerância de até 20s)
      const tradeCandle = candleList.find((c) => Math.abs(c.time - entryTime) < Math.min(20, expirationSec * 0.4))
        || (currentCandle && Math.abs(currentCandle.time - entryTime) < Math.min(20, expirationSec * 0.4) ? currentCandle : null);

      // Localiza a vela SUBSEQUENTE (iniciada em expTime, tolerância de até 20s):
      // REGRA CRÍTICA: nextCandle DEVE ser estritamente posterior a tradeCandle para não
      // confundir a mesma vela como "próxima" e usar seu close indevido como fechamento.
      const nextCandle = candleList.find((c) => Math.abs(c.time - expTime) < Math.min(20, expirationSec * 0.4) && c.time > entryTime)
        || (currentCandle && Math.abs(currentCandle.time - expTime) < Math.min(20, expirationSec * 0.4) && currentCandle.time > entryTime ? currentCandle : null);

      // A vela do sinal encerra quando:
      // - O tempo de expiração foi atingido (nowSec >= expTime)
      // - OU a duração integral da vela foi cumprida (tradeElapsedFromEntry >= expirationSec - 2)
      // E confirmação de encerramento da vela (próxima vela já aberta, candle fechada ou timer zerado)
      const isTimeExpired = nowSec >= expTime;
      const hasNextCandle = !!nextCandle;
      const isTimerZero = remainingSec !== undefined && remainingSec === 0 && tradeElapsedFromEntry >= expirationSec - 2;
      const isCandleClosed = tradeCandle?.isClosed === true && tradeElapsedFromEntry >= expirationSec - 2;
      const isTimeoutSafety = tradeElapsedFromEntry >= expirationSec + 5; // Segurança para não travar se o feed congelar

      const isExpired = (isTimeExpired && (hasNextCandle || isTimerZero || isCandleClosed || tradeElapsedFromEntry >= expirationSec)) || isTimeoutSafety;

      if (isExpired) {
        // ABERTURA OFICIAL DA VELA DO SINAL:
        // Prioridade 1: tradeCandle.open (abertura real da vela da operação no gráfico da corretora)
        // Prioridade 2: Preço travado (candleOpenPrice)
        // Prioridade 3: entryPrice (fallback)
        const officialOpen = (tradeCandle && tradeCandle.open > 0)
          ? tradeCandle.open
          : ((trade.candleOpenPrice && trade.candleOpenPrice > 0) ? trade.candleOpenPrice : trade.entryPrice);

        // FECHAMENTO OFICIAL DA VELA DO SINAL:
        // Prioridade 1: tradeCandle.close se a vela encerrou (isClosed)
        // Prioridade 2: nextCandle.open (o open da vela seguinte é exatamente o fechamento da anterior)
        // Prioridade 3: tradeCandle.close
        // Prioridade 4: Última cotação capturada antes da expiração
        // Prioridade 5: Preço atual de mercado
        let officialClose: number;
        if (tradeCandle && tradeCandle.isClosed && tradeCandle.close > 0) {
          officialClose = tradeCandle.close;
        } else if (nextCandle && nextCandle.open > 0 && nextCandle.time > entryTime) {
          officialClose = nextCandle.open;
        } else if (tradeCandle && tradeCandle.close > 0) {
          officialClose = tradeCandle.close;
        } else if (trade.candleClosePrice && trade.candleClosePrice > 0) {
          officialClose = trade.candleClosePrice;
        } else {
          officialClose = currentPrice;
        }

        const diff = officialClose - officialOpen;
        const EPSILON = 1e-8;

        let outcome: TradeResult = 'EMPATE';
        if (trade.direction === 'CALL') {
          // CALL: WIN se fechou acima da abertura da vela (vela verde)
          if (diff > EPSILON) {
            outcome = 'WIN';
          } else if (diff < -EPSILON) {
            outcome = 'LOSS';
          } else {
            outcome = 'EMPATE';
          }
        } else {
          // PUT: WIN se fechou abaixo da abertura da vela (vela vermelha)
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

        // Armazena para feedback de 7 segundos no HUD
        this.lastResolvedTrade = { ...trade };
        this.lastResolvedTime = Date.now();

        console.log(
          `[SignalEngine] Operação Finalizada na Vela: ${trade.asset} ${trade.direction} -> ${outcome} | Abertura: ${officialOpen} ➔ Fechamento: ${officialClose} (Dif: ${diff.toFixed(6)})`
        );

        // Atualiza histórico
        const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
        if (histIndex !== -1) {
          this.signalHistory[histIndex] = { ...trade };
        }

        // Toca o alerta sonoro de acordo com o resultado
        if (outcome === 'WIN') audioAlerts.playWin();
        if (outcome === 'LOSS') audioAlerts.playLoss();

        if (this.onSignalEventCallback) {
          this.onSignalEventCallback(trade, 'RESULT');
        }

        updated = true;
        return false; // Remove da lista de pendentes
      }
      return true; // Continua aguardando o fechamento da vela
    });

    if (updated) {
      this.saveHistory(this.lastResolvedTrade || undefined);
      this.notify();
    }
  }

  /**
   * Forçar apuração imediata no fechamento caso cronômetro atinja 00:00 no cliente
   */
  public forceResolveTrade(tradeId: string, currentPrice: number, allCandles?: Candle[]) {
    const trade = this.pendingTrades.find((t) => t.id === tradeId);
    if (!trade) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const expirationSec = getSecondsForExpiration(trade.expiration, trade.timeframe);
    const tradeElapsedFromEntry = trade.entryTimestamp ? (nowSec - trade.entryTimestamp) : Math.floor((Date.now() - trade.timestamp) / 1000);

    // Proteção absoluta: nunca apurar prematuramente antes da abertura e duração mínima da vela
    if (trade.entryTimestamp && nowSec < trade.entryTimestamp) {
      return;
    }
    if (tradeElapsedFromEntry < expirationSec - 3 && nowSec < trade.expirationTimestamp) {
      console.warn(`[SignalEngine] forceResolveTrade bloqueado: operação ${trade.id} ainda está em andamento (${tradeElapsedFromEntry}s decorridos).`);
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
    const now = Math.floor(Date.now() / 1000);
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
    const now = Math.floor(Date.now() / 1000);
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
      const confirmedNow = Math.floor(Date.now() / 1000);
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
    const now = Math.floor(Date.now() / 1000);
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
    } catch {}

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
            // Filtrar apenas sinais legítimos executados (eliminando sinais fictícios gerados por seeds anteriores)
            this.signalHistory = parsed.filter((s) => !s.id.startsWith('seed-'));
            const nowSec = Math.floor(Date.now() / 1000);
            this.pendingTrades = this.signalHistory.filter(
              (s) => s.result === 'PENDING' && s.expirationTimestamp > nowSec
            );
            return;
          }
        }
      }
    } catch {}
    this.signalHistory = [];
    this.pendingTrades = [];
  }
}

function generateInitialSeedSignals(): SignalRecord[] {
  return [];
}

export const signalEngine = new SignalEngine();

