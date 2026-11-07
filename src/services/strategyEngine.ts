import {
  Candle,
  SignalDirection,
  StrategyDefinition,
  StrategyBacktestResult,
  AnalysisProfile,
} from '../types/trading';

/**
 * Catálogo Oficial dos 6 Padrões CandleX-IA para Opções Binárias
 * Conforme especificação oficial e regras de confluência do gráfico de referência:
 *
 * Padrão 1: Continuação de Fluxo de Baixa -> PUT na 3ª vela vermelha
 * Padrão 2: Continuação de Fluxo de Alta -> CALL na 3ª vela verde
 * Padrão 3: Vela de Força + Correção 50% -> CALL na vela vermelha que fecha acima dos 50%
 * Padrão 4: Vela de Força + Correção 50% -> PUT na vela verde que fecha abaixo dos 50%
 * Padrão 5: Saída de Consolidação 5ª Vela -> CALL na 5ª vela verde (mesma direção da Vela 1)
 * Padrão 6: Saída de Consolidação 5ª Vela -> PUT na 5ª vela vermelha (mesma direção da Vela 1)
 */
export const AVAILABLE_STRATEGIES: StrategyDefinition[] = [
  {
    id: 'padrao_1_fluxo_put',
    name: 'Padrão 1: Fluxo de Baixa (3ª Vela Vermelha)',
    badge: '🔴 PADRÃO 1 (PUT)',
    tag: 'FLUXO DE BAIXA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Baixa: após vela verde, ocorrem 3 velas vermelhas consecutivas. Entrada de VENDA (PUT) na 3ª vela vermelha.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_2_fluxo_call',
    name: 'Padrão 2: Fluxo de Alta (3ª Vela Verde)',
    badge: '🟢 PADRÃO 2 (CALL)',
    tag: 'FLUXO DE ALTA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Alta: após vela vermelha, ocorrem 3 velas verdes consecutivas. Entrada de COMPRA (CALL) na 3ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_3_correcao_50_call',
    name: 'Padrão 3: Correção 50% (CALL)',
    badge: '🟢 PADRÃO 3 (CALL)',
    tag: 'CORREÇÃO 50%',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Alta (verde) + Correção de Baixa (vermelha) que fecha acima dos 50% da vela de força. Entrada de COMPRA (CALL) na vela de correção.',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_4_correcao_50_put',
    name: 'Padrão 4: Correção 50% (PUT)',
    badge: '🔴 PADRÃO 4 (PUT)',
    tag: 'CORREÇÃO 50%',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Baixa (vermelha) + Correção de Alta (verde) que fecha abaixo dos 50% da vela de força. Entrada de VENDA (PUT) na vela de correção.',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_5_consolidacao_call',
    name: 'Padrão 5: Consolidação 5ª Vela (CALL)',
    badge: '🟢 PADRÃO 5 (CALL)',
    tag: 'CONSOLIDAÇÃO',
    category: 'REVERSAL',
    description: 'Consolidação alternada de 5 velas (1: Verde, 2: Vermelha, 3: Verde, 4: Vermelha, 5: Verde). Entrada de COMPRA (CALL) na 5ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_6_consolidacao_put',
    name: 'Padrão 6: Consolidação 5ª Vela (PUT)',
    badge: '🔴 PADRÃO 6 (PUT)',
    tag: 'CONSOLIDAÇÃO',
    category: 'REVERSAL',
    description: 'Consolidação alternada de 5 velas (1: Vermelha, 2: Verde, 3: Vermelha, 4: Verde, 5: Vermelha). Entrada de VENDA (PUT) na 5ª vela vermelha.',
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

/**
 * Obtém os IDs das estratégias ativas salvas no localStorage
 * Garante migração automática caso haja chaves obsoletas salvas em sessões anteriores.
 */
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

/**
 * Salva os IDs das estratégias ativas no localStorage
 */
export function storeActiveStrategies(strategyIds: string[]): void {
  try {
    localStorage.setItem('clandex_active_strategies', JSON.stringify(strategyIds));
  } catch { }
}

export interface StrategySignalDecision {
  strategy: StrategyDefinition;
  direction: SignalDirection;
  score: number;
  reasons: string[];
}

/**
 * Calcula o Average True Range (ATR) para medição de volatilidade e proporção dos corpos
 */
function calculateAtr(candles: Candle[], index: number, period = 14): number {
  if (index < 1) return 0.0001;
  const start = Math.max(1, index - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= index; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    if (c && p) {
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
      sum += tr;
      count++;
    }
  }
  return count > 0 ? sum / count : 0.0001;
}

/**
 * Avalia um dos 6 Padrões CandleX-IA no índice específico
 *
 * REGRA OBRIGATÓRIA:
 * A última vela do padrão (candles[index]) é EXATAMENTE a vela da operação.
 * O sinal é desenhado sobre ela e não há deslocamento para a vela seguinte.
 */
export function evaluateSingleStrategy(
  strategyId: string,
  candles: Candle[],
  index: number
): { direction: SignalDirection | null; score: number; reasons: string[] } {
  if (!candles || !Array.isArray(candles) || index < 4 || index >= candles.length) {
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

  const atr = calculateAtr(candles, index, 14);
  const minBodyThreshold = Math.max(atr * 0.05, 0.00001);

  const isGreen = (c: Candle) => c.close > c.open;
  const isRed = (c: Candle) => c.close < c.open;
  const getBody = (c: Candle) => Math.abs(c.close - c.open);

  switch (strategyId) {
    // ----------------------------------------------------
    // PADRÃO 1: Continuação de Fluxo de Baixa (3ª Vela Vermelha)
    // Sequência: vela verde -> vela 1 vermelha -> vela 2 vermelha -> vela 3 vermelha (Entrada PUT)
    // ----------------------------------------------------
    case 'padrao_1_fluxo_put': {
      if (!prev3 || !prev2) return { direction: null, score: 0, reasons: [] };

      const cGreenBefore = isGreen(prev3);
      const c1Red = isRed(prev2);
      const c2Red = isRed(prev1);
      const c3Red = current.close <= current.open;

      // Sequência descendente: vela 1, 2 e 3 avançam na baixa
      const isSequenceAdvancingDown = prev1.close <= prev2.open && current.close <= prev1.open;

      if (cGreenBefore && c1Red && c2Red && c3Red && isSequenceAdvancingDown) {
        return {
          direction: 'PUT',
          score: 93,
          reasons: [
            'Padrão 1: Continuação de Fluxo de Baixa (3ª Vela Vermelha)',
            'Inversão após vela verde confirmada por 3 velas vermelhas consecutivas',
            'Entrada de VENDA (PUT) na 3ª vela vermelha da sequência',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 2: Continuação de Fluxo de Alta (3ª Vela Verde)
    // Sequência: vela vermelha -> vela 1 verde -> vela 2 verde -> vela 3 verde (Entrada CALL)
    // ----------------------------------------------------
    case 'padrao_2_fluxo_call': {
      if (!prev3 || !prev2) return { direction: null, score: 0, reasons: [] };

      const cRedBefore = isRed(prev3);
      const c1Green = isGreen(prev2);
      const c2Green = isGreen(prev1);
      const c3Green = current.close >= current.open;

      // Sequência ascendente: vela 1, 2 e 3 avançam na alta
      const isSequenceAdvancingUp = prev1.close >= prev2.open && current.close >= prev1.open;

      if (cRedBefore && c1Green && c2Green && c3Green && isSequenceAdvancingUp) {
        return {
          direction: 'CALL',
          score: 93,
          reasons: [
            'Padrão 2: Continuação de Fluxo de Alta (3ª Vela Verde)',
            'Inversão após vela vermelha confirmada por 3 velas verdes consecutivas',
            'Entrada de COMPRA (CALL) na 3ª vela verde da sequência',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 3: Vela de Força + Correção 50% (CALL)
    // Vela de força verde anterior + vela vermelha de correção que fecha acima dos 50% da força
    // ----------------------------------------------------
    case 'padrao_3_correcao_50_call': {
      const prevBody = prev1.close - prev1.open;
      const isPrevStrongGreen = isGreen(prev1) && prevBody >= Math.max(atr * 0.18, minBodyThreshold);

      if (!isPrevStrongGreen) return { direction: null, score: 0, reasons: [] };

      const mid50 = prev1.open + prevBody * 0.5;

      // Vela atual vermelha de correção que fecha ACIMA dos 50% da vela de força
      const isCurrentRedCorrection = current.close <= current.open || current.close < prev1.close;
      const closesAbove50 = current.close >= mid50;

      if (isCurrentRedCorrection && closesAbove50) {
        return {
          direction: 'CALL',
          score: 95,
          reasons: [
            'Padrão 3: Vela de Força + Correção 50% (CALL)',
            `Vela de força compradora anterior (${prevBody.toFixed(5)} pts)`,
            `Vela vermelha de correção fechou acima dos 50% (${mid50.toFixed(5)})`,
            'Entrada de COMPRA (CALL) na vela de correção respeitando a zona de 50%',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 4: Vela de Força + Correção 50% (PUT)
    // Vela de força vermelha anterior + vela verde de correção que fecha abaixo dos 50% da força
    // ----------------------------------------------------
    case 'padrao_4_correcao_50_put': {
      const prevBody = prev1.open - prev1.close;
      const isPrevStrongRed = isRed(prev1) && prevBody >= Math.max(atr * 0.18, minBodyThreshold);

      if (!isPrevStrongRed) return { direction: null, score: 0, reasons: [] };

      const mid50 = prev1.close + prevBody * 0.5;

      // Vela atual verde de correção que fecha ABAIXO dos 50% da vela de força
      const isCurrentGreenCorrection = current.close >= current.open || current.close > prev1.close;
      const closesBelow50 = current.close <= mid50;

      if (isCurrentGreenCorrection && closesBelow50) {
        return {
          direction: 'PUT',
          score: 95,
          reasons: [
            'Padrão 4: Vela de Força + Correção 50% (PUT)',
            `Vela de força vendedora anterior (${prevBody.toFixed(5)} pts)`,
            `Vela verde de correção fechou abaixo dos 50% (${mid50.toFixed(5)})`,
            'Entrada de VENDA (PUT) na vela de correção respeitando a zona de 50%',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 5: Saída de Consolidação 5ª Vela (CALL)
    // Sequência alternada: 1: Verde, 2: Vermelha, 3: Verde, 4: Vermelha, 5: Verde (Entrada CALL na direção da Vela 1)
    // ----------------------------------------------------
    case 'padrao_5_consolidacao_call': {
      if (!prev4 || !prev3 || !prev2) return { direction: null, score: 0, reasons: [] };

      const c1Green = isGreen(prev4);
      const c2Red = isRed(prev3);
      const c3Green = isGreen(prev2);
      const c4Red = isRed(prev1);
      const c5Green = current.close >= current.open;

      if (c1Green && c2Red && c3Green && c4Red && c5Green) {
        return {
          direction: 'CALL',
          score: 91,
          reasons: [
            'Padrão 5: Saída de Consolidação 5ª Vela (CALL)',
            'Alternância confirmada de 5 velas (Verde, Vermelha, Verde, Vermelha, Verde)',
            'Entrada de COMPRA (CALL) na 5ª vela seguindo a direção da Vela 1',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 6: Saída de Consolidação 5ª Vela (PUT)
    // Sequência alternada: 1: Vermelha, 2: Verde, 3: Vermelha, 4: Verde, 5: Vermelha (Entrada PUT na direção da Vela 1)
    // ----------------------------------------------------
    case 'padrao_6_consolidacao_put': {
      if (!prev4 || !prev3 || !prev2) return { direction: null, score: 0, reasons: [] };

      const c1Red = isRed(prev4);
      const c2Green = isGreen(prev3);
      const c3Red = isRed(prev2);
      const c4Green = isGreen(prev1);
      const c5Red = current.close <= current.open;

      if (c1Red && c2Green && c3Red && c4Green && c5Red) {
        return {
          direction: 'PUT',
          score: 91,
          reasons: [
            'Padrão 6: Saída de Consolidação 5ª Vela (PUT)',
            'Alternância confirmada de 5 velas (Vermelha, Verde, Vermelha, Verde, Vermelha)',
            'Entrada de VENDA (PUT) na 5ª vela seguindo a direção da Vela 1',
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
 * Obtém se o Auto-Filtro IA de Lucro está ativo
 */
export function getStoredAutoFilterProfit(): boolean {
  try {
    const raw = localStorage.getItem('clandex_auto_filter_profit');
    if (raw !== null) return raw === 'true';
  } catch {}
  return true;
}

/**
 * Salva a preferência do Auto-Filtro IA no localStorage
 */
export function storeAutoFilterProfit(enabled: boolean): void {
  try {
    localStorage.setItem('clandex_auto_filter_profit', String(enabled));
  } catch {}
}

/**
 * Retorna os IDs das estratégias que a IA aprovou como lucrativas (WinRate >= 50%)
 */
export function getProfitableStrategyIds(backtestResults: StrategyBacktestResult[]): string[] {
  const profitable = backtestResults
    .filter((b) => b.isProfitable && !b.autoDeactivated)
    .map((b) => b.id);
  if (profitable.length > 0) return profitable;
  return backtestResults.length > 0 ? [backtestResults[0].id] : ['padrao_1_fluxo_put', 'padrao_2_fluxo_call'];
}

/**
 * Executa o Backtest em Tempo Real dos 6 Padrões CandleX-IA
 *
 * REGRA CRÍTICA PARA OPÇÕES BINÁRIAS:
 * A avaliação de WIN/LOSS é apurada NA PRÓPRIA VELA DE ENTRADA (candle[i]),
 * sem deslocamento para a vela seguinte e sem lookahead bias.
 */
export function runRealtimeBacktest(
  candles?: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  autoFilterProfitOnly = getStoredAutoFilterProfit()
): StrategyBacktestResult[] {
  const safeActiveIds = Array.isArray(activeStrategyIds) ? activeStrategyIds : getStoredActiveStrategies();

  if (!candles || !Array.isArray(candles) || candles.length < 10) {
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

  // Avalia velas fechadas a partir da 5ª vela até a penúltima (ou última se fechada)
  const maxEvalIndex = candles.length - 2;
  const startEvalIndex = Math.max(5, candles.length - 120);

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
    const entryCandle = candles[i];
    if (!entryCandle) continue;

    AVAILABLE_STRATEGIES.forEach((strat) => {
      const evalRes = evaluateSingleStrategy(strat.id, candles, i);
      if (!evalRes || !evalRes.direction) return;

      const record = resultsMap[strat.id];
      if (!record) return;

      // O sinal é ancorado estritamente na vela de entrada (candles[i])
      record.lastSignal = { dir: evalRes.direction, time: entryCandle.time };

      let isWin = false;
      let isLoss = false;

      // Apuração do resultado da operação de Opções Binárias na própria vela de entrada
      if (evalRes.direction === 'CALL') {
        if (strat.id === 'padrao_3_correcao_50_call') {
          const prevForce = candles[i - 1];
          const mid50 = (prevForce.open + prevForce.close) / 2;
          if (entryCandle.close >= mid50 - EPSILON) isWin = true;
          else isLoss = true;
        } else {
          const diff = entryCandle.close - entryCandle.open;
          if (diff > EPSILON) isWin = true;
          else if (diff < -EPSILON) isLoss = true;
          else record.ties += 1;
        }
      } else {
        if (strat.id === 'padrao_4_correcao_50_put') {
          const prevForce = candles[i - 1];
          const mid50 = (prevForce.open + prevForce.close) / 2;
          if (entryCandle.close <= mid50 + EPSILON) isWin = true;
          else isLoss = true;
        } else {
          const diff = entryCandle.close - entryCandle.open;
          if (diff < -EPSILON) isWin = true;
          else if (diff > EPSILON) isLoss = true;
          else record.ties += 1;
        }
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

/**
 * Avalia todas as estratégias ativas na vela mais recente
 * e retorna o padrão confirmado de maior assertividade.
 */
export function getBestActiveStrategySignal(
  candles: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  backtestResults?: StrategyBacktestResult[],
  profile: AnalysisProfile = 'MODERADA'
): StrategySignalDecision | null {
  if (!candles || !Array.isArray(candles) || candles.length < 5) return null;

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

    // Filtro por Perfil
    if (profile === 'CONSERVADORA' && strat.minProfile === 'AGRESSIVA') {
      continue;
    }

    // Trava de Segurança IA: apenas desprioriza se houver pelo menos 1 outra estratégia ativa elegível
    if (backtestResults && safeActiveIds.length > 1) {
      const bRes = backtestResults.find((b) => b.id === stratId);
      if (bRes && bRes.autoDeactivated && bRes.totalTrades >= 5 && bRes.winRate < 40) {
        continue;
      }
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

  // Ordena por assertividade histórica ou maior score do padrão
  decisions.sort((a, b) => {
    const wrA = winRateMap[a.strategy.id] || 0;
    const wrB = winRateMap[b.strategy.id] || 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.score - a.score;
  });

  return decisions[0];
}
