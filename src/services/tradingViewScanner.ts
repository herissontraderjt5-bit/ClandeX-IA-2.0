import { Asset } from '../types/trading';

export interface LiveTradingViewData {
  symbol: string;
  tvSymbol: string;
  category: 'FOREX' | 'CRYPTO';
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
  lastUpdated: number;
}

export type TradingViewUpdateCallback = (data: LiveTradingViewData) => void;

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
   * Obtém a cotação e indicadores mais recentes em cache para o ativo
   */
  public getLatest(symbol: string): LiveTradingViewData | null {
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
   * Busca dados em tempo real diretamente do scanner oficial do TradingView
   */
  public async fetchAssetData(asset: Asset): Promise<LiveTradingViewData | null> {
    const isCrypto = asset.category === 'CRYPTO';
    const scannerEndpoint = isCrypto
      ? 'https://scanner.tradingview.com/crypto/scan'
      : 'https://scanner.tradingview.com/forex/scan';
    const proxyEndpoint = `/api/tradingview/scan?category=${isCrypto ? 'crypto' : 'forex'}`;

    const bodyPayload = JSON.stringify({
      symbols: { tickers: [asset.tvSymbol] },
      columns: [
        'close',
        'open',
        'high',
        'low',
        'change',
        'Recommend.All',
        'Recommend.MA',
        'Recommend.Other',
        'RSI',
        'MACD.macd',
        'MACD.signal',
        'Stoch.K',
        'Stoch.D',
      ],
    });

    let rawData: any = null;

    // 1. Tenta proxy local (/api/tradingview/scan) primeiro para evitar qualquer problema de CORS
    try {
      const resp = await fetch(proxyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPayload,
      });
      if (resp.ok) {
        rawData = await resp.json();
      }
    } catch {}

    // 2. Se falhar, chama o endpoint oficial da TradingView diretamente (suporta CORS no navegador)
    if (!rawData || !rawData.data || rawData.data.length === 0) {
      try {
        const resp = await fetch(scannerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyPayload,
        });
        if (resp.ok) {
          rawData = await resp.json();
        }
      } catch (err) {
        console.warn(`[TradingViewScanner] Falha ao escanear ${asset.tvSymbol}:`, err);
      }
    }

    if (!rawData || !Array.isArray(rawData.data) || rawData.data.length === 0) {
      return this.cache.get(asset.symbol) || null;
    }

    const row = rawData.data[0];
    if (!row || !Array.isArray(row.d) || row.d.length < 5) {
      return this.cache.get(asset.symbol) || null;
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

    const item: LiveTradingViewData = {
      symbol: asset.symbol,
      tvSymbol: asset.tvSymbol,
      category: asset.category,
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
      lastUpdated: Date.now(),
    };

    this.cache.set(asset.symbol, item);
    this.notify(item);
    return item;
  }

  /**
   * Escaneia todos os ativos configurados em uma única requisição em lote para alta performance
   */
  public async scanAllAssets(assets: Asset[]): Promise<Map<string, LiveTradingViewData>> {
    const forexAssets = assets.filter((a) => a.category === 'FOREX');
    const cryptoAssets = assets.filter((a) => a.category === 'CRYPTO');

    const fetchCategory = async (cat: 'forex' | 'crypto', list: Asset[]) => {
      if (list.length === 0) return;
      const tickers = list.map((a) => a.tvSymbol);
      const endpoint = cat === 'crypto'
        ? 'https://scanner.tradingview.com/crypto/scan'
        : 'https://scanner.tradingview.com/forex/scan';
      const proxy = `/api/tradingview/scan?category=${cat}`;

      const payload = JSON.stringify({
        symbols: { tickers },
        columns: [
          'close',
          'open',
          'high',
          'low',
          'change',
          'Recommend.All',
          'Recommend.MA',
          'Recommend.Other',
          'RSI',
          'MACD.macd',
          'MACD.signal',
          'Stoch.K',
          'Stoch.D',
        ],
      });

      let rawData: any = null;
      try {
        const resp = await fetch(proxy, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (resp.ok) rawData = await resp.json();
      } catch {}

      if (!rawData || !rawData.data) {
        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });
          if (resp.ok) rawData = await resp.json();
        } catch {}
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

            const item: LiveTradingViewData = {
              symbol: assetMatch.symbol,
              tvSymbol: assetMatch.tvSymbol,
              category: assetMatch.category,
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
              lastUpdated: Date.now(),
            };

            this.cache.set(assetMatch.symbol, item);
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
   * Inicia o monitoramento contínuo em background (a cada 3.5 segundos)
   */
  public startBackgroundPolling(getCurrentAsset: () => Asset, getAllAssets: () => Asset[]) {
    if (this.pollInterval) return;

    let cycleCount = 0;
    const runCycle = async () => {
      if (this.isScanning) return;
      this.isScanning = true;
      try {
        const current = getCurrentAsset();
        if (current) {
          await this.fetchAssetData(current);
        }

        // A cada 3 ciclos (~10s), atualiza todos os outros ativos em lote
        cycleCount++;
        if (cycleCount % 3 === 0) {
          const all = getAllAssets();
          await this.scanAllAssets(all);
        }
      } catch (err) {
        console.error('[TradingViewScanner] Erro no ciclo:', err);
      } finally {
        this.isScanning = false;
      }
    };

    // Executa imediatamente o primeiro ciclo
    runCycle();
    this.pollInterval = window.setInterval(runCycle, 3500);
  }

  public stopBackgroundPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const tradingViewScanner = new TradingViewScannerService();
