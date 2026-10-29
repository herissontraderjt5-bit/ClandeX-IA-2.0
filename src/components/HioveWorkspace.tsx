import React, { useState } from 'react';
import { ExternalLink, ShieldCheck, ArrowRight, Monitor, Layers, AlertCircle, Copy, Check } from 'lucide-react';
import { Asset, SignalRecord } from '../types/trading';
import { HIOVE_LOGIN_URL } from './HioveBrokerBackground';

interface HioveWorkspaceProps {
  currentAsset: Asset;
  activeSignal: SignalRecord | null;
  latestConfirmedSignal: SignalRecord | null;
}

export const HioveWorkspace: React.FC<HioveWorkspaceProps> = ({
  currentAsset,
  activeSignal,
  latestConfirmedSignal,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);

  const copyBrokerLink = () => {
    navigator.clipboard.writeText(HIOVE_LOGIN_URL);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-4 backdrop-blur-md space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">
            INTEGRAÇÃO SIMULTÂNEA — CORRETORA HIOVE (hiove.io)
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyBrokerLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-mono border border-neutral-700 transition-colors cursor-pointer"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedLink ? 'Link Copiado' : 'Login Hiove'}
          </button>
          <a
            href={HIOVE_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold rounded-lg text-xs transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            Abrir Login Hiove
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Guide Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* Step 1 */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold font-mono text-[11px]">
            <span>PASSO 1:</span>
            <span>POSICIONAMENTO</span>
          </div>
          <p className="text-neutral-400 text-[11px] leading-relaxed">
            Abra a corretora <strong>Hiove</strong> e mantenha a janela lado a lado, ou use o painel flutuante arrastável da ClandeX-IA sobreposto ao navegador.
          </p>
        </div>

        {/* Step 2 */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold font-mono text-[11px]">
            <span>PASSO 2:</span>
            <span>SINCRONIZAÇÃO DE ATIVO</span>
          </div>
          <p className="text-neutral-400 text-[11px] leading-relaxed">
            Certifique-se de que o mesmo par selecionado na ClandeX-IA (atualmente <strong>{currentAsset.symbol}</strong>) está aberto na plataforma da Hiove.
          </p>
        </div>

        {/* Step 3 */}
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl space-y-1.5">
          <div className="flex items-center gap-2 text-cyan-400 font-bold font-mono text-[11px]">
            <span>PASSO 3:</span>
            <span>EXECUÇÃO MANUAL</span>
          </div>
          <p className="text-neutral-400 text-[11px] leading-relaxed">
            Ao surgir o <strong>Pré-Alerta</strong>, prepare a ordem. Quando a <strong>Confirmação</strong> emitir o sinal na virada da vela, realize a entrada manual na Hiove.
          </p>
        </div>
      </div>

      {/* Current Signal Quick HUD for Hiove Execution */}
      <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg font-mono ${
              latestConfirmedSignal?.direction === 'CALL'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : latestConfirmedSignal?.direction === 'PUT'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
            }`}
          >
            {latestConfirmedSignal?.direction === 'CALL' ? 'CALL' : latestConfirmedSignal?.direction === 'PUT' ? 'PUT' : '---'}
          </div>

          <div>
            <div className="text-[10px] text-neutral-400 font-mono">ÚLTIMA CONFIRMAÇÃO PARA HIOVE</div>
            <div className="text-sm font-bold text-white font-mono">
              {latestConfirmedSignal
                ? `${latestConfirmedSignal.asset} • ${latestConfirmedSignal.direction} • Exp: ${latestConfirmedSignal.expiration}`
                : 'Aguardando validação da próxima confluência institucional'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
          <span className="text-[10px]">Payout Estimado na Hiove:</span>
          <span className="text-emerald-400 font-bold text-sm">~{currentAsset.hiovePayoutPercent}%</span>
        </div>
      </div>
    </div>
  );
};
