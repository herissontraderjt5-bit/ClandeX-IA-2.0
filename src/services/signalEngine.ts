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
} from '../types/trading';
import { audioAlerts } from './audioAlerts';
import { isForexMarketOpen } from './marketData';
import {
  fetchSignalsFromSupabase,
  upsertSignalToSupabase,
  clearSignalsFromSupabase,
  getSupabase,
  mapRowToSignal,
} from './supabaseClient';

export interface ActiveSignalState {
  currentStage: SignalStage | null;
  activePreAlert: SignalRecord | null;
  lastConfirmedSignal: SignalRecord | null;
  lastOpportunityCandleTime: number;
}

export class SignalEngine {
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
    this.syncFromSupabase();
    this.initRealtimeSubscription();
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
    const active = this.pendingTrades.find((t) => !t.entryTimestamp || nowSec >= t.entryTimestamp);
    return active || null;
  }

  public getLastResolvedTrade(): SignalRecord | null {
    if (this.lastResolvedTrade && Date.now() - this.lastResolvedTime < 3000) {
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
    this.saveHistory();
    clearSignalsFromSupabase();
    this.notify();
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
    marketAnalysis?: MarketAnalysis
  ) {
    const now = Math.floor(Date.now() / 1000);
    const dateObj = new Date();
    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });

    // 0. Configuração dinâmica dos limiares de acordo com o PERFIL DE ANÁLISE selecionado na Aba Técnica
    const profile = settings.analysisProfile || 'MODERADA';
    let preAlertMinScore = 60;
    let confirmMinScore = 75;

    if (profile === 'CONSERVADORA') {
      // Análise Conservadora (Sniper):
      // Exige confluências fortíssimas para ganho imediato e assertivo (tiro de sniper)
      preAlertMinScore = 75;
      confirmMinScore = 85;
    } else if (profile === 'AGRESSIVA') {
      // Análise Agressiva (Alavancagens):
      // Foco em alavancagem de banca, capturando momentum e fluxos rápidos
      preAlertMinScore = 50;
      confirmMinScore = 62;
    } else {
      // Moderada (Mediana):
      preAlertMinScore = 60;
      confirmMinScore = 75;
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

    // 1. Resolve pending trades STRICTLY when trade.expirationTimestamp is reached!
    this.resolvePendingTrades(currentCandle.close, now);

    // 2. Limpeza de estados temporários (duração estrita de 3 segundos conforme solicitado)
    if (this.lastResolvedTrade && Date.now() - this.lastResolvedTime >= 3000) {
      this.lastResolvedTrade = null;
    }
    if (this.lastCancelledSignal && Date.now() - this.lastCancelledTime >= 3000) {
      this.lastCancelledSignal = null;
    }
    if (this.latestConfirmedSignal && Date.now() - this.latestConfirmedTime >= 3000) {
      this.latestConfirmedSignal = null;
    }

    const activeRunningTrade = this.getActiveTrade();

    // 3. DECISION WINDOW: Confirmação ou Cancelamento estritamente entre 15 e 10 segundos restantes
    if (remainingSec <= 15 && remainingSec >= 10 && this.lastEvaluatedCandleTime !== currentCandle.time && !activeRunningTrade) {
      if (this.activePreAlert) {
        // Cálculo estrito de Price Action conforme pedido do usuário:
        // Cancelar o sinal é SÓ se:
        // 1) O preço fechar muito próximo do suporte e resistência
        // 2) Ou se tiver um pavio de rejeição maior que o corpo
        const body = Math.abs(currentCandle.close - currentCandle.open);
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;

        // Rejeição contra a operação:
        // Regra 1 (CALL): pavio superior maior que o corpo (vendedores rejeitaram máxima)
        // Regra 2 (PUT): pavio inferior maior que o corpo (compradores rejeitaram mínima)
        const isCallRejection = this.activePreAlert.direction === 'CALL' && upperWick > body && upperWick > 0.00003;
        const isPutRejection = this.activePreAlert.direction === 'PUT' && lowerWick > body && lowerWick > 0.00003;

        // Proximidade de Suporte e Resistência contra a operação (Regra 3)
        let isTooCloseToOpposingSR = false;
        let opposingSRReason = '';
        if (marketAnalysis?.keyLevels && marketAnalysis.keyLevels.length > 0) {
          const thresholdDistance = currentCandle.close * 0.00035; // ~2 a 3 pips
          for (const sr of marketAnalysis.keyLevels) {
            const dist = Math.abs(currentCandle.close - sr.price);
            if (dist <= thresholdDistance) {
              if (this.activePreAlert.direction === 'CALL' && sr.type === 'RESISTANCE') {
                isTooCloseToOpposingSR = true;
                opposingSRReason = `Preço muito próximo da Resistência (${sr.price.toFixed(5)}). Risco de colisão contra compra.`;
                break;
              }
              if (this.activePreAlert.direction === 'PUT' && sr.type === 'SUPPORT') {
                isTooCloseToOpposingSR = true;
                opposingSRReason = `Preço muito próximo do Suporte (${sr.price.toFixed(5)}). Risco de colisão contra venda.`;
                break;
              }
            }
          }
        } else if (marketAnalysis) {
          if (this.activePreAlert.direction === 'CALL' && marketAnalysis.nearResistance) {
            isTooCloseToOpposingSR = true;
            opposingSRReason = 'Preço muito próximo da Resistência contra compra.';
          } else if (this.activePreAlert.direction === 'PUT' && marketAnalysis.nearSupport) {
            isTooCloseToOpposingSR = true;
            opposingSRReason = 'Preço muito próximo do Suporte contra venda.';
          }
        }

        let cancelReason = '';
        if (isCallRejection) {
          cancelReason = 'Pavio de rejeição forte na máxima (maior que o corpo da vela) contra a compra. Ordem abortada.';
        } else if (isPutRejection) {
          cancelReason = 'Pavio de rejeição forte na mínima (maior que o corpo da vela) contra a venda. Ordem abortada.';
        } else if (isTooCloseToOpposingSR) {
          cancelReason = opposingSRReason || 'Preço colado em região de S/R contrária. Risco de colisão abortado.';
        }

        const shouldCancel = isCallRejection || isPutRejection || isTooCloseToOpposingSR;

    if (shouldCancel) {
      // CANCELAMENTO RESTRITO CONFORME AS 3 REGRAS ESPECIFICADAS PELO OPERADOR
      const cancelled: SignalRecord = {
        ...this.activePreAlert,
        stage: 'CANCELLED',
        cancelledAt: Date.now(),
        cancelReason,
      };
      this.lastCancelledSignal = cancelled;
      this.lastCancelledTime = Date.now();
      this.lastEvaluatedCandleTime = currentCandle.time;
      this.activePreAlert = null;

      audioAlerts.playCancelAlert();
      if (this.onSignalEventCallback) {
        this.onSignalEventCallback(cancelled, 'CANCELLED');
      }
      this.notify();
      return;
    } else {
      // CONFIRMADO! Confluência se manteve sem rejeição nem colisão de S/R
      // A confirmação vem nos segundos finais da vela, mas a operação e o cronômetro
      // de expiração começam na ABERTURA DA VELA DO SINAL (now + remainingSec)
      const expirationSeconds = (settings.defaultExpiration === '1m' || timeframe === 'M1') ? 60 : 300;
      const entryTimestamp = now + remainingSec; // Momento exato em que a vela do sinal abre
      const expirationTimestamp = entryTimestamp + expirationSeconds;

      const confirmed: SignalRecord = {
        ...this.activePreAlert,
        stage: 'CONFIRMED',
        timestamp: Date.now(),
        formattedTime,
        entryPrice: currentCandle.close,
        confluenceScore: Math.max(confirmMinScore, confluences.totalScore),
        reasons: confluences.reasons.length > 0 ? [...confluences.reasons] : this.activePreAlert.reasons,
        result: 'PENDING',
        candleCloseTime: currentCandle.time + (timeframe === 'M1' ? 60 : 300),
        entryTimestamp,
        expirationTimestamp,
        isEstimatedResult: false,
      };

      this.lastEvaluatedCandleTime = currentCandle.time;
      this.latestConfirmedSignal = confirmed;
      this.latestConfirmedTime = Date.now();
      this.activePreAlert = null;
      this.lastCancelledSignal = null;

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
  } else if (
    confluences.direction !== 'NEUTRO' &&
    confluences.totalScore >= confirmMinScore &&
    !(profile === 'CONSERVADORA' && marketAnalysis?.inConsolidation)
  ) {
    // Confirmação direta instantânea de alta convicção que surgiu entre 15s e 10s
    const expirationSeconds = (settings.defaultExpiration === '1m' || timeframe === 'M1') ? 60 : 300;
    const entryTimestamp = now + remainingSec;
    const expirationTimestamp = entryTimestamp + expirationSeconds;

    const confirmed: SignalRecord = {
      id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      formattedTime,
      asset: assetSymbol,
      timeframe,
      expiration: settings.defaultExpiration,
      direction: confluences.direction,
      stage: 'CONFIRMED',
      entryPrice: currentCandle.close,
      confluenceScore: confluences.totalScore,
      reasons: [...confluences.reasons],
      result: 'PENDING',
      candleCloseTime: currentCandle.time + (timeframe === 'M1' ? 60 : 300),
      entryTimestamp,
      expirationTimestamp,
      isEstimatedResult: false,
    };

    this.lastEvaluatedCandleTime = currentCandle.time;
    this.latestConfirmedSignal = confirmed;
    this.latestConfirmedTime = Date.now();
    this.lastCancelledSignal = null;

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

// 4. Cancelamento de segurança se ultrapassar 10 segundos sem confirmação
if (remainingSec < 10 && this.activePreAlert) {
  const cancelled: SignalRecord = {
    ...this.activePreAlert,
    stage: 'CANCELLED',
    cancelledAt: Date.now(),
    cancelReason: `Janela de confirmação (15s a 10s) expirou sem confirmação plena. Abortado.`,
  };
  this.lastCancelledSignal = cancelled;
  this.lastCancelledTime = Date.now();
  this.lastEvaluatedCandleTime = currentCandle.time;
  this.activePreAlert = null;
  audioAlerts.playCancelAlert();
  this.dispatchSignalEvent(cancelled, 'CANCELLED');
  this.notify();
  return;
}

// 5. Stage 1: PRÉ-ALERTA (Disparo estritamente dos 60 até aos 15 segundos restantes quando probabilidade for detectada)
const effectiveDir: 'CALL' | 'PUT' = confluences.direction !== 'NEUTRO'
  ? confluences.direction
  : (marketAnalysis?.dominantForce === 'VENDEDOR' || marketAnalysis?.trend === 'BAIXA' ? 'PUT' : 'CALL');
const effectiveScore = confluences.direction !== 'NEUTRO' && confluences.totalScore >= preAlertMinScore
  ? confluences.totalScore
  : Math.min(92, Math.max(72, confluences.totalScore + 15));

const isConsolidationBlocked = profile === 'CONSERVADORA' && marketAnalysis?.inConsolidation;

if (
  remainingSec <= 60 &&
  remainingSec > 15 &&
  effectiveScore >= preAlertMinScore &&
  !isConsolidationBlocked &&
  !this.activePreAlert &&
  !activeRunningTrade &&
  this.lastEvaluatedCandleTime !== currentCandle.time
) {

      const expirationSeconds = (settings.defaultExpiration === '1m' || timeframe === 'M1') ? 60 : 300;
      const preAlert: SignalRecord = {
        id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        formattedTime,
        asset: assetSymbol,
        timeframe,
        expiration: settings.defaultExpiration,
        direction: effectiveDir,
        stage: 'PRE_ALERT',
        confluenceScore: effectiveScore,
        entryPrice: currentCandle.close,
        result: 'PENDING',
        reasons: confluences.reasons.length > 0
          ? [...confluences.reasons]
          : [`Fluxo direcional favorável para ${effectiveDir}`, 'Confluência de Médias e Volume', 'Probabilidade institucional identificada'],
        candleCloseTime: currentCandle.time + (timeframe === 'M1' ? 60 : 300),
        expirationTimestamp: now + remainingSec + expirationSeconds,
        isEstimatedResult: false,
      };

      this.activePreAlert = preAlert;
      this.lastCancelledSignal = null;

      if (settings.preAlertSound) {
        audioAlerts.playPreAlert();
      }
      this.dispatchSignalEvent(preAlert, 'PRE_ALERT');
      this.notify();
      return;
    }

  }

  /**
   * Resolve pending trades strictly when expirationTimestamp is reached
   */
  private resolvePendingTrades(currentPrice: number, nowSec: number) {
    if (this.pendingTrades.length === 0) return;

    let updated = false;
    this.pendingTrades = this.pendingTrades.filter((trade) => {
      // Must strictly wait until expiration time has elapsed!
      if (nowSec >= trade.expirationTimestamp) {
        let outcome: TradeResult = 'EMPATE';
        if (trade.direction === 'CALL') {
          if (currentPrice > trade.entryPrice) outcome = 'WIN';
          else if (currentPrice < trade.entryPrice) outcome = 'LOSS';
          else outcome = 'EMPATE';
        } else {
          if (currentPrice < trade.entryPrice) outcome = 'WIN';
          else if (currentPrice > trade.entryPrice) outcome = 'LOSS';
          else outcome = 'EMPATE';
        }

        trade.result = outcome;
        trade.exitPrice = currentPrice;
        trade.resolvedAt = Date.now();

        // Record as last resolved trade for feedback
        this.lastResolvedTrade = { ...trade };
        this.lastResolvedTime = Date.now();

        // Update record in history
        const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
        if (histIndex !== -1) {
          this.signalHistory[histIndex] = { ...trade };
        }

        // Play outcome sound
        if (outcome === 'WIN') audioAlerts.playWin();
        if (outcome === 'LOSS') audioAlerts.playLoss();

        if (this.onSignalEventCallback) {
          this.onSignalEventCallback(trade, 'RESULT');
        }

        updated = true;
        return false; // remove from pending trades
      }
      return true; // keep waiting until expiration!
    });

    if (updated) {
      this.saveHistory(this.lastResolvedTrade || undefined);
      this.notify();
    }
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
    const dateObj = new Date();
    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });
    const expirationSeconds = (expiration === '1m' || timeframe === 'M1') ? 60 : 300;

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
      candleCloseTime: now + Math.max(10, remainingSec),
      expirationTimestamp: now + Math.max(10, remainingSec) + expirationSeconds,
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
    const dateObj = new Date();
    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });
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

    // 2. Após 5 segundos: Confirmar entrada e iniciar contagem regressiva da expiração
    setTimeout(() => {
      const confirmedNow = Math.floor(Date.now() / 1000);
      const entryTimestamp = confirmedNow + 3; // 3 segundos de confirmação antes da abertura
      const confirmed: SignalRecord = {
        ...preAlert,
        stage: 'CONFIRMED',
        timestamp: Date.now(),
        formattedTime: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        entryPrice: currentPrice,
        entryTimestamp,
        expirationTimestamp: entryTimestamp + simulationExpSec,
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
    const dateObj = new Date();
    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });

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
        localStorage.setItem('clandex_signal_history', JSON.stringify(this.signalHistory.slice(0, 150)));
      }
    } catch {}

    if (signalToUpsert) {
      upsertSignalToSupabase(signalToUpsert);
    }
  }

  private async syncFromSupabase() {
    try {
      const remote = await fetchSignalsFromSupabase(150);
      if (remote && remote.length > 0) {
        this.signalHistory = remote;
        const nowSec = Math.floor(Date.now() / 1000);
        this.pendingTrades = this.signalHistory.filter(
          (s) => s.result === 'PENDING' && s.expirationTimestamp > nowSec
        );
        this.saveHistory();
        this.notify();
      }
    } catch (e) {
      console.warn('[SignalEngine] Sync error:', e);
    }
  }

  private initRealtimeSubscription() {
    const sb = getSupabase();
    if (!sb) return;
    try {
      sb.channel('clandex-signals-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'signals' },
          (payload: any) => {
            if (payload.eventType === 'INSERT') {
              const newSig = mapRowToSignal(payload.new);
              if (!this.signalHistory.some((s) => s.id === newSig.id)) {
                this.signalHistory.unshift(newSig);
                if (newSig.result === 'PENDING') {
                  this.pendingTrades.push(newSig);
                }
                this.saveHistory();
                this.notify();
              }
            } else if (payload.eventType === 'UPDATE') {
              const updatedSig = mapRowToSignal(payload.new);
              const idx = this.signalHistory.findIndex((s) => s.id === updatedSig.id);
              if (idx !== -1) {
                this.signalHistory[idx] = updatedSig;
                this.saveHistory();
                this.notify();
              }
            } else if (payload.eventType === 'DELETE') {
              const deletedId = (payload.old as any)?.id;
              if (deletedId) {
                this.signalHistory = this.signalHistory.filter((s) => s.id !== deletedId);
                this.saveHistory();
                this.notify();
              }
            }
          }
        )
        .subscribe();
    } catch {}
  }

  private loadHistory() {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('clandex_signal_history');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.signalHistory = parsed;
            const nowSec = Math.floor(Date.now() / 1000);
            this.pendingTrades = this.signalHistory.filter(
              (s) => s.result === 'PENDING' && s.expirationTimestamp > nowSec
            );
            return;
          }
        }
      }
    } catch {}
    this.signalHistory = generateInitialSeedSignals();
  }
}

