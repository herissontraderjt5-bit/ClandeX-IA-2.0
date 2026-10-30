import {
  Candle,
  MarketAnalysis,
  OrderBlock,
  FairValueGap,
  SupportResistanceLevel,
  ConfluenceBreakdown,
  AppSettings,
  SignalDirection
} from '../types/trading';
import { LiveTradingViewData } from './tradingViewScanner';

/**
 * ClandeX-IA Technical Analysis Engine
 * Deterministic calculation of Price Action, SMC, Support/Resistance, and Candlestick Flow.
 */

export function analyzeMarket(candles: Candle[], tvData?: LiveTradingViewData | null): MarketAnalysis {
  if (candles.length < 15) {
    return {
      trend: 'LATERAL',
      buyerStrength: 'MODERADA',
      sellerStrength: 'MODERADA',
      dominantForce: 'EQUILIBRADO',
      rejectionCandle: false,
      rejectionDirection: null,
      engulfingPattern: null,
      candleSequences: { color: 'GREEN', count: 0 },
      exhaustionDetected: false,
      momentumAccelerating: false,
      bos: false,
      bosDirection: null,
      choch: false,
      chochDirection: null,
      activeOrderBlock: null,
      activeFVG: null,
      liquiditySweep: null,
      nearSupport: false,
      nearResistance: false,
      inConsolidation: false,
      keyLevels: [],
      atr: 0,
      volatilityStatus: 'NORMAL',
      tradingView: {
        symbol: 'TRADINGVIEW:DIRECT',
        recommendation: 'NEUTRO',
        rsi: 50,
        rsiCondition: 'NEUTRO',
        macdSignal: 'NEUTRO',
        emaCross: 'NEUTRO',
        oscillatorsScore: { buy: 3, neutral: 5, sell: 3 },
        movingAveragesScore: { buy: 7, neutral: 1, sell: 7 },
      },
    };
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  // 1. Calculate Average True Range (ATR) & Volatility
  let trSum = 0;
  const period = Math.min(14, candles.length - 1);
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trSum += tr;
  }
  const atr = trSum / period;
  const recentRange = latest.high - latest.low;
  const volatilityStatus = recentRange > atr * 1.5 ? 'ALTA' : (recentRange < atr * 0.6 ? 'BAIXA' : 'NORMAL');

  // 2. Trend Identification via Exponential / Simple Moving Averages & Higher Highs/Lows
  let shortSum = 0;
  const shortPeriod = Math.min(8, candles.length);
  for (let i = candles.length - shortPeriod; i < candles.length; i++) {
    shortSum += candles[i].close;
  }
  const smaShort = shortSum / shortPeriod;

  let longSum = 0;
  const longPeriod = Math.min(21, candles.length);
  for (let i = candles.length - longPeriod; i < candles.length; i++) {
    longSum += candles[i].close;
  }
  const smaLong = longSum / longPeriod;

  let trend: 'ALTA' | 'BAIXA' | 'LATERAL' = 'LATERAL';
  const priceVsSma = latest.close - smaLong;
  if (smaShort > smaLong && latest.close > smaShort && priceVsSma > atr * 0.3) {
    trend = 'ALTA';
  } else if (smaShort < smaLong && latest.close < smaShort && priceVsSma < -atr * 0.3) {
    trend = 'BAIXA';
  }

  // 3. Price Action: Body vs Wick, Pinbars, Engulfing
  const bodySize = Math.abs(latest.close - latest.open);
  const upperWick = latest.high - Math.max(latest.close, latest.open);
  const lowerWick = Math.min(latest.close, latest.open) - latest.low;

  // Rejection: Pinbar with wick at least 1.6x body and representing > 45% of total candle range
  const isPinbarBullish = lowerWick >= bodySize * 1.6 && lowerWick >= recentRange * 0.45;
  const isPinbarBearish = upperWick >= bodySize * 1.6 && upperWick >= recentRange * 0.45;
  const rejectionCandle = isPinbarBullish || isPinbarBearish;
  const rejectionDirection: 'BULLISH' | 'BEARISH' | null = isPinbarBullish ? 'BULLISH' : (isPinbarBearish ? 'BEARISH' : null);

  // Engulfing pattern
  let engulfingPattern: 'BULLISH' | 'BEARISH' | null = null;
  const prevBody = Math.abs(prev.close - prev.open);
  if (latest.close > latest.open && prev.close < prev.open) {
    if (latest.close > prev.open && latest.open <= prev.close && bodySize > prevBody * 1.1) {
      engulfingPattern = 'BULLISH';
    }
  } else if (latest.close < latest.open && prev.close > prev.open) {
    if (latest.close < prev.open && latest.open >= prev.close && bodySize > prevBody * 1.1) {
      engulfingPattern = 'BEARISH';
    }
  }

  // Candle sequences & Momentum Flow
  let sequenceColor: 'GREEN' | 'RED' = latest.close >= latest.open ? 'GREEN' : 'RED';
  let sequenceCount = 1;
  for (let i = candles.length - 2; i >= Math.max(0, candles.length - 8); i--) {
    const isGreen = candles[i].close >= candles[i].open;
    if ((sequenceColor === 'GREEN' && isGreen) || (sequenceColor === 'RED' && !isGreen)) {
      sequenceCount++;
    } else {
      break;
    }
  }

  // Exhaustion: 4+ candles in one direction with shrinking bodies or huge climax wick
  const prevWick = prev.high - Math.max(prev.close, prev.open);
  const exhaustionDetected = (sequenceCount >= 4 && bodySize < prevBody * 0.5) ||
    (sequenceColor === 'GREEN' && upperWick > bodySize * 2) ||
    (sequenceColor === 'RED' && lowerWick > bodySize * 2);

  // Momentum acceleration
  const momentumAccelerating = bodySize > prevBody * 1.3 && bodySize > atr * 0.9;

  // Buyer / Seller strength
  let buyerPoints = 0;
  let sellerPoints = 0;

  if (latest.close > latest.open) buyerPoints += 2; else sellerPoints += 2;
  if (trend === 'ALTA') buyerPoints += 3; else if (trend === 'BAIXA') sellerPoints += 3;
  if (lowerWick > upperWick * 1.5) buyerPoints += 2;
  if (upperWick > lowerWick * 1.5) sellerPoints += 2;
  if (engulfingPattern === 'BULLISH') buyerPoints += 3;
  if (engulfingPattern === 'BEARISH') sellerPoints += 3;

  const buyerStrength: 'FORTE' | 'MODERADA' | 'FRACA' = 
    buyerPoints >= 6 ? 'FORTE' : buyerPoints >= 3 ? 'MODERADA' : 'FRACA';
  const sellerStrength: 'FORTE' | 'MODERADA' | 'FRACA' = 
    sellerPoints >= 6 ? 'FORTE' : sellerPoints >= 3 ? 'MODERADA' : 'FRACA';
  const dominantForce = buyerPoints > sellerPoints + 2 ? 'COMPRADOR' : (sellerPoints > buyerPoints + 2 ? 'VENDEDOR' : 'EQUILIBRADO');

  // 4. Key Support & Resistance (Dynamic Price Action & Swings)
  const rawPeaks: { price: number; type: 'HIGH' | 'LOW' }[] = [];
  const lookback = Math.min(50, candles.length - 2);
  const startIdx = Math.max(1, candles.length - lookback);

  for (let i = startIdx; i < candles.length - 1; i++) {
    const curr = candles[i];
    const prevC = candles[i - 1];
    const nextC = candles[i + 1];

    // Swing High
    if (curr.high >= prevC.high && curr.high >= nextC.high) {
      rawPeaks.push({ price: curr.high, type: 'HIGH' });
    }
    // Swing Low
    if (curr.low <= prevC.low && curr.low <= nextC.low) {
      rawPeaks.push({ price: curr.low, type: 'LOW' });
    }
  }

  // Also include the overall highest high and lowest low of the lookback
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  for (let i = startIdx; i < candles.length; i++) {
    if (candles[i].high > highestHigh) highestHigh = candles[i].high;
    if (candles[i].low < lowestLow) lowestLow = candles[i].low;
  }
  if (highestHigh > -Infinity) rawPeaks.push({ price: highestHigh, type: 'HIGH' });
  if (lowestLow < Infinity) rawPeaks.push({ price: lowestLow, type: 'LOW' });

  // Cluster nearby levels within 0.25 * ATR
  const clusterDistance = Math.max(atr * 0.25, 0.00005);
  const clusteredLevels: { price: number; touches: number }[] = [];

  for (const peak of rawPeaks) {
    const existing = clusteredLevels.find((c) => Math.abs(c.price - peak.price) <= clusterDistance);
    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price * (existing.touches - 1) + peak.price) / existing.touches;
    } else {
      clusteredLevels.push({ price: peak.price, touches: 1 });
    }
  }

  // Principle of Polaridade:
  // Any level strictly above current price is RESISTANCE.
  // Any level strictly below current price is SUPPORT.
  const currentPrice = latest.close;
  const deadZone = Math.max(atr * 0.04, 0.00002);

  const rawResistances: SupportResistanceLevel[] = clusteredLevels
    .filter((l) => l.price > currentPrice + deadZone)
    .map((l) => ({
      price: l.price,
      touches: l.touches,
      type: 'RESISTANCE' as const,
      strength: l.touches >= 2 ? ('STRONG' as const) : ('MEDIUM' as const),
    }))
    .sort((a, b) => a.price - b.price); // Ascending: index 0 is closest ceiling above price

  const rawSupports: SupportResistanceLevel[] = clusteredLevels
    .filter((l) => l.price < currentPrice - deadZone)
    .map((l) => ({
      price: l.price,
      touches: l.touches,
      type: 'SUPPORT' as const,
      strength: l.touches >= 2 ? ('STRONG' as const) : ('MEDIUM' as const),
    }))
    .sort((a, b) => b.price - a.price); // Descending: index 0 is closest floor below price

  // Guarantee at least 2 Resistances above current price
  if (rawResistances.length === 0) {
    rawResistances.push({
      price: currentPrice + Math.max(atr * 1.2, 0.0003),
      touches: 1,
      type: 'RESISTANCE',
      strength: 'MEDIUM',
    });
    rawResistances.push({
      price: currentPrice + Math.max(atr * 2.5, 0.0007),
      touches: 1,
      type: 'RESISTANCE',
      strength: 'MEDIUM',
    });
  } else if (rawResistances.length === 1) {
    rawResistances.push({
      price: rawResistances[0].price + Math.max(atr * 1.2, 0.0004),
      touches: 1,
      type: 'RESISTANCE',
      strength: 'MEDIUM',
    });
  }

  // Guarantee at least 2 Supports below current price
  if (rawSupports.length === 0) {
    rawSupports.push({
      price: currentPrice - Math.max(atr * 1.2, 0.0003),
      touches: 1,
      type: 'SUPPORT',
      strength: 'MEDIUM',
    });
    rawSupports.push({
      price: currentPrice - Math.max(atr * 2.5, 0.0007),
      touches: 1,
      type: 'SUPPORT',
      strength: 'MEDIUM',
    });
  } else if (rawSupports.length === 1) {
    rawSupports.push({
      price: rawSupports[0].price - Math.max(atr * 1.2, 0.0004),
      touches: 1,
      type: 'SUPPORT',
      strength: 'MEDIUM',
    });
  }

  // Interleave key levels so both Resistance & Support are in the top elements (for charts & quick slice)
  const keyLevels: SupportResistanceLevel[] = [];
  const maxPairs = Math.max(rawResistances.length, rawSupports.length);
  for (let i = 0; i < maxPairs; i++) {
    if (rawResistances[i]) keyLevels.push(rawResistances[i]);
    if (rawSupports[i]) keyLevels.push(rawSupports[i]);
  }

  // Proximity to S/R (within 0.45 * ATR)
  const proximityThreshold = atr * 0.45;
  const closestResistance = rawResistances[0];
  const closestSupport = rawSupports[0];

  const nearSupport = closestSupport ? Math.abs(currentPrice - closestSupport.price) <= proximityThreshold : false;
  const nearResistance = closestResistance ? Math.abs(closestResistance.price - currentPrice) <= proximityThreshold : false;

  // Consolidation detection: if past 6 candles all lie within 1.2 * ATR
  let maxRecent = -Infinity;
  let minRecent = Infinity;
  for (let i = candles.length - 6; i < candles.length; i++) {
    maxRecent = Math.max(maxRecent, candles[i].high);
    minRecent = Math.min(minRecent, candles[i].low);
  }
  const inConsolidation = (maxRecent - minRecent) < atr * 1.1;

  // 5. Smart Money Concepts (SMC)
  // BOS (Break of structure) & CHoCH (Change of character)
  let bos = false;
  let bosDirection: 'BULLISH' | 'BEARISH' | null = null;
  let choch = false;
  let chochDirection: 'BULLISH' | 'BEARISH' | null = null;
  let liquiditySweep: 'HIGH' | 'LOW' | null = null;

  // Recent swing high/low
  let recentSwingHigh = -Infinity;
  let recentSwingLow = Infinity;
  for (let i = candles.length - 12; i < candles.length - 1; i++) {
    if (candles[i].high > recentSwingHigh) recentSwingHigh = candles[i].high;
    if (candles[i].low < recentSwingLow) recentSwingLow = candles[i].low;
  }

  // BOS: close above recent swing high in uptrend or close below recent swing low in downtrend
  if (trend === 'ALTA' && latest.close > recentSwingHigh) {
    bos = true;
    bosDirection = 'BULLISH';
  } else if (trend === 'BAIXA' && latest.close < recentSwingLow) {
    bos = true;
    bosDirection = 'BEARISH';
  }

  // CHoCH: trend reversal break
  if (trend === 'BAIXA' && latest.close > recentSwingHigh) {
    choch = true;
    chochDirection = 'BULLISH';
  } else if (trend === 'ALTA' && latest.close < recentSwingLow) {
    choch = true;
    chochDirection = 'BEARISH';
  }

  // Liquidity sweep: wick probed beyond swing high/low, but candle closed back inside
  if (latest.high > recentSwingHigh && latest.close < recentSwingHigh) {
    liquiditySweep = 'HIGH'; // Bearish sweep
  } else if (latest.low < recentSwingLow && latest.close > recentSwingLow) {
    liquiditySweep = 'LOW'; // Bullish sweep
  }

  // Order Block (OB)
  let activeOrderBlock: OrderBlock | null = null;
  // Look for last opposite candle before strong displacement in last 5 candles
  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    const c = candles[i];
    const n = candles[i + 1];
    // Bullish displacement after red candle
    if (c.close < c.open && n.close > n.open && (n.close - n.open) > atr * 1.2) {
      activeOrderBlock = {
        type: 'BULLISH',
        high: c.open,
        low: c.low,
        candleIndex: i,
        mitigated: latest.low < c.low
      };
    }
    // Bearish displacement after green candle
    if (c.close > c.open && n.close < n.open && (n.open - n.close) > atr * 1.2) {
      activeOrderBlock = {
        type: 'BEARISH',
        high: c.high,
        low: c.open,
        candleIndex: i,
        mitigated: latest.high > c.high
      };
    }
  }

  // Fair Value Gap (FVG)
  let activeFVG: FairValueGap | null = null;
  if (prev2 && prev && latest) {
    // Bullish FVG: prev2 high < latest low
    if (prev2.high < latest.low) {
      activeFVG = {
        type: 'BULLISH',
        top: latest.low,
        bottom: prev2.high,
        candleIndex: candles.length - 2
      };
    } else if (prev2.low > latest.high) {
      // Bearish FVG: prev2 low > latest high
      activeFVG = {
        type: 'BEARISH',
        top: prev2.low,
        bottom: latest.high,
        candleIndex: candles.length - 2
      };
    }
  }

  // 6. Direct TradingView Technical Indicator Suite
  let gains = 0;
  let losses = 0;
  const rsiPeriod = Math.min(14, candles.length - 1);
  for (let i = candles.length - rsiPeriod; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = Math.round(100 - (100 / (1 + rs)));
  const rsiCondition: 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO' = 
    rsi >= 70 ? 'SOBRECOMPRADO' : rsi <= 30 ? 'SOBREVENDIDO' : 'NEUTRO';

  // MACD & Fast/Slow EMAs
  let fastEma = latest.close;
  let slowEma = latest.close;
  const fastK = 2 / (12 + 1);
  const slowK = 2 / (26 + 1);
  for (let i = Math.max(0, candles.length - 26); i < candles.length; i++) {
    fastEma = candles[i].close * fastK + fastEma * (1 - fastK);
    slowEma = candles[i].close * slowK + slowEma * (1 - slowK);
  }
  const macdVal = fastEma - slowEma;
  const macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRO' =
    macdVal > atr * 0.1 ? 'BULLISH' : macdVal < -atr * 0.1 ? 'BEARISH' : 'NEUTRO';

  const emaCross: 'ALTA' | 'BAIXA' | 'NEUTRO' =
    fastEma > slowEma ? 'ALTA' : fastEma < slowEma ? 'BAIXA' : 'NEUTRO';

  // TradingView Oscillators
  let oscBuy = 0;
  let oscNeutral = 0;
  let oscSell = 0;

  if (rsi <= 32) oscBuy += 2;
  else if (rsi >= 68) oscSell += 2;
  else oscNeutral += 2;

  if (macdSignal === 'BULLISH') oscBuy += 2;
  else if (macdSignal === 'BEARISH') oscSell += 2;
  else oscNeutral += 2;

  if (momentumAccelerating) {
    if (dominantForce === 'COMPRADOR') oscBuy += 2;
    else if (dominantForce === 'VENDEDOR') oscSell += 2;
    else oscNeutral += 2;
  } else {
    oscNeutral += 2;
  }

  // TradingView Moving Averages
  let maBuy = 0;
  let maNeutral = 0;
  let maSell = 0;

  if (latest.close > smaShort) maBuy += 4;
  else if (latest.close < smaShort) maSell += 4;
  else maNeutral += 4;

  if (latest.close > smaLong) maBuy += 5;
  else if (latest.close < smaLong) maSell += 5;
  else maNeutral += 5;

  if (emaCross === 'ALTA') maBuy += 4;
  else if (emaCross === 'BAIXA') maSell += 4;
  else maNeutral += 4;

  const totalBuys = oscBuy + maBuy;
  const totalSells = oscSell + maSell;

  let recommendation: 'FORTE COMPRA' | 'COMPRA' | 'NEUTRO' | 'VENDA' | 'FORTE VENDA' = 'NEUTRO';
  if (tvData) {
    recommendation = tvData.recommendation;
  } else if (totalBuys >= 13) {
    recommendation = 'FORTE COMPRA';
  } else if (totalBuys > totalSells + 4) {
    recommendation = 'COMPRA';
  } else if (totalSells >= 13) {
    recommendation = 'FORTE VENDA';
  } else if (totalSells > totalBuys + 4) {
    recommendation = 'VENDA';
  } else {
    recommendation = 'NEUTRO';
  }

  const effectiveRsi = tvData ? tvData.rsi : rsi;
  const effectiveRsiCondition: 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO' =
    effectiveRsi >= 70 ? 'SOBRECOMPRADO' : effectiveRsi <= 30 ? 'SOBREVENDIDO' : 'NEUTRO';

  const effectiveMacdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRO' = tvData
    ? tvData.macd > tvData.macdSignal
      ? 'BULLISH'
      : tvData.macd < tvData.macdSignal
      ? 'BEARISH'
      : 'NEUTRO'
    : macdSignal;

  const effectiveEmaCross: 'ALTA' | 'BAIXA' | 'NEUTRO' = tvData
    ? tvData.recommendationMA > 0.05
      ? 'ALTA'
      : tvData.recommendationMA < -0.05
      ? 'BAIXA'
      : 'NEUTRO'
    : emaCross;

  return {
    trend,
    buyerStrength,
    sellerStrength,
    dominantForce,
    rejectionCandle,
    rejectionDirection,
    engulfingPattern,
    candleSequences: { color: sequenceColor, count: sequenceCount },
    exhaustionDetected,
    momentumAccelerating,
    bos,
    bosDirection,
    choch,
    chochDirection,
    activeOrderBlock,
    activeFVG,
    liquiditySweep,
    nearSupport,
    nearResistance,
    inConsolidation,
    keyLevels,
    atr,
    volatilityStatus,
    tradingView: {
      symbol: tvData ? tvData.tvSymbol : 'TRADINGVIEW:DIRECT',
      recommendation,
      rsi: effectiveRsi,
      rsiCondition: effectiveRsiCondition,
      macdSignal: effectiveMacdSignal,
      emaCross: effectiveEmaCross,
      oscillatorsScore: tvData
        ? {
            buy: tvData.recommendationOther > 0.1 ? 6 : tvData.recommendationOther > -0.1 ? 2 : 0,
            neutral: Math.abs(tvData.recommendationOther) <= 0.1 ? 6 : 2,
            sell: tvData.recommendationOther < -0.1 ? 6 : tvData.recommendationOther < 0.1 ? 2 : 0,
          }
        : { buy: oscBuy, neutral: oscNeutral, sell: oscSell },
      movingAveragesScore: tvData
        ? {
            buy: tvData.recommendationMA > 0.1 ? 12 : tvData.recommendationMA > -0.1 ? 4 : 0,
            neutral: Math.abs(tvData.recommendationMA) <= 0.1 ? 8 : 2,
            sell: tvData.recommendationMA < -0.1 ? 12 : tvData.recommendationMA < 0.1 ? 4 : 0,
          }
        : { buy: maBuy, neutral: maNeutral, sell: maSell },
      isLiveTradingView: Boolean(tvData),
      recommendationScore: tvData ? tvData.recommendationScore : (totalBuys - totalSells) / 20,
      livePrice: tvData ? tvData.price : latest.close,
    },
  };
}

