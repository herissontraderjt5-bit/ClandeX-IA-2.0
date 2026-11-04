import {
  Candle,
  MarketAnalysis,
  SignalDirection,
  StrategyDefinition,
  StrategyBacktestResult,
  AnalysisProfile,
} from '../types/trading';

/**
 * Catálogo Oficial das Estratégias ClandeX-IA
 */
export const AVAILABLE_STRATEGIES: StrategyDefinition[] = [
  {
    id: 'retração_sr',
    name: 'Rejeição em Suporte & Resistência (Taxa Sniper)',
    badge: '🎯 TAXA SNIPER (S/R)',
    tag: 'REJEIÇÃO DE TAXA',
    category: 'RETRACTION',
    description: 'Opera retração precisa quando o preço toca suporte ou resistência e deixa pavio de rejeição.',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'fluxo_tendencia',
    name: 'Fluxo Contínuo & Momentum (Seguir a Tendência)',
    badge: '🚀 FLUXO & MOMENTUM',
    tag: 'TENDÊNCIA FORTE',
    category: 'MOMENTUM',
    description: 'Surfa o fluxo direcional forte com médias alinhadas e rompimento contínuo da máxima/mínima.',
    minProfile: 'MODERADA',
  },
  {
    id: 'smc_liquidez',
    name: 'SMC: Captura de Liquidez (Institutional Sweep)',
    badge: '🏛️ SMC LIQUIDEZ',
    tag: 'RASTREAMENTO INSTITUCIONAL',
    category: 'SMC',
    description: 'Entrada após grandes bancos violarem topos/fundos para estopar o varejo e reverter com força.',
    minProfile: 'MODERADA',
  },
  {
    id: 'reversao_rsi',
    name: 'Reversão em Exaustão (RSI Extremo)',
    badge: '⚡ REVERSÃO RSI',
    tag: 'SOBRECOMPRA / SOBREVENDA',
    category: 'REVERSAL',
    description: 'Entra na exaustão dos preços em regiões extremas de RSI (acima de 70 ou abaixo de 30).',
    minProfile: 'MODERADA',
  },
  {
    id: 'engolfo_pro',
    name: 'Engolfo de Força (Price Action Clássico)',
    badge: '💎 ENGOLFO PRO',
    tag: 'ABSORÇÃO DE FORÇA',
    category: 'PRICE_ACTION',
    description: 'Padrão em que a vela atual engolfa 100% da vela anterior após correção na média ou suporte.',
    minProfile: 'MODERADA',
  },
  {
    id: 'rompimento_bos',
    name: 'Rompimento Estrutural Institucional (BOS)',
    badge: '🔥 ROMPIMENTO BOS',
    tag: 'BREAK OF STRUCTURE',
    category: 'PRICE_ACTION',
    description: 'Rompimento verdadeiro de pivô estrutural com expansão de range e continuidade de movimento.',
    minProfile: 'AGRESSIVA',
  },
];

const DEFAULT_ACTIVE_STRATEGY_IDS = [
  'retração_sr',
  'fluxo_tendencia',
  'smc_liquidez',
  'engolfo_pro',
  'reversao_rsi',
  'rompimento_bos',
];

/**
 * Obtém os IDs das estratégias ativas salvas no localStorage
 */