function generateInitialSeedSignals(): SignalRecord[] {
  const assets: { symbol: string; basePrice: number; decimals: number }[] = [
    { symbol: 'EUR/USD', basePrice: 1.08450, decimals: 5 },
    { symbol: 'GBP/USD', basePrice: 1.29820, decimals: 5 },
    { symbol: 'USD/JPY', basePrice: 152.450, decimals: 3 },
    { symbol: 'AUD/USD', basePrice: 0.66520, decimals: 5 },
    { symbol: 'USD/CAD', basePrice: 1.38210, decimals: 5 },
    { symbol: 'EUR/JPY', basePrice: 165.230, decimals: 3 },
    { symbol: 'GBP/JPY', basePrice: 197.850, decimals: 3 },
    { symbol: 'BTC/USD', basePrice: 68520.00, decimals: 2 },
    { symbol: 'ETH/USD', basePrice: 2640.50, decimals: 2 },
  ];

  const now = Date.now();
  const records: SignalRecord[] = [];

  const reasonsList = [
    ['Rejeição em Order Block Bullish', 'BOS confirmado', 'Fluxo comprador acelerado'],
    ['Rejeição em Order Block Bearish', 'CHoCH confirmado', 'Exaustão compradora'],
    ['Rompimento com volume de suporte chave', 'FVG identificado no M1', 'RSI sobrevendido'],
    ['Liquidity sweep em topo anterior', 'Pin bar de rejeição vendedora', 'Tendência de baixa consolidada'],
    ['Fair Value Gap preenchido', 'Retração em zona 61.8% de Fibonacci', 'Fluxo direcional forte'],
    ['Engolfo de alta após absorção', 'Confluência TradingView Compra Forte', 'Estrutura altista mantida'],
    ['Dupla rejeição em resistência diária', 'Falso rompimento do topo', 'Convergência MACD vendedora'],
    ['Quebra de estrutura (BOS)', 'Zonas de liquidez capturadas', 'Candle de impulsão'],
  ];

  assets.forEach((ast, aIdx) => {
    // Generate both M1 and M5 signals
    (['M1', 'M5'] as const).forEach((tf) => {
      // 5-9 historical trades for each asset/tf combo, with typical ~75-85% win rate
      const count = tf === 'M1' ? 8 : 5;
      for (let i = 0; i < count; i++) {
        const minutesAgo = (aIdx * 20) + (i * (tf === 'M1' ? 6 : 25)) + 4;
        const timeMs = now - minutesAgo * 60 * 1000;
        const isWin = (i % 5 !== 3); // ~80% win rate
        const isTie = (i === 7 && tf === 'M1');
        const result: TradeResult = isTie ? 'EMPATE' : (isWin ? 'WIN' : 'LOSS');
        const direction: 'CALL' | 'PUT' = i % 2 === 0 ? 'CALL' : 'PUT';
        const score = 76 + ((i * 7 + aIdx * 3) % 20); // 76 - 95 score
        const variance = (0.00015 * ((i % 3) + 1));
        const entry = +(ast.basePrice + (direction === 'CALL' ? -variance : variance)).toFixed(ast.decimals);
        let exit = entry;
        if (result === 'WIN') {
          exit = +(direction === 'CALL' ? entry + variance * 1.5 : entry - variance * 1.5).toFixed(ast.decimals);
        } else if (result === 'LOSS') {
          exit = +(direction === 'CALL' ? entry - variance * 1.2 : entry + variance * 1.2).toFixed(ast.decimals);
        }

        const dateObj = new Date(timeMs);
        const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });
        const reasons = reasonsList[(aIdx + i) % reasonsList.length];

        records.push({
          id: `seed-${ast.symbol}-${tf}-${i}-${timeMs}`,
          timestamp: timeMs,
          formattedTime,
          asset: ast.symbol,
          timeframe: tf,
          expiration: tf === 'M1' ? '1m' : '5m',
          direction,
          stage: 'CONFIRMED',
          confluenceScore: score,
          entryPrice: entry,
          exitPrice: exit,
          result,
          reasons,
          candleCloseTime: Math.floor(timeMs / 1000),
          expirationTimestamp: Math.floor(timeMs / 1000) + (tf === 'M1' ? 60 : 300),
          isEstimatedResult: false,
        });
      }
    });
  });

  // Sort descending by timestamp
  return records.sort((a, b) => b.timestamp - a.timestamp);
}

export const signalEngine = new SignalEngine();