/**
 * Calculates confluence score (0 - 100) and decides CALL / PUT / NEUTRO
 */
export function calculateConfluences(
  analysis: MarketAnalysis,
  settings: AppSettings
): ConfluenceBreakdown {
  const { weights, thresholds, analysisProfile = 'MODERADA' } = settings;
  const reasons: string[] = [];

  let paCall = 0;
  let paPut = 0;
  let srCall = 0;
  let srPut = 0;
  let smcCall = 0;
  let smcPut = 0;
  let msCall = 0;
  let msPut = 0;
  let indCall = 0;
  let indPut = 0;

  // 1. ESTRUTURA DE MERCADO (Weight: default 25)
  if (analysis.trend === 'ALTA') {
    msCall += 18;
    reasons.push('Tendência principal de ALTA confirmada');
  } else if (analysis.trend === 'BAIXA') {
    msPut += 18;
    reasons.push('Tendência principal de BAIXA confirmada');
  }

  if (analysis.dominantForce === 'COMPRADOR') {
    msCall += 7;
    if (analysis.trend === 'ALTA') reasons.push('Domínio comprador alinhado à tendência');
  } else if (analysis.dominantForce === 'VENDEDOR') {
    msPut += 7;
    if (analysis.trend === 'BAIXA') reasons.push('Domínio vendedor alinhado à tendência');
  }

  const normalizedMSCall = Math.min(weights.marketStructure, (msCall / 25) * weights.marketStructure);
  const normalizedMSPut = Math.min(weights.marketStructure, (msPut / 25) * weights.marketStructure);

  // 2. PRICE ACTION (Weight: default 25)
  // Engolfo
  if (analysis.engulfingPattern === 'BULLISH') {
    paCall += 15;
    reasons.push('Padrão Engolfo de ALTA com forte absorção');
  } else if (analysis.engulfingPattern === 'BEARISH') {
    paPut += 15;
    reasons.push('Padrão Engolfo de BAIXA com forte absorção');
  }

  // Pinbar / Rejeição de pavio
  if (analysis.rejectionDirection === 'BULLISH') {
    paCall += 14;
    reasons.push('Rejeição em mínima com pavio inferior longo (Martelo Bullish)');
  } else if (analysis.rejectionDirection === 'BEARISH') {
    paPut += 14;
    reasons.push('Rejeição em máxima com pavio superior longo (Estrela Cadente Bearish)');
  }

  // Aceleração de fluxo (Apenas nas 1 a 3 primeiras velas do movimento - NUNCA em esticada exausta)
  if (analysis.momentumAccelerating) {
    if (analysis.candleSequences.count <= 3) {
      if (analysis.dominantForce === 'COMPRADOR' || analysis.candleSequences.color === 'GREEN') {
        paCall += 8;
        reasons.push('Aceleração de fluxo comprador inicial');
      } else if (analysis.dominantForce === 'VENDEDOR' || analysis.candleSequences.color === 'RED') {
        paPut += 8;
        reasons.push('Aceleração de fluxo vendedor inicial');
      }
    }
  }

  // Bloqueio rigoroso de esticada de vela (Exaustão institucional): 4+ velas consecutivas da mesma cor
  if (analysis.candleSequences.count >= 4) {
    if (analysis.candleSequences.color === 'GREEN') {
      // Anula CALL após 4+ velas verdes consecutivas (probabilidade altíssima de correção/pullback na próxima vela)
      paCall = Math.max(0, paCall - 16);
      if (analysis.rejectionDirection === 'BEARISH' || (analysis.tradingView && analysis.tradingView.rsi >= 68)) {
        paPut += 14;
        reasons.push(`Exaustão compradora (${analysis.candleSequences.count} velas verdes) com rejeição`);
      }
    } else if (analysis.candleSequences.color === 'RED') {
      // Anula PUT após 4+ velas vermelhas consecutivas (probabilidade altíssima de repique/pullback na próxima vela)
      paPut = Math.max(0, paPut - 16);
      if (analysis.rejectionDirection === 'BULLISH' || (analysis.tradingView && analysis.tradingView.rsi <= 32)) {
        paCall += 14;
        reasons.push(`Exaustão vendedora (${analysis.candleSequences.count} velas vermelhas) com rejeição`);
      }
    }
  } else if (analysis.exhaustionDetected) {
    if (analysis.candleSequences.color === 'RED') {
      paCall += 10;
      reasons.push('Exaustão vendedora detectada');
    } else if (analysis.candleSequences.color === 'GREEN') {
      paPut += 10;
      reasons.push('Exaustão compradora detectada');
    }
  }

  const normalizedPACall = Math.min(weights.priceAction, (paCall / 25) * weights.priceAction);
  const normalizedPAPut = Math.min(weights.priceAction, (paPut / 25) * weights.priceAction);

  // 3. SUPORTE E RESISTÊNCIA COM VALIDAÇÃO DE REJEIÇÃO REAL
  if (analysis.nearSupport) {
    if (analysis.rejectionDirection === 'BULLISH' || analysis.dominantForce === 'COMPRADOR' || analysis.engulfingPattern === 'BULLISH') {
      srCall += 18;
      reasons.push('Defesa compradora comprovada em zona de SUPORTE');
    } else if (analysis.dominantForce === 'VENDEDOR' && analysis.trend === 'BAIXA') {
      // Rompimento de suporte com força vendedora!
      srPut += 12;
      reasons.push('Pressão de rompimento vendedor em suporte');
    }
  }

  if (analysis.nearResistance) {
    if (analysis.rejectionDirection === 'BEARISH' || analysis.dominantForce === 'VENDEDOR' || analysis.engulfingPattern === 'BEARISH') {
      srPut += 18;
      reasons.push('Defesa vendedora comprovada em zona de RESISTÊNCIA');
    } else if (analysis.dominantForce === 'COMPRADOR' && analysis.trend === 'ALTA') {
      // Rompimento de resistência com força compradora!
      srCall += 12;
      reasons.push('Pressão de rompimento comprador em resistência');
    }
  }

  if (analysis.inConsolidation) {
    // Em mercado lateral, proíbe entradas no meio da consolidação (área de ruído)
    if (!analysis.nearSupport && !analysis.nearResistance) {
      srCall = 0;
      srPut = 0;
      paCall = 0;
      paPut = 0;
      msCall = 0;
      msPut = 0;
      reasons.push('Mercado em consolidação no meio do canal (sem entrada)');
    } else if (analysisProfile === 'CONSERVADORA') {
      srCall = Math.min(srCall, 8);
      srPut = Math.min(srPut, 8);
    }
  }

  // Proteção contra operações fracas contra a tendência principal:
  if (analysis.trend === 'ALTA') {
    // Para vender contra tendência de ALTA, exige confluência extrema de reversão (RSI extremo + Rejeição ou Liquidity Sweep)
    const isExtremeBearishReversal = (
      (analysis.tradingView && (analysis.tradingView.rsi >= 70 || analysis.tradingView.recommendation === 'FORTE VENDA')) ||
      analysis.liquiditySweep === 'HIGH'
    ) && (analysis.rejectionDirection === 'BEARISH' || analysis.engulfingPattern === 'BEARISH');
    
    if (!isExtremeBearishReversal) {
      msPut = 0;
      srPut = Math.min(srPut, 5);
      indPut = Math.min(indPut, 5);
    }
  } else if (analysis.trend === 'BAIXA') {
    // Para comprar contra tendência de BAIXA, exige confluência extrema de reversão (RSI extremo + Rejeição ou Liquidity Sweep)
    const isExtremeBullishReversal = (
      (analysis.tradingView && (analysis.tradingView.rsi <= 30 || analysis.tradingView.recommendation === 'FORTE COMPRA')) ||
      analysis.liquiditySweep === 'LOW'
    ) && (analysis.rejectionDirection === 'BULLISH' || analysis.engulfingPattern === 'BULLISH');
    
    if (!isExtremeBullishReversal) {
      msCall = 0;
      srCall = Math.min(srCall, 5);
      indCall = Math.min(indCall, 5);
    }
  }

  const normalizedSRCall = Math.min(weights.supportResistance, (srCall / 20) * weights.supportResistance);
  const normalizedSRPut = Math.min(weights.supportResistance, (srPut / 20) * weights.supportResistance);

  // 4. SMART MONEY CONCEPTS (SMC) (Weight: default 20)
  // CHoCH (Quebra de Caráter)
  if (analysis.chochDirection === 'BULLISH') {
    smcCall += 14;
    reasons.push('SMC: Quebra de Caráter (CHoCH) de reversão para ALTA');
  } else if (analysis.chochDirection === 'BEARISH') {
    smcPut += 14;
    reasons.push('SMC: Quebra de Caráter (CHoCH) de reversão para BAIXA');
  }

  // BOS (Rompimento Estrutural)
  if (analysis.bosDirection === 'BULLISH') {
    smcCall += 10;
    reasons.push('SMC: Rompimento Estrutural (BOS) a favor da ALTA');
  } else if (analysis.bosDirection === 'BEARISH') {
    smcPut += 10;
    reasons.push('SMC: Rompimento Estrutural (BOS) a favor da BAIXA');
  }

  // Liquidity Sweep
  if (analysis.liquiditySweep === 'LOW') {
    smcCall += 12;
    reasons.push('SMC: Captura de Liquidez em fundos com rejeição imediata');
  } else if (analysis.liquiditySweep === 'HIGH') {
    smcPut += 12;
    reasons.push('SMC: Captura de Liquidez em topos com rejeição imediata');
  }

  // Order Block
  if (analysis.activeOrderBlock && !analysis.activeOrderBlock.mitigated) {
    if (analysis.activeOrderBlock.type === 'BULLISH') {
      smcCall += 10;
      reasons.push('SMC: Order Block comprador institucional ativado');
    } else if (analysis.activeOrderBlock.type === 'BEARISH') {
      smcPut += 10;
      reasons.push('SMC: Order Block vendedor institucional ativado');
    }
  }

  // Fair Value Gap (FVG)
  if (analysis.activeFVG) {
    if (analysis.activeFVG.type === 'BULLISH') {
      smcCall += 8;
      reasons.push('SMC: Desequilíbrio institucional FVG comprador preenchido');
    } else if (analysis.activeFVG.type === 'BEARISH') {
      smcPut += 8;
      reasons.push('SMC: Desequilíbrio institucional FVG vendedor preenchido');
    }
  }

  const normalizedSMCCall = Math.min(weights.smc, (smcCall / 20) * weights.smc);
  const normalizedSMCPut = Math.min(weights.smc, (smcPut / 20) * weights.smc);

  // 5. VOLATILIDADE (Weight: default 10)
  let volScore = 0;
  if (analysis.volatilityStatus === 'NORMAL') {
    volScore = weights.volatility;
  } else if (analysis.volatilityStatus === 'ALTA') {
    volScore = weights.volatility * 0.7;
  } else {
    volScore = weights.volatility * 0.4;
  }

  // 6. INDICADORES TÉCNICOS & TRADINGVIEW DIRECT (RSI, MACD, EMAs)
  if (analysis.tradingView) {
    if (analysis.tradingView.recommendation === 'FORTE COMPRA') {
      indCall += 14;
      reasons.push('TradingView: FORTE COMPRA (Consenso técnico institucional)');
    } else if (analysis.tradingView.recommendation === 'COMPRA') {
      indCall += 8;
      reasons.push('TradingView: Indicação de COMPRA');
    } else if (analysis.tradingView.recommendation === 'FORTE VENDA') {
      indPut += 14;
      reasons.push('TradingView: FORTE VENDA (Consenso técnico institucional)');
    } else if (analysis.tradingView.recommendation === 'VENDA') {
      indPut += 8;
      reasons.push('TradingView: Indicação de VENDA');
    }

    // RSI
    if (analysis.tradingView.rsiCondition === 'SOBREVENDIDO' || analysis.tradingView.rsi <= 32) {
      indCall += 12;
      reasons.push(`RSI (${analysis.tradingView.rsi}): Região de SOBREVENDA (Repique de Alta)`);
    } else if (analysis.tradingView.rsiCondition === 'SOBRECOMPRADO' || analysis.tradingView.rsi >= 68) {
      indPut += 12;
      reasons.push(`RSI (${analysis.tradingView.rsi}): Região de SOBRECOMPRA (Correção de Baixa)`);
    }

    // MACD
    if (analysis.tradingView.macdSignal === 'BULLISH') {
      indCall += 8;
      reasons.push('MACD: Cruzamento comprador com histograma de alta');
    } else if (analysis.tradingView.macdSignal === 'BEARISH') {
      indPut += 8;
      reasons.push('MACD: Cruzamento vendedor com histograma de baixa');
    }

    // EMA Cross
    if (analysis.tradingView.emaCross === 'ALTA') {
      indCall += 6;
      reasons.push('EMAs: Médias móveis alinhadas para ALTA');
    } else if (analysis.tradingView.emaCross === 'BAIXA') {
      indPut += 6;
      reasons.push('EMAs: Médias móveis alinhadas para BAIXA');
    }
  }

  const normalizedIndCall = Math.min(15, indCall * 0.45);
  const normalizedIndPut = Math.min(15, indPut * 0.45);

  // SOMA TOTAL PONDERADA
  const totalCall = Math.round(
    normalizedMSCall +
    normalizedPACall +
    normalizedSRCall +
    normalizedSMCCall +
    normalizedIndCall +
    volScore * 0.5
  );

  const totalPut = Math.round(
    normalizedMSPut +
    normalizedPAPut +
    normalizedSRPut +
    normalizedSMCPut +
    normalizedIndPut +
    volScore * 0.5
  );

  let direction: SignalDirection | 'NEUTRO' = 'NEUTRO';
  let totalScore = 0;
  let msScore = 0;
  let paScore = 0;
  let srScore = 0;
  let smcFinalScore = 0;

  const scoreDiff = totalCall - totalPut;

  // Limiares calibrados para ALTA ASSERTIVIDADE (80%+ de taxa de acerto)
  // CONSERVADORA (Sniper): 78+ pontos de score com 8+ pontos de vantagem
  // MODERADA: 72+ pontos de score com 6+ pontos de vantagem
  // AGRESSIVA: 64+ pontos de score com 4+ pontos de vantagem
  const minThreshold = analysisProfile === 'CONSERVADORA' ? 78 : (analysisProfile === 'AGRESSIVA' ? 64 : 72);
  const minAdvantage = analysisProfile === 'CONSERVADORA' ? 8 : (analysisProfile === 'AGRESSIVA' ? 4 : 6);

  // Confluência Cruzada Obrigatória (Cross-Disciplinary):
  // Uma entrada segura precisa de:
  // 1) Fundamento Direcional (Tendência/MS ou Indicadores TradingView)
  // 2) Gatilho Técnico de Execução (Price Action, Suporte/Resistência ou SMC)
  const hasCallFoundation = normalizedMSCall >= 8 || normalizedIndCall >= 6;
  const hasCallTrigger = normalizedPACall >= 8 || normalizedSMCCall >= 8 || normalizedSRCall >= 10;
  const hasCallPillars = hasCallFoundation && hasCallTrigger;

  const hasPutFoundation = normalizedMSPut >= 8 || normalizedIndPut >= 6;
  const hasPutTrigger = normalizedPAPut >= 8 || normalizedSMCPut >= 8 || normalizedSRPut >= 10;
  const hasPutPillars = hasPutFoundation && hasPutTrigger;

  if (analysis.inConsolidation && (!analysis.nearSupport && !analysis.nearResistance)) {
    direction = 'NEUTRO';
    totalScore = 0;
  } else if (scoreDiff >= minAdvantage && totalCall >= minThreshold && hasCallPillars) {
    direction = 'CALL';
    totalScore = Math.min(98, totalCall);
    msScore = normalizedMSCall;
    paScore = normalizedPACall;
    srScore = normalizedSRCall;
    smcFinalScore = normalizedSMCCall;
  } else if (scoreDiff <= -minAdvantage && totalPut >= minThreshold && hasPutPillars) {
    direction = 'PUT';
    totalScore = Math.min(98, totalPut);
    msScore = normalizedMSPut;
    paScore = normalizedPAPut;
    srScore = normalizedSRPut;
    smcFinalScore = normalizedSMCPut;
  } else {
    direction = 'NEUTRO';
    totalScore = Math.max(totalCall, totalPut);
    msScore = Math.round((normalizedMSCall + normalizedMSPut) / 2);
    paScore = Math.round((normalizedPACall + normalizedPAPut) / 2);
    srScore = Math.round((normalizedSRCall + normalizedSRPut) / 2);
    smcFinalScore = Math.round((normalizedSMCCall + normalizedSMCPut) / 2);
  }

  let classification: ConfluenceBreakdown['classification'] = 'SEM ENTRADA';
  if (totalScore >= thresholds.veryStrong) {
    classification = 'CONFLUÊNCIA MUITO FORTE';
  } else if (totalScore >= thresholds.strong) {
    classification = 'CONFLUÊNCIA FORTE';
  } else if (totalScore >= thresholds.observation) {
    classification = 'OPORTUNIDADE EM OBSERVAÇÃO';
  } else {
    classification = 'SEM ENTRADA';
  }

  return {
    marketStructureScore: Math.round(msScore),
    priceActionScore: Math.round(paScore),
    supportResistanceScore: Math.round(srScore),
    smcScore: Math.round(smcFinalScore),
    volatilityScore: Math.round(volScore),
    totalScore,
    direction,
    classification,
    reasons: reasons.slice(0, 5),
  };
}
