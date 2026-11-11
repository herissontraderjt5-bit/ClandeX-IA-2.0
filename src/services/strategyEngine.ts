import {
  Candle,
  SignalDirection,
  StrategyDefinition,
  StrategyBacktestResult,
  AnalysisProfile,
} from '../types/trading';

/**
 * Catálogo Oficial das Estratégias CandleX-IA para Opções Binárias
 *
 * Padrão 1: Fluxo 3ª Vela Baixa -> Entrada de VENDA (PUT) na 3ª vela vermelha
 * Padrão 2: Fluxo da 3ª Vela de Alta -> Entrada de COMPRA (CALL) na 3ª vela verde
 * Padrão 3: Vela de Descanso Alta -> Entrada de COMPRA (CALL) após vela de descanso fechar acima dos 50%
 * Padrão 4: Vela de Descanso Baixa -> Entrada de VENDA (PUT) após vela de descanso fechar abaixo dos 50%
 * Padrão 5: Consolidação de Alta -> Entrada de COMPRA (CALL) na 5ª vela verde (mesma direção da Vela 1)
 * Padrão 6: Consolidação de Baixa -> Entrada de VENDA (PUT) na 5ª vela vermelha (mesma direção da Vela 1)
 * Suporte e Resistência: Price Action -> CALL no Suporte / PUT na Resistência
 */
