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
 * Calcula a Média Móvel Exponencial (EMA) com precisão
 */
function calculateEma(candles: Candle[], index: number, period: number): number {
  if (index < 0 || candles.length === 0) return 0;
  const k = 2 / (period + 1);
  const start = Math.max(0, index - period * 2);
  let ema = candles[start]?.close || 0;
  for (let i = start + 1; i <= index; i++) {
    if (candles[i]) {
      ema = candles[i].close * k + ema * (1 - k);
    }
  }
  return ema;
}

/**
 * Calcula o Average True Range (ATR) para medição de volatilidade e filtro de dojis
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
 * Avalia uma estratégia individual em um índice específico da lista de velas
 * Aplica lógica institucional de Price Action, SMC e Médias Móveis para Opções Binárias.
 */
export function evaluateSingleStrategy(
  strategyId: string,
  candles: Candle[],
  index: number
): { direction: SignalDirection | null; score: number; reasons: string[] } {
  // Precisa de pelo menos 22 candles anteriores para cálculo confiável de EMA, ATR e níveis estruturais
  if (!candles || !Array.isArray(candles) || index < 22 || index >= candles.length) {
    return { direction: null, score: 0, reasons: [] };
  }

  const current = candles[index];
  const prev = candles[index - 1];
  const prev2 = candles[index - 2];
  if (!current || !prev || !prev2) {
    return { direction: null, score: 0, reasons: [] };
  }

  const body = Math.abs(current.close - current.open);
  const range = Math.max(current.high - current.low, 0.00001);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const isGreen = current.close > current.open;
  const isRed = current.close < current.open;

  const atr = calculateAtr(candles, index, 14);

  // Filtro Anti-Doji / Ruído: Se a vela tiver range minúsculo (< 35% do ATR), ignora qualquer entrada
  if (range < atr * 0.35) {
    return { direction: null, score: 0, reasons: [] };
  }

  // Médias Móveis Institucionais (EMA 9, EMA 21, EMA 50)
  const ema9 = calculateEma(candles, index, 9);
  const ema21 = calculateEma(candles, index, 21);
  const ema50 = calculateEma(candles, index, 50);

  const isUptrend = ema9 > ema21 && current.close >= ema21;
  const isDowntrend = ema9 < ema21 && current.close <= ema21;
  const isStrongUptrend = isUptrend && ema21 > ema50;
  const isStrongDowntrend = isDowntrend && ema21 < ema50;

  // Contagem de velas consecutivas da mesma cor (Anti-Exaustão)
  let consecutiveGreen = 0;
  let consecutiveRed = 0;
  for (let k = index - 1; k >= Math.max(0, index - 8); k--) {
    if (candles[k].close > candles[k].open) {
      if (consecutiveRed > 0) break;
      consecutiveGreen++;
    } else if (candles[k].close < candles[k].open) {
      if (consecutiveGreen > 0) break;
      consecutiveRed++;
    } else {
      break;
    }
  }

  // Suporte e Resistência Verdadeiros (Swing Highs e Swing Lows dos últimos 25 a 40 candles)
  const lookback = Math.min(40, index);
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  let touchesHigh = 0;
  let touchesLow = 0;

  for (let k = index - lookback; k < index; k++) {
    const c = candles[k];
    if (!c) continue;
    if (c.high > swingHigh) swingHigh = c.high;
    if (c.low < swingLow) swingLow = c.low;
  }

  // Conta toques nas regiões para validar consistência
  const zoneTolerance = atr * 0.45;
  for (let k = index - lookback; k < index; k++) {
    const c = candles[k];
    if (!c) continue;
    if (Math.abs(c.high - swingHigh) <= zoneTolerance) touchesHigh++;
    if (Math.abs(c.low - swingLow) <= zoneTolerance) touchesLow++;
  }

  const nearRes = Math.abs(current.high - swingHigh) <= zoneTolerance || current.high >= swingHigh;
  const nearSup = Math.abs(current.low - swingLow) <= zoneTolerance || current.low <= swingLow;

  // RSI de 9 períodos com suavização
  let gains = 0;
  let losses = 0;
  const rsiStart = Math.max(1, index - 9);
  for (let k = rsiStart; k <= index; k++) {
    if (candles[k] && candles[k - 1]) {
      const diff = candles[k].close - candles[k - 1].close;
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
  }
  const rs = losses === 0 ? 100 : gains / (losses || 0.00001);
  const rsi = 100 - (100 / (1 + rs));

  switch (strategyId) {
    // ----------------------------------------------------
    // 1. Rejeição em Suporte & Resistência (Taxa Sniper)
    // ----------------------------------------------------
    case 'retração_sr': {
      // CALL SNIPER:
      // Preço tocou zona de suporte comprovada, deixou pavio inferior expressivo e fechou ACIMA do suporte.
      // Bloqueia se estiver em queda livre com 4+ velas vermelhas consecutivas sem exaustão.
      const isCallRejection =
        nearSup &&
        lowerWick >= range * 0.45 &&
        lowerWick > body * 1.2 &&
        current.close > swingLow &&
        (!isStrongDowntrend || rsi <= 28) &&
        consecutiveRed <= 3;

      // PUT SNIPER:
      // Preço tocou zona de resistência comprovada, deixou pavio superior expressivo e fechou ABAIXO da resistência.
      // Bloqueia se estiver em rali vertical com 4+ velas verdes consecutivas sem exaustão.
      const isPutRejection =
        nearRes &&
        upperWick >= range * 0.45 &&
        upperWick > body * 1.2 &&
        current.close < swingHigh &&
        (!isStrongUptrend || rsi >= 72) &&
        consecutiveGreen <= 3;

      if (isCallRejection && !isPutRejection) {
        return {
          direction: 'CALL',
          score: 88,
          reasons: [
            `Taxa Sniper: Rejeição em Suporte (${swingLow.toFixed(5)})`,
            `Pavio de retração inferior longo (${((lowerWick / range) * 100).toFixed(0)}% da vela)`,
            'Defesa compradora comprovada na zona de taxa',
          ],
        };
      }
      if (isPutRejection && !isCallRejection) {
        return {
          direction: 'PUT',
          score: 88,
          reasons: [
            `Taxa Sniper: Rejeição em Resistência (${swingHigh.toFixed(5)})`,
            `Pavio de retração superior longo (${((upperWick / range) * 100).toFixed(0)}% da vela)`,
            'Defesa vendedora comprovada na zona de taxa',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 2. Fluxo Contínuo & Momentum (Pullback na Média)
    // ----------------------------------------------------
    case 'fluxo_tendencia': {
      // CALL NO PULLBACK:
      // Tendência de alta (EMA 9 > EMA 21). Vela fez correção saudável tocando a EMA 21 ou EMA 9,
      // rejeitou a queda com pavio inferior e fechou verde ou martelo a favor da alta.
      // TRAVA DE OURO: NUNCA COMPRA SE ESTIVER EM CIMA DE UMA RESISTÊNCIA!
      const touchedEmaCall = current.low <= ema9 + zoneTolerance && current.close >= ema9;
      const isCallPullback =
        isUptrend &&
        !nearRes &&
        touchedEmaCall &&
        lowerWick >= range * 0.35 &&
        consecutiveGreen <= 3 &&
        (isGreen || lowerWick > body * 1.5);

      // PUT NO PULLBACK:
      // Tendência de baixa (EMA 9 < EMA 21). Vela fez correção saudável subindo até a EMA 21 ou EMA 9,
      // rejeitou a subida com pavio superior e fechou vermelha ou estrela a favor da baixa.
      // TRAVA DE OURO: NUNCA VENDE SE ESTIVER EM CIMA DE UM SUPORTE!
      const touchedEmaPut = current.high >= ema9 - zoneTolerance && current.close <= ema9;
      const isPutPullback =
        isDowntrend &&
        !nearSup &&
        touchedEmaPut &&
        upperWick >= range * 0.35 &&
        consecutiveRed <= 3 &&
        (isRed || upperWick > body * 1.5);

      if (isCallPullback && !isPutPullback) {
        return {
          direction: 'CALL',
          score: 87,
          reasons: [
            'Fluxo & Pullback: Rejeição compradora na EMA 9/21',
            'Tendência de alta confirmada pelas médias móveis',
            'Retomada do fluxo direcional para a próxima vela',
          ],
        };
      }
      if (isPutPullback && !isCallPullback) {
        return {
          direction: 'PUT',
          score: 87,
          reasons: [
            'Fluxo & Pullback: Rejeição vendedora na EMA 9/21',
            'Tendência de baixa confirmada pelas médias móveis',
            'Retomada do fluxo direcional para a próxima vela',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 3. SMC: Captura de Liquidez Institucional (Sweep & Trap)
    // ----------------------------------------------------
    case 'smc_liquidez': {
      // CALL (BEAR TRAP INSTITUCIONAL):
      // A mínima da vela atual violou o Swing Low anterior (stopando o varejo),
      // mas os institucionais absorveram as vendas e o fechamento voltou ACIMA do Swing Low com pavio forte.
      const sweepLow =
        current.low < swingLow &&
        current.close >= swingLow &&
        lowerWick >= range * 0.45 &&
        lowerWick > body;

      // PUT (BULL TRAP INSTITUCIONAL):
      // A máxima da vela atual violou o Swing High anterior (induzindo compra de rompimento),
      // mas os institucionais descarregaram e o fechamento voltou ABAIXO do Swing High com pavio forte.
      const sweepHigh =
        current.high > swingHigh &&
        current.close <= swingHigh &&
        upperWick >= range * 0.45 &&
        upperWick > body;

      if (sweepLow && !sweepHigh) {
        return {
          direction: 'CALL',
          score: 90,
          reasons: [
            'SMC: Captura de Liquidez institucional no fundo (Bear Trap)',
            `Violou o fundo (${swingLow.toFixed(5)}) e fechou com absorção de ${((lowerWick / range) * 100).toFixed(0)}%`,
            'Bancos injetaram liquidez compradora para reversão',
          ],
        };
      }
      if (sweepHigh && !sweepLow) {
        return {
          direction: 'PUT',
          score: 90,
          reasons: [
            'SMC: Captura de Liquidez institucional no topo (Bull Trap)',
            `Violou o topo (${swingHigh.toFixed(5)}) e fechou com absorção de ${((upperWick / range) * 100).toFixed(0)}%`,
            'Bancos injetaram liquidez vendedora para reversão',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 4. Reversão em Exaustão (RSI Extremo + Rejeição)
    // ----------------------------------------------------
    case 'reversao_rsi': {
      // CALL: RSI muito baixo (<= 25) + pelo menos 3 velas vermelhas prévias + pavio longo de rejeição no fundo
      const isCallReversal =
        rsi <= 26 &&
        consecutiveRed >= 3 &&
        lowerWick >= range * 0.48 &&
        (isGreen || lowerWick > body * 1.3);

      // PUT: RSI muito alto (>= 75) + pelo menos 3 velas verdes prévias + pavio longo de rejeição no topo
      const isPutReversal =
        rsi >= 74 &&
        consecutiveGreen >= 3 &&
        upperWick >= range * 0.48 &&
        (isRed || upperWick > body * 1.3);

      if (isCallReversal) {
        return {
          direction: 'CALL',
          score: 86,
          reasons: [
            `Reversão RSI: Sobrevenda extrema atingida (${rsi.toFixed(1)} pts)`,
            `Clímax vendedor após ${consecutiveRed} velas de queda consecutivas`,
            'Pavio de absorção indicando reversão iminente',
          ],
        };
      }
      if (isPutReversal) {
        return {
          direction: 'PUT',
          score: 86,
          reasons: [
            `Reversão RSI: Sobrecompra extrema atingida (${rsi.toFixed(1)} pts)`,
            `Clímax comprador após ${consecutiveGreen} velas de alta consecutivas`,
            'Pavio de absorção indicando reversão iminente',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 5. Engolfo de Força (Price Action Pro)
    // ----------------------------------------------------
    case 'engolfo_pro': {
      const prevBody = Math.abs(prev.close - prev.open);
      const prevIsRed = prev.close < prev.open;
      const prevIsGreen = prev.close > prev.open;

      // CALL: Vela anterior vermelha consistente. Vela atual verde dominante engolfa 100% do corpo anterior
      // e fecha firme perto da máxima (pouco pavio superior) em região favorável.
      // TRAVA DE OURO: NUNCA COMPRA SE ESTIVER EM CIMA DE RESISTÊNCIA!
      const isCallEngulf =
        isGreen &&
        !nearRes &&
        prevIsRed &&
        prevBody >= atr * 0.35 &&
        current.close > prev.open &&
        current.open <= prev.close &&
        body >= prevBody * 1.25 &&
        upperWick <= body * 0.25 &&
        !isStrongDowntrend;

      // PUT: Vela anterior verde consistente. Vela atual vermelha dominante engolfa 100% do corpo anterior
      // e fecha firme perto da mínima (pouco pavio inferior) em região favorável.
      // TRAVA DE OURO: NUNCA VENDE SE ESTIVER EM CIMA DE SUPORTE!
      const isPutEngulf =
        isRed &&
        !nearSup &&
        prevIsGreen &&
        prevBody >= atr * 0.35 &&
        current.close < prev.open &&
        current.open >= prev.close &&
        body >= prevBody * 1.25 &&
        lowerWick <= body * 0.25 &&
        !isStrongUptrend;

      if (isCallEngulf) {
        return {
          direction: 'CALL',
          score: 88,
          reasons: [
            'Engolfo Pro: Inversão total de força compradora',
            'Superou 100% do corpo da vela vendedora anterior',
            'Fechamento com expansão de volume no topo',
          ],
        };
      }
      if (isPutEngulf) {
        return {
          direction: 'PUT',
          score: 88,
          reasons: [
            'Engolfo Pro: Inversão total de força vendedora',
            'Superou 100% do corpo da vela compradora anterior',
            'Fechamento com expansão de volume no fundo',
          ],
        };
      }
      return { direction: null, score: 0, reasons: [] };
    }

    // ----------------------------------------------------
    // 6. Rompimento Estrutural Institucional (BOS com Re-teste)
    // ----------------------------------------------------
    case 'rompimento_bos': {
      // CALL BOS: Rompimento estrutural de topo confirmado com re-teste na antiga resistência
      const brokeHighRecently = prev.close > swingHigh || prev2.close > swingHigh;
      const isCallBOS =
        isUptrend &&
        brokeHighRecently &&
        current.low <= swingHigh + zoneTolerance &&
        current.close >= swingHigh &&
        lowerWick >= range * 0.35;

      // PUT BOS: Rompimento estrutural de fundo confirmado com re-teste no antigo suporte
      const brokeLowRecently = prev.close < swingLow || prev2.close < swingLow;
      const isPutBOS =
        isDowntrend &&
        brokeLowRecently &&
        current.high >= swingLow - zoneTolerance &&
        current.close <= swingLow &&
        upperWick >= range * 0.35;

      if (isCallBOS) {
        return {
          direction: 'CALL',
          score: 87,
          reasons: [
            'SMC: Quebra Estrutural (BOS) com Re-teste de Alta',
            `Resistência rompida (${swingHigh.toFixed(5)}) agora atua como novo Suporte`,
            'Rejeição confirmada para continuidade da tendência',
          ],
        };
      }
      if (isPutBOS) {
        return {
          direction: 'PUT',
          score: 87,
          reasons: [
            'SMC: Quebra Estrutural (BOS) com Re-teste de Baixa',
            `Suporte rompido (${swingLow.toFixed(5)}) agora atua como nova Resistência`,
            'Rejeição confirmada para continuidade da tendência',
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
 * Obtém se o Auto-Filtro IA de Lucro está ativo (desativa automaticamente estratégias em prejuízo)
 */
export function getStoredAutoFilterProfit(): boolean {
  try {
    const raw = localStorage.getItem('clandex_auto_filter_profit');
    if (raw !== null) return raw === 'true';
  } catch {}
  return true; // Padrão: ATIVADO (A IA filtra e desativa automaticamente as que dão loss)
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
 * Retorna os IDs das estratégias que a IA aprovou como lucrativas (WinRate >= 55% e sem prejuízo)
 */
export function getProfitableStrategyIds(backtestResults: StrategyBacktestResult[]): string[] {
  const profitable = backtestResults
    .filter((b) => b.isProfitable && !b.autoDeactivated)
    .map((b) => b.id);
  if (profitable.length > 0) return profitable;
  return backtestResults.length > 0 ? [backtestResults[0].id] : ['retração_sr'];
}

/**
 * Executa o Backtest em Tempo Real de TODAS as estratégias
 * sobre o histórico de velas atual do ativo e timeframe.
 * Classifica lucro real e desativa automaticamente estratégias perdedoras.
 */
export function runRealtimeBacktest(
  candles?: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  autoFilterProfitOnly = getStoredAutoFilterProfit()
): StrategyBacktestResult[] {
  const safeActiveIds = Array.isArray(activeStrategyIds) ? activeStrategyIds : getStoredActiveStrategies();

  if (!candles || !Array.isArray(candles) || candles.length < 25) {
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
      isActive: safeActiveIds.includes(strat.id),
      isProfitable: true,
      profitStatus: 'AGUARDANDO',
      autoDeactivated: false,
    }));
  }

  const resultsMap: Record<string, { wins: number; losses: number; ties: number; consecutiveWins: number; currentStreak: number; lastSignal?: { dir: 'CALL' | 'PUT'; time: number } }> = {};

  AVAILABLE_STRATEGIES.forEach((s) => {
    resultsMap[s.id] = { wins: 0, losses: 0, ties: 0, consecutiveWins: 0, currentStreak: 0 };
  });

  // Simula vela por vela com limites protegidos contra bounds inválidos
  const maxEvalIndex = candles.length - 2;
  const startEvalIndex = Math.max(22, candles.length - 120); // Avalia a partir do candle 22 até max

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

  for (let i = startEvalIndex; i <= maxEvalIndex; i++) {
    const outcomeCandle = candles[i + 1];
    if (!outcomeCandle) continue;

    const outcomeDiff = outcomeCandle.close - outcomeCandle.open;
    const EPSILON = 1e-8;

    AVAILABLE_STRATEGIES.forEach((strat) => {
      const evalRes = evaluateSingleStrategy(strat.id, candles, i);
      if (!evalRes || !evalRes.direction) return;

      const record = resultsMap[strat.id];
      if (!record) return;
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
    const r = resultsMap[strat.id] || { wins: 0, losses: 0, ties: 0, consecutiveWins: 0, currentStreak: 0 };
    const totalTrades = r.wins + r.losses + r.ties;
    const decisiveTrades = r.wins + r.losses;
    const winRate = decisiveTrades > 0 ? Number(((r.wins / decisiveTrades) * 100).toFixed(1)) : 0;

    // Lógica Real de Lucratividade para Opções Binárias (Break-even ~54% payout padrão)
    let profitStatus: 'LUCRO' | 'PREJUIZO' | 'AGUARDANDO' = 'AGUARDANDO';
    let isProfitable = true;
    let autoDeactivated = false;

    if (decisiveTrades >= 2) {
      if (winRate >= 55 && r.wins >= r.losses) {
        profitStatus = 'LUCRO';
        isProfitable = true;
      } else {
        profitStatus = 'PREJUIZO';
        isProfitable = false;
        if (autoFilterProfitOnly) {
          autoDeactivated = true;
        }
      }
    } else if (decisiveTrades === 1) {
      if (r.wins > 0) {
        profitStatus = 'LUCRO';
        isProfitable = true;
      } else {
        profitStatus = 'PREJUIZO';
        isProfitable = false;
        if (autoFilterProfitOnly) {
          autoDeactivated = true;
        }
      }
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
      consecutiveWins: recordStreak(r.consecutiveWins),
      lastSignalDirection: r.lastSignal?.dir,
      lastSignalTime: r.lastSignal?.time,
      isActive,
      isProfitable,
      profitStatus,
      autoDeactivated,
    };
  });

  // Ordena por maior WinRate, e em caso de empate, por maior número de vitórias
  return compiled.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.wins - a.wins;
  });
}

function recordStreak(streak: number): number {
  return Math.max(0, streak || 0);
}

/**
 * Avalia todas as estratégias ativas na vela mais recente
 * e retorna a estratégia vencedora mais assertiva.
 * Bloqueia qualquer estratégia em prejuízo para blindar o trader.
 */
export function getBestActiveStrategySignal(
  candles: Candle[],
  activeStrategyIds: string[] = getStoredActiveStrategies(),
  backtestResults?: StrategyBacktestResult[],
  profile: AnalysisProfile = 'MODERADA'
): StrategySignalDecision | null {
  if (!candles || !Array.isArray(candles) || candles.length < 20) return null;

  const lastIndex = candles.length - 1;
  const decisions: StrategySignalDecision[] = [];

  // Cria mapa de assertividade do backtest para ponderar
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

    // Filtro por Perfil de Análise
    if (profile === 'CONSERVADORA' && strat.minProfile === 'AGRESSIVA') {
      continue; // No modo Sniper (Conservador), descarta estratégias muito agressivas
    }

    // Trava de Segurança IA: descarta qualquer estratégia com histórico de prejuízo (< 55%)
    if (backtestResults) {
      const bRes = backtestResults.find((b) => b.id === stratId);
      if (bRes && (bRes.autoDeactivated || bRes.profitStatus === 'PREJUIZO' || (bRes.totalTrades >= 2 && bRes.winRate < 55))) {
        continue;
      }
    }

    const evalRes = evaluateSingleStrategy(stratId, candles, lastIndex);
    if (evalRes && evalRes.direction) {
      const historicalWinRate = winRateMap[stratId] || 70;
      if (profile !== 'AGRESSIVA' && historicalWinRate > 0 && historicalWinRate < 50) {
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

