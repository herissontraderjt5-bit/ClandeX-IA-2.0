import React, { useMemo } from 'react';
import { Asset, Candle, TimeFrame } from '../types/trading';

interface LiveLevelChartProps {
  candles: Candle[];
  asset: Asset;
  timeframe: TimeFrame;
  currentPrice: number;
  resistance: number; // Topo
  support: number;    // Fundo
  height?: number;
}

export const LiveLevelChart: React.FC<LiveLevelChartProps> = ({
  candles,
  asset,
  timeframe,
  currentPrice,
  resistance,
  support,
  height = 340,
}) => {
  const chartWidth = 900;
  const paddingRight = 95;
  const paddingLeft = 10;
  const paddingTop = 25;
  const paddingBottom = 25;

  // Usa as últimas 45 velas para visualização nítida
  const visibleCandles = useMemo(() => {
    return candles && candles.length > 0 ? candles.slice(-45) : [];
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
      const base = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 1.0;
      min = base * 0.998;
      max = base * 1.002;
    }

    if (Number.isFinite(resistance) && resistance > 0) max = Math.max(max, resistance);
    if (Number.isFinite(support) && support > 0) min = Math.min(min, support);
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      max = Math.max(max, currentPrice);
      min = Math.min(min, currentPrice);
    }

    const diff = max > min ? max - min : 0.001;
    const buffer = diff * 0.08;
    const safeMin = min - buffer;
    const safeMax = max + buffer;
    const safeRange = safeMax > safeMin ? safeMax - safeMin : 0.001;

    return {
      minPrice: safeMin,
      maxPrice: safeMax,
      priceRange: safeRange,
    };
  }, [visibleCandles, currentPrice, resistance, support]);

  // Transforma preço em coordenada Y do SVG
  const getY = (price: number): number => {
    const usableHeight = height - paddingTop - paddingBottom;
    if (priceRange <= 0) return height / 2;
    const ratio = (price - minPrice) / priceRange;
    const val = height - paddingBottom - ratio * usableHeight;
    return Math.max(paddingTop - 5, Math.min(height - paddingBottom + 5, val));
  };

  const candleSpacing = (chartWidth - paddingLeft - paddingRight) / Math.max(visibleCandles.length, 1);
  const candleBodyWidth = Math.max(4, candleSpacing * 0.65);

  const decimals = asset.pipDecimals || (asset.category === 'CRYPTO' ? 2 : 5);

  const currentY = getY(currentPrice);
  const rY = getY(resistance);
  const sY = getY(support);

  return (
    <div className="w-full bg-[#070a12] border-2 border-neutral-800 rounded-2xl overflow-hidden shadow-2xl relative select-none font-mono">
      {/* Top Banner do Gráfico */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-neutral-950/90 border-b border-neutral-800/80 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="font-black text-white">{asset.symbol}</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {timeframe}
          </span>
          <span className="text-neutral-400 hidden sm:inline">
            • Marcações Exclusivas de Topo e Fundo
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-rose-400 font-bold">
            <span className="w-2.5 h-1 bg-rose-500 inline-block rounded-full" />
            <span>TOPO: {resistance.toFixed(decimals)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <span className="w-2.5 h-1 bg-emerald-500 inline-block rounded-full" />
            <span>FUNDO: {support.toFixed(decimals)}</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas com Velas e Linhas de Suporte e Resistência */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full block"
          style={{ height: `${height}px` }}
          preserveAspectRatio="none"
        >
          {/* Linhas de Grade Sutis */}
          {[0.25, 0.5, 0.75].map((ratio, idx) => {
            const y = paddingTop + ratio * (height - paddingTop - paddingBottom);
            return (
              <line
                key={`grid_${idx}`}
                x1={paddingLeft}
                y1={y}
                x2={chartWidth - paddingRight}
                y2={y}
                stroke="#171923"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
            );
          })}

          {/* 🔴 LINHA DE RESISTÊNCIA (TOPO REAL) */}
          {Number.isFinite(rY) && (
            <g className="transition-all duration-300">
              {/* Brilho da Linha */}
              <line
                x1={paddingLeft}
                y1={rY}
                x2={chartWidth - paddingRight}
                y2={rY}
                stroke="#f43f5e"
                strokeWidth="5"
                opacity="0.25"
              />
              {/* Linha Principal Tracejada */}
              <line
                x1={paddingLeft}
                y1={rY}
                x2={chartWidth - paddingRight}
                y2={rY}
                stroke="#f43f5e"
                strokeWidth="2"
                strokeDasharray="6 3"
              />
              {/* Badge com Cotação do Topo na régua */}
              <rect
                x={chartWidth - paddingRight + 2}
                y={rY - 10}
                width={paddingRight - 4}
                height={20}
                fill="#e11d48"
                stroke="#ffe4e6"
                strokeWidth="1.2"
                rx="4"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={rY + 3.5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                TOPO {resistance.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* 🟢 LINHA DE SUPORTE (FUNDO REAL) */}
          {Number.isFinite(sY) && (
            <g className="transition-all duration-300">
              {/* Brilho da Linha */}
              <line
                x1={paddingLeft}
                y1={sY}
                x2={chartWidth - paddingRight}
                y2={sY}
                stroke="#10b981"
                strokeWidth="5"
                opacity="0.25"
              />
              {/* Linha Principal Tracejada */}
              <line
                x1={paddingLeft}
                y1={sY}
                x2={chartWidth - paddingRight}
                y2={sY}
                stroke="#10b981"
                strokeWidth="2"
                strokeDasharray="6 3"
              />
              {/* Badge com Cotação do Fundo na régua */}
              <rect
                x={chartWidth - paddingRight + 2}
                y={sY - 10}
                width={paddingRight - 4}
                height={20}
                fill="#059669"
                stroke="#d1fae5"
                strokeWidth="1.2"
                rx="4"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={sY + 3.5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                FUNDO {support.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* Renderização das Velas Japonesas Reais */}
          {visibleCandles.map((c, i) => {
            const xCenter = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const isBullish = c.close >= c.open;
            const topBody = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

            const candleColor = isBullish ? '#10b981' : '#f43f5e';
            const wickColor = isBullish ? '#34d399' : '#fb7185';

            return (
              <g key={c.time || i}>
                {/* Pavio (Wick) */}
                <line
                  x1={xCenter}
                  y1={yHigh}
                  x2={xCenter}
                  y2={yLow}
                  stroke={wickColor}
                  strokeWidth="1.5"
                />
                {/* Corpo (Body) */}
                <rect
                  x={xCenter - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  stroke={wickColor}
                  strokeWidth="0.5"
                  rx="1"
                />
              </g>
            );
          })}

          {/* ⚡ LINHA DE COTAÇÃO ATUAL (AO VIVO) */}
          {Number.isFinite(currentY) && (
            <g className="transition-all duration-150">
              <line
                x1={paddingLeft}
                y1={currentY}
                x2={chartWidth - paddingRight}
                y2={currentY}
                stroke="#06b6d4"
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
              <circle
                cx={chartWidth - paddingRight}
                cy={currentY}
                r="3.5"
                fill="#06b6d4"
                className="animate-ping"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={currentY - 9}
                width={paddingRight - 4}
                height={18}
                fill="#083344"
                stroke="#06b6d4"
                strokeWidth="1.2"
                rx="4"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={currentY + 3.5}
                fill="#22d3ee"
                fontSize="9"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                ● {currentPrice.toFixed(decimals)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
