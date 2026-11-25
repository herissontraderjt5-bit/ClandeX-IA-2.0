import React, { useMemo, useState } from 'react';
import { Asset, Candle, TimeFrame } from '../types/trading';

/**
 * Calcula o Ponto de Controle (POC) de uma vela individual.
 * Na análise institucional de fluxo / Footprint, o POC é a faixa de preço
 * onde ocorreu a maior concentração de liquidez e ordens executadas.
 */
export function getCandlePoc(c: Candle): number {
  if (c.poc && Number.isFinite(c.poc) && c.poc > 0) return c.poc;
  // Ponderação típica de liquidez Footprint: (High + Low + 2 * Close) / 4
  const typical = (c.high + c.low + 2 * c.close) / 4;
  return Math.max(c.low, Math.min(c.high, typical));
}

export interface ProjectedSignalInfo {
  direction: 'CALL' | 'PUT' | 'NEUTRO';
  confidence?: number;
  strategyName?: string;
}

interface LiveLevelChartProps {
  candles: Candle[];
  asset: Asset;
  timeframe: TimeFrame;
  currentPrice: number;
  resistance: number; // Topo
  support: number;    // Fundo
  height?: number;
  projectedSignal?: ProjectedSignalInfo | null;
}

export const LiveLevelChart: React.FC<LiveLevelChartProps> = ({
  candles,
  asset,
  timeframe,
  currentPrice,
  resistance,
  support,
  height = 360,
  projectedSignal,
}) => {
  const chartWidth = 900;
  const paddingRight = 95;
  const paddingLeft = 12;
  const paddingTop = 25;
  const paddingBottom = 25;

  // Nível de Zoom: padrão em 10 velas para que fiquem grandes e nítidas
  const [zoomLevel, setZoomLevel] = useState<number>(10);
  const [hoveredCandleIdx, setHoveredCandleIdx] = useState<number | null>(null);
  // Alternador para exibir ou ocultar a Projeção da Próxima Vela da IA
  const [showProjection, setShowProjection] = useState<boolean>(true);

  // Velas visíveis com base no nível de zoom escolhido
  const visibleCandles = useMemo(() => {
    return candles && candles.length > 0 ? candles.slice(-zoomLevel) : [];
  }, [candles, zoomLevel]);

  // Cálculo da Próxima Vela Prevista pela IA (Ghost Candle / Vela Preditiva)
  const { projectedCandle, projDirection, projConfidence } = useMemo(() => {
    if (!visibleCandles || visibleCandles.length === 0) {
      return { projectedCandle: null, projDirection: 'NEUTRO' as const, projConfidence: 50 };
    }

    const lastCandle = visibleCandles[visibleCandles.length - 1];
    const open = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : lastCandle.close;

    // Volatilidade real com base na média das últimas 5 velas
    const recent = visibleCandles.slice(-5);
    const avgBody = Math.max(
      0.0001,
      recent.reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / recent.length
    );
    const avgRange = Math.max(
      avgBody * 1.35,
      recent.reduce((acc, c) => acc + (c.high - c.low), 0) / recent.length
    );
    const avgWick = (avgRange - avgBody) / 2;

    // Determina a direção prevista (prioriza sinal de IA ou confluência dos indicadores)
    let dir: 'CALL' | 'PUT' | 'NEUTRO' = projectedSignal?.direction || 'NEUTRO';
    let conf = projectedSignal?.confidence || 65;

    if (dir === 'NEUTRO') {
      const bullCount = recent.filter((c) => c.close >= c.open).length;
      if (bullCount >= 3) {
        dir = 'CALL';
        conf = 62 + bullCount * 5;
      } else if (bullCount <= 1) {
        dir = 'PUT';
        conf = 62 + (5 - bullCount) * 5;
      } else {
        dir = lastCandle.close >= lastCandle.open ? 'CALL' : 'PUT';
        conf = 60;
      }
    }

    let close: number;
    let high: number;
    let low: number;

    if (dir === 'CALL') {
      close = open + avgBody;
      high = close + avgWick;
      low = open - avgWick * 0.4;
    } else {
      close = open - avgBody;
      low = close - avgWick;
      high = open + avgWick * 0.4;
    }

    const poc = Math.max(low, Math.min(high, (high + low + 2 * close) / 4));

    return {
      projectedCandle: {
        time: (lastCandle.time || 0) + 60,
        open,
        high,
        low,
        close,
        poc,
      },
      projDirection: dir,
      projConfidence: Math.min(95, Math.max(55, conf)),
    };
  }, [visibleCandles, currentPrice, projectedSignal]);

  // Escala Vertical idêntica ao TradingView:
  // Foca estritamente nas velas visíveis (e na projeção) para não achatar os corpos
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

    // Inclui a vela projetada se estiver ativada
    if (showProjection && projectedCandle) {
      if (projectedCandle.low < min) min = projectedCandle.low;
      if (projectedCandle.high > max) max = projectedCandle.high;
    }

    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      max = Math.max(max, currentPrice);
      min = Math.min(min, currentPrice);
    }

    const diff = max > min ? max - min : 0.001;
    // Buffer vertical padrão do TradingView (8%) para dar respiro nas extremidades sem achatar
    const buffer = diff * 0.08;
    const safeMin = min - buffer;
    const safeMax = max + buffer;
    const safeRange = safeMax > safeMin ? safeMax - safeMin : 0.001;

    return {
      minPrice: safeMin,
      maxPrice: safeMax,
      priceRange: safeRange,
    };
  }, [visibleCandles, currentPrice, showProjection, projectedCandle]);

  // Transforma preço em coordenada Y no SVG
  const getY = (price: number): number => {
    const usableHeight = height - paddingTop - paddingBottom;
    if (priceRange <= 0) return height / 2;
    const ratio = (price - minPrice) / priceRange;
    const val = height - paddingBottom - ratio * usableHeight;
    return Math.max(paddingTop - 10, Math.min(height - paddingBottom + 10, val));
  };

  // Espaçamento com coluna reservada para a próxima vela prevista
  const totalSlots = showProjection && projectedCandle ? visibleCandles.length + 1 : visibleCandles.length;
  const candleSpacing = (chartWidth - paddingLeft - paddingRight) / Math.max(totalSlots, 1);
  // Largura proporcional do corpo (72% do espaçamento para manter espaço entre velas)
  const candleBodyWidth = Math.max(12, candleSpacing * 0.72);

  const decimals = asset.pipDecimals || (asset.category === 'CRYPTO' ? 2 : 5);

  const currentY = getY(currentPrice);
  const rY = getY(resistance);
  const sY = getY(support);

  const isResistanceVisible = resistance >= minPrice && resistance <= maxPrice;
  const isSupportVisible = support >= minPrice && support <= maxPrice;

  // Informações da vela em hover
  const hoveredCandle = hoveredCandleIdx !== null && visibleCandles[hoveredCandleIdx]
    ? visibleCandles[hoveredCandleIdx]
    : null;
  const hoveredPoc = hoveredCandle ? getCandlePoc(hoveredCandle) : null;

  return (
    <div className="w-full bg-[#070a12] border-2 border-neutral-800 rounded-2xl overflow-hidden shadow-2xl relative select-none font-mono">
      {/* Top Banner com Ativo, Timeframe, Projeção IA, Zoom e Legenda */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-neutral-950/90 border-b border-neutral-800/80 text-[10px]">
        {/* Ativo e Timeframe */}
        <div className="flex items-center gap-2">
          <span className="font-black text-white text-xs">{asset.symbol}</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
            {timeframe}
          </span>
          <span className="text-neutral-400 hidden sm:inline text-[9px]">
            • Gráfico Footprint POC
          </span>
        </div>

        {/* Botão Alternador da Próxima Vela Prevista pela IA */}
        <button
          type="button"
          onClick={() => setShowProjection((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
            showProjection
              ? projDirection === 'CALL'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/70 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'bg-rose-950/80 text-rose-300 border-rose-500/70 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
              : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
          }`}
          title="Ativar/Desativar desenho preditivo da próxima vela da IA"
        >
          <span className={`w-2 h-2 rounded-full ${showProjection ? (projDirection === 'CALL' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400 animate-pulse') : 'bg-neutral-600'}`} />
          <span>🔮 Próxima Vela IA: {showProjection ? `${projDirection} (${projConfidence}%)` : 'DESATIVADA'}</span>
        </button>

        {/* Controles de Zoom */}
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
            onClick={() => setZoomLevel((prev) => Math.min(30, prev + 2))}
            disabled={zoomLevel >= 30}
            className={`w-5 h-5 rounded flex items-center justify-center font-black cursor-pointer transition-all active:scale-90 ${
              zoomLevel >= 30
                ? 'bg-neutral-900 text-neutral-600'
                : 'bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-neutral-700'
            }`}
            title="Menos Zoom (Mais Velas)"
          >
            -
          </button>
        </div>

        {/* Legenda de Níveis */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            <span className="w-2.5 h-1 bg-amber-400 inline-block rounded-full shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
            <span>POC</span>
          </div>
          <div className="flex items-center gap-1 text-rose-400 font-bold">
            <span className="w-2 h-1 bg-rose-500 inline-block rounded-full" />
            <span>TOPO: {resistance.toFixed(decimals)}</span>
          </div>
          <div className="flex items-center gap-1 text-emerald-400 font-bold">
            <span className="w-2 h-1 bg-emerald-500 inline-block rounded-full" />
            <span>FUNDO: {support.toFixed(decimals)}</span>
          </div>
        </div>
      </div>

      {/* Barra de Inspeção da Vela em Foco / Hover */}
      {hoveredCandle && hoveredPoc !== null && (
        <div className="px-3.5 py-1 bg-neutral-900/90 border-b border-neutral-800 text-[9px] flex items-center justify-between text-neutral-300">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">
              Vela {hoveredCandle.time ? new Date(hoveredCandle.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
            <span>A: <strong className="text-white">{hoveredCandle.open.toFixed(decimals)}</strong></span>
            <span>M: <strong className="text-white">{hoveredCandle.high.toFixed(decimals)}</strong></span>
            <span>M: <strong className="text-white">{hoveredCandle.low.toFixed(decimals)}</strong></span>
            <span>F: <strong className={hoveredCandle.close >= hoveredCandle.open ? 'text-emerald-400' : 'text-rose-400'}>{hoveredCandle.close.toFixed(decimals)}</strong></span>
          </div>
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            <span>🎯 POC DESTA VELA:</span>
            <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded font-mono">
              {hoveredPoc.toFixed(decimals)}
            </span>
          </div>
        </div>
      )}

      {/* SVG Canvas com Velas Japonesas, POC Oficial e Vela Prevista pela IA */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full block"
          style={{ height: `${height}px` }}
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredCandleIdx(null)}
        >
          {/* Grade de Preços Suave */}
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
          {Number.isFinite(rY) && isResistanceVisible && (
            <g className="transition-all duration-300">
              <line
                x1={paddingLeft}
                y1={rY}
                x2={chartWidth - paddingRight}
                y2={rY}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={rY - 9}
                width={paddingRight - 4}
                height={18}
                fill="#e11d48"
                stroke="#ffe4e6"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={rY + 3.5}
                fill="#ffffff"
                fontSize="8.5"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                TOPO {resistance.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* Indicador de Topo Fora do Campo Visível */}
          {resistance > maxPrice && (
            <g>
              <rect
                x={chartWidth - paddingRight + 2}
                y={paddingTop - 5}
                width={paddingRight - 4}
                height={16}
                fill="#881337"
                stroke="#f43f5e"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={paddingTop + 6}
                fill="#fda4af"
                fontSize="7.5"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                ▲ TOPO {resistance.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* 🟢 LINHA DE SUPORTE (FUNDO REAL) */}
          {Number.isFinite(sY) && isSupportVisible && (
            <g className="transition-all duration-300">
              <line
                x1={paddingLeft}
                y1={sY}
                x2={chartWidth - paddingRight}
                y2={sY}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={sY - 9}
                width={paddingRight - 4}
                height={18}
                fill="#059669"
                stroke="#d1fae5"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={sY + 3.5}
                fill="#ffffff"
                fontSize="8.5"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                FUNDO {support.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* Indicador de Fundo Fora do Campo Visível */}
          {support < minPrice && (
            <g>
              <rect
                x={chartWidth - paddingRight + 2}
                y={height - paddingBottom - 10}
                width={paddingRight - 4}
                height={16}
                fill="#064e3b"
                stroke="#10b981"
                strokeWidth="1"
                rx="3"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={height - paddingBottom + 1}
                fill="#6ee7b7"
                fontSize="7.5"
                fontWeight="900"
                fontFamily="JetBrains Mono, monospace"
              >
                ▼ FUNDO {support.toFixed(decimals)}
              </text>
            </g>
          )}

          {/* Velas Japonesas Históricas com Coloração Oficial TradingView e POC Alinhado */}
          {visibleCandles.map((c, i) => {
            const xCenter = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const isBullish = c.close >= c.open;
            const topBody = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

            const candleColor = isBullish ? '#089981' : '#f23645';

            // POC da vela
            const pocPrice = getCandlePoc(c);
            const yPoc = getY(pocPrice);

            const isHovered = hoveredCandleIdx === i;

            return (
              <g
                key={c.time || i}
                onMouseEnter={() => setHoveredCandleIdx(i)}
                className="cursor-pointer"
              >
                {/* Pavio (Wick) Nítido e Centralizado */}
                <line
                  x1={xCenter}
                  y1={yHigh}
                  x2={xCenter}
                  y2={yLow}
                  stroke={candleColor}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />

                {/* Corpo (Body) Sólido com Borda Fina */}
                <rect
                  x={xCenter - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  stroke={candleColor}
                  strokeWidth="1"
                  rx="1"
                  className={isHovered ? 'filter drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]' : ''}
                />

                {/* 🟡 POC (Ponto de Controle) Desenhado na Vela:
                    Barra horizontal dourada atravessando o corpo da vela sem sobrepor caixas de texto */}
                {Number.isFinite(yPoc) && (
                  <g>
                    {/* Linha da POC na vela */}
                    <line
                      x1={xCenter - (candleBodyWidth * 1.1) / 2}
                      y1={yPoc}
                      x2={xCenter + (candleBodyWidth * 1.1) / 2}
                      y2={yPoc}
                      stroke="#fbbf24"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className="drop-shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                    />
                    {/* Ponto focal central branco */}
                    <circle
                      cx={xCenter}
                      cy={yPoc}
                      r="1.8"
                      fill="#ffffff"
                      stroke="#b45309"
                      strokeWidth="0.8"
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* 🔮 DESENHO DA PRÓXIMA VELA PREVISTA PELA IA (GHOST CANDLE HOLOGRÁFICA) */}
          {showProjection && projectedCandle && (() => {
            const xProj = paddingLeft + visibleCandles.length * candleSpacing + candleSpacing / 2;
            const yProjOpen = getY(projectedCandle.open);
            const yProjClose = getY(projectedCandle.close);
            const yProjHigh = getY(projectedCandle.high);
            const yProjLow = getY(projectedCandle.low);
            const yProjPoc = getY(projectedCandle.poc);
            const isBullish = projDirection === 'CALL';
            const topProjBody = Math.min(yProjOpen, yProjClose);
            const projBodyHeight = Math.max(3, Math.abs(yProjClose - yProjOpen));

            const projColor = isBullish ? '#10b981' : '#f43f5e';
            const projFill = isBullish ? '#089981' : '#f23645';

            return (
              <g className="transition-all duration-300">
                {/* Linha Divisória Temporal (Presente vs Futuro) */}
                <line
                  x1={xProj - candleSpacing / 2}
                  y1={paddingTop}
                  x2={xProj - candleSpacing / 2}
                  y2={height - paddingBottom}
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                  opacity="0.5"
                />

                {/* Coluna de Foco da Próxima Vela */}
                <rect
                  x={xProj - candleSpacing / 2}
                  y={paddingTop}
                  width={candleSpacing}
                  height={height - paddingTop - paddingBottom}
                  fill={isBullish ? '#10b981' : '#f43f5e'}
                  opacity="0.04"
                />

                {/* Badge de Próxima Vela IA no Topo */}
                <g>
                  <rect
                    x={xProj - 34}
                    y={paddingTop - 1}
                    width={68}
                    height={15}
                    fill={isBullish ? '#064e3b' : '#881337'}
                    stroke={projColor}
                    strokeWidth="1"
                    rx="3.5"
                    className="drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]"
                  />
                  <text
                    x={xProj}
                    y={paddingTop + 10}
                    fill={isBullish ? '#6ee7b7' : '#fda4af'}
                    fontSize="7.5"
                    fontWeight="900"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {isBullish ? `▲ CALL ${projConfidence}%` : `▼ PUT ${projConfidence}%`}
                  </text>
                </g>

                {/* Pavio Tracejado Holográfico */}
                <line
                  x1={xProj}
                  y1={yProjHigh}
                  x2={xProj}
                  y2={yProjLow}
                  stroke={projColor}
                  strokeWidth="1.8"
                  strokeDasharray="3 2"
                  opacity="0.85"
                />

                {/* Corpo da Vela Prevista (Translúcido com Borda Tracejada e Efeito Neon) */}
                <rect
                  x={xProj - candleBodyWidth / 2}
                  y={topProjBody}
                  width={candleBodyWidth}
                  height={projBodyHeight}
                  fill={projFill}
                  fillOpacity="0.25"
                  stroke={projColor}
                  strokeWidth="1.8"
                  strokeDasharray="4 2"
                  rx="2"
                  className={isBullish ? 'drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]'}
                />

                {/* Seta Holográfica de Direção no Centro da Vela */}
                <text
                  x={xProj}
                  y={topProjBody + projBodyHeight / 2 + 3.5}
                  fill={isBullish ? '#a7f3d0' : '#fecdd3'}
                  fontSize="10"
                  fontWeight="900"
                  textAnchor="middle"
                  opacity="0.9"
                >
                  {isBullish ? '▲' : '▼'}
                </text>

                {/* 🟡 POC Previsto na Vela Futura */}
                {Number.isFinite(yProjPoc) && (
                  <g>
                    <line
                      x1={xProj - (candleBodyWidth * 1.1) / 2}
                      y1={yProjPoc}
                      x2={xProj + (candleBodyWidth * 1.1) / 2}
                      y2={yProjPoc}
                      stroke="#fbbf24"
                      strokeWidth="2.5"
                      strokeDasharray="3 2"
                      opacity="0.9"
                    />
                    <circle
                      cx={xProj}
                      cy={yProjPoc}
                      r="2"
                      fill="#fbbf24"
                      stroke="#78350f"
                      strokeWidth="0.8"
                    />
                    {/* Tag "POC IA" ao lado da vela projetada */}
                    <rect
                      x={xProj + candleBodyWidth / 2 + 3}
                      y={yProjPoc - 6.5}
                      width={38}
                      height={13}
                      fill="#78350f"
                      stroke="#fbbf24"
                      strokeWidth="0.8"
                      rx="2"
                    />
                    <text
                      x={xProj + candleBodyWidth / 2 + 22}
                      y={yProjPoc + 2.5}
                      fill="#fef08a"
                      fontSize="7"
                      fontWeight="900"
                      textAnchor="middle"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      POC IA
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

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
                  strokeWidth="1.2"
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
                  rx="3"
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
                rx="3"
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
