import React from 'react';
import { ConfluenceBreakdown, MarketAnalysis, AppSettings } from '../types/trading';
import {
  TrendingUp,
  Activity,
  Layers,
  ShieldCheck,
  Zap,
  BarChart2,
  CheckCircle2,
  AlertTriangle,
  Info
} from 'lucide-react';

interface ConfluenceBreakdownProps {
  confluences: ConfluenceBreakdown;
  marketAnalysis: MarketAnalysis;
  settings: AppSettings;
}

export const ConfluenceBreakdownCard: React.FC<ConfluenceBreakdownProps> = ({
  confluences,
  marketAnalysis,
  settings,
}) => {
  const { weights } = settings;

  return (
    <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-4 backdrop-blur-md space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">MOTOR DE CONFLUÊNCIAS</h3>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-neutral-400 uppercase font-mono mr-2">PONTUAÇÃO GLOBAL:</span>
          <span
            className={`font-mono font-bold text-base ${
              confluences.totalScore >= 90
                ? 'text-cyan-300'
                : confluences.totalScore >= 75
                ? 'text-emerald-400'
                : confluences.totalScore >= 60
                ? 'text-amber-400'
                : 'text-neutral-400'
            }`}
          >
            {confluences.totalScore}/100
          </span>
        </div>
      </div>

      {/* 5 Modular Pillars Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Pillar 1: Market Structure */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              Estrutura
            </span>
            <span className="font-mono text-xs font-bold text-cyan-300">
              {confluences.marketStructureScore}/{weights.marketStructure}
            </span>
          </div>
          <div className="text-[10px] space-y-1 text-neutral-400">
            <div className="flex justify-between">
              <span>Tendência:</span>
              <strong className="text-white">{marketAnalysis.trend}</strong>
            </div>
            <div className="flex justify-between">
              <span>Domínio:</span>
              <strong className="text-white">{marketAnalysis.dominantForce}</strong>
            </div>
          </div>
        </div>

        {/* Pillar 2: Price Action */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              Price Action
            </span>
            <span className="font-mono text-xs font-bold text-emerald-300">
              {confluences.priceActionScore}/{weights.priceAction}
            </span>
          </div>
          <div className="text-[10px] space-y-1 text-neutral-400">
            <div className="flex justify-between">
              <span>Rejeição:</span>
              <strong className={marketAnalysis.rejectionCandle ? 'text-emerald-400' : 'text-neutral-500'}>
                {marketAnalysis.rejectionCandle ? 'Pinbar Ativo' : 'Não'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Engolfo:</span>
              <strong className={marketAnalysis.engulfingPattern ? 'text-cyan-400' : 'text-neutral-500'}>
                {marketAnalysis.engulfingPattern || 'Nenhum'}
              </strong>
            </div>
          </div>
        </div>

        {/* Pillar 3: Support & Resistance */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Suporte & Res.
            </span>
            <span className="font-mono text-xs font-bold text-blue-300">
              {confluences.supportResistanceScore}/{weights.supportResistance}
            </span>
          </div>
          <div className="text-[10px] space-y-1 text-neutral-400">
            <div className="flex justify-between">
              <span>Teste Zona:</span>
              <strong className="text-white">
                {marketAnalysis.nearSupport ? 'Suporte' : marketAnalysis.nearResistance ? 'Resistência' : 'Meio de Canal'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Consolidação:</span>
              <strong className={marketAnalysis.inConsolidation ? 'text-amber-400' : 'text-emerald-400'}>
                {marketAnalysis.inConsolidation ? 'Alerta Ruído' : 'Fluxo Livre'}
              </strong>
            </div>
          </div>
        </div>

        {/* Pillar 4: Smart Money Concepts (SMC) */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5 text-purple-400" />
              SMC Institucional
            </span>
            <span className="font-mono text-xs font-bold text-purple-300">
              {confluences.smcScore}/{weights.smc}
            </span>
          </div>
          <div className="text-[10px] space-y-1 text-neutral-400">
            <div className="flex justify-between">
              <span>BOS / CHoCH:</span>
              <strong className="text-white">
                {marketAnalysis.choch ? 'CHoCH' : marketAnalysis.bos ? 'BOS' : 'Neutro'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Order Block:</span>
              <strong className="text-white truncate max-w-[70px]">
                {marketAnalysis.activeOrderBlock ? marketAnalysis.activeOrderBlock.type : 'Nenhum'}
              </strong>
            </div>
          </div>
        </div>

        {/* Pillar 5: Volatility Context */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              Volatilidade
            </span>
            <span className="font-mono text-xs font-bold text-amber-300">
              {confluences.volatilityScore}/{weights.volatility}
            </span>
          </div>
          <div className="text-[10px] space-y-1 text-neutral-400">
            <div className="flex justify-between">
              <span>Estado:</span>
              <strong className="text-white">{marketAnalysis.volatilityStatus}</strong>
            </div>
            <div className="flex justify-between">
              <span>Expiração:</span>
              <strong className="text-cyan-300">Favorável</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Reasons breakdown list */}
      <div className="pt-2">
        <div className="text-[11px] font-semibold text-neutral-300 mb-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
          Confluências Verificadas Deterministicamente:
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {confluences.reasons.map((reason, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 bg-neutral-950/40 border border-neutral-800/60 rounded-lg text-neutral-300 text-[11px]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
          {confluences.reasons.length === 0 && (
            <div className="text-neutral-500 text-xs italic col-span-2">
              Nenhuma condição técnica forte no candle atual. Aguardando estruturação.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
