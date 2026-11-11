import { Asset, TimeFrame } from '../types/trading';

export interface LiveTradingViewData {
  symbol: string;
  tvSymbol: string;
  category: 'FOREX' | 'CRYPTO';
  timeframe?: TimeFrame;
  price: number;
  open: number;
  high: number;
  low: number;
  change24h: number;
  recommendation: 'FORTE COMPRA' | 'COMPRA' | 'NEUTRO' | 'VENDA' | 'FORTE VENDA';
  recommendationScore: number; // -1.0 a +1.0
  recommendationMA: number;    // -1.0 a +1.0
  recommendationOther: number; // -1.0 a +1.0
  rsi: number;
  macd: number;
  macdSignal: number;
  stochK: number;
  stochD: number;
  adx?: number;
  atr?: number;
  bbUpper?: number;
  bbLower?: number;
  ema10?: number;
  ema20?: number;
  sma50?: number;
  sma200?: number;
  lastUpdated: number;
}

export type TradingViewUpdateCallback = (data: LiveTradingViewData) => void;

/**
 * Converte o Timeframe ClandeX para o sufixo oficial aceito no TradingView Scanner
 * Ex: M1 -> |1, M5 -> |5, M15 -> |15, M30 -> |30, H1 -> |60, H4 -> |240, D1 -> ''
 */
export function getTimeframeTvSuffix(tf?: TimeFrame): string {
  if (!tf) return '|1';
  switch (tf) {
    case 'M1': return '|1';
    case 'M5': return '|5';
    case 'M15': return '|15';
    case 'M30': return '|30';
    case 'H1': return '|60';
    case 'H4': return '|240';
    case 'D1': return '';
    default: return '|1';
  }
}

class TradingViewScannerService {
  private cache = new Map<string, LiveTradingViewData>();
  private listeners: TradingViewUpdateCallback[] = [];
  private pollInterval: number | null = null;
  private isScanning = false;

  constructor() {
    // Inicialização silenciosa
  }

  /**
   * Converte o score numérico do TradingView (-1.0 a +1.0) para categoria em português
   */
  public parseRecommendation(score: number): 'FORTE COMPRA' | 'COMPRA' | 'NEUTRO' | 'VENDA' | 'FORTE VENDA' {
    if (score >= 0.5) return 'FORTE COMPRA';
    if (score >= 0.1) return 'COMPRA';
    if (score <= -0.5) return 'FORTE VENDA';
    if (score <= -0.1) return 'VENDA';
    return 'NEUTRO';
  }

  /**
   * Obtém a cotação e indicadores mais recentes em cache para o ativo e timeframe
   */
  public getLatest(symbol: string, timeframe?: TimeFrame): LiveTradingViewData | null {
    if (timeframe) {
      const tfKey = `${symbol}::${timeframe}`;
      if (this.cache.has(tfKey)) {
        return this.cache.get(tfKey)!;
      }
    }
    return this.cache.get(symbol) || null;
  }

