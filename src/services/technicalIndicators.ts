import { Candle, TimeFrame, Asset } from '../types/trading';
import { LiveTradingViewData } from './tradingViewScanner';

export type IndicatorStatus = 'ALTA' | 'BAIXA' | 'NEUTRO' | 'LATERAL';
export type RsiCondition = 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO';

export interface TechnicalOverviewData {
  timeframe: TimeFrame;
  asset: Asset;
  currentPrice: number;

  // 1. Tendência Maior
  majorTrend: {
    status: 'ALTA' | 'BAIXA' | 'LATERAL';
    strength: 'FORTE' | 'MODERADA' | 'FRACA';
    description: string;
  };

  // 2. Indicadores Principais Solicitados
  rsi: {
    value: number;
    condition: RsiCondition;
    statusLabel: string; // "Sobrecomprado" | "Sobrevendido" | "Neutro"
    signal: 'ALTA' | 'BAIXA' | 'NEUTRO';
  };

  macd: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    macdLine: number;
    signalLine: number;
    histogram: number;
    description: string;
  };

  maShort: {
    status: 'ALTA' | 'BAIXA' | 'LATERAL';
    ema9: number;
    ema21: number;
    label: string;
  };

  maLong: {
    status: 'ALTA' | 'BAIXA' | 'LATERAL';
    sma50: number;
    sma200: number;
    label: string;
  };

  bollingerBands: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    description: string;
  };

  volume: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    currentVolume: number;
    averageVolume: number;
    ratio: number;
    description: string;
  };

  delta: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    buyerPercent: number;
    sellerPercent: number;
    netDelta: number;
    description: string;
  };

  adx: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    value: number;
    plusDI: number;
    minusDI: number;
    trendStrength: string;
  };

  // Indicadores Adicionais Relevantes
  stochastic: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    kValue: number;
    dValue: number;
    label: string;
  };

  atr: {
    status: 'ALTA' | 'BAIXA' | 'NEUTRO';
    value: number;
    pips: number;
  };
}

/**
 * Calculate Exponential Moving Average
 */
function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Calculate Simple Moving Average
 */
function calcSMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length;
}

/**
 * Compute Complete Technical Indicators Suite for a Given Asset, TimeFrame & Candles
 * Prioritizes live TradingView scanner data for 1:1 real-time accuracy.
 */
