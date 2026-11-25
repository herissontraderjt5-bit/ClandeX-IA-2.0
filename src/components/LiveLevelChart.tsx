import React, { useMemo, useState } from 'react';
import { Asset, Candle, TimeFrame } from '../types/trading';

/**
 * Calcula o Ponto de Controle (POC) de uma vela individual.
 * Na análise de fluxo / Footprint, o POC é o preço onde ocorreu a maior
 * concentração de volume e liquidez no intervalo daquela vela.
 */
export function getCandlePoc(c: Candle): number {
  if (c.poc && Number.isFinite(c.poc)) return c.poc;
  // Ponderação clássica institucional: zona de maior densidade negociada
  const typical = (c.high + c.low + 2 * c.close) / 4;
  return Math.max(c.low, Math.min(c.high, typical));
}

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
  const paddingLeft = 12;
  const paddingTop = 20;
  const paddingBottom = 20;

  // Nível de Zoom: padrão super ampliado (10 velas) para visualização máxima Footprint/POC
  const [zoomLevel, setZoomLevel] = useState<number>(10);

  // Velas visíveis com zoom aplicado (exibe de 6 a 30 velas)
  const visibleCandles = useMemo(() => {
    return candles && candles.length > 0 ? candles.slice(-zoomLevel) : [];
  }, [candles, zoomLevel]);

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

    // Zoom Vertical Otimizado: Foca nas velas visíveis.
    // Expande a escala caso o suporte ou resistência estejam no campo de visão próximo (até 40% da amplitude),
    // garantindo que as velas fiquem altas e não comprimidas.
    const visibleSpan = Math.max(0.0001, max - min);
    if (Number.isFinite(resistance) && resistance > 0 && resistance <= max + visibleSpan * 0.4) {
      max = Math.max(max, resistance);
    }
    if (Number.isFinite(support) && support > 0 && support >= min - visibleSpan * 0.4) {
      min = Math.min(min, support);
    }
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      max = Math.max(max, currentPrice);
      min = Math.min(min, currentPrice);
    }

    const diff = max > min ? max - min : 0.001;
    // Buffer vertical reduzido (4%) para maximizar a altura das velas no canvas
    const buffer = diff * 0.04;
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
    return Math.max(paddingTop - 6, Math.min(height - paddingBottom + 6, val));
  };

  const candleSpacing = (chartWidth - paddingLeft - paddingRight) / Math.max(visibleCandles.length, 1);
  // Largura do corpo da vela ampliada proporcionalmente ao zoom
  const candleBodyWidth = Math.max(16, candleSpacing * 0.76);

  const decimals = asset.pipDecimals || (asset.category === 'CRYPTO' ? 2 : 5);

  const currentY = getY(currentPrice);
  const rY = getY(resistance);
  const sY = getY(support);

  return (
    <div className="w-full bg-[#070a12] border-2 border-neutral-800 rounded-2xl overflow-hidden shadow-2xl relative select-none font-mono">
      {/* Top Banner do Gráfico com Controles de Zoom Interativo */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-neutral-950/90 border-b border-neutral-800/80 text-[10px]">
        {/* Ativo e Timeframe */}
        <div className="flex items-center gap-2">
          <span className="font-black text-white text-xs">{asset.symbol}</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {timeframe}
          </span>
          <span className="text-neutral-400 hidden sm:inline text-[9px]">
            • Marcações de Topo e Fundo
          </span>
        </div>

        {/* Controles de Zoom das Velas (Botões + / - e Presets rápidos) */}
        <div className="flex items-center gap-1.5 bg-black/60 px-2 py-0.5 rounded-lg border border-neutral-800">
          <span className="text-neutral-400 font-bold text-[9px]">ZOOM:</span>
          <button
            type="button"
            onClick={() => setZoomLevel((prev) => Math.max(6, prev - 2))}
            disabled={zoomLevel <= 6}
            className={`w-5 h-5 rounded flex items-center justify-center font-black cursor-pointer transition-all active:scale-90 ${
              zoomLevel <= 6
                ? 'bg-neutral-900 text-neutral-600'
                : 'bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-neutral-700'
            }`}
            title="Mais Zoom (Velas Maiores)"
          >
            +
          </button>
          <span className="text-amber-300 font-bold px-1 min-w-[28px] text-center">
            {zoomLevel}V
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((prev) => Math.min(28, prev + 2))}
            disabled={zoomLevel >= 28}
            className={`w-5 h-5 rounded flex items-center justify-center font-black cursor-pointer transition-all active:scale-90 ${
              zoomLevel >= 28
                ? 'bg-neutral-900 text-neutral-600'
                : 'bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-neutral-700'
            }`}
            title="Menos Zoom (Mais Velas)"
          >
            -
          </button>

          {/* Presets Rápidos */}
          <div className="hidden md:flex items-center gap-1 ml-1 pl-1 border-l border-neutral-800 text-[8px]">
            <button
              type="button"
              onClick={() => setZoomLevel(6)}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                zoomLevel === 6 ? 'bg-amber-500 text-black font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              6V (Max)
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel(10)}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                zoomLevel === 10 ? 'bg-amber-500 text-black font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              10V
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel(18)}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                zoomLevel === 18 ? 'bg-amber-500 text-black font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              18V
            </button>
          </div>
        </div>

        {/* Legenda dos Níveis */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold">
            <span className="w-2.5 h-1.5 bg-amber-400 inline-block rounded-full shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
            <span>POC (PONTO DE CONTROLE)</span>
          </div>
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

      {/* SVG Canvas com Velas e Linhas de Suporte, Resistência e POC */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full block"
          style={{ height: `${height}px` }}
          preserveAspectRatio="none"
        >
          {/* Linhas de Grade Sutis */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
            const y = paddingTop + ratio * (height - paddingTop - paddingBottom);
            return (
              <line
                key={`grid_${idx}`}
                x1={paddingLeft}
                y1={y}
                x2={chartWidth - paddingRight}
                y2={y}
                stroke="#151824"
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

          {/* Renderização das Velas Japonesas Grandes e Nítidas com POC */}
          {visibleCandles.map((c, i) => {
            const xCenter = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const isBullish = c.close >= c.open;
            const topBody = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(3, Math.abs(yClose - yOpen));

            const candleColor = isBullish ? '#10b981' : '#f43f5e';
            const wickColor = isBullish ? '#34d399' : '#fb7185';

            // Ponto de Controle (POC) individual desta vela
            const pocPrice = getCandlePoc(c);
            const yPoc = getY(pocPrice);

            return (
              <g key={c.time || i}>
                {/* Pavio (Wick) Grosso e Definido */}
                <line
                  x1={xCenter}
                  y1={yHigh}
                  x2={xCenter}
                  y2={yLow}
                  stroke={wickColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Sombra / Glow do Corpo da Vela */}
                <rect
                  x={xCenter - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  opacity="0.2"
                  rx="3"
                />

                {/* Corpo (Body) Sólido com Bordas Arredondadas */}
                <rect
                  x={xCenter - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  stroke={wickColor}
                  strokeWidth="0.8"
                  rx="2.5"
                />

                {/* 🟡 POC (POINT OF CONTROL) DESTACADO NA VELA */}
                {Number.isFinite(yPoc) && (
                  <g>
                    {/* Barra Dourada da POC com Efeito Neon */}
                    <rect
                      x={xCenter - (candleBodyWidth * 1.25) / 2}
                      y={yPoc - 3}
                      width={candleBodyWidth * 1.25}
                      height={6}
                      fill="#fbbf24"
                      stroke="#d97706"
                      strokeWidth="1"
                      rx="2.5"
                      className="drop-shadow-[0_0_10px_rgba(251,191,36,0.95)]"
                    />

                    {/* Ponto Central Branco da POC */}
                    <circle
                      cx={xCenter}
                      cy={yPoc}
                      r="2.2"
                      fill="#ffffff"
                      stroke="#b45309"
                      strokeWidth="0.8"
                    />

                    {/* Tag de Identificação "POC" quando a vela está ampliada */}
                    {candleBodyWidth >= 28 && (
                      <g>
                        <rect
                          x={xCenter - 14}
                          y={yPoc - 14}
                          width={28}
                          height={10}
                          fill="#451a03"
                          stroke="#fbbf24"
                          strokeWidth="0.8"
                          rx="3"
                        />
                        <text
                          x={xCenter}
                          y={yPoc - 6.5}
                          fill="#fef08a"
                          fontSize="7.5"
                          fontWeight="900"
                          textAnchor="middle"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          POC
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            );
          })}

          {/* 🟡 PROJEÇÃO DA POC DA VELA ATUAL NA RÉGUA LATERAL */}
          {visibleCandles.length > 0 && (() => {
            const lastCandle = visibleCandles[visibleCandles.length - 1];
            const lastPoc = getCandlePoc(lastCandle);
            const lastPocY = getY(lastPoc);
            const lastX = paddingLeft + (visibleCandles.length - 1) * candleSpacing + candleSpacing / 2;

            return Number.isFinite(lastPocY) ? (
              <g className="transition-all duration-150">
                <line
                  x1={lastX}
                  y1={lastPocY}
                  x2={chartWidth - paddingRight}
                  y2={lastPocY}
                  stroke="#fbbf24"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.9"
                />
                <rect
                  x={chartWidth - paddingRight + 2}
                  y={lastPocY - 9}
                  width={paddingRight - 4}
                  height={18}
                  fill="#78350f"
                  stroke="#fbbf24"
                  strokeWidth="1.2"
                  rx="4"
                />
                <text
                  x={chartWidth - paddingRight + 6}
                  y={lastPocY + 3.5}
                  fill="#fef08a"
                  fontSize="8.5"
                  fontWeight="900"
                  fontFamily="JetBrains Mono, monospace"
                >
                  POC {lastPoc.toFixed(decimals)}
                </text>
              </g>
            ) : null;
          })()}

          {/* ⚡ LINHA DE COTAÇÃO ATUAL (AO VIVO) */}
          {Number.isFinite(currentY) && (
            <g className="transition-all duration-150">
              <line
                x1={paddingLeft}
                y1={currentY}
                x2={chartWidth - paddingRight}
                y2={currentY}
                stroke="#06b6d4"
                strokeWidth="1.4"
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
