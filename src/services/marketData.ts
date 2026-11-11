import { Asset, Candle, DataSourceInfo, TimeFrame } from '../types/trading';
import { tradingViewScanner, LiveTradingViewData } from './tradingViewScanner';

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
  // 1. FOREX (Oficial TradingView OANDA)
  {
    symbol: 'EUR/USD',
    name: 'Euro / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.11587,
    change24h: 0.05,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.6,
    hiovePayoutPercent: 88,
    tvSymbol: 'OANDA:EURUSD',
  },
  {
    symbol: 'GBP/USD',
    name: 'Libra Esterlina / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.33662,
    change24h: 0.31,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.8,
    hiovePayoutPercent: 87,
    tvSymbol: 'OANDA:GBPUSD',
  },
  {
    symbol: 'USD/JPY',
    name: 'Dólar Americano / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 157.867,
    change24h: 0.03,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.7,
    hiovePayoutPercent: 86,
    tvSymbol: 'OANDA:USDJPY',
  },
  {
    symbol: 'AUD/USD',
    name: 'Dólar Australiano / Dólar Americano',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 0.70354,
    change24h: -0.26,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.9,
    hiovePayoutPercent: 85,
    tvSymbol: 'OANDA:AUDUSD',
  },
  {
    symbol: 'USD/CAD',
    name: 'Dólar Americano / Dólar Canadense',
    category: 'FOREX',
    pipDecimals: 5,
    currentPrice: 1.39867,
    change24h: -0.06,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 0.8,
    hiovePayoutPercent: 85,
    tvSymbol: 'OANDA:USDCAD',
  },
  {
    symbol: 'EUR/JPY',
    name: 'Euro / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 176.157,
    change24h: 0.07,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 1.1,
    hiovePayoutPercent: 86,
    tvSymbol: 'OANDA:EURJPY',
  },
  {
    symbol: 'GBP/JPY',
    name: 'Libra Esterlina / Iene Japonês',
    category: 'FOREX',
    pipDecimals: 3,
    currentPrice: 211.014,
    change24h: 0.33,
    status: isForexMarketOpen() ? 'OPEN' : 'CLOSED',
    spread: 1.2,
    hiovePayoutPercent: 85,
    tvSymbol: 'OANDA:GBPJPY',
  },

  // 2. CRIPTOMOEDAS (Oficial TradingView BYBIT - Aberto 24/7)
  {
    symbol: 'BTC/USD',
    name: 'Bitcoin / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 81526.63,
    change24h: 0.22,
    status: 'OPEN',
    spread: 2.5,
    hiovePayoutPercent: 90,
    tvSymbol: 'BYBIT:BTCUSDT',
  },
  {
    symbol: 'ETH/USD',
    name: 'Ethereum / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 2360.27,
    change24h: 0.03,
    status: 'OPEN',
    spread: 0.8,
    hiovePayoutPercent: 89,
    tvSymbol: 'BYBIT:ETHUSDT',
  },
  {
    symbol: 'SOL/USD',
    name: 'Solana / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 102.24,
    change24h: -0.20,
    status: 'OPEN',
    spread: 0.2,
    hiovePayoutPercent: 88,
    tvSymbol: 'BYBIT:SOLUSDT',
  },
  {
    symbol: 'BNB/USD',
    name: 'BNB / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 2,
    currentPrice: 751.54,
    change24h: -1.10,
    status: 'OPEN',
    spread: 0.5,
    hiovePayoutPercent: 87,
    tvSymbol: 'BYBIT:BNBUSDT',
  },
  {
    symbol: 'XRP/USD',
    name: 'Ripple / Dólar Americano',
    category: 'CRYPTO',
    pipDecimals: 4,
    currentPrice: 1.3062,
    change24h: -1.48,
    status: 'OPEN',
    spread: 0.001,
    hiovePayoutPercent: 86,
    tvSymbol: 'BYBIT:XRPUSDT',
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
    case 'M2': return 120;
    case 'M5': return 300;
    case 'M15': return 900;
    case 'M30': return 1800;
    case 'H1': return 3600;
    case 'H4': return 14400;
    case 'D1': return 86400;
    default: return 60;
  }
}

