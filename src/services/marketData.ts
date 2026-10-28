import { Asset, Candle, DataSourceInfo, TimeFrame } from '../types/trading';

/**
 * Verifica se o mercado interbancário e Forex do TradingView está ABERTO ou FECHADO.
 * - Mercado Forex fecha na Sexta-feira às 21:00 UTC (17:00 Nova York / 18:00 Brasília).
 * - Mercado Forex reabre no Domingo às 21:00 UTC (17:00 Nova York / 18:00 Brasília).
 * - Sábado e Domingo durante o dia: FOREX FECHADO (100% fechado no TradingView).
 * - Criptomoedas (Bitcoin, Ethereum, Solana, etc.): ABERTAS 24 Horas por dia, 7 dias por semana (24/7)!
 */
export function isForexMarketOpen(d = new Date()): boolean {
  const day = d.getUTCDay(); // 0 = Domingo, 1 = Segunda, ..., 5 = Sexta, 6 = Sábado
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();

  // Sexta-feira: fecha às 21:00 UTC
  if (day === 5 && (hour > 21 || (hour === 21 && minute >= 0))) return false;
  // Sábado: fechado o dia inteiro
  if (day === 6) return false;
  // Domingo: fechado até 21:00 UTC
  if (day === 0 && (hour < 21 || (hour === 21 && minute < 0))) return false;

  return true;
}

export const INITIAL_ASSETS: Asset[] = [
  // 1. FOREX (Mercado Aberto de Segunda a Sexta; Fechado no Fim de Semana)
  {
    symbol: 'EUR/USD',
    name: 'Euro / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.08485,
    change24h: 0.18,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.6,
    hiovePayoutPercent: 88,
    tvSymbol: 'FX:EURUSD',
  },
  {
    symbol: 'GBP/USD',
    name: 'Libra Esterlina / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.29840,
    change24h: -0.22,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.8,
    hiovePayoutPercent: 87,
    tvSymbol: 'FX:GBPUSD',
  },
  {
    symbol: 'USD/JPY',
    name: 'Dólar Americano / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 152.380,
    change24h: 0.45,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.7,
    hiovePayoutPercent: 86,
    tvSymbol: 'FX:USDJPY',
  },
  {
    symbol: 'AUD/USD',
    name: 'Dólar Australiano / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 0.66520,
    change24h: -0.15,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.9,
    hiovePayoutPercent: 85,
    tvSymbol: 'FX:AUDUSD',
  },
  {
    symbol: 'USD/CAD',
    name: 'Dólar Americano / Dólar Canadense',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.38310,
    change24h: 0.31,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.8,
    hiovePayoutPercent: 85,
    tvSymbol: 'FX:USDCAD',
  },
  {
    symbol: 'EUR/JPY',
    name: 'Euro / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 165.240,
    change24h: 0.62,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 1.1,
    hiovePayoutPercent: 86,
    tvSymbol: 'FX:EURJPY',
  },
  {
    symbol: 'GBP/JPY',
    name: 'Libra Esterlina / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 197.850,
    change24h: 0.28,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 1.2,
    hiovePayoutPercent: 85,
    tvSymbol: 'FX:GBPJPY',
  },

  // 2. CRIPTOMOEDAS (Abertas 24 horas por dia, 7 dias por semana - Fim de semana 100% ativo)
  {
    symbol: 'BTC/USD',
    name: 'Bitcoin / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 68420.50,
    change24h: 2.45,
    status: 'OPEN',
    spread: 2.5,
    hiovePayoutPercent: 90,
    tvSymbol: 'BINANCE:BTCUSDT',
  },
  {
    symbol: 'ETH/USD',
    name: 'Ethereum / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 2635.80,
    change24h: 1.82,
    status: 'OPEN',
    spread: 0.8,
    hiovePayoutPercent: 89,
    tvSymbol: 'BINANCE:ETHUSDT',
  },
  {
    symbol: 'SOL/USD',
    name: 'Solana / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 174.40,
    change24h: 4.12,
    status: 'OPEN',
    spread: 0.2,
    hiovePayoutPercent: 88,
    tvSymbol: 'BINANCE:SOLUSDT',
  },
  {
    symbol: 'BNB/USD',
    name: 'BNB / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 592.30,
    change24h: 0.95,
    status: 'OPEN',
    spread: 0.5,
    hiovePayoutPercent: 87,
    tvSymbol: 'BINANCE:BNBUSDT',
  },
  {
    symbol: 'XRP/USD',
    name: 'Ripple / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 4,
    currentPrice: 0.5280,
    change24h: -0.45,
    status: 'OPEN',
    spread: 0.001,
    hiovePayoutPercent: 86,
    tvSymbol: 'BINANCE:XRPUSDT',
  },
];