  public subscribe(cb: TradingViewUpdateCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(data: LiveTradingViewData) {
    for (const cb of this.listeners) {
      try {
        cb(data);
      } catch (err) {
        console.error('[TradingViewScanner] Erro no listener:', err);
      }
    }
  }

  /**
   * Monta a lista oficial de colunas do scanner TradingView para o timeframe desejado
   */
  private buildColumns(timeframe?: TimeFrame): string[] {
    const s = getTimeframeTvSuffix(timeframe);
    return [
      'close',
      'open',
      'high',
      'low',
      'change',
      `Recommend.All${s}`,
      `Recommend.MA${s}`,
      `Recommend.Other${s}`,
      `RSI${s}`,
      `MACD.macd${s}`,
      `MACD.signal${s}`,
      `Stoch.K${s}`,
      `Stoch.D${s}`,
      `ADX${s}`,
      `ATR${s}`,
      `BB.upper${s}`,
      `BB.lower${s}`,
      `EMA10${s}`,
      `EMA20${s}`,
      `SMA50${s}`,
      `SMA200${s}`,
    ];
  }

  /**
   * Busca dados em tempo real diretamente do scanner oficial do TradingView para o ativo e timeframe especificados
   */
  public async fetchAssetData(asset: Asset, timeframe: TimeFrame = 'M1'): Promise<LiveTradingViewData | null> {
    const isCrypto = asset.category === 'CRYPTO';
    const scannerEndpoint = isCrypto
      ? 'https://scanner.tradingview.com/crypto/scan'
      : 'https://scanner.tradingview.com/forex/scan';
    const proxyEndpoint = `/api/tradingview/scan?category=${isCrypto ? 'crypto' : 'forex'}`;

    const columns = this.buildColumns(timeframe);
    const bodyPayload = JSON.stringify({
      symbols: { tickers: [asset.tvSymbol] },
      columns,
    });

    let rawData: any = null;

    // 1. Tenta proxy local (/api/tradingview/scan) primeiro para evitar qualquer problema de CORS
    try {
      const resp = await fetch(proxyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPayload,
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        rawData = await resp.json();
      }
    } catch { }

    // 2. Se falhar, chama o endpoint oficial da TradingView diretamente com text/plain (Bypassa preflight CORS no navegador!)
    if (!rawData || !rawData.data || rawData.data.length === 0) {
      try {
        const resp = await fetch(scannerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: bodyPayload,
          signal: AbortSignal.timeout(4000),
        });
        if (resp.ok) {
          rawData = await resp.json();
        }
      } catch (err) {
        console.warn(`[TradingViewScanner] Falha ao escanear ${asset.tvSymbol}:`, err);
      }
    }

    if (!rawData || !Array.isArray(rawData.data) || rawData.data.length === 0) {
      return this.getLatest(asset.symbol, timeframe);
    }

    const row = rawData.data[0];
    if (!row || !Array.isArray(row.d) || row.d.length < 5) {
      return this.getLatest(asset.symbol, timeframe);
    }

    const d = row.d;
    const price = Number(parseFloat(d[0]).toFixed(asset.pipDecimals));
    const open = Number(parseFloat(d[1] ?? d[0]).toFixed(asset.pipDecimals));
    const high = Number(parseFloat(d[2] ?? d[0]).toFixed(asset.pipDecimals));
    const low = Number(parseFloat(d[3] ?? d[0]).toFixed(asset.pipDecimals));
    const change24h = Number(parseFloat(d[4] ?? 0).toFixed(2));
    const recommendScore = Number(d[5] ?? 0);
    const recommendMA = Number(d[6] ?? 0);
    const recommendOther = Number(d[7] ?? 0);
    const rsi = Math.round(Number(d[8] ?? 50));
    const macd = Number(d[9] ?? 0);
    const macdSignal = Number(d[10] ?? 0);
    const stochK = Math.round(Number(d[11] ?? 50));
    const stochD = Math.round(Number(d[12] ?? 50));
    const adx = d[13] !== null && d[13] !== undefined ? Number(Number(d[13]).toFixed(1)) : undefined;
    const atr = d[14] !== null && d[14] !== undefined ? Number(d[14]) : undefined;
    const bbUpper = d[15] !== null && d[15] !== undefined ? Number(d[15]) : undefined;
    const bbLower = d[16] !== null && d[16] !== undefined ? Number(d[16]) : undefined;
    const ema10 = d[17] !== null && d[17] !== undefined ? Number(d[17]) : undefined;
    const ema20 = d[18] !== null && d[18] !== undefined ? Number(d[18]) : undefined;
    const sma50 = d[19] !== null && d[19] !== undefined ? Number(d[19]) : undefined;
    const sma200 = d[20] !== null && d[20] !== undefined ? Number(d[20]) : undefined;

    const item: LiveTradingViewData = {
      symbol: asset.symbol,
      tvSymbol: asset.tvSymbol,
      category: asset.category,
      timeframe,
      price,
      open,
      high,
      low,
      change24h,
      recommendation: this.parseRecommendation(recommendScore),
      recommendationScore: recommendScore,
      recommendationMA: recommendMA,
      recommendationOther: recommendOther,
      rsi,
      macd,
      macdSignal,
      stochK,
      stochD,
      adx,
      atr,
      bbUpper,
      bbLower,
      ema10,
      ema20,
      sma50,
      sma200,
      lastUpdated: Date.now(),
    };

    this.cache.set(asset.symbol, item);
    this.cache.set(`${asset.symbol}::${timeframe}`, item);
    this.notify(item);
    return item;
  }