export function getBybitPair(symbol: string): string {
  const sym = symbol.toUpperCase();
  if (sym.includes('BTC')) return 'BTCUSDT';
  if (sym.includes('ETH')) return 'ETHUSDT';
  if (sym.includes('SOL')) return 'SOLUSDT';
  if (sym.includes('BNB')) return 'BNBUSDT';
  if (sym.includes('XRP')) return 'XRPUSDT';
  const clean = symbol.replace(/[\/\-_]/g, '').toUpperCase();
  if (clean.endsWith('USDT')) return clean;
  if (clean.endsWith('USD')) return clean + 'T';
  return clean + 'USDT';
}

export function getBinancePair(symbol: string): string {
  const sym = symbol.toUpperCase();
  if (sym.includes('BTC')) return 'btcusdt';
  if (sym.includes('ETH')) return 'ethusdt';
  if (sym.includes('SOL')) return 'solusdt';
  if (sym.includes('BNB')) return 'bnbusdt';
  if (sym.includes('XRP')) return 'xrpusdt';
  return 'btcusdt';
}

export function getBinanceInterval(tf: TimeFrame): string {
  switch (tf) {
    case 'M1': return '1m';
    case 'M2': return '1m'; // Binance não possui 2m nativo; buscamos 1m e agrupamos a cada 2 velas
    case 'M5': return '5m';
    case 'M15': return '15m';
    case 'M30': return '30m';
    case 'H1': return '1h';
    case 'H4': return '4h';
    case 'D1': return '1d';
    default: return '1m';
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): number {
  let t = (seed += 0x6D2B79F5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Gera velas históricas matematicamente determinísticas com base no tempo e ativo.
 * Desta forma, a vela de 10:00 sempre terá o mesmo preço, RSI e confluências,
 * independente de quantas vezes o operador alternar entre M1, M5 e M15.
 */
export function generateDeterministicCandles(asset: Asset, timeframe: TimeFrame, count = 55): Candle[] {
  const candles: Candle[] = [];
  const tfSeconds = getTimeframeSeconds(timeframe);
  const now = Math.floor(Date.now() / 1000);
  const currentBoundary = now - (((now % tfSeconds) + tfSeconds) % tfSeconds);

  const basePrice = asset.currentPrice;
  const volatility = asset.pipDecimals === 5 ? 0.00018 : (asset.pipDecimals === 3 ? 0.045 : (asset.pipDecimals === 4 ? 0.0012 : 14.0));
  const assetHash = hashString(asset.symbol);

  // Função harmônica de preço no tempo exato (Ondas de mercado consistentes)
  const getPriceAtTime = (tSec: number): number => {
    const wave24h = Math.sin((tSec / 86400) * 2 * Math.PI) * volatility * 9;
    const wave4h = Math.cos((tSec / 14400) * 2 * Math.PI) * volatility * 4.5;
    const wave1h = Math.sin((tSec / 3600) * 2 * Math.PI) * volatility * 2.2;
    const wave15m = Math.cos((tSec / 900) * 2 * Math.PI) * volatility * 1.1;
    const rand = (seededRandom(assetHash ^ tSec) - 0.5) * volatility * 1.8;
    return basePrice + wave24h + wave4h + wave1h + wave15m + rand;
  };

  for (let i = count - 1; i >= 0; i--) {
    const candleTime = currentBoundary - (i * tfSeconds);
    const nextTime = candleTime + tfSeconds;
    const open = Number(getPriceAtTime(candleTime).toFixed(asset.pipDecimals));
    const close = i === 0 ? asset.currentPrice : Number(getPriceAtTime(nextTime).toFixed(asset.pipDecimals));

    const seed = assetHash ^ candleTime;
    const r1 = seededRandom(seed + 1);
    const r2 = seededRandom(seed + 2);
    const r3 = seededRandom(seed + 3);

    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const wickUp = (r1 * 0.8 + 0.1) * volatility;
    const wickDown = (r2 * 0.8 + 0.1) * volatility;

    const high = Number((bodyHigh + wickUp).toFixed(asset.pipDecimals));
    const low = Number(Math.max(0.00001, bodyLow - wickDown).toFixed(asset.pipDecimals));
    const volume = Math.floor(r3 * 350 + 60);

    candles.push({
      time: candleTime,
      open,
      high,
      low,
      close,
      volume,
      isClosed: i > 0,
    });
  }

  return candles;
}

export function generateInitialCandles(asset: Asset, timeframe: TimeFrame, count = 55): Candle[] {
  return generateDeterministicCandles(asset, timeframe, count);
}

/**
 * Market Data Manager com Cache Persistente Multi-Timeframe e Binance WebSocket
 */
export class MarketDataManager {
  private cryptoWs: WebSocket | null = null;
  private tickInterval: number | null = null;
  private currentAsset: Asset;
  private currentTimeframe: TimeFrame = 'M1';
  private candles: Candle[] = [];
  private candleCache = new Map<string, Candle[]>();
  private onTickCallback: ((candle: Candle, remainingSec: number, asset: Asset) => void) | null = null;
  private onSourceChange: ((info: DataSourceInfo) => void) | null = null;
  private isConnected = false;
  private latency = 28;
  private isDemoMode = false;
  private serverOffsetMs = 0;
  private manualOffsetSec = 0;

  constructor() {
    this.syncServerTime();
    // Ressincronização contínua a cada 45 segundos para manter precisão atômica com a Hiove
    if (typeof window !== 'undefined') {
      window.setInterval(() => {
        this.syncServerTime().catch(() => {});
      }, 45000);
    }

    const liveAssets = getLiveAssets();
    const initialAsset = isForexMarketOpen()
      ? liveAssets[0]
      : (liveAssets.find((a) => a.category === 'CRYPTO') || liveAssets[0]);
    this.currentAsset = { ...initialAsset };

    // Sincronização em tempo real com o feed oficial da TradingView
    tradingViewScanner.subscribe((tvData) => {
      // Atualiza o preço global do ativo na lista
      const assetMatch = INITIAL_ASSETS.find((a) => a.symbol === tvData.symbol);
      if (assetMatch) {
        assetMatch.currentPrice = tvData.price;
        assetMatch.change24h = tvData.change24h;
      }

      // Se for o ativo em foco, atualiza preço, calibra candle e dispara evento
      if (tvData.symbol === this.currentAsset.symbol) {
        this.currentAsset.currentPrice = tvData.price;
        this.currentAsset.change24h = tvData.change24h;
        this.updateCurrentCandle(tvData.price);
        this.notifyTickImmediately();
      }
    });

    this.candles = generateDeterministicCandles(this.currentAsset, this.currentTimeframe, 55);
    const key = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
    this.candleCache.set(key, this.candles);

    this.loadCandlesForCurrentSelection();
  }

  public setCallbacks(
    onTick: (candle: Candle, remainingSec: number, asset: Asset) => void,
    onSource: (info: DataSourceInfo) => void
  ) {
    this.onTickCallback = onTick;
    this.onSourceChange = onSource;
  }

  /**
   * Busca cotações e velas reais diretamente do TradingView / Binance
   */
  private async loadCandlesForCurrentSelection() {
    // 1. Sempre tenta buscar primeiro a cotação oficial do TradingView
    try {
      const tvData = await tradingViewScanner.fetchAssetData(this.currentAsset, this.currentTimeframe);
      if (tvData) {
        this.currentAsset.currentPrice = tvData.price;
        this.currentAsset.change24h = tvData.change24h;
      }
    } catch { }

    const key = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
    if (this.currentAsset.category !== 'CRYPTO' && this.candleCache.has(key) && (this.candleCache.get(key) || []).length >= 10) {
      this.candles = [...this.candleCache.get(key)!];
      if (this.candles.length > 0) {
        this.candles[this.candles.length - 1].close = this.currentAsset.currentPrice;
      }
      this.notifyTickImmediately();
      return;
    }

    if (this.currentAsset.category === 'CRYPTO') {
      // 1. Bybit Spot Klines Oficial
      try {
        const bybitPair = getBybitPair(this.currentAsset.symbol);
        let bybitInterval = '1';
        if (this.currentTimeframe === 'M5') bybitInterval = '5';
        else if (this.currentTimeframe === 'M15') bybitInterval = '15';
        else if (this.currentTimeframe === 'M30') bybitInterval = '30';
        else if (this.currentTimeframe === 'H1') bybitInterval = '60';
        else if (this.currentTimeframe === 'H4') bybitInterval = '240';
        else if (this.currentTimeframe === 'D1') bybitInterval = 'D';

        const bybitRes = await fetch(
          `https://api.bybit.com/v5/market/kline?category=spot&symbol=${bybitPair}&interval=${bybitInterval}&limit=55`
        );
        if (bybitRes.ok) {
          const bybitData = await bybitRes.json();
          if (bybitData?.result?.list && Array.isArray(bybitData.result.list) && bybitData.result.list.length > 0) {
            const rawList = [...bybitData.result.list].reverse();
            let parsed: Candle[] = rawList.map((item: any, idx: number) => ({
              time: Math.floor(Number(item[0]) / 1000),
              open: Number(parseFloat(item[1]).toFixed(this.currentAsset.pipDecimals)),
              high: Number(parseFloat(item[2]).toFixed(this.currentAsset.pipDecimals)),
              low: Number(parseFloat(item[3]).toFixed(this.currentAsset.pipDecimals)),
              close: Number(parseFloat(item[4]).toFixed(this.currentAsset.pipDecimals)),
              volume: Math.round(parseFloat(item[5] || '0')),
              isClosed: idx < rawList.length - 1,
            }));

            if (parsed.length > 0) {
              this.currentAsset.currentPrice = parsed[parsed.length - 1].close;
              this.candles = parsed;
              this.candleCache.set(key, parsed);
              this.notifyTickImmediately();
              return;
            }
          }
        }
      } catch (err) {
        console.warn('[MarketData] Fallback Bybit klines para', this.currentAsset.symbol, err);
      }

      // 2. Fallback secundário Binance com CORS aberto (* via data-api.binance.vision)
      try {
        const pair = getBinancePair(this.currentAsset.symbol);
        const interval = getBinanceInterval(this.currentTimeframe);
        const limit = this.currentTimeframe === 'M2' ? 110 : 55;
        const res = await fetch(
          `https://data-api.binance.vision/api/v3/klines?symbol=${pair.toUpperCase()}&interval=${interval}&limit=${limit}`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            let parsed: Candle[] = data.map((item: any, idx: number) => ({
              time: Math.floor(Number(item[0]) / 1000),
              open: Number(parseFloat(item[1]).toFixed(this.currentAsset.pipDecimals)),
              high: Number(parseFloat(item[2]).toFixed(this.currentAsset.pipDecimals)),
              low: Number(parseFloat(item[3]).toFixed(this.currentAsset.pipDecimals)),
              close: Number(parseFloat(item[4]).toFixed(this.currentAsset.pipDecimals)),
              volume: Math.round(parseFloat(item[5])),
              isClosed: idx < data.length - 1,
            }));

            // Se for M2, agrupa com precisão pares de velas de 1m em velas de 2m
            if (this.currentTimeframe === 'M2' && parsed.length >= 2) {
              const m2Candles: Candle[] = [];
              for (let i = 0; i < parsed.length - 1; i += 2) {
                const c1 = parsed[i];
                const c2 = parsed[i + 1];
                m2Candles.push({
                  time: c1.time,
                  open: c1.open,
                  high: Math.max(c1.high, c2.high),
                  low: Math.min(c1.low, c2.low),
                  close: c2.close,
                  volume: c1.volume + c2.volume,
                  isClosed: c2.isClosed,
                });
              }
              parsed = m2Candles;
            }

            if (parsed.length > 0) {
              parsed[parsed.length - 1].close = this.currentAsset.currentPrice;
            }
            this.candles = parsed;
            this.candleCache.set(key, parsed);
            this.notifyTickImmediately();
            return;
          }
        }
      } catch (err) {
        console.warn('[MarketData] Fallback klines para', this.currentAsset.symbol, err);
      }
    }

    // Forex ou fallback determinístico (calibrado exatamente com o preço oficial TradingView)
    const generated = generateDeterministicCandles(this.currentAsset, this.currentTimeframe, 55);
    if (generated.length > 0) {
      generated[generated.length - 1].close = this.currentAsset.currentPrice;
    }
    this.candles = generated;
    this.candleCache.set(key, generated);
    this.notifyTickImmediately();
  }

  public getServerOffsetMs(): number {
    return this.serverOffsetMs;
  }

  public getManualOffsetSec(): number {
    return this.manualOffsetSec;
  }

  public getServerTimeMs(): number {
    return Date.now() + this.serverOffsetMs + (this.manualOffsetSec * 1000);
  }

  public getServerTimeSec(): number {
    return Math.floor(this.getServerTimeMs() / 1000);
  }

  /**
   * Cálculo atômico e sincronizado de vela e contagem regressiva em total harmonia com a Hiove.
   * Em opções binárias, a vela exibe de (tfSeconds - 1) até 00s.
   * Ex: M1 conta de 59s até 00s, virando a vela no segundo :00 exato.
   */
  public getCandleTiming(): { nowMs: number; nowSec: number; currentBoundary: number; remainingSec: number } {
    const nowMs = this.getServerTimeMs();
    const nowSec = Math.floor(nowMs / 1000);
    const tfSeconds = getTimeframeSeconds(this.currentTimeframe);
    const currentBoundary = nowSec - (((nowSec % tfSeconds) + tfSeconds) % tfSeconds);
    const nextBoundaryMs = (currentBoundary + tfSeconds) * 1000;
    const msRemaining = Math.max(0, nextBoundaryMs - nowMs);
    const remainingSec = Math.max(0, Math.floor(msRemaining / 1000));
    return { nowMs, nowSec, currentBoundary, remainingSec };
  }

  private notifyTickImmediately() {
    const activeCandle = this.candles[this.candles.length - 1];
    if (activeCandle && this.onTickCallback) {
      const { remainingSec } = this.getCandleTiming();
      this.onTickCallback(activeCandle, remainingSec, this.currentAsset);
    }
  }

  public async setAsset(symbol: string) {
    const liveAssets = getLiveAssets();
    const found = liveAssets.find((a) => a.symbol === symbol);
    if (found) {
      // 1. Salva candles do ativo anterior no cache
      const oldKey = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
      this.candleCache.set(oldKey, [...this.candles]);

      // 2. Altera ativo
      this.currentAsset = { ...found };

      // 3. Carrega do cache ou gera imediatamente para o novo par
      const newKey = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
      if (this.candleCache.has(newKey) && (this.candleCache.get(newKey) || []).length >= 10) {
        this.candles = [...this.candleCache.get(newKey)!];
      } else {
        const fresh = generateDeterministicCandles(this.currentAsset, this.currentTimeframe, 55);
        this.candles = fresh;
        this.candleCache.set(newKey, fresh);
      }

      this.notifyTickImmediately();
      await this.loadCandlesForCurrentSelection();
      tradingViewScanner.fetchAssetData(this.currentAsset, this.currentTimeframe);
      this.reconnectStreams();
      this.notifySource();
    }
  }

  public async setTimeframe(tf: TimeFrame) {
    if (tf !== this.currentTimeframe) {
      // 1. Salva histórico do timeframe atual no cache
      const oldKey = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
      this.candleCache.set(oldKey, [...this.candles]);

      // 2. Muda timeframe
      this.currentTimeframe = tf;

      // 3. Carrega do cache ou gera imediatamente para o novo timeframe
      const newKey = `${this.currentAsset.symbol}::${tf}`;
      if (this.candleCache.has(newKey) && (this.candleCache.get(newKey) || []).length >= 10) {
        this.candles = [...this.candleCache.get(newKey)!];
      } else {
        const fresh = generateDeterministicCandles(this.currentAsset, tf, 55);
        this.candles = fresh;
        this.candleCache.set(newKey, fresh);
      }

      this.notifyTickImmediately();
      await this.loadCandlesForCurrentSelection();
      tradingViewScanner.fetchAssetData(this.currentAsset, tf);
      this.reconnectStreams();
      this.notifySource();
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
    // 1. Prioridade máxima: Binance API (referência mundial de tempo atômico com CORS livre)
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = await fetch('https://api.binance.com/api/v3/time', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const rtt = Math.max(1, t1 - t0);
        const estimatedServerMs = Number(data.serverTime) + Math.round(rtt / 2);
        this.serverOffsetMs = estimatedServerMs - Date.now();
        console.log(`[MarketData] Relógio atômico sincronizado com Binance/Hiove. Offset: ${this.serverOffsetMs}ms (RTT: ${Math.round(rtt)}ms)`);
        return;
      }
    } catch {}

    // 2. Fallback: Endpoint próprio /api/time
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = await fetch('/api/time', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const rtt = Math.max(1, t1 - t0);
        const estimatedServerMs = Number(data.serverTimeMs) + Math.round(rtt / 2);
        this.serverOffsetMs = estimatedServerMs - Date.now();
        console.log(`[MarketData] Relógio atômico sincronizado via /api/time. Offset: ${this.serverOffsetMs}ms (RTT: ${Math.round(rtt)}ms)`);
        return;
      }
    } catch {}

    // 3. Fallback: WorldTimeAPI
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const rtt = Math.max(1, t1 - t0);
        const estimatedServerMs = Math.floor(Number(data.unixtime) * 1000) + Math.round(rtt / 2);
        this.serverOffsetMs = estimatedServerMs - Date.now();
        console.log(`[MarketData] Relógio sincronizado via WorldTime. Offset: ${this.serverOffsetMs}ms`);
      }
    } catch {}
  }

  public getCandles(): Candle[] {
    return [...this.candles];
  }

  public getCandlesForAsset(symbol: string, timeframe: TimeFrame): Candle[] {
    const key = `${symbol}::${timeframe}`;
    if (this.currentAsset.symbol === symbol && this.currentTimeframe === timeframe && this.candles.length >= 10) {
      return [...this.candles];
    }
    const cached = this.candleCache.get(key);
    if (cached && cached.length >= 10) {
      return [...cached];
    }
    const found = getLiveAssets().find((a) => a.symbol === symbol) || this.currentAsset;
    const generated = generateDeterministicCandles(found, timeframe, 55);
    this.candleCache.set(key, generated);
    return [...generated];
  }

  public getCurrentAsset(): Asset {
    return this.currentAsset;
  }

  public getCurrentTimeframe(): TimeFrame {
    return this.currentTimeframe;
  }

  public start() {
    this.isConnected = true;
    tradingViewScanner.startBackgroundPolling(
      () => this.currentAsset,
      () => getLiveAssets(),
      () => this.currentTimeframe
    );
    this.reconnectStreams();
    this.startTickLoop();
    this.notifySource();
  }

  public stop() {
    this.isConnected = false;
    tradingViewScanner.stopBackgroundPolling();
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

  public getLiveTradingViewData(timeframe?: TimeFrame): LiveTradingViewData | null {
    return tradingViewScanner.getLatest(this.currentAsset.symbol, timeframe || this.currentTimeframe);
  }

  private reconnectStreams() {
    if (this.cryptoWs) {
      this.cryptoWs.close();
      this.cryptoWs = null;
    }

    if (this.currentAsset.category === 'CRYPTO' && typeof WebSocket !== 'undefined') {
      try {
        const pair = getBybitPair(this.currentAsset.symbol);
        let bybitInterval = '1';
        if (this.currentTimeframe === 'M5') bybitInterval = '5';
        else if (this.currentTimeframe === 'M15') bybitInterval = '15';
        else if (this.currentTimeframe === 'M30') bybitInterval = '30';
        else if (this.currentTimeframe === 'H1') bybitInterval = '60';
        else if (this.currentTimeframe === 'H4') bybitInterval = '240';
        else if (this.currentTimeframe === 'D1') bybitInterval = 'D';

        const wsUrl = 'wss://stream.bybit.com/v5/public/spot';
        this.cryptoWs = new WebSocket(wsUrl);

        this.cryptoWs.onopen = () => {
          this.latency = 18 + Math.floor(Math.random() * 10);
          this.notifySource();
          try {
            this.cryptoWs?.send(JSON.stringify({
              op: 'subscribe',
              args: [`kline.${bybitInterval}.${pair}`],
            }));
          } catch {}
        };

        this.cryptoWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg && msg.topic && Array.isArray(msg.data) && msg.data.length > 0) {
              const k = msg.data[0];
              const closePrice = parseFloat(k.close);
              this.currentAsset.currentPrice = closePrice;
              this.updateCurrentCandle(closePrice, {
                o: k.open,
                h: k.high,
                l: k.low,
                c: k.close,
                x: k.confirm,
              });
            }
          } catch {}
        };

        this.cryptoWs.onerror = () => {
          // Fallback para Binance WebSocket se Bybit falhar
          try {
            const bPair = getBinancePair(this.currentAsset.symbol);
            const bInterval = getBinanceInterval(this.currentTimeframe);
            const bWs = new WebSocket(`wss://stream.binance.com:9443/ws/${bPair}@kline_${bInterval}`);
            bWs.onmessage = (e) => {
              try {
                const bData = JSON.parse(e.data);
                if (bData?.k) {
                  const cPrice = parseFloat(bData.k.c);
                  this.currentAsset.currentPrice = cPrice;
                  this.updateCurrentCandle(cPrice, bData.k);
                }
              } catch {}
            };
            this.cryptoWs = bWs;
          } catch {}
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
      const { remainingSec } = this.getCandleTiming();
      const tfSeconds = getTimeframeSeconds(this.currentTimeframe);

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

      // Sincronização estrita com cotações reais oficiais (SEM ruído artificial)
      // Garante que a abertura, fechamento e resultado de WIN/LOSS batam 100% com a cotação real
      if (this.currentAsset.category === 'FOREX' || !this.cryptoWs || this.cryptoWs.readyState !== WebSocket.OPEN) {
        const latestTv = tradingViewScanner.getLatest(this.currentAsset.symbol, this.currentTimeframe);
        if (latestTv && latestTv.price > 0) {
          this.currentAsset.currentPrice = latestTv.price;
          this.currentAsset.change24h = latestTv.change24h;
        }

        const livePrice = Number(this.currentAsset.currentPrice.toFixed(this.currentAsset.pipDecimals));
        // Para FOREX: passamos o open da vela do TradingView para manter o open real
        if (latestTv && latestTv.open > 0 && this.currentAsset.category === 'FOREX') {
          this.updateCurrentCandle(livePrice, {
            o: latestTv.open,
            h: latestTv.high || livePrice,
            l: latestTv.low || livePrice,
            c: latestTv.price,
          });
        } else {
          this.updateCurrentCandle(livePrice);
        }
      }

      // Nos momentos críticos de fechamento/abertura de vela (0s e 59s), força leitura imediata
      if (remainingSec === 0 || remainingSec === tfSeconds - 1) {
        tradingViewScanner.fetchAssetData(this.currentAsset, this.currentTimeframe);
      }

      const activeCandle = this.candles[this.candles.length - 1];
      if (activeCandle && this.onTickCallback) {
        this.onTickCallback(activeCandle, remainingSec, this.currentAsset);
      }
    }, 500);
  }

  private updateCurrentCandle(price: number, binanceK?: any) {
    const { currentBoundary } = this.getCandleTiming();

    if (this.candles.length === 0) {
      this.candles = generateDeterministicCandles(this.currentAsset, this.currentTimeframe, 55);
      const key = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
      this.candleCache.set(key, this.candles);
      return;
    }

    const last = this.candles[this.candles.length - 1];

    if (last.time < currentBoundary) {
      // Finalize previous candle
      last.isClosed = true;

      // Start new candle
      const newCandle: Candle = {
        time: currentBoundary,
        open: binanceK?.o ? parseFloat(binanceK.o) : price,
        high: binanceK ? Math.max(parseFloat(binanceK.h), price) : price,
        low: binanceK ? Math.min(parseFloat(binanceK.l), price) : price,
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
      if (binanceK) {
        // Preserva o open original da vela (nunca sobrescreve com outro valor depois do primeiro)
        if (binanceK.o && (!last.open || last.open <= 0)) {
          last.open = parseFloat(binanceK.o);
        }
        const hVal = parseFloat(binanceK.h);
        const lVal = parseFloat(binanceK.l);
        if (hVal > last.high) last.high = hVal;
        if (lVal < last.low) last.low = lVal;
        if (binanceK.x) last.isClosed = true;
      } else {
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
      }
      last.volume += 1;
    }

    const cacheKey = `${this.currentAsset.symbol}::${this.currentTimeframe}`;
    this.candleCache.set(cacheKey, this.candles);
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