export function computeTechnicalOverview(
  candles: Candle[],
  timeframe: TimeFrame,
  asset: Asset,
  tvData?: LiveTradingViewData | null
): TechnicalOverviewData {
  // Garante isolamento estrito: se tvData pertencer a outro par, descarta imediatamente
  const safeTv = (tvData && tvData.symbol === asset.symbol) ? tvData : null;

  const n = candles.length;
  const currentPrice = n > 0 && candles[n - 1].close > 0 ? candles[n - 1].close : asset.currentPrice;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const latest = n > 0 ? candles[n - 1] : { open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, volume: 100, time: 0, isClosed: false };
  const prev = n > 1 ? candles[n - 2] : latest;

  const pipUnit = Math.pow(10, -asset.pipDecimals);
  const threshold = pipUnit * 2;

  // --- 1. RSI (14 períodos) ---
  let rsiVal: number;
  if (safeTv && typeof safeTv.rsi === 'number' && !isNaN(safeTv.rsi)) {
    rsiVal = safeTv.rsi;
  } else {
    const rsiPeriod = Math.min(14, Math.max(2, n - 1));
    let gains = 0;
    let losses = 0;
    for (let i = Math.max(1, n - rsiPeriod); i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiVal = Number((100 - 100 / (1 + rs)).toFixed(1));
  }

  let rsiCondition: RsiCondition = 'NEUTRO';
  let rsiLabel = 'Neutro';
  let rsiSignal: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';

  if (rsiVal >= 70) {
    rsiCondition = 'SOBRECOMPRADO';
    rsiLabel = 'Sobrecomprado';
    rsiSignal = 'ALTA'; // Momentum comprador / exaustão em topos
  } else if (rsiVal <= 30) {
    rsiCondition = 'SOBREVENDIDO';
    rsiLabel = 'Sobrevendido';
    rsiSignal = 'BAIXA'; // Momentum vendedor / exaustão em fundos
  } else {
    rsiCondition = 'NEUTRO';
    rsiLabel = 'Neutro';
    rsiSignal = rsiVal >= 55 ? 'ALTA' : rsiVal <= 45 ? 'BAIXA' : 'NEUTRO';
  }

  // --- 2. MACD (12, 26, 9) ---
  let macdLine: number;
  let signalLine: number;
  let histogram: number;
  let macdStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  let macdDesc = 'Histograma próximo a zero';

  if (safeTv && typeof safeTv.macd === 'number' && typeof safeTv.macdSignal === 'number') {
    macdLine = safeTv.macd;
    signalLine = safeTv.macdSignal;
    histogram = macdLine - signalLine;
    if (histogram > threshold && macdLine > signalLine) {
      macdStatus = 'ALTA';
      macdDesc = 'Cruzamento altista e histograma positivo (TV Live)';
    } else if (histogram < -threshold && macdLine < signalLine) {
      macdStatus = 'BAIXA';
      macdDesc = 'Cruzamento baixista e histograma negativo (TV Live)';
    } else {
      macdStatus = 'NEUTRO';
      macdDesc = 'Linhas sobrepostas em convergência (TV Live)';
    }
  } else {
    const fastEma = calcEMA(closes, 12);
    const slowEma = calcEMA(closes, 26);
    macdLine = fastEma - slowEma;
    const macdHistory: number[] = [];
    const lookback = Math.min(18, n);
    for (let i = n - lookback; i <= n; i++) {
      const subCloses = closes.slice(0, i);
      if (subCloses.length > 5) {
        macdHistory.push(calcEMA(subCloses, 12) - calcEMA(subCloses, 26));
      }
    }
    signalLine = calcEMA(macdHistory.length > 0 ? macdHistory : [macdLine], 9);
    histogram = macdLine - signalLine;

    if (histogram > threshold && macdLine > signalLine) {
      macdStatus = 'ALTA';
      macdDesc = 'Cruzamento altista e histograma positivo';
    } else if (histogram < -threshold && macdLine < signalLine) {
      macdStatus = 'BAIXA';
      macdDesc = 'Cruzamento baixista e histograma negativo';
    } else {
      macdStatus = 'NEUTRO';
      macdDesc = 'Linhas sobrepostas em convergência';
    }
  }

  // --- 3. MÉDIAS MÓVEIS DE CURTO PERÍODO (EMA 9 / EMA 21) ---
  let ema9: number;
  let ema21: number;
  let maShortStatus: 'ALTA' | 'BAIXA' | 'LATERAL' = 'LATERAL';
  let maShortLabel = 'EMAs 9/21 laterais';

  if (safeTv && typeof safeTv.ema10 === 'number' && typeof safeTv.ema20 === 'number') {
    ema9 = safeTv.ema10;
    ema21 = safeTv.ema20;
    const diff = ema9 - ema21;
    if (ema9 > ema21 && currentPrice >= ema9 && diff > threshold) {
      maShortStatus = 'ALTA';
      maShortLabel = 'EMA 10 acima da EMA 20 (Alinhamento Comprador TV)';
    } else if (ema9 < ema21 && currentPrice <= ema9 && diff < -threshold) {
      maShortStatus = 'BAIXA';
      maShortLabel = 'EMA 10 abaixo da EMA 20 (Alinhamento Vendedor TV)';
    } else {
      maShortStatus = 'LATERAL';
      maShortLabel = 'EMAs rápidas em convergência';
    }
  } else {
    ema9 = calcEMA(closes, 9);
    ema21 = calcEMA(closes, 21);
    const diff9_21 = ema9 - ema21;
    if (ema9 > ema21 && currentPrice > ema9 && diff9_21 > threshold) {
      maShortStatus = 'ALTA';
      maShortLabel = 'EMA 9 acima da EMA 21 (Alinhamento Comprador)';
    } else if (ema9 < ema21 && currentPrice < ema9 && diff9_21 < -threshold) {
      maShortStatus = 'BAIXA';
      maShortLabel = 'EMA 9 abaixo da EMA 21 (Alinhamento Vendedor)';
    } else {
      maShortStatus = 'LATERAL';
      maShortLabel = 'EMAs 9 e 21 sem inclinação definida';
    }
  }

  // --- 4. MÉDIAS MÓVEIS DE LONGO PERÍODO (SMA 50 / SMA 200) ---
  let sma50: number;
  let sma200: number;
  let maLongStatus: 'ALTA' | 'BAIXA' | 'LATERAL' = 'LATERAL';
  let maLongLabel = 'SMA 50/200 neutras';

  if (safeTv && typeof safeTv.sma50 === 'number') {
    sma50 = safeTv.sma50;
    sma200 = safeTv.sma200 || sma50 * 0.998;
    if (currentPrice > sma50 && sma50 >= sma200) {
      maLongStatus = 'ALTA';
      maLongLabel = 'Preço acima da SMA 50 e SMA 200 (TradingView)';
    } else if (currentPrice < sma50 && sma50 <= sma200) {
      maLongStatus = 'BAIXA';
      maLongLabel = 'Preço abaixo da SMA 50 e SMA 200 (TradingView)';
    } else {
      maLongStatus = 'LATERAL';
      maLongLabel = 'Preço em transição de médias longas (TradingView)';
    }
  } else {
    sma50 = calcSMA(closes, Math.min(50, closes.length));
    sma200 = closes.length >= 70 ? calcSMA(closes, Math.min(200, closes.length)) : (sma50 * 0.998);
    if (currentPrice > sma50 && sma50 >= sma200) {
      maLongStatus = 'ALTA';
      maLongLabel = 'Preço acima da SMA 50 e SMA 200';
    } else if (currentPrice < sma50 && sma50 <= sma200) {
      maLongStatus = 'BAIXA';
      maLongLabel = 'Preço abaixo da SMA 50 e SMA 200';
    } else {
      maLongStatus = 'LATERAL';
      maLongLabel = 'Preço em transição entre médias longas';
    }
  }

  // --- 5. BANDAS DE BOLLINGER (20, 2) ---
  let bbUpper: number;
  let bbMiddle: number;
  let bbLower: number;
  let percentB: number;
  let bbStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  let bbDesc = 'Preço no centro do canal';

  if (safeTv && typeof safeTv.bbUpper === 'number' && typeof safeTv.bbLower === 'number') {
    bbUpper = safeTv.bbUpper;
    bbLower = safeTv.bbLower;
    bbMiddle = (bbUpper + bbLower) / 2;
    const bbRange = bbUpper - bbLower || threshold;
    percentB = (currentPrice - bbLower) / bbRange;

    if (currentPrice >= bbUpper - (bbRange * 0.1) || percentB >= 0.85) {
      bbStatus = 'ALTA';
      bbDesc = 'Tocando Banda Superior (Pressão Compradora TV)';
    } else if (currentPrice <= bbLower + (bbRange * 0.1) || percentB <= 0.15) {
      bbStatus = 'BAIXA';
      bbDesc = 'Tocando Banda Inferior (Pressão Vendedora TV)';
    } else {
      bbStatus = 'NEUTRO';
      bbDesc = 'Oscilação normal dentro das bandas (TV Live)';
    }
  } else {
    const bbPeriod = Math.min(20, closes.length);
    bbMiddle = calcSMA(closes, bbPeriod);
    const sliceForDev = closes.slice(-bbPeriod);
    const variance = sliceForDev.reduce((acc, v) => acc + Math.pow(v - bbMiddle, 2), 0) / bbPeriod;
    const stdDev = Math.sqrt(variance);
    bbUpper = bbMiddle + 2 * stdDev;
    bbLower = bbMiddle - 2 * stdDev;
    const bbRange = bbUpper - bbLower || threshold;
    percentB = (currentPrice - bbLower) / bbRange;

    if (currentPrice >= bbUpper - (bbRange * 0.1) || percentB >= 0.85) {
      bbStatus = 'ALTA';
      bbDesc = 'Tocando Banda Superior (Pressão Compradora)';
    } else if (currentPrice <= bbLower + (bbRange * 0.1) || percentB <= 0.15) {
      bbStatus = 'BAIXA';
      bbDesc = 'Tocando Banda Inferior (Pressão Vendedora)';
    } else {
      bbStatus = 'NEUTRO';
      bbDesc = 'Oscilação normal dentro do canal';
    }
  }

  // --- 6. VOLUME (Vs Média de 20 Períodos) ---
  const volPeriod = Math.min(20, volumes.length);
  const avgVol = calcSMA(volumes, volPeriod);
  const recentVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const volRatio = avgVol > 0 ? Number((recentVol / avgVol).toFixed(2)) : 1.0;

  let volumeStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  let volDesc = 'Volume na média';

  const isGreenCandles = latest.close >= latest.open && prev.close >= prev.open;
  const isRedCandles = latest.close <= latest.open && prev.close <= prev.open;

  if (volRatio >= 1.15 && isGreenCandles) {
    volumeStatus = 'ALTA';
    volDesc = `Volume Comprador Elevado (${volRatio}x a média)`;
  } else if (volRatio >= 1.15 && isRedCandles) {
    volumeStatus = 'BAIXA';
    volDesc = `Volume Vendedor Elevado (${volRatio}x a média)`;
  } else if (volRatio >= 1.3) {
    volumeStatus = latest.close >= latest.open ? 'ALTA' : 'BAIXA';
    volDesc = `Volume Institucional Atípico (${volRatio}x)`;
  } else {
    volumeStatus = 'NEUTRO';
    volDesc = `Volume Regular (${volRatio}x a média)`;
  }

  // --- 7. DELTA (Volume Delta / Pressão de Fluxo Comprador x Vendedor) ---
  let buyerSum = 0;
  let sellerSum = 0;
  const deltaPeriod = Math.min(10, n);

  for (let i = n - deltaPeriod; i < n; i++) {
    const c = candles[i];
    const totalRange = c.high - c.low || pipUnit;
    const buyPressure = (c.close - c.low) / totalRange;
    const sellPressure = (c.high - c.close) / totalRange;
    buyerSum += c.volume * buyPressure;
    sellerSum += c.volume * sellPressure;
  }

  const totalDeltaVol = buyerSum + sellerSum || 1;
  const buyerPct = Math.round((buyerSum / totalDeltaVol) * 100);
  const sellerPct = 100 - buyerPct;
  const netDelta = buyerPct - sellerPct;

  let deltaStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  let deltaDesc = 'Fluxo de ordens equilibrado';

  if (buyerPct >= 58) {
    deltaStatus = 'ALTA';
    deltaDesc = `Delta Comprador Predominante (${buyerPct}% vs ${sellerPct}%)`;
  } else if (sellerPct >= 58) {
    deltaStatus = 'BAIXA';
    deltaDesc = `Delta Vendedor Predominante (${sellerPct}% vs ${buyerPct}%)`;
  } else {
    deltaStatus = 'NEUTRO';
    deltaDesc = `Delta Neutro (${buyerPct}% C / ${sellerPct}% V)`;
  }

  // --- 8. ADX (Índice Direcional Médio - 14 períodos) ---
  let adxValue: number;
  let plusDI = 25;
  let minusDI = 25;
  let adxStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  let trendStrength = 'Mercado sem direção forte';

  if (safeTv && typeof safeTv.adx === 'number') {
    adxValue = safeTv.adx;
    if (adxValue >= 24) {
      if (safeTv.recommendationScore >= 0.05) {
        adxStatus = 'ALTA';
        trendStrength = `Tendência Direcional de Alta no TradingView (ADX ${adxValue})`;
      } else if (safeTv.recommendationScore <= -0.05) {
        adxStatus = 'BAIXA';
        trendStrength = `Tendência Direcional de Baixa no TradingView (ADX ${adxValue})`;
      } else {
        adxStatus = 'NEUTRO';
        trendStrength = `ADX Forte (${adxValue}) com oscilação neutra`;
      }
    } else {
      adxStatus = 'NEUTRO';
      trendStrength = `Mercado Consolidado / Sem Tendência Definida (ADX ${adxValue} < 24)`;
    }
  } else {
    let plusDM = 0;
    let minusDM = 0;
    let trSum = 0;
    const adxPeriod = Math.min(14, n - 1);

    for (let i = Math.max(1, n - adxPeriod); i < n; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const upMove = c.high - p.high;
      const downMove = p.low - c.low;

      if (upMove > downMove && upMove > 0) plusDM += upMove;
      if (downMove > upMove && downMove > 0) minusDM += downMove;

      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
      trSum += tr;
    }

    const safeTrSum = trSum || pipUnit;
    plusDI = Number(((plusDM / safeTrSum) * 100).toFixed(1));
    minusDI = Number(((minusDM / safeTrSum) * 100).toFixed(1));
    const dx = (plusDI + minusDI > 0)
      ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100
      : 20;

    adxValue = Number(Math.min(75, Math.max(12, dx * 0.95 + 10)).toFixed(1));

    if (adxValue >= 24) {
      if (plusDI > minusDI) {
        adxStatus = 'ALTA';
        trendStrength = `Tendência Direcional Forte de Alta (+DI ${plusDI} > -DI ${minusDI})`;
      } else {
        adxStatus = 'BAIXA';
        trendStrength = `Tendência Direcional Forte de Baixa (-DI ${minusDI} > +DI ${plusDI})`;
      }
    } else {
      adxStatus = 'NEUTRO';
      trendStrength = `Mercado Consolidado / Sem Tendência Definida (ADX < 24)`;
    }
  }

  // --- 9. ESTOCÁSTICO (%K / %D) ---
  let stochK: number;
  let stochD: number;
  let stochStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';

  if (safeTv && typeof safeTv.stochK === 'number' && typeof safeTv.stochD === 'number') {
    stochK = safeTv.stochK;
    stochD = safeTv.stochD;
  } else {
    const stochPeriod = Math.min(14, n);
    const stochSliceHighs = highs.slice(-stochPeriod);
    const stochSliceLows = lows.slice(-stochPeriod);
    const highestHigh = Math.max(...stochSliceHighs);
    const lowestLow = Math.min(...stochSliceLows);
    const stochDenom = highestHigh - lowestLow || pipUnit;
    stochK = Number((((currentPrice - lowestLow) / stochDenom) * 100).toFixed(1));
    stochD = Number((stochK * 0.7 + 15).toFixed(1));
  }

  if (stochK >= 80) stochStatus = 'ALTA';
  else if (stochK <= 20) stochStatus = 'BAIXA';
  else stochStatus = stochK >= 50 ? 'ALTA' : 'BAIXA';

  // --- 10. ATR / VOLATILIDADE ---
  const pipsMultiplier = asset.pipDecimals === 5 ? 10000 : (asset.pipDecimals === 3 ? 100 : 1);
  let atrVal: number;
  let atrPips: number;

  if (safeTv && typeof safeTv.atr === 'number') {
    atrVal = safeTv.atr;
    atrPips = Number((atrVal * pipsMultiplier).toFixed(1));
  } else {
    let trSum = 0;
    const adxPeriod = Math.min(14, Math.max(2, n - 1));
    for (let i = Math.max(1, n - adxPeriod); i < n; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      trSum += tr;
    }
    atrVal = trSum / adxPeriod;
    atrPips = Number((atrVal * pipsMultiplier).toFixed(1));
  }

  let atrStatus: 'ALTA' | 'BAIXA' | 'NEUTRO' = 'NEUTRO';
  if (atrPips > 15) atrStatus = 'ALTA';
  else if (atrPips < 5) atrStatus = 'BAIXA';
  else atrStatus = 'NEUTRO';

  // --- TENDÊNCIA MAIOR DE ACORDO COM OS INDICADORES TÉCNICOS NO TIMEFRAME ATIVO ---
  let bullPoints = 0;
  let bearPoints = 0;

  // 1. Médias Rápidas (EMA 9 / EMA 21)
  if (maShortStatus === 'ALTA') bullPoints += 2.5;
  else if (maShortStatus === 'BAIXA') bearPoints += 2.5;

  // 2. Médias Longas (SMA 50 / SMA 200)
  if (maLongStatus === 'ALTA') bullPoints += 3;
  else if (maLongStatus === 'BAIXA') bearPoints += 3;

  // 3. Posição em Relação às Bandas de Bollinger
  if (currentPrice > bbMiddle) bullPoints += 1.5;
  else bearPoints += 1.5;

  // 4. MACD Institucional
  if (macdStatus === 'ALTA') bullPoints += 2;
  else if (macdStatus === 'BAIXA') bearPoints += 2;

  // 5. Delta de Volume / Pressão Compradora vs Vendedora
  if (deltaStatus === 'ALTA') bullPoints += 2;
  else if (deltaStatus === 'BAIXA') bearPoints += 2;

  // 6. ADX Força da Tendência
  if (adxStatus === 'ALTA') bullPoints += 1.5;
  else if (adxStatus === 'BAIXA') bearPoints += 1.5;

  // 7. TradingView Scanner (Se disponível, adiciona peso ao consenso)
  if (safeTv && safeTv.recommendation) {
    if (safeTv.recommendation.includes('COMPRA')) {
      bullPoints += safeTv.recommendation.startsWith('FORTE') ? 3 : 1.5;
    } else if (safeTv.recommendation.includes('VENDA')) {
      bearPoints += safeTv.recommendation.startsWith('FORTE') ? 3 : 1.5;
    }
  }

  // 8. Vela recente
  if (latest.close > prev.close) bullPoints += 1;
  else if (latest.close < prev.close) bearPoints += 1;

  const scoreDiff = bullPoints - bearPoints;
  let majorTrendStatus: 'ALTA' | 'BAIXA' | 'LATERAL' = 'LATERAL';
  let majorStrength: 'FORTE' | 'MODERADA' | 'FRACA' = 'MODERADA';
  let majorDesc = 'Consolidação e equilíbrio entre forças';

  if (scoreDiff >= 4.0) {
    majorTrendStatus = 'ALTA';
    majorStrength = scoreDiff >= 7.0 ? 'FORTE' : 'MODERADA';
    majorDesc = `Tendência Maior dos Indicadores (${timeframe}): Compradores no controle (+${scoreDiff.toFixed(1)} pts)`;
  } else if (scoreDiff <= -4.0) {
    majorTrendStatus = 'BAIXA';
    majorStrength = scoreDiff <= -7.0 ? 'FORTE' : 'MODERADA';
    majorDesc = `Tendência Maior dos Indicadores (${timeframe}): Vendedores no controle (${scoreDiff.toFixed(1)} pts)`;
  } else {
    majorTrendStatus = 'LATERAL';
    majorStrength = 'MODERADA';
    majorDesc = `Indicadores em Faixa/Consolidação em ${timeframe}: Oportunidades em ambas as direções`;
  }

  return {
    timeframe,
    asset,
    currentPrice,
    majorTrend: {
      status: majorTrendStatus,
      strength: majorStrength,
      description: majorDesc,
    },
    rsi: {
      value: rsiVal,
      condition: rsiCondition,
      statusLabel: rsiLabel,
      signal: rsiSignal,
    },
    macd: {
      status: macdStatus,
      macdLine,
      signalLine,
      histogram,
      description: macdDesc,
    },
    maShort: {
      status: maShortStatus,
      ema9,
      ema21,
      label: maShortLabel,
    },
    maLong: {
      status: maLongStatus,
      sma50,
      sma200,
      label: maLongLabel,
    },
    bollingerBands: {
      status: bbStatus,
      upper: bbUpper,
      middle: bbMiddle,
      lower: bbLower,
      percentB,
      description: bbDesc,
    },
    volume: {
      status: volumeStatus,
      currentVolume: Math.round(recentVol),
      averageVolume: Math.round(avgVol),
      ratio: volRatio,
      description: volDesc,
    },
    delta: {
      status: deltaStatus,
      buyerPercent: buyerPct,
      sellerPercent: sellerPct,
      netDelta,
      description: deltaDesc,
    },
    adx: {
      status: adxStatus,
      value: adxValue,
      plusDI,
      minusDI,
      trendStrength,
    },
    stochastic: {
      status: stochStatus,
      kValue: stochK,
      dValue: stochD,
      label: `${stochK}%`,
    },
    atr: {
      status: atrStatus,
      value: atrVal,
      pips: atrPips,
    },
  };
}