  /**
   * Escaneia todos os ativos configurados em uma única requisição em lote para alta performance
   */
  public async scanAllAssets(assets: Asset[], timeframe: TimeFrame = 'M1'): Promise<Map<string, LiveTradingViewData>> {
    const forexAssets = assets.filter((a) => a.category === 'FOREX');
    const cryptoAssets = assets.filter((a) => a.category === 'CRYPTO');
    const columns = this.buildColumns(timeframe);

    const fetchCategory = async (cat: 'forex' | 'crypto', list: Asset[]) => {
      if (list.length === 0) return;
      const tickers = list.map((a) => a.tvSymbol);
      const endpoint = cat === 'crypto'
        ? 'https://scanner.tradingview.com/crypto/scan'
        : 'https://scanner.tradingview.com/forex/scan';
      const proxy = `/api/tradingview/scan?category=${cat}`;

      const payload = JSON.stringify({
        symbols: { tickers },
        columns,
      });

      let rawData: any = null;
      try {
        const resp = await fetch(proxy, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) rawData = await resp.json();
      } catch { }

      if (!rawData || !rawData.data) {
        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: payload,
            signal: AbortSignal.timeout(4000),
          });
          if (resp.ok) rawData = await resp.json();
        } catch { }
      }

      if (rawData && Array.isArray(rawData.data)) {
        for (const row of rawData.data) {
          const assetMatch = list.find((a) => a.tvSymbol === row.s);
          if (assetMatch && Array.isArray(row.d)) {
            const d = row.d;
            const price = Number(parseFloat(d[0]).toFixed(assetMatch.pipDecimals));
            const open = Number(parseFloat(d[1] ?? d[0]).toFixed(assetMatch.pipDecimals));
            const high = Number(parseFloat(d[2] ?? d[0]).toFixed(assetMatch.pipDecimals));
            const low = Number(parseFloat(d[3] ?? d[0]).toFixed(assetMatch.pipDecimals));
            const change24h = Number(parseFloat(d[4] ?? 0).toFixed(2));
            const recommendScore = Number(d[5] ?? 0);
            const recommendMA = Number(d[6] ?? 0);
            const recommendOther = Number(d[7] ?? 0);
            const rsi = Math.round(Number(d[8] ?? 50));
            const macd = Number(d[9] ?? 0);
            const macdSignal = Number(d[10] ?? 0);
            const stochK = Math.round(Number(d[11] ?? 50));
            const stochD = Math.round(Number(d[12] ?? 50));
            const adx = d[13] !== null && d[13] !== undefined ? Number(Number(d[13]).toFixed(1)) : undefined;
            const atr = d[14] !== null && d[14] !== undefined ? Number(d[14]) : undefined;
            const bbUpper = d[15] !== null && d[15] !== undefined ? Number(d[15]) : undefined;
            const bbLower = d[16] !== null && d[16] !== undefined ? Number(d[16]) : undefined;
            const ema10 = d[17] !== null && d[17] !== undefined ? Number(d[17]) : undefined;
            const ema20 = d[18] !== null && d[18] !== undefined ? Number(d[18]) : undefined;
            const sma50 = d[19] !== null && d[19] !== undefined ? Number(d[19]) : undefined;
            const sma200 = d[20] !== null && d[20] !== undefined ? Number(d[20]) : undefined;

            const item: LiveTradingViewData = {
              symbol: assetMatch.symbol,
              tvSymbol: assetMatch.tvSymbol,
              category: assetMatch.category,
              timeframe,
              price,
              open,
              high,
              low,
              change24h,
              recommendation: this.parseRecommendation(recommendScore),
              recommendationScore: recommendScore,
              recommendationMA: recommendMA,
              recommendationOther: recommendOther,
              rsi,
              macd,
              macdSignal,
              stochK,
              stochD,
              adx,
              atr,
              bbUpper,
              bbLower,
              ema10,
              ema20,
              sma50,
              sma200,
              lastUpdated: Date.now(),
            };

            this.cache.set(assetMatch.symbol, item);
            this.cache.set(`${assetMatch.symbol}::${timeframe}`, item);
            this.notify(item);
          }
        }
      }
    };

    await Promise.all([
      fetchCategory('forex', forexAssets),
      fetchCategory('crypto', cryptoAssets),
    ]);

    return this.cache;
  }

  /**
   * Inicia o monitoramento contínuo em background (a cada 2.5 segundos para ultra-precisão)
   */
  public startBackgroundPolling(
    getCurrentAsset: () => Asset,
    getAllAssets: () => Asset[],
    getCurrentTimeframe: () => TimeFrame = () => 'M1'
  ) {
    if (this.pollInterval) return;

    let cycleCount = 0;
    const runCycle = async () => {
      if (this.isScanning) return;
      this.isScanning = true;
      try {
        const current = getCurrentAsset();
        const tf = getCurrentTimeframe();
        if (current) {
          await this.fetchAssetData(current, tf);
        }

        // A cada 4 ciclos (~10s), atualiza todos os outros ativos em lote no timeframe atual
        cycleCount++;
        if (cycleCount % 4 === 0) {
          const all = getAllAssets();
          await this.scanAllAssets(all, tf);
        }
      } catch (err) {
        console.error('[TradingViewScanner] Erro no ciclo:', err);
      } finally {
        this.isScanning = false;
      }
    };

    // Executa imediatamente o primeiro ciclo
    runCycle();
    this.pollInterval = window.setInterval(runCycle, 1500);
  }

  public stopBackgroundPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const tradingViewScanner = new TradingViewScannerService();
