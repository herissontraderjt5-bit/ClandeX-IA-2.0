import React from 'react';
import { X, History, TrendingUp, TrendingDown, Download, Trash2, CheckCircle, XCircle, Clock, HelpCircle } from 'lucide-react';
import { SignalRecord } from '../types/trading';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  signals: SignalRecord[];
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  signals,
  onClearHistory,
}) => {
  if (!isOpen) return null;

  const wins = signals.filter((s) => s.result === 'WIN').length;
  const losses = signals.filter((s) => s.result === 'LOSS').length;
  const empates = signals.filter((s) => s.result === 'EMPATE').length;
  const finished = wins + losses;
  const winRate = finished > 0 ? ((wins / finished) * 100).toFixed(1) : '0.0';

  const handleExportCsv = () => {
    if (signals.length === 0) return;
    const headers = ['ID', 'Horario', 'Ativo', 'TF', 'Direcao', 'Score', 'PrecoEntrada', 'Resultado', 'Motivo'];
    const rows = signals.map((s) => [
      s.id,
      s.formattedTime,
      s.asset,
      s.timeframe,
      s.direction,
      s.confluenceScore,
      s.entryPrice,
      s.result,
      `"${s.reasons[0] || ''}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `clandex_sinais_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">HISTÓRICO DE SINAIS — CLANDEX-IA</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={signals.length === 0}
              className="flex items-center gap-1.5 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium border border-neutral-700 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              CSV
            </button>
            <button
              onClick={onClearHistory}
              disabled={signals.length === 0}
              title="Limpar Histórico"
              className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-2 p-4 bg-neutral-900/40 border-b border-neutral-800/80 text-xs font-mono">
          <div className="p-2 bg-neutral-950/80 border border-neutral-800/60 rounded-xl text-center">
            <span className="text-[10px] text-neutral-400 block uppercase">Assertividade</span>
            <span className="text-base font-bold text-cyan-400">{winRate}%</span>
          </div>
          <div className="p-2 bg-neutral-950/80 border border-neutral-800/60 rounded-xl text-center">
            <span className="text-[10px] text-neutral-400 block uppercase">WIN</span>
            <span className="text-base font-bold text-emerald-400">{wins}</span>
          </div>
          <div className="p-2 bg-neutral-950/80 border border-neutral-800/60 rounded-xl text-center">
            <span className="text-[10px] text-neutral-400 block uppercase">LOSS</span>
            <span className="text-base font-bold text-rose-400">{losses}</span>
          </div>
          <div className="p-2 bg-neutral-950/80 border border-neutral-800/60 rounded-xl text-center">
            <span className="text-[10px] text-neutral-400 block uppercase">Total</span>
            <span className="text-base font-bold text-white">{signals.length}</span>
          </div>
        </div>

        {/* Signals List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
          {signals.map((sig) => {
            const isCall = sig.direction === 'CALL';
            return (
              <div
                key={sig.id}
                className="flex items-center justify-between p-3 bg-neutral-900/60 border border-neutral-800/70 rounded-xl font-mono"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
                      isCall ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {isCall ? '▲' : '▼'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-white text-xs">{sig.asset}</strong>
                      <span className="text-[10px] text-cyan-400">{sig.timeframe}</span>
                      <span className="text-[10px] text-neutral-500">Exp: {sig.expiration}</span>
                    </div>
                    <div className="text-[10px] text-neutral-400">
                      Entrada: {sig.entryPrice} • Score: {sig.confluenceScore}/100
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[11px] font-bold">
                    {sig.result === 'WIN' && <span className="text-emerald-400">WIN (Estimado)</span>}
                    {sig.result === 'LOSS' && <span className="text-rose-400">LOSS (Estimado)</span>}
                    {sig.result === 'EMPATE' && <span className="text-neutral-400">EMPATE</span>}
                    {sig.result === 'PENDING' && <span className="text-amber-400 animate-pulse">Em execução</span>}
                  </div>
                  <div className="text-[10px] text-neutral-500">{sig.formattedTime}</div>
                </div>
              </div>
            );
          })}

          {signals.length === 0 && (
            <div className="py-12 text-center text-neutral-500 text-xs">
              Nenhum sinal emitido até o momento. O painel flutuante gerará alertas automaticamente ao detectar confluências.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
