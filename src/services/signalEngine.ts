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
import { isForexMarketOpen, marketDataManager } from './marketData';
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
  private lastConfirmedCandleTime = 0;
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
    const active = this.pendingTrades.find(
      (t) => (!t.entryTimestamp || nowSec >= t.entryTimestamp) && t.result === 'PENDING' && nowSec < t.expirationTimestamp
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
    this.saveHistory();
    clearSignalsFromSupabase();
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

        const targetTime = trade.entryTimestamp || trade.candleCloseTime;
        const targetCandle = candleList.find((c) => Math.abs(c.time - targetTime) < 5) ||
          (currentCandle && Math.abs(currentCandle.time - targetTime) < 5 ? currentCandle : null);

        // Quando a vela do sinal abre: registra oficialmente o preço de abertura da vela
        if (!trade.isEntered) {
          if (targetCandle) {
            trade.isEntered = true;
            trade.entryPrice = targetCandle.open;
            trade.candleOpenPrice = targetCandle.open;
            updatedEntry = true;
          } else if (trade.entryTimestamp && nowSec >= trade.entryTimestamp) {
            trade.isEntered = true;
            const openPrice = currentCandle.open || currentPrice;
            trade.entryPrice = openPrice;
            trade.candleOpenPrice = openPrice;
            updatedEntry = true;
          }

          if (updatedEntry) {
            const histIndex = this.signalHistory.findIndex((s) => s.id === trade.id);
            if (histIndex !== -1) {
              this.signalHistory[histIndex] = { ...trade };
            }
          }
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
    const dateObj = new Date();
    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour12: false });

    // 0. Configuração dinâmica dos limiares de acordo com o PERFIL DE ANÁLISE selecionado na Aba Técnica
    const profile = settings.analysisProfile || 'MODERADA';
    let preAlertMinScore = 68;
    let confirmMinScore = 75;

    if (profile === 'CONSERVADORA') {
      // Análise Conservadora (Sniper):
      // Exige confluências fortíssimas para ganho imediato e assertivo (tiro de sniper)
      preAlertMinScore = 78;
      confirmMinScore = 82;
    } else if (profile === 'AGRESSIVA') {
      // Análise Agressiva (Alavancagens):
      // Foco em alavancagem de banca, capturando momentum e fluxos rápidos
      preAlertMinScore = 58;
      confirmMinScore = 68;
    } else {
      // Moderada (Mediana):
      preAlertMinScore = 68;
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
    const tfSec = (timeframe === 'M2') ? 120 : ((timeframe === 'M1') ? 60 : 300);
    const expirationSeconds = (settings.defaultExpiration === '2m' || timeframe === 'M2') ? 120 : ((settings.defaultExpiration === '1m' || timeframe === 'M1') ? 60 : 300);

    // Momento exato da ABERTURA DA VELA (segundo 00:00 ou primeiros 2 segundos da nova vela)
    const isAtCandleOpening = remainingSec >= tfSec - 2;
    const isNewCandle = this.lastConfirmedCandleTime !== currentCandle.time;

    // 3. CONFIRMAÇÃO EXATA NA ABERTURA DA VELA (SEGUNDO 00:00)
    if (isAtCandleOpening && isNewCandle && !activeRunningTrade) {
      if (this.activePreAlert) {
        // Validação da confluência no momento exato em que a vela abre
        const directionMatches = confluences.direction === this.activePreAlert.direction;
        const scoreSufficient = confluences.totalScore >= confirmMinScore;

        const isConsolidationTrap = (profile === 'CONSERVADORA' || profile === 'MODERADA') &&
          marketAnalysis?.inConsolidation && (!marketAnalysis?.nearSupport && !marketAnalysis?.nearResistance);

        if (!directionMatches || !scoreSufficient || isConsolidationTrap) {
          // CANCELAMENTO NA ABERTURA (PROTEÇÃO DE BANCA)
          let cancelReason = '';
          if (!directionMatches) {
            cancelReason = 'Vela anterior fechou sem confirmação do direcionamento técnico. Entrada abortada.';
          } else if (!scoreSufficient) {
            cancelReason = `Pontuação insuficiente na abertura da vela (${confluences.totalScore}/${confirmMinScore} pts). Evitando LOSS.`;
          } else if (isConsolidationTrap) {
            cancelReason = 'Mercado lateralizado sem rejeição de extremidade. Entrada abortada.';
          }

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
        } else {
          // CONFIRMAÇÃO OFICIAL NA ABERTURA DA VELA!
          const entryPrice = currentCandle.open;
          const confirmed: SignalRecord = {
            ...this.activePreAlert,
            id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            stage: 'CONFIRMED',
            timestamp: Date.now(),
            formattedTime,
            entryPrice,
            candleOpenPrice: entryPrice,
            isEntered: true, // Já inicia operando no segundo 00 da nova vela!
            confluenceScore: confluences.totalScore,
            reasons: confluences.reasons.length > 0 ? [...confluences.reasons] : this.activePreAlert.reasons,
            result: 'PENDING',
            candleCloseTime: currentCandle.time,
            entryTimestamp: currentCandle.time,
            expirationTimestamp: currentCandle.time + expirationSeconds,
            isEstimatedResult: false,
          };

          this.lastConfirmedCandleTime = currentCandle.time;
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
        !(marketAnalysis?.inConsolidation && (!marketAnalysis?.nearSupport && !marketAnalysis?.nearResistance))
      ) {
        // Confirmação direta instantânea de alta convicção que abriu na nova vela
        const entryPrice = currentCandle.open;
        const confirmed: SignalRecord = {
          id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
          formattedTime,
          asset: assetSymbol,
          timeframe,
          expiration: settings.defaultExpiration,
          direction: confluences.direction,
          stage: 'CONFIRMED',
          entryPrice,
          candleOpenPrice: entryPrice,
          isEntered: true,
          confluenceScore: confluences.totalScore,
          reasons: [...confluences.reasons],
          result: 'PENDING',
          candleCloseTime: currentCandle.time,
          entryTimestamp: currentCandle.time,
          expirationTimestamp: currentCandle.time + expirationSeconds,
          isEstimatedResult: false,
        };

        this.lastConfirmedCandleTime = currentCandle.time;
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

    // 4. CANCELAMENTO DO PRÉ-ALERTA SE HOUVER REVERSÃO FORTE DURANTE O FECHAMENTO DA VELA ANTERIOR
    if (this.activePreAlert && remainingSec < tfSec - 3 && remainingSec <= 15) {
      const body = Math.abs(currentCandle.close - currentCandle.open);
      const range = Math.max(currentCandle.high - currentCandle.low, 0.00001);
      const minBodyReversal = range * 0.40;

      const isCallReversal = this.activePreAlert.direction === 'CALL' && (
        (currentCandle.close < currentCandle.open && body > minBodyReversal) ||
        confluences.direction === 'PUT'
      );
      const isPutReversal = this.activePreAlert.direction === 'PUT' && (
        (currentCandle.close > currentCandle.open && body > minBodyReversal) ||
        confluences.direction === 'CALL'
      );

      if (isCallReversal || isPutReversal) {
        const cancelled: SignalRecord = {
          ...this.activePreAlert,
          stage: 'CANCELLED',
          cancelledAt: Date.now(),
          cancelReason: 'Vela reverteu nos segundos finais antes da abertura. Pré-alerta abortado.',
        };
        this.lastCancelledSignal = cancelled;
        this.lastCancelledTime = Date.now();
        this.activePreAlert = null;
        audioAlerts.playCancelAlert();
        this.dispatchSignalEvent(cancelled, 'CANCELLED');
        this.notify();
        return;
      }
    }

    // 5. STAGE 1: PRÉ-ALERTA (Aviso prévio durante o corpo da vela atual para confirmação na abertura da próxima)
    if (confluences.direction === 'NEUTRO' || confluences.totalScore < preAlertMinScore) {
      return;
    }

    const isConsolidationBlocked = marketAnalysis?.inConsolidation && (!marketAnalysis?.nearSupport && !marketAnalysis?.nearResistance);

    if (
      remainingSec < tfSec - 4 &&
      remainingSec >= 3 &&
      confluences.totalScore >= preAlertMinScore &&
      !isConsolidationBlocked &&
      !this.activePreAlert &&
      !activeRunningTrade &&
      this.lastEvaluatedCandleTime !== currentCandle.time
    ) {
      const targetCandleTime = currentCandle.time + tfSec;
      const preAlert: SignalRecord = {
        id: `sig_pre_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        formattedTime,
        asset: assetSymbol,
        timeframe,
        expiration: settings.defaultExpiration,
        direction: confluences.direction,
        stage: 'PRE_ALERT',
        confluenceScore: confluences.totalScore,
        entryPrice: currentCandle.close,
        result: 'PENDING',
        reasons: confluences.reasons.length > 0
          ? [...confluences.reasons]
          : [`Fluxo direcional favorável para ${confluences.direction}`, 'Confluência de Médias e Volume', 'Probabilidade institucional identificada'],
        candleCloseTime: targetCandleTime,
        entryTimestamp: targetCandleTime,
        expirationTimestamp: targetCandleTime + expirationSeconds,
        isEstimatedResult: false,
      };

      this.activePreAlert = preAlert;
      this.lastCancelledSignal = null;
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
      const candleList = (allCandles && allCandles.length > 0)
        ? allCandles
        : marketDataManager.getCandlesForAsset(trade.asset, trade.timeframe);

      const targetTime = trade.entryTimestamp || trade.candleCloseTime;
      // Localiza a vela correspondente ao horário do sinal no gráfico
      const targetCandle = candleList.find((c) => Math.abs(c.time - targetTime) < 5) ||
        (currentCandle && Math.abs(currentCandle.time - targetTime) < 5 ? currentCandle : null);

      // A vela do sinal é considerada oficialmente encerrada quando:
      // 1. Já existe vela subsequente no histórico (time > targetTime + 2)
      // 2. A própria vela do sinal tem isClosed === true
      // 3. O timestamp de expiração foi atingido (nowSec >= trade.expirationTimestamp)
      // 4. O cronômetro zerou no momento exato de encerramento da vela
      const hasNextCandle = candleList.some((c) => c.time > targetTime + 2);
      const isCandleClosed = targetCandle?.isClosed === true;
      const isTimeExpired = nowSec >= trade.expirationTimestamp;
      const isTimerZero = remainingSec !== undefined && remainingSec === 0 && nowSec >= trade.expirationTimestamp - 1;

      const isExpired = hasNextCandle || isCandleClosed || isTimeExpired || isTimerZero;

      if (isExpired) {
        // Taxa de abertura oficial da vela do sinal
        const officialOpen = targetCandle ? targetCandle.open : (trade.candleOpenPrice || trade.entryPrice);
        // Taxa de fechamento oficial da vela do sinal
        const officialClose = targetCandle ? targetCandle.close : currentPrice;

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
    trade.expirationTimestamp = nowSec;
    this.resolvePendingTrades(currentPrice, nowSec, 0, allCandles);
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
        candleOpenPrice: currentPrice,
        isEntered: false,
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
  }
}

function generateInitialSeedSignals(): SignalRecord[] {
  return [];
}

export const signalEngine = new SignalEngine();