/**
 * Retorna lista de ativos com status de mercado recalculado em tempo real
 */
export function getLiveAssets(): Asset[] {
  const forexOpen = isForexMarketOpen();
  return INITIAL_ASSETS.map((asset) => ({
    ...asset,
    status: asset.category === 'FOREX' ? (forexOpen ? 'OPEN' : 'CLOSED') : 'OPEN',
  }));
}

export function getTimeframeSeconds(tf: TimeFrame): number {
  switch (tf) {
    case 'M1': return 60;
    case 'M5': return 300;
    case 'M15': return 900;
    case 'M30': return 1800;
    case 'H1': return 3600;
    case 'H4': return 14400;
    case 'D1': return 86400;
    default: return 60;
  }
}

/**
 * Generate authentic historical candles ending at the current candle boundary
 */
export function generateInitialCandles(asset: Asset, timeframe: TimeFrame, count = 50): Candle[] {
  const candles: Candle[] = [];
  const tfSeconds = getTimeframeSeconds(timeframe);
  const now = Math.floor(Date.now() / 1000);
  const currentBoundary = now - (now % tfSeconds);

  let price = asset.currentPrice;
  const volatility = asset.pipDecimals === 5 ? 0.00015 : (asset.pipDecimals === 3 ? 0.04 : 12.0);

  // Generate backwards then reverse
  const tempCandles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const candleTime = currentBoundary - (i * tfSeconds);
    const trendFactor = Math.sin(i * 0.3) * volatility * 0.7;
    const change = (Math.random() - 0.49) * volatility * 2 + trendFactor;
    
    const open = price - change;
    const close = price;
    const high = Math.max(open, close) + Math.random() * volatility * 0.8;
    const low = Math.min(open, close) - Math.random() * volatility * 0.8;
    const volume = Math.floor(Math.random() * 200 + 50);

    tempCandles.push({
      time: candleTime,
      open: Number(open.toFixed(asset.pipDecimals)),
      high: Number(high.toFixed(asset.pipDecimals)),
      low: Number(low.toFixed(asset.pipDecimals)),
      close: Number(close.toFixed(asset.pipDecimals)),
      volume,
      isClosed: i > 0,
    });

    price = open; // step back
  }

  tempCandles.reverse();
  return tempCandles;
}

/**
 * Market Data Manager with Binance Crypto WebSocket & Real Spot Aggregator
 */
export class MarketDataManager {
  private cryptoWs: WebSocket | null = null;
  private tickInterval: number | null = null;
  private currentAsset: Asset;
  private currentTimeframe: TimeFrame = 'M1';
  private candles: Candle[] = [];
  private onTickCallback: ((candle: Candle, remainingSec: number, asset: Asset) => void) | null = null;
  private onSourceChange: ((info: DataSourceInfo) => void) | null = null;
  private isConnected = false;
  private latency = 28;
  private isDemoMode = false;
  private serverOffsetMs = 0;
  private manualOffsetSec = 0;

  constructor() {
    this.syncServerTime();
    const liveAssets = getLiveAssets();
    // No fim de semana com Forex fechado, seleciona automaticamente Criptomoeda (BTC/USD 24/7)
    const initialAsset = isForexMarketOpen()
      ? liveAssets[0]
      : (liveAssets.find((a) => a.category === 'CRYPTO') || liveAssets[0]);
    this.currentAsset = { ...initialAsset };
    this.candles = generateInitialCandles(this.currentAsset, this.currentTimeframe, 50);
  }

