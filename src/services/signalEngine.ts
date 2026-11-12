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

/**
 * Determina se existe um PAVIO DE REJEIÇÃO REAL e significativo.
 * Para evitar falsos alarmes causados por micro-oscilações de spread (0.00001):
 * 1. O pavio deve ter tamanho mínimo real (mínimo de pips ou % da cotação).
 * 2. O pavio deve representar pelo menos 45% de TODA a amplitude da vela (candleRange).
 * 3. O pavio deve ser estritamente maior que o corpo da vela (wick > body).
 * 4. A vela NÃO pode estar fechando rente à extremidade (se fecha na mínima, não há rejeição compradora!).
 */
function isTrueRejectionWick(
  wick: number,
  body: number,
  candleRange: number,
  currentPrice: number,
  direction: 'UPPER' | 'LOWER',
  candle: Candle
): boolean {
  // 1. Limiar mínimo de tamanho para evitar falsos alarmes de ruído
  let minWickSize = 0.00020; // 2.0 pips em pares normais
  if (currentPrice > 1000) minWickSize = currentPrice * 0.0005; // BTC, ETH
  else if (currentPrice > 50) minWickSize = currentPrice * 0.0006; // SOL, BNB
  else if (currentPrice < 5) minWickSize = Math.max(0.00025, currentPrice * 0.0008); // XRP (evita 0.00002)

  // Se o pavio for menor que a oscilação natural mínima de spread, NUNCA é pavio de rejeição
  if (wick < minWickSize) return false;

  // 2. Deve representar pelo menos 45% da amplitude total da vela (formato martelo/pinbar evidente)
  if (candleRange <= 0.00001) return false;
  const wickRatio = wick / candleRange;
  if (wickRatio < 0.45) return false;

  // 3. O pavio deve ser estritamente maior que o corpo da vela
  if (wick <= body) return false;

  // 4. Verificação de fechamento: se estiver fechando perto da mínima para PUT, não há rejeição compradora
  if (direction === 'LOWER') {
    // Rejeição inferior significa que o preço subiu muito em relação à mínima (deixando pavio embaixo)
    // Se o fechamento estiver nos 30% inferiores da vela, ela é uma vela de força vendedora, sem rejeição!
    const distFromLow = candle.close - candle.low;
    if (distFromLow < candleRange * 0.35) return false;
  } else {
    // Rejeição superior significa que o preço caiu muito em relação à máxima
    const distFromHigh = candle.high - candle.close;
    if (distFromHigh < candleRange * 0.35) return false;
  }

  return true;
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
   * Continuous Tick Handler: Desativado conforme comando do usuário.
   */
  public onMarketTick(
    _currentCandle: Candle,
    _remainingSec: number,
    _currentPrice: number,
    _assetSymbol: string,
    _timeframe: TimeFrame,
    _allCandles?: Candle[]
  ) {
    // Sinais e placar desativados
    return;
  }

  public forceResolveTrade(_tradeId: string, _currentPrice: number, _allCandles?: Candle[]) {
    return;
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

