import {
  Candle,
  SignalDirection,
  StrategyDefinition,
  StrategyBacktestResult,
  AnalysisProfile,
} from '../types/trading';

/**
 * Catálogo Oficial dos 6 Padrões CandleX-IA para Opções Binárias
 *
 * Padrão 1: Continuação de Fluxo de Baixa -> Entrada de VENDA (PUT) na 3ª vela vermelha
 * Padrão 2: Continuação de Fluxo de Alta -> Entrada de COMPRA (CALL) na 3ª vela verde
 * Padrão 3: Vela de Força + Correção 50% -> Entrada de COMPRA (CALL) após vela vermelha fechar acima dos 50%
 * Padrão 4: Vela de Força + Correção 50% -> Entrada de VENDA (PUT) após vela verde fechar abaixo dos 50%
 * Padrão 5: Saída de Consolidação 5ª Vela -> Entrada de COMPRA (CALL) na 5ª vela verde (mesma direção da Vela 1)
 * Padrão 6: Saída de Consolidação 5ª Vela -> Entrada de VENDA (PUT) na 5ª vela vermelha (mesma direção da Vela 1)
 */
export const AVAILABLE_STRATEGIES: StrategyDefinition[] = [
  {
    id: 'padrao_1_fluxo_put',
    name: 'Padrão 1: Fluxo de Baixa (3ª Vela Vermelha)',
    badge: '🔴 PADRÃO 1 (PUT)',
    tag: 'FLUXO DE BAIXA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Baixa: após vela verde, ocorrem velas vermelhas consecutivas. Entrada de VENDA (PUT) na 3ª vela vermelha.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_2_fluxo_call',
    name: 'Padrão 2: Fluxo de Alta (3ª Vela Verde)',
    badge: '🟢 PADRÃO 2 (CALL)',
    tag: 'FLUXO DE ALTA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Alta: após vela vermelha, ocorrem velas verdes consecutivas. Entrada de COMPRA (CALL) na 3ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_3_correcao_50_call',
    name: 'Padrão 3: Correção 50% (CALL)',
    badge: '🟢 PADRÃO 3 (CALL)',
    tag: 'CORREÇÃO 50%',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Alta (verde) + Correção de Baixa (vermelha) fechando acima dos 50%. Entrada de COMPRA (CALL).',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_4_correcao_50_put',
    name: 'Padrão 4: Correção 50% (PUT)',
    badge: '🔴 PADRÃO 4 (PUT)',
    tag: 'CORREÇÃO 50%',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Baixa (vermelha) + Correção de Alta (verde) fechando abaixo dos 50%. Entrada de VENDA (PUT).',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_5_consolidacao_call',
    name: 'Padrão 5: Consolidação 5ª Vela (CALL)',
    badge: '🟢 PADRÃO 5 (CALL)',
    tag: 'CONSOLIDAÇÃO',
    category: 'REVERSAL',
    description: 'Consolidação alternada de velas (1: Verde, 2: Vermelha, 3: Verde, 4: Vermelha). Entrada de COMPRA (CALL) na 5ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_6_consolidacao_put',
    name: 'Padrão 6: Consolidação 5ª Vela (PUT)',
    badge: '🔴 PADRÃO 6 (PUT)',
    tag: 'CONSOLIDAÇÃO',
    category: 'REVERSAL',
    description: 'Consolidação alternada de velas (1: Vermelha, 2: Verde, 3: Vermelha, 4: Verde). Entrada de VENDA (PUT) na 5ª vela vermelha.',
    minProfile: 'MODERADA',
  },
];

export const DEFAULT_ACTIVE_STRATEGY_IDS = [
  'padrao_1_fluxo_put',
  'padrao_2_fluxo_call',
  'padrao_3_correcao_50_call',
  'padrao_4_correcao_50_put',
  'padrao_5_consolidacao_call',
  'padrao_6_consolidacao_put',
];

export function getStoredActiveStrategies(): string[] {
  try {
    const raw = localStorage.getItem('clandex_active_strategies');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((id) => typeof id === 'string' && AVAILABLE_STRATEGIES.some((s) => s.id === id));
        if (valid.length > 0) return valid;
      }
    }
  } catch { }
  return [...DEFAULT_ACTIVE_STRATEGY_IDS];
}