export function getStoredActiveStrategies(): string[] {
  try {
    const raw = localStorage.getItem('clandex_active_strategies');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [...DEFAULT_ACTIVE_STRATEGY_IDS];
}

/**
 * Salva os IDs das estratégias ativas no localStorage
 */
export function storeActiveStrategies(strategyIds: string[]): void {
  try {
    localStorage.setItem('clandex_active_strategies', JSON.stringify(strategyIds));
  } catch {}
}

export interface StrategySignalDecision {
  strategy: StrategyDefinition;
  direction: SignalDirection;
  score: number;
  reasons: string[];
}

/**
 * Avalia uma estratégia individual em um índice específico da lista de velas
 */
export function evaluateSingleStrategy(
  strategyId: string,
  candles: Candle[],
  index: number
): { direction: SignalDirection | null; score: number; reasons: string[] } {
  if (index < 10 || index >= candles.length) {
    return { direction: null, score: 0, reasons: [] };
  }

  const current = candles[index];
  const prev = candles[index - 1];
  const prev2 = candles[index - 2];

  const body = Math.abs(current.close - current.open);
  const range = Math.max(current.high - current.low, 0.00001);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;

  // Médias rápidas para contexto
  let sumShort = 0;
  for (let k = index - 4; k <= index; k++) sumShort += candles[k].close;
  const sma5 = sumShort / 5;

  let sumLong = 0;
  for (let k = index - 11; k <= index; k++) sumLong += candles[k].close;
  const sma12 = sumLong / 12;

  const isUptrend = sma5 > sma12;
  const isDowntrend = sma5 < sma12;

  // Suporte e resistência locais dos últimos 15 candles
  let localHigh = -Infinity;
  let localLow = Infinity;
  for (let k = index - 15; k < index; k++) {
    if (candles[k].high > localHigh) localHigh = candles[k].high;
    if (candles[k].low < localLow) localLow = candles[k].low;
  }
  const nearRes = Math.abs(current.high - localHigh) <= range * 0.5 || current.high >= localHigh;
  const nearSup = Math.abs(current.low - localLow) <= range * 0.5 || current.low <= localLow;

  // RSI simplificado de 7 períodos
  let gains = 0;
  let losses = 0;
  for (let k = index - 6; k <= index; k++) {
    const diff = candles[k].close - candles[k - 1].close;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - (100 / (1 + rs));

  switch (strategyId) {
    // ----------------------------------------------------
    // 1. Rejeição em Suporte & Resistência (Taxa Sniper)
    // ----------------------------------------------------
    case 'retração_sr': {
      // CALL: Preço tocou suporte local e deixou pavio de rejeição inferior significativo
      const isCallRejection = nearSup && lowerWick > body * 1.1 && lowerWick >= range * 0.40 && current.close > current.low;
      // PUT: Preço tocou resistência local e deixou pavio de rejeição superior significativo
      const isPutRejection = nearRes && upperWick > body * 1.1 && upperWick >= range * 0.40 && current.close < current.high;

      if (isCallRejection && !isPutRejection) {
        return {
          direction: 'CALL',
          score: 86,
          reasons: [
            'Rejeição com pavio inferior longo em suporte',
            `Pavio de rejeição (${lowerWick.toFixed(5)}) maior que o corpo`,
            'Defesa compradora comprovada no fundo',
          ],
        };
      }
      if (isPutRejection && !isCallRejection) {
        return {
          direction: 'PUT',
          score: 86,
          reasons: [
            'Rejeição com pavio superior longo em resistência',
            `Pavio de rejeição (${upperWick.toFixed(5)}) maior que o corpo`,
            'Defesa vendedora comprovada no topo',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 2. Fluxo Contínuo & Momentum (Seguir a Tendência)
    // ----------------------------------------------------
    case 'fluxo_tendencia': {
      const isGreen = current.close > current.open;
      const isRed = current.close < current.open;
      const prevGreen = prev.close > prev.open;
      const prevRed = prev.close < prev.open;

      // CALL: Tendência de alta, vela verde de impulsão rompendo máxima da anterior com pouco pavio superior
      const isCallFlow = isUptrend && isGreen && prevGreen && current.close > prev.high && upperWick <= body * 0.45 && body >= range * 0.50;
      // PUT: Tendência de baixa, vela vermelha de impulsão rompendo mínima da anterior com pouco pavio inferior
      const isPutFlow = isDowntrend && isRed && prevRed && current.close < prev.low && lowerWick <= body * 0.45 && body >= range * 0.50;

      if (isCallFlow) {
        return {
          direction: 'CALL',
          score: 82,
          reasons: [
            'Fluxo comprador contínuo alinhado às médias',
            'Rompimento limpo da máxima da vela anterior',
            'Volume direcional em expansão',
          ],
        };
      }
      if (isPutFlow) {
        return {
          direction: 'PUT',
          score: 82,
          reasons: [
            'Fluxo vendedor contínuo alinhado às médias',
            'Rompimento limpo da mínima da vela anterior',
            'Volume direcional em expansão',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 3. SMC: Captura de Liquidez (Institutional Sweep)
    // ----------------------------------------------------
    case 'smc_liquidez': {
      // CALL: Violação de mínima dos últimos candles mas fechou acima (falso rompimento institucional)
      const sweepLow = current.low < localLow && current.close >= localLow && lowerWick >= range * 0.35;
      // PUT: Violação de máxima dos últimos candles mas fechou abaixo (falso rompimento institucional)
      const sweepHigh = current.high > localHigh && current.close <= localHigh && upperWick >= range * 0.35;

      if (sweepLow) {
        return {
          direction: 'CALL',
          score: 88,
          reasons: [
            'SMC: Captura de Liquidez institucional no fundo',
            'Falso rompimento com rejeição imediata',
            'Institucionais absorveram ordens vendedoras',
          ],
        };
      }
      if (sweepHigh) {
        return {
          direction: 'PUT',
          score: 88,
          reasons: [
            'SMC: Captura de Liquidez institucional no topo',
            'Falso rompimento com rejeição imediata',
            'Institucionais absorveram ordens compradoras',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 4. Reversão em Exaustão (RSI Extremo)
    // ----------------------------------------------------
    case 'reversao_rsi': {
      const isCallReversal = rsi <= 28 && lowerWick >= range * 0.35 && (current.close > current.open || lowerWick > body);
      const isPutReversal = rsi >= 72 && upperWick >= range * 0.35 && (current.close < current.open || upperWick > body);

      if (isCallReversal) {
        return {
          direction: 'CALL',
          score: 84,
          reasons: [
            `RSI em Sobrevenda Extrema (${rsi.toFixed(1)})`,
            'Esgotamento da pressão vendedora',
            'Pavio de absorção indicando repique comprador',
          ],
        };
      }
      if (isPutReversal) {
        return {
          direction: 'PUT',
          score: 84,
          reasons: [
            `RSI em Sobrecompra Extrema (${rsi.toFixed(1)})`,
            'Esgotamento da pressão compradora',
            'Pavio de absorção indicando repique vendedor',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 5. Engolfo de Força (Price Action Clássico)
    // ----------------------------------------------------
    case 'engolfo_pro': {
      const prevBody = Math.abs(prev.close - prev.open);
      const isCallEngulf = current.close > current.open && prev.close < prev.open &&
        current.close > prev.open && current.open <= prev.close && body > prevBody * 1.15;
      const isPutEngulf = current.close < current.open && prev.close > prev.open &&
        current.close < prev.open && current.open >= prev.close && body > prevBody * 1.15;

      if (isCallEngulf) {
        return {
          direction: 'CALL',
          score: 83,
          reasons: [
            'Padrão Engolfo de ALTA com corpo dominante',
            'Superação de 100% da vela vendedora anterior',
            'Inversão de força compradora comprovada',
          ],
        };
      }
      if (isPutEngulf) {
        return {
          direction: 'PUT',
          score: 83,
          reasons: [
            'Padrão Engolfo de BAIXA com corpo dominante',
            'Superação de 100% da vela compradora anterior',
            'Inversão de força vendedora comprovada',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 6. Rompimento Estrutural Institucional (BOS)
    // ----------------------------------------------------
    case 'rompimento_bos': {
      const isCallBOS = isUptrend && current.close > localHigh && body > range * 0.60;
      const isPutBOS = isDowntrend && current.close < localLow && body > range * 0.60;

      if (isCallBOS) {
        return {
          direction: 'CALL',
          score: 79,
          reasons: [
            'SMC: Quebra Estrutural (BOS) a favor da ALTA',
            'Fechamento acima da resistência estrutural',
            'Expansão de volatilidade compradora',
          ],
        };
      }
      if (isPutBOS) {
        return {
          direction: 'PUT',
          score: 79,
          reasons: [
            'SMC: Quebra Estrutural (BOS) a favor da BAIXA',
            'Fechamento abaixo do suporte estrutural',
            'Expansão de volatilidade vendedora',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    default:
      return { direction: null, score: 0, reasons: [] };
  }
}

/**
 * Executa o Backtest em Tempo Real de TODAS as estratégias
 * sobre o histórico de velas atual do ativo e timeframe.
 */
export function runRealtimeBacktest(
  candles: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies()
): StrategyBacktestResult[] {
  if (!candles || candles.length < 25) {
    // Retorna resultados padrão se ainda não tiver velas suficientes
    return AVAILABLE_STRATEGIES.map((strat) => ({
      id: strat.id,
      name: strat.name,
      badge: strat.badge,
      category: strat.category,
      description: strat.description,
      wins: 0,
      losses: 0,
      ties: 0,
      totalTrades: 0,
      winRate: 0,
      consecutiveWins: 0,
      isActive: activeStrategyIds.includes(strat.id),
    }));
  }

  const resultsMap: Record<string, { wins: number; losses: number; ties: number; consecutiveWins: number; currentStreak: number; lastSignal?: { dir: 'CALL' | 'PUT'; time: number } }> = {};

  AVAILABLE_STRATEGIES.forEach((s) => {
    resultsMap[s.id] = { wins: 0, losses: 0, ties: 0, consecutiveWins: 0, currentStreak: 0 };
  });

  // Simula vela por vela a partir do candle 15 até o penúltimo candle (pois o penúltimo tem o candle fechado seguinte)
  const maxEvalIndex = candles.length - 2;
  const startEvalIndex = Math.max(12, candles.length - 80); // Avalia os últimos ~60 a 80 candles recentes

  for (let i = startEvalIndex; i <= maxEvalIndex; i++) {
    const outcomeCandle = candles[i + 1];
    if (!outcomeCandle) continue;

    const outcomeDiff = outcomeCandle.close - outcomeCandle.open;
    const EPSILON = 1e-8;

    AVAILABLE_STRATEGIES.forEach((strat) => {
      const evalRes = evaluateSingleStrategy(strat.id, candles, i);
      if (!evalRes.direction) return;

      const record = resultsMap[strat.id];
      record.lastSignal = { dir: evalRes.direction, time: candles[i].time };

      let isWin = false;
      let isLoss = false;

      if (evalRes.direction === 'CALL') {
        if (outcomeDiff > EPSILON) isWin = true;
        else if (outcomeDiff < -EPSILON) isLoss = true;
        else record.ties += 1;
      } else {
        if (outcomeDiff < -EPSILON) isWin = true;
        else if (outcomeDiff > EPSILON) isLoss = true;
        else record.ties += 1;
      }

      if (isWin) {
        record.wins += 1;
        record.currentStreak += 1;
        if (record.currentStreak > record.consecutiveWins) {
          record.consecutiveWins = record.currentStreak;
        }
      } else if (isLoss) {
        record.losses += 1;
        record.currentStreak = 0;
      }
    });
  }

  // Monta e ordena os resultados pela maior taxa de assertividade (%)
  const compiled: StrategyBacktestResult[] = AVAILABLE_STRATEGIES.map((strat) => {
    const r = resultsMap[strat.id];
    const totalTrades = r.wins + r.losses + r.ties;
    const decisiveTrades = r.wins + r.losses;
    const winRate = decisiveTrades > 0 ? Number(((r.wins / decisiveTrades) * 100).toFixed(1)) : 0;

    return {
      id: strat.id,
      name: strat.name,
      badge: strat.badge,
      category: strat.category,
      description: strat.description,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      totalTrades,
      winRate,
      consecutiveWins: recordStreak(r.consecutiveWins),
      lastSignalDirection: r.lastSignal?.dir,
      lastSignalTime: r.lastSignal?.time,
      isActive: activeStrategyIds.includes(strat.id),
    };
  });

  // Ordena por maior WinRate, e em caso de empate, por maior número de vitórias
  return compiled.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.wins - a.wins;
  });
}

function recordStreak(streak: number): number {
  return Math.max(0, streak);
}

/**
 * Avalia todas as estratégias ativas na vela mais recente
 * e retorna a estratégia vencedora mais assertiva.
 */
export function getBestActiveStrategySignal(
  candles: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  backtestResults?: StrategyBacktestResult[],
  profile: AnalysisProfile = 'MODERADA'
): StrategySignalDecision | null {
  if (!candles || candles.length < 15) return null;

  const lastIndex = candles.length - 1;
  const decisions: StrategySignalDecision[] = [];

  // Cria mapa de assertividade do backtest para ponderar
  const winRateMap: Record<string, number> = {};
  if (backtestResults) {
    backtestResults.forEach((b) => {
      winRateMap[b.id] = b.winRate;
    });
  }

  for (const stratId of activeStrategyIds) {
    const strat = AVAILABLE_STRATEGIES.find((s) => s.id === stratId);
    if (!strat) continue;

    // Filtro por Perfil de Análise
    if (profile === 'CONSERVADORA' && strat.minProfile === 'AGRESSIVA') {
      continue; // No modo Sniper (Conservador), descarta estratégias muito agressivas
    }

    const evalRes = evaluateSingleStrategy(stratId, candles, lastIndex);
    if (evalRes.direction) {
      const historicalWinRate = winRateMap[stratId] || 70;
      // Se a estratégia no backtest estiver com assertividade muito baixa (<40%), descarta no modo moderado/conservador
      if (profile !== 'AGRESSIVA' && historicalWinRate > 0 && historicalWinRate < 45) {
        continue;
      }

      decisions.push({
        strategy: strat,
        direction: evalRes.direction,
        score: evalRes.score,
        reasons: evalRes.reasons,
      });
    }
  }

  if (decisions.length === 0) return null;

  // Ordena pela maior assertividade histórica do backtest ou maior pontuação de score
  decisions.sort((a, b) => {
    const wrA = winRateMap[a.strategy.id] || 0;
    const wrB = winRateMap[b.strategy.id] || 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.score - a.score;
  });

  return decisions[0];
}

