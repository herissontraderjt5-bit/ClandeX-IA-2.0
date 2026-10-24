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

/**
 * ClandeX-IA Technical Analysis Engine
 * Deterministic calculation of Price Action, SMC, Support/Resistance, and Candlestick Flow.
 */

export function analyzeMarket(candles: Candle[]): MarketAnalysis {
  if (candles.length < 15) {
    return {
      trend: 'LATERAL',
      buyerStrength: 'MODERADA',
      sellerStrength: 'MODERADA',
      dominantForce: 'EQUILIBRADO',
      rejectionCandle: false,
      engulfingPattern: null,
      candleSequences: { color: 'GREEN', count: 0 },
      exhaustionDetected: false,
      momentumAccelerating: false,
      bos: false,
      choch: false,
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

  // Rejection: Pinbar with wick at least 2x body and representing > 55% of total candle range
  const isPinbarBullish = lowerWick >= bodySize * 1.8 && lowerWick >= recentRange * 0.5;
  const isPinbarBearish = upperWick >= bodySize * 1.8 && upperWick >= recentRange * 0.5;
  const rejectionCandle = isPinbarBullish || isPinbarBearish;

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

  // 4. Key Support & Resistance Swing Detection
  const keyLevels: SupportResistanceLevel[] = [];
  const lookback = Math.min(30, candles.length - 2);
  
  for (let i = candles.length - lookback; i < candles.length - 2; i++) {
    const curr = candles[i];
    const prevC = candles[i - 1];
    const nextC = candles[i + 1];

    // Swing High
    if (curr.high > prevC.high && curr.high > nextC.high) {
      keyLevels.push({
        price: curr.high,
        touches: 1,
        type: 'RESISTANCE',
        strength: 'MEDIUM'
      });
    }
    // Swing Low
    if (curr.low < prevC.low && curr.low < nextC.low) {
      keyLevels.push({
        price: curr.low,
        touches: 1,
        type: 'SUPPORT',
        strength: 'MEDIUM'
      });
    }
  }

  // Check proximity to S/R (within 0.3 * ATR)
  const proximityThreshold = atr * 0.4;
  let nearSupport = false;
  let nearResistance = false;

  for (const lvl of keyLevels) {
    if (lvl.type === 'SUPPORT' && Math.abs(latest.close - lvl.price) <= proximityThreshold) {
      nearSupport = true;
    }
    if (lvl.type === 'RESISTANCE' && Math.abs(latest.close - lvl.price) <= proximityThreshold) {
      nearResistance = true;
    }
  }

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
  let choch = false;
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
  } else if (trend === 'BAIXA' && latest.close < recentSwingLow) {
    bos = true;
  }

  // CHoCH: trend reversal break
  if (trend === 'BAIXA' && latest.close > recentSwingHigh) {
    choch = true;
  } else if (trend === 'ALTA' && latest.close < recentSwingLow) {
    choch = true;
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
  if (totalBuys >= 13) recommendation = 'FORTE COMPRA';
  else if (totalBuys > totalSells + 4) recommendation = 'COMPRA';
  else if (totalSells >= 13) recommendation = 'FORTE VENDA';
  else if (totalSells > totalBuys + 4) recommendation = 'VENDA';
  else recommendation = 'NEUTRO';

  return {
    trend,
    buyerStrength,
    sellerStrength,
    dominantForce,
    rejectionCandle,
    engulfingPattern,
    candleSequences: { color: sequenceColor, count: sequenceCount },
    exhaustionDetected,
    momentumAccelerating,
    bos,
    choch,
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
      symbol: 'TRADINGVIEW:DIRECT',
      recommendation,
      rsi,
      rsiCondition,
      macdSignal,
      emaCross,
      oscillatorsScore: { buy: oscBuy, neutral: oscNeutral, sell: oscSell },
      movingAveragesScore: { buy: maBuy, neutral: maNeutral, sell: maSell },
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
  const { weights, thresholds } = settings;
  const reasons: string[] = [];

  let callScore = 0;
  let putScore = 0;

  // 1. Market Structure (Weight: default 25)
  let msPoints = 0;
  if (analysis.trend === 'ALTA') {
    msPoints += 18;
    reasons.push('Tendência principal de ALTA confirmada');
  } else if (analysis.trend === 'BAIXA') {
    msPoints += 18;
    reasons.push('Tendência principal de BAIXA confirmada');
  } else {
    msPoints += 5; // Lateral / sem clareza
  }

  if (analysis.dominantForce === 'COMPRADOR' && analysis.trend === 'ALTA') {
    msPoints += 7;
    reasons.push('Domínio comprador alinhado à tendência');
  } else if (analysis.dominantForce === 'VENDEDOR' && analysis.trend === 'BAIXA') {
    msPoints += 7;
    reasons.push('Domínio vendedor alinhado à tendência');
  }

  const normalizedMS = Math.min(weights.marketStructure, (msPoints / 25) * weights.marketStructure);
  if (analysis.trend === 'ALTA') callScore += normalizedMS;
  if (analysis.trend === 'BAIXA') putScore += normalizedMS;

  // 2. Price Action (Weight: default 25)
  let paCall = 0;
  let paPut = 0;

  if (analysis.engulfingPattern === 'BULLISH') {
    paCall += 15;
    reasons.push('Padrão Engolfo de Alta com forte expressão');
  } else if (analysis.engulfingPattern === 'BEARISH') {
    paPut += 15;
    reasons.push('Padrão Engolfo de Baixa com forte expressão');
  }

  if (analysis.rejectionCandle) {
    if (analysis.buyerStrength === 'FORTE' || analysis.trend === 'ALTA') {
      paCall += 10;
      reasons.push('Rejeição em mínima com pavio inferior expressivo');
    } else if (analysis.sellerStrength === 'FORTE' || analysis.trend === 'BAIXA') {
      paPut += 10;
      reasons.push('Rejeição em máxima com pavio superior expressivo');
    }
  }

  if (analysis.momentumAccelerating) {
    if (analysis.dominantForce === 'COMPRADOR') {
      paCall += 7;
      reasons.push('Aceleração de fluxo comprador');
    } else if (analysis.dominantForce === 'VENDEDOR') {
      paPut += 7;
      reasons.push('Aceleração de fluxo vendedor');
    }
  }

  if (analysis.exhaustionDetected) {
    if (analysis.candleSequences.color === 'RED') {
      paCall += 8;
      reasons.push('Exaustão vendedora após sequência de candles');
    } else if (analysis.candleSequences.color === 'GREEN') {
      paPut += 8;
      reasons.push('Exaustão compradora após sequência de candles');
    }
  }

  const normalizedPACall = Math.min(weights.priceAction, (paCall / 25) * weights.priceAction);
  const normalizedPAPut = Math.min(weights.priceAction, (paPut / 25) * weights.priceAction);

  // 3. Support & Resistance (Weight: default 20)
  let srCall = 0;
  let srPut = 0;

  if (analysis.nearSupport) {
    srCall += 16;
    reasons.push('Preço testando zona chave de SUPORTE com rejeição');
  }
  if (analysis.nearResistance) {
    srPut += 16;
    reasons.push('Preço testando zona chave de RESISTÊNCIA com rejeição');
  }

  // Penalize consolidation/chop
  if (analysis.inConsolidation) {
    srCall = Math.max(0, srCall - 10);
    srPut = Math.max(0, srPut - 10);
    reasons.push('Mercado em consolidação estreita (filtro anti-ruído)');
  }

  const normalizedSRCall = Math.min(weights.supportResistance, (srCall / 20) * weights.supportResistance);
  const normalizedSRPut = Math.min(weights.supportResistance, (srPut / 20) * weights.supportResistance);

  // 4. Smart Money Concepts (SMC) (Weight: default 20)
  let smcCall = 0;
  let smcPut = 0;

  if (analysis.choch) {
    if (analysis.trend === 'ALTA' || analysis.dominantForce === 'COMPRADOR') {
      smcCall += 12;
      reasons.push('SMC: Quebra de Caráter (CHoCH) para alta');
    } else {
      smcPut += 12;
      reasons.push('SMC: Quebra de Caráter (CHoCH) para baixa');
    }
  } else if (analysis.bos) {
    if (analysis.trend === 'ALTA') {
      smcCall += 10;
      reasons.push('SMC: Rompimento de Estrutura (BOS) a favor da alta');
    } else if (analysis.trend === 'BAIXA') {
      smcPut += 10;
      reasons.push('SMC: Rompimento de Estrutura (BOS) a favor da baixa');
    }
  }

  if (analysis.liquiditySweep === 'LOW') {
    smcCall += 12;
    reasons.push('SMC: Varredura de Liquidez (Liquidity Sweep) em fundos');
  } else if (analysis.liquiditySweep === 'HIGH') {
    smcPut += 12;
    reasons.push('SMC: Varredura de Liquidez (Liquidity Sweep) em topos');
  }

  if (analysis.activeOrderBlock) {
    if (analysis.activeOrderBlock.type === 'BULLISH' && !analysis.activeOrderBlock.mitigated) {
      smcCall += 8;
      reasons.push('SMC: Order Block comprador institucional ativo');
    } else if (analysis.activeOrderBlock.type === 'BEARISH' && !analysis.activeOrderBlock.mitigated) {
      smcPut += 8;
      reasons.push('SMC: Order Block vendedor institucional ativo');
    }
  }

  if (analysis.activeFVG) {
    if (analysis.activeFVG.type === 'BULLISH') {
      smcCall += 6;
      reasons.push('SMC: Desequilíbrio Fair Value Gap (FVG) comprador');
    } else if (analysis.activeFVG.type === 'BEARISH') {
      smcPut += 6;
      reasons.push('SMC: Desequilíbrio Fair Value Gap (FVG) vendedor');
    }
  }

  const normalizedSMCCall = Math.min(weights.smc, (smcCall / 20) * weights.smc);
  const normalizedSMCPut = Math.min(weights.smc, (smcPut / 20) * weights.smc);

  // 5. Volatility Context (Weight: default 10)
  let volScore = 0;
  if (analysis.volatilityStatus === 'NORMAL') {
    volScore = weights.volatility;
    reasons.push('Volatilidade saudável para tempo de expiração curto');
  } else if (analysis.volatilityStatus === 'ALTA') {
    volScore = weights.volatility * 0.7; // slight risk
    reasons.push('Volatilidade elevada — expansão de spreads');
  } else {
    volScore = weights.volatility * 0.3; // low liquidity risk
  }

  // 6. Direct TradingView Signal Confluence
  let tvCall = 0;
  let tvPut = 0;
  if (analysis.tradingView) {
    if (analysis.tradingView.recommendation === 'FORTE COMPRA') {
      tvCall += 12;
      reasons.push('TradingView: FORTE COMPRA (Osciladores & Médias alinhadas)');
    } else if (analysis.tradingView.recommendation === 'COMPRA') {
      tvCall += 8;
      reasons.push('TradingView: Indicação técnica de COMPRA');
    } else if (analysis.tradingView.recommendation === 'FORTE VENDA') {
      tvPut += 12;
      reasons.push('TradingView: FORTE VENDA (Osciladores & Médias alinhadas)');
    } else if (analysis.tradingView.recommendation === 'VENDA') {
      tvPut += 8;
      reasons.push('TradingView: Indicação técnica de VENDA');
    }

    if (analysis.tradingView.rsiCondition === 'SOBREVENDIDO') {
      tvCall += 6;
      reasons.push(`TradingView RSI (${analysis.tradingView.rsi}): Região de Sobrevenda extrema`);
    } else if (analysis.tradingView.rsiCondition === 'SOBRECOMPRADO') {
      tvPut += 6;
      reasons.push(`TradingView RSI (${analysis.tradingView.rsi}): Região de Sobrecompra extrema`);
    }
  }

  const totalCall = Math.round(
    (analysis.trend === 'ALTA' ? normalizedMS : 0) +
    normalizedPACall +
    normalizedSRCall +
    normalizedSMCCall +
    volScore +
    tvCall * 0.4
  );

  const totalPut = Math.round(
    (analysis.trend === 'BAIXA' ? normalizedMS : 0) +
    normalizedPAPut +
    normalizedSRPut +
    normalizedSMCPut +
    volScore +
    tvPut * 0.4
  );

  let direction: SignalDirection | 'NEUTRO' = 'NEUTRO';
  let totalScore = 0;
  let msScore = 0;
  let paScore = 0;
  let srScore = 0;
  let smcFinalScore = 0;

  if (totalCall >= totalPut && totalCall >= 50 && !analysis.inConsolidation) {
    direction = 'CALL';
    totalScore = Math.min(100, totalCall);
    msScore = analysis.trend === 'ALTA' ? normalizedMS : 0;
    paScore = normalizedPACall;
    srScore = normalizedSRCall;
    smcFinalScore = normalizedSMCCall;
  } else if (totalPut > totalCall && totalPut >= 50 && !analysis.inConsolidation) {
    direction = 'PUT';
    totalScore = Math.min(100, totalPut);
    msScore = analysis.trend === 'BAIXA' ? normalizedMS : 0;
    paScore = normalizedPAPut;
    srScore = normalizedSRPut;
    smcFinalScore = normalizedSMCPut;
  } else {
    direction = 'NEUTRO';
    totalScore = Math.max(totalCall, totalPut);
    msScore = 5;
    paScore = 5;
    srScore = 5;
    smcFinalScore = 5;
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