export function storeActiveStrategies(strategyIds: string[]): void {
  try {
    const valid = strategyIds.filter((id) => AVAILABLE_STRATEGIES.some((s) => s.id === id));
    localStorage.setItem('clandex_active_strategies', JSON.stringify(valid.length > 0 ? valid : DEFAULT_ACTIVE_STRATEGY_IDS));
  } catch { }
}

export interface StrategySignalDecision {
  strategy: StrategyDefinition;
  direction: SignalDirection;
  score: number;
  reasons: string[];
}

/**
 * Avalia com precisão se um dos 6 Padrões CandleX-IA está presente no índice indicado.
 * Reconhece a formação do padrão tanto no candle de setup quanto na própria vela de entrada.
 */
export function evaluateSingleStrategy(
  strategyId: string,
  candles: Candle[],
  index: number
): { direction: SignalDirection | null; score: number; reasons: string[] } {
  if (!candles || !Array.isArray(candles) || index < 2 || index >= candles.length) {
    return { direction: null, score: 0, reasons: [] };
  }

  const current = candles[index];
  const prev1 = candles[index - 1];
  const prev2 = index >= 2 ? candles[index - 2] : null;
  const prev3 = index >= 3 ? candles[index - 3] : null;
  const prev4 = index >= 4 ? candles[index - 4] : null;

  if (!current || !prev1) {
    return { direction: null, score: 0, reasons: [] };
  }

  const isGreen = (c: Candle) => c.close > c.open;
  const isRed = (c: Candle) => c.close < c.open;

  switch (strategyId) {
    // ----------------------------------------------------
    // PADRÃO 1: Continuação de Fluxo de Baixa (3ª Vela Vermelha -> PUT)
    // Sequência: Vela Verde -> Vela 1 Vermelha -> Vela 2 Vermelha -> Vela 3 Vermelha
    // ----------------------------------------------------
    case 'padrao_1_fluxo_put': {
      // Caso A: Estamos na 3ª vela vermelha (Vela de Entrada da imagem)
      if (prev3 && prev2) {
        const isGreenBefore = isGreen(prev3);
        const isRed1 = isRed(prev2);
        const isRed2 = isRed(prev1);
        const isRed3 = current.close <= current.open || isRed(current);

        if (isGreenBefore && isRed1 && isRed2 && isRed3) {
          return {
            direction: 'PUT',
            score: 96,
            reasons: [
              'Padrão 1: Continuação de Fluxo de Baixa',
              'Vela Verde ➔ Vela 1 Vermelha ➔ Vela 2 Vermelha confirmadas',
              'Entrada de VENDA (PUT) na 3ª vela vermelha',
            ],
          };
        }
      }

      // Caso B: Estamos na 2ª vela vermelha (preparação imediata para abrir a 3ª vela)
      if (prev2) {
        const isGreenBefore = isGreen(prev2);
        const isRed1 = isRed(prev1);
        const isRed2 = current.close <= current.open || isRed(current);

        if (isGreenBefore && isRed1 && isRed2) {
          return {
            direction: 'PUT',
            score: 94,
            reasons: [
              'Padrão 1: Fluxo de Baixa em Formação',
              'Vela Verde ➔ Vela 1 Vermelha ➔ Vela 2 Vermelha',
              'Entrada de VENDA (PUT) na 3ª vela',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 2: Continuação de Fluxo de Alta (3ª Vela Verde -> CALL)
    // Sequência: Vela Vermelha -> Vela 1 Verde -> Vela 2 Verde -> Vela 3 Verde
    // ----------------------------------------------------
    case 'padrao_2_fluxo_call': {
      // Caso A: Estamos na 3ª vela verde (Vela de Entrada da imagem)
      if (prev3 && prev2) {
        const isRedBefore = isRed(prev3);
        const isGreen1 = isGreen(prev2);
        const isGreen2 = isGreen(prev1);
        const isGreen3 = current.close >= current.open || isGreen(current);

        if (isRedBefore && isGreen1 && isGreen2 && isGreen3) {
          return {
            direction: 'CALL',
            score: 96,
            reasons: [
              'Padrão 2: Continuação de Fluxo de Alta',
              'Vela Vermelha ➔ Vela 1 Verde ➔ Vela 2 Verde confirmadas',
              'Entrada de COMPRA (CALL) na 3ª vela verde',
            ],
          };
        }
      }

      // Caso B: Estamos na 2ª vela verde (preparação imediata para abrir a 3ª vela)
      if (prev2) {
        const isRedBefore = isRed(prev2);
        const isGreen1 = isGreen(prev1);
        const isGreen2 = current.close >= current.open || isGreen(current);

        if (isRedBefore && isGreen1 && isGreen2) {
          return {
            direction: 'CALL',
            score: 94,
            reasons: [
              'Padrão 2: Fluxo de Alta em Formação',
              'Vela Vermelha ➔ Vela 1 Verde ➔ Vela 2 Verde',
              'Entrada de COMPRA (CALL) na 3ª vela',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 3: Vela de Força + Correção 50% (CALL)
    // Vela de força verde + vela vermelha de correção fechando acima dos 50%
    // ----------------------------------------------------
    case 'padrao_3_correcao_50_call': {
      // Caso A: index é a vela após a correção
      if (prev2) {
        const forceBody = prev2.close - prev2.open;
        if (isGreen(prev2) && forceBody > 0.00003) {
          const mid50 = prev2.open + forceBody * 0.5;
          const isRedCorr = isRed(prev1);
          const closedAbove50 = prev1.close >= mid50;
          if (isRedCorr && closedAbove50) {
            return {
              direction: 'CALL',
              score: 96,
              reasons: [
                'Padrão 3: Vela de Força + Correção 50% (CALL)',
                `Vela de força verde anterior respeitada nos 50% (${mid50.toFixed(5)})`,
                'Entrada de COMPRA (CALL) na retomada do fluxo',
              ],
            };
          }
        }
      }

      // Caso B: index é a própria vela vermelha de correção
      const forceBody = prev1.close - prev1.open;
      if (isGreen(prev1) && forceBody > 0.00003) {
        const mid50 = prev1.open + forceBody * 0.5;
        const isRedCorr = current.close <= current.open || current.close < prev1.close;
        const closesAbove50 = current.close >= mid50;
        if (isRedCorr && closesAbove50) {
          return {
            direction: 'CALL',
            score: 94,
            reasons: [
              'Padrão 3: Correção 50% em Andamento',
              `Vela vermelha respeitando e fechando acima dos 50% (${mid50.toFixed(5)})`,
              'Entrada de COMPRA (CALL)',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 4: Vela de Força + Correção 50% (PUT)
    // Vela de força vermelha + vela verde de correção fechando abaixo dos 50%
    // ----------------------------------------------------
    case 'padrao_4_correcao_50_put': {
      // Caso A: index é a vela após a correção
      if (prev2) {
        const forceBody = prev2.open - prev2.close;
        if (isRed(prev2) && forceBody > 0.00003) {
          const mid50 = prev2.close + forceBody * 0.5;
          const isGreenCorr = isGreen(prev1);
          const closedBelow50 = prev1.close <= mid50;
          if (isGreenCorr && closedBelow50) {
            return {
              direction: 'PUT',
              score: 96,
              reasons: [
                'Padrão 4: Vela de Força + Correção 50% (PUT)',
                `Vela de força vermelha anterior respeitada nos 50% (${mid50.toFixed(5)})`,
                'Entrada de VENDA (PUT) na retomada do fluxo',
              ],
            };
          }
        }
      }

      // Caso B: index é a própria vela verde de correção
      const forceBody = prev1.open - prev1.close;
      if (isRed(prev1) && forceBody > 0.00003) {
        const mid50 = prev1.close + forceBody * 0.5;
        const isGreenCorr = current.close >= current.open || current.close > prev1.close;
        const closesBelow50 = current.close <= mid50;
        if (isGreenCorr && closesBelow50) {
          return {
            direction: 'PUT',
            score: 94,
            reasons: [
              'Padrão 4: Correção 50% em Andamento',
              `Vela verde respeitando e fechando abaixo dos 50% (${mid50.toFixed(5)})`,
              'Entrada de VENDA (PUT)',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 5: Saída de Consolidação 5ª Vela (CALL)
    // ----------------------------------------------------
    case 'padrao_5_consolidacao_call': {
      // Caso A: index é a 5ª vela verde
      if (prev4 && prev3 && prev2) {
        if (isGreen(prev4) && isRed(prev3) && isGreen(prev2) && isRed(prev1) && (current.close >= current.open || isGreen(current))) {
          return {
            direction: 'CALL',
            score: 95,
            reasons: [
              'Padrão 5: Saída de Consolidação 5ª Vela (CALL)',
              'Alternância de 5 velas confirmada (Verde, Vermelha, Verde, Vermelha, Verde)',
              'Entrada de COMPRA (CALL) na 5ª vela na direção da Vela 1',
            ],
          };
        }
      }

      // Caso B: index é a 4ª vela vermelha (preparando 5ª)
      if (prev3 && prev2) {
        if (isGreen(prev3) && isRed(prev2) && isGreen(prev1) && (current.close <= current.open || isRed(current))) {
          return {
            direction: 'CALL',
            score: 92,
            reasons: [
              'Padrão 5: Consolidação em Formação (4 Velas)',
              'Alternância confirmada: Verde, Vermelha, Verde, Vermelha',
              'Entrada de COMPRA (CALL) na 5ª vela',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 6: Saída de Consolidação 5ª Vela (PUT)
    // ----------------------------------------------------
    case 'padrao_6_consolidacao_put': {
      // Caso A: index é a 5ª vela vermelha
      if (prev4 && prev3 && prev2) {
        if (isRed(prev4) && isGreen(prev3) && isRed(prev2) && isGreen(prev1) && (current.close <= current.open || isRed(current))) {
          return {
            direction: 'PUT',
            score: 95,
            reasons: [
              'Padrão 6: Saída de Consolidação 5ª Vela (PUT)',
              'Alternância de 5 velas confirmada (Vermelha, Verde, Vermelha, Verde, Vermelha)',
              'Entrada de VENDA (PUT) na 5ª vela na direção da Vela 1',
            ],
          };
        }
      }

      // Caso B: index é a 4ª vela verde (preparando 5ª)
      if (prev3 && prev2) {
        if (isRed(prev3) && isGreen(prev2) && isRed(prev1) && (current.close >= current.open || isGreen(current))) {
          return {
            direction: 'PUT',
            score: 92,
            reasons: [
              'Padrão 6: Consolidação em Formação (4 Velas)',
              'Alternância confirmada: Vermelha, Verde, Vermelha, Verde',
              'Entrada de VENDA (PUT) na 5ª vela',
            ],
          };
        }
      }

      return { direction: null, score: 0, reasons: [] };
    }

    default:
      return { direction: null, score: 0, reasons: [] };
  }
}

export function getStoredAutoFilterProfit(): boolean {
  try {
    const raw = localStorage.getItem('clandex_auto_filter_profit');
    if (raw !== null) return raw === 'true';
  } catch {}
  return true;
}

export function storeAutoFilterProfit(enabled: boolean): void {
  try {
    localStorage.setItem('clandex_auto_filter_profit', String(enabled));
  } catch {}
}

export function getProfitableStrategyIds(backtestResults: StrategyBacktestResult[]): string[] {
  const profitable = backtestResults
    .filter((b) => b.isProfitable && !b.autoDeactivated)
    .map((b) => b.id);
  if (profitable.length > 0) return profitable;
  return backtestResults.length > 0 ? [backtestResults[0].id] : ['padrao_1_fluxo_put', 'padrao_2_fluxo_call'];
}

export function runRealtimeBacktest(
  candles?: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  autoFilterProfitOnly = getStoredAutoFilterProfit()
): StrategyBacktestResult[] {
  const safeActiveIds = Array.isArray(activeStrategyIds) ? activeStrategyIds : getStoredActiveStrategies();

  if (!candles || !Array.isArray(candles) || candles.length < 5) {
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
      isActive: safeActiveIds.includes(strat.id),
      isProfitable: true,
      profitStatus: 'AGUARDANDO',
      autoDeactivated: false,
    }));
  }

  const resultsMap: Record<
    string,
    { wins: number; losses: number; ties: number; consecutiveWins: number; currentStreak: number; lastSignal?: { dir: 'CALL' | 'PUT'; time: number } }
  > = {};

  AVAILABLE_STRATEGIES.forEach((s) => {
    resultsMap[s.id] = { wins: 0, losses: 0, ties: 0, consecutiveWins: 0, currentStreak: 0 };
  });

  const maxEvalIndex = candles.length - 2;
  const startEvalIndex = Math.max(3, candles.length - 120);

  if (startEvalIndex > maxEvalIndex) {
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
      isActive: safeActiveIds.includes(strat.id),
      isProfitable: true,
      profitStatus: 'AGUARDANDO',
      autoDeactivated: false,
    }));
  }

  const EPSILON = 1e-7;

  for (let i = startEvalIndex; i <= maxEvalIndex; i++) {
    const outcomeCandle = candles[i + 1];
    if (!outcomeCandle) continue;

    AVAILABLE_STRATEGIES.forEach((strat) => {
      const evalRes = evaluateSingleStrategy(strat.id, candles, i);
      if (!evalRes || !evalRes.direction) return;

      const record = resultsMap[strat.id];
      if (!record) return;

      record.lastSignal = { dir: evalRes.direction, time: outcomeCandle.time };

      let isWin = false;
      let isLoss = false;
      const diff = outcomeCandle.close - outcomeCandle.open;

      if (evalRes.direction === 'CALL') {
        if (diff > EPSILON) isWin = true;
        else if (diff < -EPSILON) isLoss = true;
        else record.ties += 1;
      } else {
        if (diff < -EPSILON) isWin = true;
        else if (diff > EPSILON) isLoss = true;
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

  const compiled: StrategyBacktestResult[] = AVAILABLE_STRATEGIES.map((strat) => {
    const r = resultsMap[strat.id] || { wins: 0, losses: 0, ties: 0, consecutiveWins: 0, currentStreak: 0 };
    const totalTrades = r.wins + r.losses + r.ties;
    const decisiveTrades = r.wins + r.losses;
    const winRate = decisiveTrades > 0 ? Number(((r.wins / decisiveTrades) * 100).toFixed(1)) : 0;

    let profitStatus: 'LUCRO' | 'PREJUIZO' | 'AGUARDANDO' = 'AGUARDANDO';
    let isProfitable = true;
    let autoDeactivated = false;

    if (decisiveTrades >= 3) {
      if (winRate >= 50 && r.wins >= r.losses) {
        profitStatus = 'LUCRO';
        isProfitable = true;
      } else {
        profitStatus = 'PREJUIZO';
        isProfitable = false;
        if (autoFilterProfitOnly) {
          autoDeactivated = true;
        }
      }
    } else {
      profitStatus = 'AGUARDANDO';
      isProfitable = true;
    }

    const isActive = safeActiveIds.includes(strat.id) && !autoDeactivated;

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
      consecutiveWins: Math.max(0, r.consecutiveWins || 0),
      lastSignalDirection: r.lastSignal?.dir,
      lastSignalTime: r.lastSignal?.time,
      isActive,
      isProfitable,
      profitStatus,
      autoDeactivated,
    };
  });

  return compiled.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.wins - a.wins;
  });
}

export function getBestActiveStrategySignal(
  candles: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  backtestResults?: StrategyBacktestResult[],
  profile: AnalysisProfile = 'MODERADA'
): StrategySignalDecision | null {
  if (!candles || !Array.isArray(candles) || candles.length < 3) return null;

  const lastIndex = candles.length - 1;
  const decisions: StrategySignalDecision[] = [];

  const winRateMap: Record<string, number> = {};
  if (backtestResults) {
    backtestResults.forEach((b) => {
      winRateMap[b.id] = b.winRate;
    });
  }

  const safeActiveIds = Array.isArray(activeStrategyIds) ? activeStrategyIds : getStoredActiveStrategies();

  for (const stratId of safeActiveIds) {
    const strat = AVAILABLE_STRATEGIES.find((s) => s.id === stratId);
    if (!strat) continue;

    if (profile === 'CONSERVADORA' && strat.minProfile === 'AGRESSIVA') {
      continue;
    }

    const evalRes = evaluateSingleStrategy(stratId, candles, lastIndex);
    if (evalRes && evalRes.direction) {
      decisions.push({
        strategy: strat,
        direction: evalRes.direction,
        score: evalRes.score,
        reasons: evalRes.reasons,
      });
    }
  }

  if (decisions.length === 0) return null;

  decisions.sort((a, b) => {
    const wrA = winRateMap[a.strategy.id] || 0;
    const wrB = winRateMap[b.strategy.id] || 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.score - a.score;
  });

  return decisions[0];
}