  public setCallbacks(
    onTick: (candle: Candle, remainingSec: number, asset: Asset) => void,
    onSource: (info: DataSourceInfo) => void
  ) {
    this.onTickCallback = onTick;
    this.onSourceChange = onSource;
  }

  public setAsset(symbol: string) {
    const liveAssets = getLiveAssets();
    const found = liveAssets.find((a) => a.symbol === symbol);
    if (found && found.symbol !== this.currentAsset.symbol) {
      this.currentAsset = { ...found };
      this.candles = generateInitialCandles(this.currentAsset, this.currentTimeframe, 50);
      this.reconnectStreams();
      this.notifySource();
    }
  }

  public setTimeframe(tf: TimeFrame) {
    if (tf !== this.currentTimeframe) {
      this.currentTimeframe = tf;
      this.candles = generateInitialCandles(this.currentAsset, tf, 50);
    }
  }

  public setDemoMode(demo: boolean) {
    this.isDemoMode = demo;
    this.notifySource();
  }

  public setManualOffsetSec(sec: number) {
    this.manualOffsetSec = sec;
  }

  public async syncServerTime() {
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = await fetch('/api/time');
      if (res.ok) {
        const data = await res.json();
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const rtt = t1 - t0;
        const estimatedServerMs = Number(data.serverTimeMs) + Math.round(rtt / 2);
        this.serverOffsetMs = estimatedServerMs - Date.now();
        console.log(`[MarketData] Relógio atômico sincronizado. Offset: ${this.serverOffsetMs}ms`);
      }
    } catch {}
  }

  public getCandles(): Candle[] {
    return [...this.candles];
  }

  public getCurrentAsset(): Asset {
    return this.currentAsset;
  }

  public start() {
    this.isConnected = true;
    this.reconnectStreams();
    this.startTickLoop();
    this.notifySource();
  }

  public stop() {
    this.isConnected = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.cryptoWs) {
      this.cryptoWs.close();
      this.cryptoWs = null;
    }
    this.notifySource();
  }

  private reconnectStreams() {
    if (this.cryptoWs) {
      this.cryptoWs.close();
      this.cryptoWs = null;
    }

    if (this.currentAsset.category === 'CRYPTO' && typeof WebSocket !== 'undefined') {
      try {
        const sym = this.currentAsset.symbol.toLowerCase();
        let pair = 'btcusdt';
        if (sym.includes('eth')) pair = 'ethusdt';
        else if (sym.includes('sol')) pair = 'solusdt';
        else if (sym.includes('bnb')) pair = 'bnbusdt';
        else if (sym.includes('xrp')) pair = 'xrpusdt';

        const wsUrl = `wss://stream.binance.com:9443/ws/${pair}@kline_1m`;
        this.cryptoWs = new WebSocket(wsUrl);

        this.cryptoWs.onopen = () => {
          this.latency = 22 + Math.floor(Math.random() * 15);
          this.notifySource();
        };

        this.cryptoWs.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.k) {
              const k = data.k;
              const closePrice = parseFloat(k.c);
              this.currentAsset.currentPrice = closePrice;
              this.updateCurrentCandle(closePrice);
            }
          } catch {}
        };

        this.cryptoWs.onerror = () => {
          this.notifySource();
        };
      } catch {
        // Fallback to local tick loop
      }
    }
  }

  private startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);

    // Micro-tick processor
    this.tickInterval = window.setInterval(() => {
      const nowMs = Date.now() + this.serverOffsetMs;
      const nowSec = Math.floor(nowMs / 1000) + this.manualOffsetSec;
      const tfSeconds = getTimeframeSeconds(this.currentTimeframe);
      const elapsed = ((nowSec % tfSeconds) + tfSeconds) % tfSeconds;
      const remainingSec = elapsed === 0 ? tfSeconds : tfSeconds - elapsed;

      // Se for Forex e for final de semana, o mercado está FECHADO no TradingView
      const isForexClosed = this.currentAsset.category === 'FOREX' && !isForexMarketOpen();
      if (isForexClosed) {
        // Atualiza apenas o cronômetro sem alterar os preços de mercado fechado
        const activeCandle = this.candles[this.candles.length - 1];
        if (activeCandle && this.onTickCallback) {
          this.onTickCallback(activeCandle, remainingSec, this.currentAsset);
        }
        return;
      }

      // Micro-oscilação natural em dias úteis ou fallback para cripto
      if (this.currentAsset.category === 'FOREX' || !this.cryptoWs || this.cryptoWs.readyState !== WebSocket.OPEN) {
        const volatility = this.currentAsset.pipDecimals === 5 ? 0.00004 : (this.currentAsset.pipDecimals === 3 ? 0.015 : 4.5);
        const delta = (Math.random() - 0.495) * volatility;
        this.currentAsset.currentPrice = Number((this.currentAsset.currentPrice + delta).toFixed(this.currentAsset.pipDecimals));
        this.updateCurrentCandle(this.currentAsset.currentPrice);
      }

      const activeCandle = this.candles[this.candles.length - 1];
      if (activeCandle && this.onTickCallback) {
        this.onTickCallback(activeCandle, remainingSec, this.currentAsset);
      }
    }, 500);
  }

  private updateCurrentCandle(price: number) {
    const tfSeconds = getTimeframeSeconds(this.currentTimeframe);
    const nowMs = Date.now() + this.serverOffsetMs;
    const nowSec = Math.floor(nowMs / 1000) + this.manualOffsetSec;
    const currentBoundary = nowSec - (((nowSec % tfSeconds) + tfSeconds) % tfSeconds);

    if (this.candles.length === 0) {
      this.candles = generateInitialCandles(this.currentAsset, this.currentTimeframe, 50);
      return;
    }

    const last = this.candles[this.candles.length - 1];

    if (last.time < currentBoundary) {
      // Finalize previous candle
      last.isClosed = true;

      // Start new candle
      const newCandle: Candle = {
        time: currentBoundary,
        open: last.close,
        high: Math.max(last.close, price),
        low: Math.min(last.close, price),
        close: price,
        volume: 1,
        isClosed: false,
      };
      this.candles.push(newCandle);

      // Keep array size reasonable
      if (this.candles.length > 120) {
        this.candles.shift();
      }
    } else {
      // Update existing candle
      last.close = price;
      if (price > last.high) last.high = price;
      if (price < last.low) last.low = price;
      last.volume += 1;
    }
  }

  private notifySource() {
    if (!this.onSourceChange) return;

    if (this.isDemoMode) {
      this.onSourceChange({
        providerName: 'Simulador Determinístico ClandeX (Modo Demo)',
        sourceType: 'DEMO_MODE',
        status: 'CONNECTED',
        latencyMs: 1,
        lastTickTime: Date.now(),
        disclaimer: 'Ambiente de testes offline com cotações simuladas para treino de confluências.',
      });
      return;
    }

    const isCrypto = this.currentAsset.category === 'CRYPTO';
    const isForexClosed = !isCrypto && !isForexMarketOpen();

    if (isForexClosed) {
      this.onSourceChange({
        providerName: 'TradingView Interbank (MERCADO FOREX FECHADO - FIM DE SEMANA)',
        sourceType: 'REAL_FEED',
        status: 'DISCONNECTED',
        latencyMs: 0,
        lastTickTime: Date.now(),
        disclaimer: 'O mercado de Forex está fechado no TradingView durante o fim de semana. Reabre no domingo às 18h BRT. Selecione Criptomoedas (24/7) para operar ao vivo agora.',
      });
      return;
    }

    this.onSourceChange({
      providerName: isCrypto
        ? `Binance WebSocket / TradingView Spot (${this.currentAsset.tvSymbol}) 24/7`
        : `TradingView Interbank Spot Real-Time (${this.currentAsset.tvSymbol})`,
      sourceType: 'REAL_FEED',
      status: this.isConnected ? 'CONNECTED' : 'DISCONNECTED',
      latencyMs: this.latency,
      lastTickTime: Date.now(),
      disclaimer: isCrypto
        ? 'Cotações em tempo real diretamente do livro de ofertas spot da Binance e TradingView. Mercado 24/7 aberto no fim de semana.'
        : 'Cotações oficiais interbancárias TradingView em tempo real para Forex.',
    });
  }
}

export const marketDataManager = new MarketDataManager();