export const AVAILABLE_STRATEGIES: StrategyDefinition[] = [
  {
    id: 'padrao_1_fluxo_put',
    name: 'Padrão 1: Fluxo 3ª Vela Baixa',
    badge: '🔴 FLUXO 3ª VELA BAIXA',
    tag: 'FLUXO 3ª VELA BAIXA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Baixa: após vela verde, ocorrem velas vermelhas consecutivas. Entrada de VENDA (PUT) na 3ª vela vermelha.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_2_fluxo_call',
    name: 'Padrão 2: Fluxo da 3ª Vela de Alta',
    badge: '🟢 FLUXO 3ª VELA ALTA',
    tag: 'FLUXO 3ª VELA ALTA',
    category: 'MOMENTUM',
    description: 'Continuação de Fluxo de Alta: após vela vermelha, ocorrem velas verdes consecutivas. Entrada de COMPRA (CALL) na 3ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_3_correcao_50_call',
    name: 'Padrão 3: Vela de Descanso Alta',
    badge: '🟢 VELA DE DESCANSO ALTA',
    tag: 'VELA DE DESCANSO ALTA',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Alta (verde) + Vela de Descanso (vermelha) fechando acima dos 50%. Entrada de COMPRA (CALL).',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_4_correcao_50_put',
    name: 'Padrão 4: Vela de Descanso Baixa',
    badge: '🔴 VELA DE DESCANSO BAIXA',
    tag: 'VELA DE DESCANSO BAIXA',
    category: 'PRICE_ACTION',
    description: 'Vela de Força de Baixa (vermelha) + Vela de Descanso (verde) fechando abaixo dos 50%. Entrada de VENDA (PUT).',
    minProfile: 'CONSERVADORA',
  },
  {
    id: 'padrao_5_consolidacao_call',
    name: 'Padrão 5: Consolidação de Alta',
    badge: '🟢 CONSOLIDAÇÃO DE ALTA',
    tag: 'CONSOLIDAÇÃO DE ALTA',
    category: 'REVERSAL',
    description: 'Consolidação de Alta: alternância de velas (1: Verde, 2: Vermelha, 3: Verde, 4: Vermelha). Entrada de COMPRA (CALL) na 5ª vela verde.',
    minProfile: 'MODERADA',
  },
  {
    id: 'padrao_6_consolidacao_put',
    name: 'Padrão 6: Consolidação de Baixa',
    badge: '🔴 CONSOLIDAÇÃO DE BAIXA',
    tag: 'CONSOLIDAÇÃO DE BAIXA',
    category: 'REVERSAL',
    description: 'Consolidação de Baixa: alternância de velas (1: Vermelha, 2: Verde, 3: Vermelha, 4: Verde). Entrada de VENDA (PUT) na 5ª vela vermelha.',
    minProfile: 'MODERADA',
  },
  {
    id: 'estrategia_suporte_resistencia',
    name: 'Suporte e Resistência (Price Action)',
    badge: '🎯 SUPORTE & RESISTÊNCIA',
    tag: 'PRICE ACTION',
    category: 'PRICE_ACTION',
    description: 'Operações em Zonas de Suporte e Resistência: COMPRA (CALL) em teste de suporte com rejeição compradora, ou VENDA (PUT) em teste de resistência com rejeição vendedora.',
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
  'estrategia_suporte_resistencia',
];

export function getStoredActiveStrategies(): string[] {
  try {
    const raw = localStorage.getItem('clandex_active_strategies');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((id) => typeof id === 'string' && AVAILABLE_STRATEGIES.some((s) => s.id === id));
        if (valid.length > 0) {
          if (!valid.includes('estrategia_suporte_resistencia')) {
            valid.push('estrategia_suporte_resistencia');
          }
          return valid;
        }
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
    // PADRÃO 1: Fluxo 3ª Vela Baixa (3ª Vela Vermelha -> PUT)
    // Setup na 2ª vela vermelha: Vela Verde ➔ Vela 1 Vermelha ➔ Vela 2 Vermelha
    // Entrada oficial de VENDA (PUT) na 3ª vela vermelha
    // ----------------------------------------------------
    case 'padrao_1_fluxo_put': {
      if (prev2) {
        const isGreenBefore = isGreen(prev2);
        const isRed1 = isRed(prev1);
        const isRed2 = isRed(current);

        if (isGreenBefore && isRed1 && isRed2) {
          return {
            direction: 'PUT',
            score: 96,
            reasons: [
              'Padrão 1: Fluxo 3ª Vela Baixa',
              'Vela Verde ➔ Vela 1 Vermelha ➔ Vela 2 Vermelha confirmadas',
              'Entrada de VENDA (PUT) na 3ª vela vermelha',
            ],
          };
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 2: Fluxo da 3ª Vela de Alta (3ª Vela Verde -> CALL)
    // Setup na 2ª vela verde: Vela Vermelha ➔ Vela 1 Verde ➔ Vela 2 Verde
    // Entrada oficial de COMPRA (CALL) na 3ª vela verde
    // ----------------------------------------------------
    case 'padrao_2_fluxo_call': {
      if (prev2) {
        const isRedBefore = isRed(prev2);
        const isGreen1 = isGreen(prev1);
        const isGreen2 = isGreen(current);

        if (isRedBefore && isGreen1 && isGreen2) {
          return {
            direction: 'CALL',
            score: 96,
            reasons: [
              'Padrão 2: Fluxo da 3ª Vela de Alta',
              'Vela Vermelha ➔ Vela 1 Verde ➔ Vela 2 Verde confirmadas',
              'Entrada de COMPRA (CALL) na 3ª vela verde',
            ],
          };
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 3: Vela de Descanso Alta (CALL)
    // Vela 1 verde de força + Vela 2 vermelha de descanso fechando acima dos 50%
    // Entrada oficial de COMPRA (CALL) na 3ª vela
    // ----------------------------------------------------
    case 'padrao_3_correcao_50_call': {
      if (prev1) {
        const forceBody = prev1.close - prev1.open;
        if (isGreen(prev1) && forceBody > 0.00001) {
          const mid50 = prev1.open + forceBody * 0.5;
          const isRedCorr = isRed(current);
          const closedAbove50 = current.close >= mid50;
          if (isRedCorr && closedAbove50) {
            return {
              direction: 'CALL',
              score: 96,
              reasons: [
                'Padrão 3: Vela de Descanso Alta',
                `Vela de descanso vermelha respeitou e fechou acima dos 50% (${mid50.toFixed(5)})`,
                'Entrada de COMPRA (CALL) na retomada do fluxo de alta',
              ],
            };
          }
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 4: Vela de Descanso Baixa (PUT)
    // Vela 1 vermelha de força + Vela 2 verde de descanso fechando abaixo dos 50%
    // Entrada oficial de VENDA (PUT) na 3ª vela
    // ----------------------------------------------------
    case 'padrao_4_correcao_50_put': {
      if (prev1) {
        const forceBody = prev1.open - prev1.close;
        if (isRed(prev1) && forceBody > 0.00001) {
          const mid50 = prev1.close + forceBody * 0.5;
          const isGreenCorr = isGreen(current);
          const closedBelow50 = current.close <= mid50;
          if (isGreenCorr && closedBelow50) {
            return {
              direction: 'PUT',
              score: 96,
              reasons: [
                'Padrão 4: Vela de Descanso Baixa',
                `Vela de descanso verde respeitou e fechou abaixo dos 50% (${mid50.toFixed(5)})`,
                'Entrada de VENDA (PUT) na retomada do fluxo de baixa',
              ],
            };
          }
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 5: Consolidação de Alta (CALL)
    // Setup na 4ª vela: 1 Verde, 2 Vermelha, 3 Verde, 4 Vermelha
    // Entrada oficial de COMPRA (CALL) na 5ª vela na direção da Vela 1
    // ----------------------------------------------------
    case 'padrao_5_consolidacao_call': {
      if (prev3 && prev2 && prev1) {
        if (isGreen(prev3) && isRed(prev2) && isGreen(prev1) && isRed(current)) {
          return {
            direction: 'CALL',
            score: 95,
            reasons: [
              'Padrão 5: Consolidação de Alta',
              'Alternância de 4 velas confirmada (Verde, Vermelha, Verde, Vermelha)',
              'Entrada de COMPRA (CALL) na 5ª vela na direção da Vela 1',
            ],
          };
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // PADRÃO 6: Consolidação de Baixa (PUT)
    // Setup na 4ª vela: 1 Vermelha, 2 Verde, 3 Vermelha, 4 Verde
    // Entrada oficial de VENDA (PUT) na 5ª vela na direção da Vela 1
    // ----------------------------------------------------
    case 'padrao_6_consolidacao_put': {
      if (prev3 && prev2 && prev1) {
        if (isRed(prev3) && isGreen(prev2) && isRed(prev1) && isGreen(current)) {
          return {
            direction: 'PUT',
            score: 95,
            reasons: [
              'Padrão 6: Consolidação de Baixa',
              'Alternância de 4 velas confirmada (Vermelha, Verde, Vermelha, Verde)',
              'Entrada de VENDA (PUT) na 5ª vela na direção da Vela 1',
            ],
          };
        }
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // ESTRATÉGIA: Suporte e Resistência (Price Action / Retração / Reversão)
    // ----------------------------------------------------
    case 'estrategia_suporte_resistencia': {
      if (index < 6) return { direction: null, score: 0, reasons: [] };

      // Lookback de 20 a 35 velas para mapear topos e fundos prévios
      const lookback = Math.min(index, 35);
      const startIdx = index - lookback;

      // Calcular ATR recente para tolerância dinâmica de toque na zona
      let trSum = 0;
      let trCount = 0;
      const atrStart = Math.max(0, index - 14);
      for (let k = atrStart; k < index; k++) {
        trSum += (candles[k].high - candles[k].low);
        trCount++;
      }
      const atr = trCount > 0 ? (trSum / trCount) : 0.0004;
      const zoneTolerance = Math.max(atr * 0.22, 0.0001);

      // Topo mais alto e fundo mais baixo do período (Zonas Extremas)
      let highestHigh = -Infinity;
      let lowestLow = Infinity;
      for (let k = startIdx; k < index; k++) {
        if (candles[k].high > highestHigh) highestHigh = candles[k].high;
        if (candles[k].low < lowestLow) lowestLow = candles[k].low;
      }

      // Mapear topos (Resistências) e fundos (Suportes) anteriores
      const resistances: { price: number; touches: number }[] = [];
      const supports: { price: number; touches: number }[] = [];

      for (let j = startIdx + 1; j < index - 1; j++) {
        const cPrev = candles[j - 1];
        const cCurr = candles[j];
        const cNext = candles[j + 1];

        // Topo local (Swing High)
        if (cCurr.high >= cPrev.high && cCurr.high >= cNext.high) {
          const matched = resistances.find((r) => Math.abs(r.price - cCurr.high) <= zoneTolerance);
          if (matched) {
            matched.touches++;
            matched.price = (matched.price + cCurr.high) / 2;
          } else {
            resistances.push({ price: cCurr.high, touches: 1 });
          }
        }

        // Fundo local (Swing Low)
        if (cCurr.low <= cPrev.low && cCurr.low <= cNext.low) {
          const matched = supports.find((s) => Math.abs(s.price - cCurr.low) <= zoneTolerance);
          if (matched) {
            matched.touches++;
            matched.price = (matched.price + cCurr.low) / 2;
          } else {
            supports.push({ price: cCurr.low, touches: 1 });
          }
        }
      }

      // Níveis consolidados: 2+ toques confirmados ou extremidade absoluta do período
      const validResistances = resistances.filter((r) => r.touches >= 2 || Math.abs(r.price - highestHigh) <= zoneTolerance);
      const validSupports = supports.filter((s) => s.touches >= 2 || Math.abs(s.price - lowestLow) <= zoneTolerance);

      const body = Math.abs(current.close - current.open);
      const candleRange = current.high - current.low;
      const upperWick = current.high - Math.max(current.open, current.close);
      const lowerWick = Math.min(current.open, current.close) - current.low;

      // 1. TESTE DE RESISTÊNCIA ➔ SINAL DE VENDA (PUT)
      // O preço testou o teto com pavio superior e fechou contido abaixo do nível
      const testedResistance = validResistances.find(
        (r) =>
          (current.high >= r.price - zoneTolerance) &&
          (current.close <= r.price + zoneTolerance * 0.3)
      );

      const hasBearishRejection = upperWick >= body * 0.4 && upperWick >= candleRange * 0.28 && upperWick > 0.00003;
      const isBearishClose = current.close <= current.open + body * 0.25 || upperWick >= body;

      // 2. TESTE DE SUPORTE ➔ SINAL DE COMPRA (CALL)
      // O preço testou o piso com pavio inferior e fechou contido acima do nível
      const testedSupport = validSupports.find(
        (s) =>
          (current.low <= s.price + zoneTolerance) &&
          (current.close >= s.price - zoneTolerance * 0.3)
      );

      const hasBullishRejection = lowerWick >= body * 0.4 && lowerWick >= candleRange * 0.28 && lowerWick > 0.00003;
      const isBullishClose = current.close >= current.open - body * 0.25 || lowerWick >= body;

      // Conflito de pavios em vela de alta volatilidade: vence o lado com maior pavio de rejeição
      if (testedResistance && testedSupport) {
        if (upperWick > lowerWick && hasBearishRejection && isBearishClose) {
          return {
            direction: 'PUT',
            score: 95,
            reasons: [
              'Suporte & Resistência: Rejeição no Teto de Resistência',
              `Preço testou a zona de ${testedResistance.price.toFixed(5)} (${testedResistance.touches} toques) e sofreu rejeição vendedora`,
              'Entrada de VENDA (PUT) na próxima vela para retração/reversão',
            ],
          };
        } else if (lowerWick > upperWick && hasBullishRejection && isBullishClose) {
          return {
            direction: 'CALL',
            score: 95,
            reasons: [
              'Suporte & Resistência: Rejeição no Piso de Suporte',
              `Preço testou a zona de ${testedSupport.price.toFixed(5)} (${testedSupport.touches} toques) e sofreu rejeição compradora`,
              'Entrada de COMPRA (CALL) na próxima vela para retração/reversão',
            ],
          };
        }
      }

      if (testedResistance && hasBearishRejection && isBearishClose) {
        return {
          direction: 'PUT',
          score: 95,
          reasons: [
            'Suporte & Resistência: Rejeição no Teto de Resistência',
            `Preço testou a zona de ${testedResistance.price.toFixed(5)} (${testedResistance.touches} toques) e sofreu rejeição vendedora`,
            'Entrada de VENDA (PUT) na próxima vela para retração/reversão',
          ],
        };
      }

      if (testedSupport && hasBullishRejection && isBullishClose) {
        return {
          direction: 'CALL',
          score: 95,
          reasons: [
            'Suporte & Resistência: Rejeição no Piso de Suporte',
            `Preço testou a zona de ${testedSupport.price.toFixed(5)} (${testedSupport.touches} toques) e sofreu rejeição compradora`,
            'Entrada de COMPRA (CALL) na próxima vela para retração/reversão',
          ],
        };
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
  // Regra Estrita: A IA só mantém ativas as estratégias acima de 65% de assertividade
  const profitable = backtestResults
    .filter((b) => b.winRate >= 65 && !b.autoDeactivated)
    .map((b) => b.id);
  if (profitable.length > 0) return profitable;

  // Se nenhuma atingiu o histórico de 65% ainda (início da sessão), mantém as que estão aguardando avaliação
  const awaiting = backtestResults
    .filter((b) => !b.autoDeactivated && (b.winRate >= 65 || b.profitStatus === 'AGUARDANDO'))
    .map((b) => b.id);
  if (awaiting.length > 0) return awaiting;

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

    // REGRA DE OURO: A IA só mantém as estratégias ativas com assertividade acima dos 65% quando o auto-filtro estiver ativado
    if (decisiveTrades >= 2) {
      if (winRate >= 65) {
        profitStatus = 'LUCRO';
        isProfitable = true;
        autoDeactivated = false;
      } else {
        profitStatus = 'PREJUIZO';
        isProfitable = false;
        // Só desativa automaticamente se o Auto-Filtro IA de Lucro estiver habilitado
        autoDeactivated = autoFilterProfitOnly ? true : false;
      }
    } else {
      profitStatus = 'AGUARDANDO';
      isProfitable = true;
      autoDeactivated = false;
    }

    const isActive = safeActiveIds.includes(strat.id) && (!autoFilterProfitOnly || !autoDeactivated);

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

    // TRAVA RESTRITIVA: Se o auto-filtro de lucro da IA estiver ativo, bloqueia estratégias com assertividade abaixo de 65%
    if (backtestResults && backtestResults.length > 0) {
      const bRes = backtestResults.find((b) => b.id === stratId);
      if (bRes && bRes.autoDeactivated) {
        continue; // Bloqueado pela IA: assertividade abaixo de 65% com auto-filtro ativado
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

  decisions.sort((a, b) => {
    const wrA = winRateMap[a.strategy.id] || 0;
    const wrB = winRateMap[b.strategy.id] || 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.score - a.score;
  });

  return decisions[0];
}
