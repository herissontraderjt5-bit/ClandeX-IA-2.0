import React, { useState } from 'react';
import {
  Asset,
  Candle,
  TimeFrame,
  ExpirationTime,
} from '../types/trading';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  ChevronDown,
  Clock,
  Wallet,
  ArrowUp,
  ArrowDown,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Sliders,
  DollarSign,
  Shield,
  ExternalLink,
} from 'lucide-react';

export const HIOVE_LOGIN_URL = 'https://app.hiove.com/auth/login?redirect=%2Ftraderoom%3Fticker%3DETHUSDT';

interface HioveBrokerBackgroundProps {
  currentAsset: Asset;
  assetsList: Asset[];
  timeframe: TimeFrame;
  expiration: ExpirationTime;
  candles: Candle[];
  remainingSeconds: number;
  onSelectAsset: (symbol: string) => void;
  onSelectTimeframe: (tf: TimeFrame) => void;
  onSelectExpiration: (exp: ExpirationTime) => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenWebhook?: () => void;
}

export const HioveBrokerBackground: React.FC<HioveBrokerBackgroundProps> = ({
  currentAsset,
  assetsList,
  timeframe,
  expiration,
  candles,
  remainingSeconds,
  onSelectAsset,
  onSelectTimeframe,
  onSelectExpiration,
  onOpenHistory,
  onOpenSettings,
  onOpenWebhook,
}) => {
  const [bgMode, setBgMode] = useState<'LIVE_SITE' | 'PLATFORM'>('LIVE_SITE');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [accountType, setAccountType] = useState<'DEMO' | 'REAL'>('DEMO');
  const [demoBalance, setDemoBalance] = useState<number>(10000.00);
  const [realBalance, setRealBalance] = useState<number>(1850.50);
  const [tradeAmount, setTradeAmount] = useState<number>(50);
  const [lastExecutedTrade, setLastExecutedTrade] = useState<{
    direction: 'CALL' | 'PUT';
    time: string;
    amount: number;
    price: number;
  } | null>(null);

  // Profit calculation
  const payoutRate = (currentAsset.hiovePayoutPercent || 88) / 100;
  const potentialProfit = tradeAmount * payoutRate;
  const totalReturn = tradeAmount + potentialProfit;

  // Chart coordinate math
  const visibleCandles = candles.slice(-55);
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  if (visibleCandles.length > 0) {
    visibleCandles.forEach((c) => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });
  } else {
    const base = Number.isFinite(currentAsset.currentPrice) ? currentAsset.currentPrice : 1.0;
    minPrice = base * 0.999;
    maxPrice = base * 1.001;
  }
  const diff = (maxPrice > minPrice && Number.isFinite(maxPrice - minPrice)) ? (maxPrice - minPrice) : 0.001;
  const buffer = diff * 0.08;
  const yMin = minPrice - buffer;
  const yMax = maxPrice + buffer;
  const yRange = (yMax > yMin && Number.isFinite(yMax - yMin)) ? (yMax - yMin) : 0.001;

  const chartHeight = 520;
  const chartWidth = 1000;
  const paddingRight = 80;
  const paddingLeft = 20;
  const paddingTop = 30;
  const paddingBottom = 35;

  const getY = (price: number): number => {
    const usable = chartHeight - paddingTop - paddingBottom;
    const safePrice = Number.isFinite(price) ? price : (Number.isFinite(currentAsset.currentPrice) ? currentAsset.currentPrice : 1.0);
    const safeRange = (yRange > 0 && Number.isFinite(yRange)) ? yRange : 1;
    const ratio = (safePrice - yMin) / safeRange;
    const val = chartHeight - paddingBottom - ratio * usable;
    return Number.isFinite(val) ? val : (chartHeight / 2);
  };

  const candleSpacing = (chartWidth - paddingLeft - paddingRight) / Math.max(visibleCandles.length, 1);
  const candleBodyWidth = Math.max(4, candleSpacing * 0.68);

  const currentPrice = currentAsset.currentPrice;
  const currentY = getY(currentPrice);

  const handleSimulateTrade = (dir: 'CALL' | 'PUT') => {
    if (accountType === 'DEMO') {
      if (demoBalance < tradeAmount) return;
      setDemoBalance((prev) => prev - tradeAmount);
    } else {
      if (realBalance < tradeAmount) return;
      setRealBalance((prev) => prev - tradeAmount);
    }

    setLastExecutedTrade({
      direction: dir,
      time: new Date().toLocaleTimeString('pt-BR'),
      amount: tradeAmount,
      price: currentPrice,
    });

    setTimeout(() => {
      const isWin = Math.random() > 0.35;
      if (isWin) {
        if (accountType === 'DEMO') setDemoBalance((prev) => prev + totalReturn);
        else setRealBalance((prev) => prev + totalReturn);
      }
    }, expiration === '1m' ? 60000 : 300000);
  };

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formattedCountdown = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (bgMode === 'LIVE_SITE') {
    return (
      <div className="relative w-screen h-screen bg-[#07090e] text-neutral-100 flex flex-col overflow-hidden font-sans select-none">
        {/* Top Control Strip for Live Hiove Website */}
        <header className="h-10 bg-[#0d121f]/90 border-b border-[#1c2438] flex items-center justify-between px-4 z-20 shrink-0 backdrop-blur-md">
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white tracking-wider">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>HIOVE LOGIN DIRETO (ETH/USDT)</span>
            </div>
            <span className="text-neutral-500 hidden md:inline">•</span>
            <div className="hidden lg:flex items-center gap-1 text-[11px] font-mono text-cyan-300">
              <span>IA Analisando TradingView:</span>
              <strong className="text-white px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40">
                {currentAsset.tvSymbol}
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setIframeKey((prev) => prev + 1)}
              className="px-2.5 py-1 bg-[#161e30] hover:bg-[#1e2942] border border-[#283552] text-neutral-300 hover:text-white rounded-lg text-[11px] font-mono transition-colors cursor-pointer"
              title="Recarregar tela de login da Hiove"
            >
              Recarregar
            </button>
            <button
              onClick={() => setBgMode('PLATFORM')}
              className="px-2.5 py-1 bg-[#161e30] hover:bg-[#1e2942] border border-[#283552] text-neutral-300 hover:text-white rounded-lg text-[11px] font-mono transition-colors cursor-pointer"
            >
              Alternar para Gráfico Hiove
            </button>
            <button
              onClick={onOpenHistory}
              className="px-2.5 py-1 text-neutral-400 hover:text-cyan-400 text-[11px] font-mono transition-colors cursor-pointer"
            >
              Histórico
            </button>
            <button
              onClick={onOpenWebhook}
              className="px-2.5 py-1 text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 rounded-lg text-[11px] font-mono transition-colors cursor-pointer"
            >
              Webhooks
            </button>
            <a
              href={HIOVE_LOGIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
            >
              <span>Abrir Login Hiove (ETH/USDT)</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </header>

        {/* Live Hiove Website Iframe Filling 100% Background */}
        <div className="flex-1 w-full h-full relative bg-[#090d16]">
          <iframe
            key={iframeKey}
            src={HIOVE_LOGIN_URL}
            title="Corretora Hiove - Login Traderoom ETHUSDT"
            className="w-full h-full border-0 block"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen bg-[#090d16] text-neutral-100 flex flex-col overflow-hidden font-sans select-none">
      {/* HIOVE Top Broker Header */}
      <header className="h-14 bg-[#0d121f] border-b border-[#1c2438] flex items-center justify-between px-4 z-10 shrink-0">
        {/* Left: Hiove Logo & Asset Tabs */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-[#1e263d]">
            <a
              href={HIOVE_LOGIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:opacity-85 transition-opacity"
              title="Abrir corretora Hiove oficial na página de login"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-black text-white text-xs tracking-tighter shadow-md shadow-cyan-500/20">
                H
              </div>
              <span className="font-extrabold text-lg tracking-wider text-white">HIOVE</span>
              <span className="text-[10px] text-cyan-400 font-mono font-semibold ml-0.5">.IO</span>
            </a>
          </div>

          {/* Asset Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto max-w-[45vw] py-1">
            {assetsList.slice(0, 5).map((a) => {
              const isSelected = a.symbol === currentAsset.symbol;
              return (
                <button
                  key={a.symbol}
                  onClick={() => onSelectAsset(a.symbol)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#182035] text-white border border-[#2b3758] shadow-sm'
                      : 'text-neutral-400 hover:text-white hover:bg-[#121827]'
                  }`}
                >
                  <span className="font-bold">{a.symbol}</span>
                  <span className="text-emerald-400 text-[10px] font-bold">
                    {a.hiovePayoutPercent}%
                  </span>
                </button>
              );
            })}

            {/* Quick dropdown for remaining assets */}
            <div className="relative">
              <select
                value={currentAsset.symbol}
                onChange={(e) => onSelectAsset(e.target.value)}
                className="bg-[#121827] text-neutral-300 border border-[#1e263d] rounded-lg px-2 py-1.5 text-xs font-mono cursor-pointer focus:outline-none focus:border-cyan-500"
              >
                {assetsList.map((a) => (
                  <option key={a.symbol} value={a.symbol} className="bg-[#0d121f]">
                    {a.symbol} ({a.hiovePayoutPercent}%)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Center / Right: Balance & Deposit */}
        <div className="flex items-center gap-3">
          {/* Account Selector */}
          <div className="flex items-center gap-2 bg-[#131929] border border-[#1e263d] px-3 py-1 rounded-xl">
            <button
              onClick={() => setAccountType(accountType === 'DEMO' ? 'REAL' : 'DEMO')}
              className="text-left cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    accountType === 'DEMO' ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                  }`}
                />
                <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
                  {accountType === 'DEMO' ? 'Conta Treinamento' : 'Conta Real'}
                </span>
                <ChevronDown className="w-3 h-3 text-neutral-400" />
              </div>
              <div className="font-mono font-bold text-sm text-white">
                R$ {accountType === 'DEMO' ? demoBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : realBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </button>
          </div>

          {/* Deposit Button */}
          <a
            href={HIOVE_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-neutral-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5" />
            DEPOSITAR
          </a>

          {/* Switch to Live Site Mode */}
          <button
            onClick={() => setBgMode('LIVE_SITE')}
            className="px-2.5 py-1.5 bg-[#172138] hover:bg-[#202e4d] text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-mono transition-colors cursor-pointer"
          >
            Ver Site Hiove (Login)
          </button>

          {/* View Official Link */}
          <a
            href={HIOVE_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Ir para o Login Hiove (Traderoom ETH/USDT)"
            className="p-2 text-neutral-400 hover:text-cyan-400 rounded-lg hover:bg-[#151c2e] transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Main Broker Layout: Chart + Trading Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Central Candlestick Chart Area */}
        <div className="flex-1 relative flex flex-col bg-[#090d16]">
          {/* Chart Header Bar */}
          <div className="h-10 px-4 flex items-center justify-between border-b border-[#141b2b] text-xs text-neutral-400 font-mono">
            <div className="flex items-center gap-4">
              <span className="text-white font-bold">{currentAsset.name}</span>
              <span className="text-neutral-500">•</span>
              <span>Spread: <strong className="text-neutral-300">{currentAsset.spread} pips</strong></span>
              <span className="text-neutral-500">•</span>
              <span>24h: <strong className={currentAsset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{currentAsset.change24h >= 0 ? `+${currentAsset.change24h}%` : `${currentAsset.change24h}%`}</strong></span>
            </div>

            <div className="flex items-center gap-2 text-cyan-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Próxima Vela: <strong>{formattedCountdown}</strong></span>
            </div>
          </div>

          {/* Live SVG Candlestick Chart */}
          <div className="flex-1 relative w-full h-full">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-full block"
              preserveAspectRatio="none"
            >
              {/* Background horizontal grid */}
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const y = paddingTop + (idx * (chartHeight - paddingTop - paddingBottom)) / 5;
                const priceVal = yMax - (idx * yRange) / 5;
                return (
                  <g key={idx}>
                    <line
                      x1={paddingLeft}
                      y1={y}
                      x2={chartWidth - paddingRight}
                      y2={y}
                      stroke="#141c2e"
                      strokeWidth="1"
                    />
                    <text
                      x={chartWidth - paddingRight + 8}
                      y={y + 3.5}
                      fill="#4b5563"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {priceVal.toFixed(currentAsset.pipDecimals)}
                    </text>
                  </g>
                );
              })}

              {/* Candles */}
              {visibleCandles.map((c, i) => {
                const xCenter = paddingLeft + i * candleSpacing + candleSpacing / 2;
                const yOpen = getY(c.open);
                const yClose = getY(c.close);
                const yHigh = getY(c.high);
                const yLow = getY(c.low);
                const isBullish = c.close >= c.open;
                const topBody = Math.min(yOpen, yClose);
                const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

                const color = isBullish ? '#10b981' : '#f43f5e';

                return (
                  <g key={c.time || i}>
                    <line
                      x1={xCenter}
                      y1={yHigh}
                      x2={xCenter}
                      y2={yLow}
                      stroke={color}
                      strokeWidth="1.2"
                    />
                    <rect
                      x={xCenter - candleBodyWidth / 2}
                      y={topBody}
                      width={candleBodyWidth}
                      height={bodyHeight}
                      fill={color}
                      rx="1"
                    />
                  </g>
                );
              })}

              {/* Live Ticker Line with Hiove style */}
              <line
                x1={paddingLeft}
                y1={currentY}
                x2={chartWidth - paddingRight}
                y2={currentY}
                stroke="#00e5ff"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <g>
                <rect
                  x={chartWidth - paddingRight + 2}
                  y={currentY - 10}
                  width={75}
                  height={20}
                  fill="#00e5ff"
                  rx="4"
                />
                <text
                  x={chartWidth - paddingRight + 39}
                  y={currentY + 4}
                  fill="#030712"
                  fontSize="11"
                  fontWeight="bold"
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {currentPrice.toFixed(currentAsset.pipDecimals)}
                </text>
              </g>
            </svg>

            {/* Bottom-left chart controls */}
            <div className="absolute bottom-4 left-4 flex items-center gap-1.5 p-1 bg-[#0d1322]/90 border border-[#1e263d] rounded-xl backdrop-blur-md z-10 text-xs font-mono">
              <button
                onClick={() => onSelectTimeframe('M1')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  timeframe === 'M1' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-neutral-400 hover:text-white'
                }`}
              >
                1M
              </button>
              <button
                onClick={() => onSelectTimeframe('M5')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  timeframe === 'M5' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-neutral-400 hover:text-white'
                }`}
              >
                5M
              </button>
            </div>
          </div>
        </div>

        {/* Right Execution Sidebar (Hiove Trading Panel) */}
        <div className="w-64 md:w-72 bg-[#0c111d] border-l border-[#1a2337] flex flex-col justify-between p-4 z-10 shrink-0">
          <div className="space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between pb-2 border-b border-[#182033]">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                PAINEL DE ORDENS
              </span>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">
                Payout: {currentAsset.hiovePayoutPercent}%
              </span>
            </div>

            {/* Expiration Timer Box */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider block">
                TEMPO DE EXPIRAÇÃO
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onSelectExpiration('1m')}
                  className={`py-2 text-xs font-mono font-bold rounded-xl border transition-all cursor-pointer ${
                    expiration === '1m'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                      : 'bg-[#121827] text-neutral-400 border-[#1e263d] hover:text-white'
                  }`}
                >
                  01:00 MIN
                </button>
                <button
                  onClick={() => onSelectExpiration('5m')}
                  className={`py-2 text-xs font-mono font-bold rounded-xl border transition-all cursor-pointer ${
                    expiration === '5m'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                      : 'bg-[#121827] text-neutral-400 border-[#1e263d] hover:text-white'
                  }`}
                >
                  05:00 MIN
                </button>
              </div>
            </div>

            {/* Investment Amount Input */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-neutral-400 font-semibold uppercase">
                <span>VALOR DO INVESTIMENTO</span>
                <span>MÍN: R$ 5,00</span>
              </div>

              <div className="flex items-center bg-[#131929] border border-[#1e273e] rounded-xl px-3 py-2 font-mono">
                <span className="text-neutral-400 font-bold text-xs mr-2">R$</span>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(Math.max(5, Number(e.target.value)))}
                  className="w-full bg-transparent text-white font-bold text-base focus:outline-none"
                />
              </div>

              {/* Amount Quick Presets */}
              <div className="grid grid-cols-4 gap-1 pt-1 font-mono text-[10px]">
                {[20, 50, 100, 250].map((val) => (
                  <button
                    key={val}
                    onClick={() => setTradeAmount(val)}
                    className="py-1 bg-[#131929] hover:bg-[#1a2338] text-neutral-300 rounded-lg border border-[#1d263b] transition-colors"
                  >
                    R$ {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Rendimento / Profit Display */}
            <div className="p-3 bg-[#111726] border border-[#1d263c] rounded-xl space-y-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Rendimento (+{currentAsset.hiovePayoutPercent}%):</span>
                <span className="font-mono text-emerald-400 font-bold">+ R$ {potentialProfit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-white font-bold">
                <span>Retorno Total:</span>
                <span className="font-mono text-emerald-300">R$ {totalReturn.toFixed(2)}</span>
              </div>
            </div>

            {/* Big Hiove Call / Put Buttons */}
            <div className="space-y-2 pt-2">
              {/* Call Button */}
              <button
                onClick={() => handleSimulateTrade('CALL')}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-neutral-950 font-black rounded-xl text-sm flex items-center justify-between px-4 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-neutral-950/20 flex items-center justify-center">
                    <ArrowUp className="w-4 h-4 stroke-[3]" />
                  </div>
                  <span className="tracking-wide">ACIMA (CALL)</span>
                </div>
                <span className="text-xs font-mono font-bold text-neutral-900">
                  +{currentAsset.hiovePayoutPercent}%
                </span>
              </button>

              {/* Put Button */}
              <button
                onClick={() => handleSimulateTrade('PUT')}
                className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-black rounded-xl text-sm flex items-center justify-between px-4 transition-all shadow-lg shadow-rose-500/20 active:scale-[0.98] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-neutral-950/20 flex items-center justify-center">
                    <ArrowDown className="w-4 h-4 stroke-[3]" />
                  </div>
                  <span className="tracking-wide">ABAIXO (PUT)</span>
                </div>
                <span className="text-xs font-mono font-bold text-white/90">
                  +{currentAsset.hiovePayoutPercent}%
                </span>
              </button>
            </div>
          </div>

          {/* Bottom Sidebar Shortcuts */}
          <div className="pt-3 border-t border-[#182033] flex items-center justify-between text-xs">
            <button
              onClick={onOpenHistory}
              className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
            >
              Histórico
            </button>
            <button
              onClick={onOpenWebhook}
              className="text-[11px] text-cyan-300 hover:underline cursor-pointer"
            >
              Webhooks
            </button>
            <button
              onClick={onOpenSettings}
              className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
            >
              Ajustes IA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
