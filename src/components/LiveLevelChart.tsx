import React, { useMemo } from 'react';
import { Asset, Candle, TimeFrame } from '../types/trading';

interface LiveLevelChartProps {
  candles: Candle[];
  asset: Asset;
  timeframe: TimeFrame;
  currentPrice: number;
  resistance1: number;
  resistance2?: number;
  support1: number;
  support2?: number;
  tops?: { price: number; index: number }[];
  bottoms?: { price: number; index: number }[];
  height?: number;
}

export const LiveLevelChart: React.FC<LiveLevelChartProps> = ({
  candles,
  asset,
  timeframe,
  currentPrice,
  resistance1,
  resistance2,
  support1,
  support2,
  tops = [],
  bottoms = [],
  height = 320,
}) => {
  const chartWidth = 900;
  const paddingRight = 95;
  const paddingLeft = 10;
  const paddingTop = 25;
  const paddingBottom = 25;

  // Usa as últimas 45 velas para visualização limpa
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

    // Inclui os níveis de Suporte e Resistência nos limites verticais se forem razoáveis
    if (Number.isFinite(resistance1) && resistance1 > 0) max = Math.max(max, resistance1);
    if (Number.isFinite(resistance2) && resistance2 > 0) max = Math.max(max, resistance2);
    if (Number.isFinite(support1) && support1 > 0) min = Math.min(min, support1);
    if (Number.isFinite(support2) && support2 > 0) min = Math.min(min, support2);
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
  }, [visibleCandles, currentPrice, resistance1, resistance2, support1, support2]);

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
  const r1Y = getY(resistance1);
  const r2Y = resistance2 ? getY(resistance2) : null;
  const s1Y = getY(support1);
  const s2Y = support2 ? getY(support2) : null;

  return (
    <div className="w-full bg-[#070a12] border-2 border-neutral-800 rounded-2xl overflow-hidden shadow-2xl relative select-none font-mono">
      {/* Top Banner do Gráfico */}
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-950/80 border-b border-neutral-800/80 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="font-black text-white">{asset.symbol}</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {timeframe}
          </span>
          <span className="text-neutral-400 hidden sm:inline">
            • Marcação Direta de Topos e Fundos
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-rose-400 font-bold">
            <span className="w-2 h-0.5 bg-rose-500 inline-block" />
            <span>RESISTÊNCIA: {resistance1.toFixed(decimals)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <span className="w-2 h-0.5 bg-emerald-500 inline-block" />
            <span>SUPORTE: {support1.toFixed(decimals)}</span>
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
          {/* Linhas de Grade de Fundo */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
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

          {/* 🔴 LINHA DE RESISTÊNCIA 2 (TOPO MÁXIMO SECUNDÁRIO) */}
          {r2Y !== null && resistance2 && (
            <g>
              <line
                x1={paddingLeft}
                y1={r2Y}
                x2={chartWidth - paddingRight}
                y2={r2Y}
                stroke="#f43f5e"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.65"
              />
              <rect
                x={chartWidth - paddingRight + 4}
                y={r2Y - 8}
                width={paddingRight - 8}
                height={16}
                fill="#4c0519"
                stroke="#f43f5e"
                strokeWidth="0.8"
                rx="3"
                opacity="0.8"
              />
              <text
                x={chartWidth - paddingRight + 8}
                y={r2Y + 3.5}
                fill="#fca5a5"
                fontSize="8.5"
                fontWeight="bold"
                fontFamily="JetBrains Mono, monospace"
              >
                R2: {resistance2.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* 🔴 LINHA DE RESISTÊNCIA 1 (TOPO PRINCIPAL / VENDA) */}
          {Number.isFinite(r1Y) && (
            <g className="transition-all duration-300">
              {/* Brilho da Linha */}
              <line
                x1={paddingLeft}
                y1={r1Y}
                x2={chartWidth - paddingRight}
                y2={r1Y}
                stroke="#f43f5e"
                strokeWidth="4"
                opacity="0.2"
              />
              {/* Linha Principal Tracejada */}
              <line
                x1={paddingLeft}
                y1={r1Y}
                x2={chartWidth - paddingRight}
                y2={r1Y}
                stroke="#f43f5e"
                strokeWidth="1.8"
                strokeDasharray="6 3"
              />
              {/* Badge na régua de preços */}
              <rect
                x={chartWidth - paddingRight + 2}
                y={r1Y - 10}
                width={paddingRight - 4}
                height={20}
                fill="#e11d48"
                stroke="#ffe4e6"
                strokeWidth="1.2"
                rx="4"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={r1Y + 3.5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                R1 {resistance1.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* 🟢 LINHA DE SUPORTE 2 (FUNDO MÍNIMO SECUNDÁRIO) */}
          {s2Y !== null && support2 && (
            <g>
              <line
                x1={paddingLeft}
                y1={s2Y}
                x2={chartWidth - paddingRight}
                y2={s2Y}
                stroke="#10b981"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.65"
              />
              <rect
                x={chartWidth - paddingRight + 4}
                y={s2Y - 8}
                width={paddingRight - 8}
                height={16}
                fill="#064e3b"
                stroke="#10b981"
                strokeWidth="0.8"
                rx="3"
                opacity="0.8"
              />
              <text
                x={chartWidth - paddingRight + 8}
                y={s2Y + 3.5}
                fill="#a7f3d0"
                fontSize="8.5"
                fontWeight="bold"
                fontFamily="JetBrains Mono, monospace"
              >
                S2: {support2.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* 🟢 LINHA DE SUPORTE 1 (FUNDO PRINCIPAL / COMPRA) */}
          {Number.isFinite(s1Y) && (
            <g className="transition-all duration-300">
              {/* Brilho da Linha */}
              <line
                x1={paddingLeft}
                y1={s1Y}
                x2={chartWidth - paddingRight}
                y2={s1Y}
                stroke="#10b981"
                strokeWidth="4"
                opacity="0.2"
              />
              {/* Linha Principal Tracejada */}
              <line
                x1={paddingLeft}
                y1={s1Y}
                x2={chartWidth - paddingRight}
                y2={s1Y}
                stroke="#10b981"
                strokeWidth="1.8"
                strokeDasharray="6 3"
              />
              {/* Badge na régua de preços */}
              <rect
                x={chartWidth - paddingRight + 2}
                y={s1Y - 10}
                width={paddingRight - 4}
                height={20}
                fill="#059669"
                stroke="#d1fae5"
                strokeWidth="1.2"
                rx="4"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={s1Y + 3.5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                S1 {support1.toFixed(decimals)}
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

            const isResistanceTop = Math.abs(c.high - resistance1) < 0.00005 * currentPrice;
            const isSupportBottom = Math.abs(c.low - support1) < 0.00005 * currentPrice;

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

                {/* Marcador Visual do Topo Testado */}
                {isResistanceTop && (
                  <polygon
                    points={`${xCenter},${yHigh - 4} ${xCenter - 4},${yHigh - 10} ${xCenter + 4},${yHigh - 10}`}
                    fill="#f43f5e"
                  />
                )}

                {/* Marcador Visual do Fundo Testado */}
                {isSupportBottom && (
                  <polygon
                    points={`${xCenter},${yLow + 4} ${xCenter - 4},${yLow + 10} ${xCenter + 4},${yLow + 10}`}
                    fill="#10b981"
                  />
                )}
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

