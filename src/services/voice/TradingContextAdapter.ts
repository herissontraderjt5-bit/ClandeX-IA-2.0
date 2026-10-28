import {
  Asset,
  Candle,
  ConfluenceBreakdown,
  MarketAnalysis,
  SignalRecord,
  TimeFrame,
} from '../../types/trading';
import { marketDataManager, isForexMarketOpen } from '../marketData';
import { analyzeMarket, calculateConfluences } from '../analysisEngine';
import { signalEngine } from '../signalEngine';
import { getRelevantEconomicEvents, getRealMarketNews } from '../economicCalendar';

export interface TradingContextContract {
  getCurrentAsset(): Asset;
  getCurrentTimeframe(): TimeFrame;
  getMarketAnalysis(): MarketAnalysis;
  getCurrentSignal(): SignalRecord | null;
  getSignalExplanation(): string;
  getMarketDataTimestamp(): number;
}

export class TradingContextAdapter implements TradingContextContract {
  private currentTimeframe: TimeFrame = 'M1';
  private cachedAnalysis: MarketAnalysis | null = null;
  private cachedConfluences: ConfluenceBreakdown | null = null;

  public setTimeframe(tf: TimeFrame) {
    this.currentTimeframe = tf;
  }

  public setAnalysis(analysis: MarketAnalysis, confluences: ConfluenceBreakdown) {
    this.cachedAnalysis = analysis;
    this.cachedConfluences = confluences;
  }

  /**
   * Retorna o ativo atualmente selecionado na plataforma
   */
  public getCurrentAsset(): Asset {
    return marketDataManager.getCurrentAsset();
  }

  /**
   * Retorna o timeframe atual configurado no painel
   */
  public getCurrentTimeframe(): TimeFrame {
    return this.currentTimeframe;
  }

  /**
   * Retorna os dados da análise técnica atual
   */
  public getMarketAnalysis(): MarketAnalysis {
    if (this.cachedAnalysis) return this.cachedAnalysis;
    const candles = marketDataManager.getCandles();
    return analyzeMarket(candles);
  }

  /**
   * Retorna o sinal ativo (operação pendente, pré-alerta ou último confirmado)
   */
  public getCurrentSignal(): SignalRecord | null {
    const activeTrade = signalEngine.getActiveTrade();
    if (activeTrade) return activeTrade;

    const preAlert = signalEngine.getActivePreAlert();
    if (preAlert) return preAlert;

    const confirmed = signalEngine.getLatestConfirmedSignal();
    if (confirmed) return confirmed;

    return null;
  }

  /**
   * Explica o sinal atual e as confluências técnicas em linguagem natural
   */
  public getSignalExplanation(): string {
    const sig = this.getCurrentSignal();
    const asset = this.getCurrentAsset();
    const analysis = this.getMarketAnalysis();
    const confluences = this.cachedConfluences;

    if (sig) {
      const dir = sig.direction === 'CALL' ? 'COMPRA (CALL)' : 'VENDA (PUT)';
      const reasonsStr = sig.reasons && sig.reasons.length > 0 ? sig.reasons.join(', ') : 'Gatilho institucional';
      return `Sinal ativo de ${dir} no par ${sig.asset} no timeframe ${sig.timeframe}. Confluência de ${sig.confluenceScore}%. Motivos: ${reasonsStr}. Preço de entrada: ${sig.entryPrice}.`;
    }

    if (confluences) {
      const dir = confluences.direction === 'CALL' ? 'COMPRA' : confluences.direction === 'PUT' ? 'VENDA' : 'NEUTRO';
      const reasonsStr = confluences.reasons.length > 0 ? confluences.reasons.slice(0, 3).join(', ') : 'Aguardando confluências';
      return `Ativo ${asset.symbol} cotado a ${asset.currentPrice}. Tendência de ${analysis.trend} com confluência de ${confluences.totalScore}% para ${dir}. Fatores ativos: ${reasonsStr}.`;
    }

    return `Ativo ${asset.symbol} cotado a ${asset.currentPrice}. Tendência ${analysis.trend}. Sem sinal ativo no momento.`;
  }

  /**
   * Retorna o timestamp dos dados de mercado mais recentes
   */
  public getMarketDataTimestamp(): number {
    const candles = marketDataManager.getCandles();
    if (candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      return (lastCandle as any).timestamp || (lastCandle.time ? lastCandle.time * 1000 : Date.now());
    }
    return Date.now();
  }

  /**
   * Retorna um resumo contextual completo em tempo real para ser injetado no prompt da IA
   */
  public getContextSummary(): string {
    const asset = this.getCurrentAsset();
    const tf = this.getCurrentTimeframe();
    const analysis = this.getMarketAnalysis();
    const signal = this.getCurrentSignal();
    const isClosedWeekendForex = asset.category === 'FOREX' && !isForexMarketOpen();
    const { upcomingHighImpact } = getRelevantEconomicEvents(asset.symbol);
    const realNews = getRealMarketNews(asset.symbol);
    const dir = this.cachedConfluences?.direction === 'CALL' ? 'COMPRA' : this.cachedConfluences?.direction === 'PUT' ? 'VENDA' : 'NEUTRO';
    const score = this.cachedConfluences?.totalScore ?? 0;

    const keyLevels = analysis.keyLevels || [];
    const supports = keyLevels.filter((k) => k.type === 'SUPPORT').map((k) => k.price.toFixed(asset.pipDecimals));
    const resistances = keyLevels.filter((k) => k.type === 'RESISTANCE').map((k) => k.price.toFixed(asset.pipDecimals));

    let summary = `DADOS REAIS DO CANDLEX-IA NO PAINEL:
- Ativo Selecionado: ${asset.symbol} (${asset.name})
- Preço Atual: ${asset.currentPrice.toFixed(asset.pipDecimals)}
- Timeframe Atual: ${tf}
- Status do Mercado: ${isClosedWeekendForex ? 'FECHADO FIM DE SEMANA (Forex fechado, recomende Criptomoedas como Bitcoin)' : 'ABERTO EM TEMPO REAL'}
- Tendência Principal: ${analysis.trend}
- Força Compradora: ${analysis.buyerStrength} | Força Vendedora: ${analysis.sellerStrength}
- Suportes Técnicos: ${supports.length > 0 ? supports.join(', ') : 'Zonas dinâmicas'}
- Resistências Técnicas: ${resistances.length > 0 ? resistances.join(', ') : 'Zonas dinâmicas'}
- Confluência do Robô: ${score}% para ${dir}`;

    if (signal) {
      summary += `\n- SINAL EM ANDAMENTO: ${signal.direction} em ${signal.asset} com ${signal.confluenceScore}% de confluência (Preço Entrada: ${signal.entryPrice})`;
    } else {
      summary += `\n- SINAL: Nenhum sinal confirmado no momento. ${score >= 60 ? 'Oportunidade em observação' : 'Mercado em consolidação ou ruído'}.`;
    }

    if (upcomingHighImpact) {
      summary += `\n- Próxima Notícia: ${upcomingHighImpact.event} (${upcomingHighImpact.currency}) às ${upcomingHighImpact.time}`;
    }

    return summary;
  }
}

export const tradingContextAdapter = new TradingContextAdapter();
