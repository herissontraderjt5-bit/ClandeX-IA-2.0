import React, { useMemo } from 'react';
import { Asset, Candle, MarketAnalysis, SignalRecord, TimeFrame } from '../types/trading';
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, Target, Shield } from 'lucide-react';

interface CandleChartProps {
  candles: Candle[];
  asset: Asset;
  timeframe: TimeFrame;
  marketAnalysis: MarketAnalysis;
  recentSignals: SignalRecord[];
  activePreAlert: SignalRecord | null;
}

export const CandleChart: React.FC<CandleChartProps> = ({
  candles,
  asset,
  timeframe,
  marketAnalysis,
  recentSignals,
  activePreAlert,
}) => {
  // Chart dimensions
  const chartHeight = 380;
  const chartWidth = 920;
  const paddingRight = 75;
  const paddingBottom = 30;
  const paddingTop = 25;
  const paddingLeft = 15;

  const visibleCandles = useMemo(() => {
    return candles.slice(-45); // show last 45 candles
  }, [candles]);

  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    if (visibleCandles.length > 0) {
      visibleCandles.forEach((c) => {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
      });
    } else {
      const base = Number.isFinite(asset.currentPrice) ? asset.currentPrice : 1.0;
      min = base * 0.999;
      max = base * 1.001;
    }

    const diff = (max > min && Number.isFinite(max - min)) ? (max - min) : 0.001;
    const buffer = diff * 0.08;
    const safeMin = min - buffer;
    const safeMax = max + buffer;
    const safeRange = (safeMax > safeMin && Number.isFinite(safeMax - safeMin)) ? (safeMax - safeMin) : 0.001;

    return {
      minPrice: safeMin,
      maxPrice: safeMax,
      priceRange: safeRange,
    };
  }, [visibleCandles, asset.currentPrice]);

  // Coordinate transforms
  const getY = (price: number): number => {
    const usableHeight = chartHeight - paddingTop - paddingBottom;
    const safePrice = Number.isFinite(price) ? price : (Number.isFinite(asset.currentPrice) ? asset.currentPrice : 1.0);
    const safeRange = (priceRange > 0 && Number.isFinite(priceRange)) ? priceRange : 1;
    const ratio = (safePrice - minPrice) / safeRange;
    const val = chartHeight - paddingBottom - ratio * usableHeight;
    return Number.isFinite(val) ? val : (chartHeight / 2);
  };

  const candleSpacing = (chartWidth - paddingLeft - paddingRight) / Math.max(visibleCandles.length, 1);
  const candleBodyWidth = Math.max(4, candleSpacing * 0.65);

  // Grid price levels
  const gridLevels = useMemo(() => {
    const steps = 5;
    const levels: number[] = [];
    const stepSize = priceRange / steps;
    for (let i = 0; i <= steps; i++) {
      levels.push(minPrice + i * stepSize);
    }
    return levels;
  }, [minPrice, priceRange]);

  const currentPrice = asset.currentPrice;
  const currentY = getY(currentPrice);

  return (
    <div className="relative w-full bg-neutral-900/60 border border-neutral-800/80 rounded-2xl overflow-hidden backdrop-blur-md">
      {/* Chart Top Stats Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-neutral-900/90 border-b border-neutral-800/80 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-wide text-white">{asset.symbol}</span>
            <span className="text-[11px] font-mono text-cyan-400 font-semibold px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">
              {timeframe}
            </span>
          </div>

          <div className="flex items-center gap-2 text-neutral-400 font-mono text-[11px]">
            <span>O: <strong className="text-neutral-200">{visibleCandles[visibleCandles.length - 1]?.open.toFixed(asset.pipDecimals)}</strong></span>
            <span>H: <strong className="text-neutral-200">{visibleCandles[visibleCandles.length - 1]?.high.toFixed(asset.pipDecimals)}</strong></span>
            <span>L: <strong className="text-neutral-200">{visibleCandles[visibleCandles.length - 1]?.low.toFixed(asset.pipDecimals)}</strong></span>
            <span>C: <strong className="text-neutral-200">{visibleCandles[visibleCandles.length - 1]?.close.toFixed(asset.pipDecimals)}</strong></span>
          </div>
        </div>

        {/* Confluence Quick Indicators */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          {marketAnalysis.activeOrderBlock && (
            <div className="flex items-center gap-1 text-cyan-400">
              <Target className="w-3 h-3" />
              <span>OB {marketAnalysis.activeOrderBlock.type}</span>
            </div>
          )}
          {marketAnalysis.bos && (
            <div className="text-amber-400 font-bold">BOS Ativo</div>
          )}
          {marketAnalysis.choch && (
            <div className="text-purple-400 font-bold">CHoCH Detectado</div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Payout Hiove:</span>
            <span className="text-emerald-400 font-bold">{asset.hiovePayoutPercent}%</span>
          </div>
        </div>
      </div>

      {/* SVG Candlestick Canvas */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-[320px] md:h-[380px] block"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {gridLevels.map((lvl, idx) => {
            const y = getY(lvl);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="#262626"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text
                  x={chartWidth - paddingRight + 8}
                  y={y + 3}
                  fill="#737373"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {lvl.toFixed(asset.pipDecimals)}
                </text>
              </g>
            );
          })}

          {/* Smart Money Concepts: Active Order Block Zone */}
          {marketAnalysis.activeOrderBlock && (
            <g>
              <rect
                x={paddingLeft}
                y={Math.min(getY(marketAnalysis.activeOrderBlock.high), getY(marketAnalysis.activeOrderBlock.low))}
                width={chartWidth - paddingLeft - paddingRight}
                height={Math.max(4, Math.abs(getY(marketAnalysis.activeOrderBlock.high) - getY(marketAnalysis.activeOrderBlock.low)))}
                fill={marketAnalysis.activeOrderBlock.type === 'BULLISH' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)'}
                stroke={marketAnalysis.activeOrderBlock.type === 'BULLISH' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}
                strokeDasharray="4 2"
                strokeWidth="1"
              />
              <text
                x={paddingLeft + 10}
                y={getY(marketAnalysis.activeOrderBlock.high) - 4}
                fill={marketAnalysis.activeOrderBlock.type === 'BULLISH' ? '#4ade80' : '#f87171'}
                fontSize="9"
                fontWeight="bold"
                fontFamily="JetBrains Mono, monospace"
              >
                ORDER BLOCK {marketAnalysis.activeOrderBlock.type}
              </text>
            </g>
          )}

          {/* Key Support and Resistance Horizontal Markers */}
          {marketAnalysis.keyLevels.slice(0, 3).map((lvl, i) => {
            const y = getY(lvl.price);
            if (y < paddingTop || y > chartHeight - paddingBottom) return null;
            return (
              <g key={`lvl_${i}`}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke={lvl.type === 'SUPPORT' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(244, 63, 94, 0.4)'}
                  strokeWidth="1"
                  strokeDasharray="6 3"
                />
                <text
                  x={paddingLeft + 6}
                  y={y - 3}
                  fill={lvl.type === 'SUPPORT' ? '#38bdf8' : '#fb7185'}
                  fontSize="8"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {lvl.type === 'SUPPORT' ? 'ZONA SUPORTE' : 'ZONA RESISTÊNCIA'}
                </text>
              </g>
            );
          })}

          {/* Render Candles */}
          {visibleCandles.map((c, i) => {
            const xCenter = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const isBullish = c.close >= c.open;
            const topBody = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

            const candleColor = isBullish ? '#10b981' : '#ef4444';
            const wickColor = isBullish ? '#34d399' : '#f87171';

            return (
              <g key={c.time || i}>
                {/* Wick */}
                <line
                  x1={xCenter}
                  y1={yHigh}
                  x2={xCenter}
                  y2={yLow}
                  stroke={wickColor}
                  strokeWidth="1.2"
                />
                {/* Body */}
                <rect
                  x={xCenter - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  rx="1"
                />
              </g>
            );
          })}

          {/* Signal markers on chart */}
          {recentSignals.slice(0, 5).map((sig) => {
            // Find candle matching time
            const idx = visibleCandles.findIndex((c) => Math.abs(c.time - sig.candleCloseTime) < 120);
            if (idx === -1) return null;
            const x = paddingLeft + idx * candleSpacing + candleSpacing / 2;
            const y = getY(sig.entryPrice);
            const isCall = sig.direction === 'CALL';

            return (
              <g key={sig.id} className="animate-bounce">
                <circle
                  cx={x}
                  cy={isCall ? y + 18 : y - 18}
                  r="10"
                  fill={isCall ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)'}
                />
                <text
                  x={x}
                  y={isCall ? y + 22 : y - 14}
                  fill="#ffffff"
                  fontSize="9"
                  fontWeight="bold"
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {isCall ? '▲' : '▼'}
                </text>
              </g>
            );
          })}

          {/* Current Live Price Line & Badge */}
          <line
            x1={paddingLeft}
            y1={currentY}
            x2={chartWidth - paddingRight}
            y2={currentY}
            stroke="#00e5ff"
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
          <g>
            <rect
              x={chartWidth - paddingRight + 2}
              y={currentY - 9}
              width={70}
              height={18}
              fill="#06b6d4"
              rx="4"
            />
            <text
              x={chartWidth - paddingRight + 37}
              y={currentY + 3.5}
              fill="#020617"
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {currentPrice.toFixed(asset.pipDecimals)}
            </text>
          </g>
        </svg>
      </div>

      {/* Chart Footer with Active SMC Analysis Summary */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-neutral-950/60 border-t border-neutral-800/80 text-[11px] text-neutral-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Fluxo Comprador: <strong>{marketAnalysis.buyerStrength}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Fluxo Vendedor: <strong>{marketAnalysis.sellerStrength}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400">ATR:</span>
            <span className="font-mono text-neutral-300">{marketAnalysis.atr.toFixed(asset.pipDecimals)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-neutral-500">Última atualização:</span>
          <span className="text-neutral-300">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
};
