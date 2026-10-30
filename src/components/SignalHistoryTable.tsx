import React, { useState, useMemo } from 'react';
import { SignalRecord, TimeFrame } from '../types/trading';
import {
  History,
  TrendingUp,
  TrendingDown,
  Download,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  HelpCircle,
} from 'lucide-react';

interface SignalHistoryTableProps {
  signals: SignalRecord[];
  onClearHistory: () => void;
}

export const SignalHistoryTable: React.FC<SignalHistoryTableProps> = ({
  signals,
  onClearHistory,
}) => {
  const [filterAsset, setFilterAsset] = useState<string>('ALL');
  const [filterTimeframe, setFilterTimeframe] = useState<string>('ALL');

  // Distinct assets
  const availableAssets = useMemo(() => {
    const set = new Set<string>();
    signals.forEach((s) => set.add(s.asset));
    return Array.from(set);
  }, [signals]);

  // Filtered signals
  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (filterAsset !== 'ALL' && s.asset !== filterAsset) return false;
      if (filterTimeframe !== 'ALL' && s.timeframe !== filterTimeframe) return false;
      return true;
    });
  }, [signals, filterAsset, filterTimeframe]);

  // Performance statistics
  const stats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let empates = 0;
    let pending = 0;

    filteredSignals.forEach((s) => {
      if (s.result === 'WIN') wins++;
      else if (s.result === 'LOSS') losses++;
      else if (s.result === 'EMPATE') empates++;
      else pending++;
    });

    const finished = wins + losses;
    const winRate = finished > 0 ? ((wins / finished) * 100).toFixed(1) : '0.0';

    return { wins, losses, empates, pending, winRate, total: filteredSignals.length };
  }, [filteredSignals]);

  // Export to CSV
  const handleExportCsv = () => {
    if (signals.length === 0) return;
    const headers = [
      'ID',
      'Data/Hora',
      'Ativo',
      'Timeframe',
      'Direção',
      'Pontuação',
      'Preço Entrada',
      'Preço Saída',
      'Expiração',
      'Resultado (Estimado)',
      'Motivos Técnicos',
    ];

    const rows = filteredSignals.map((s) => [
      s.id,
      s.formattedTime,
      s.asset,
      s.timeframe,
      s.direction,
      `${s.confluenceScore}/100`,
      s.entryPrice,
      s.exitPrice || 'N/A',
      s.expiration,
      s.result,
      `"${s.reasons.join('; ')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `clandex_ia_sinais_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-4 backdrop-blur-md space-y-4">
      {/* Top Header & Stat Cards */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">HISTÓRICO DE SINAIS & PERFORMANCE</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={signals.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium border border-neutral-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Exportar CSV
          </button>
          <button
            onClick={onClearHistory}
            disabled={signals.length === 0}
            title="Limpar Histórico"
            className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl">
          <span className="text-[10px] text-neutral-400 block uppercase">Assertividade</span>
          <div className="text-xl font-bold font-mono text-cyan-400">{stats.winRate}%</div>
        </div>
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl">
          <span className="text-[10px] text-neutral-400 block uppercase">Vitórias (WIN)</span>
          <div className="text-xl font-bold font-mono text-emerald-400">{stats.wins}</div>
        </div>
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl">
          <span className="text-[10px] text-neutral-400 block uppercase">Derrotas (LOSS)</span>
          <div className="text-xl font-bold font-mono text-rose-400">{stats.losses}</div>
        </div>
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl">
          <span className="text-[10px] text-neutral-400 block uppercase">Empates</span>
          <div className="text-xl font-bold font-mono text-neutral-400">{stats.empates}</div>
        </div>
        <div className="p-3 bg-neutral-950/60 border border-neutral-800/70 rounded-xl">
          <span className="text-[10px] text-neutral-400 block uppercase">Em Andamento</span>
          <div className="text-xl font-bold font-mono text-amber-400">{stats.pending}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filtrar por:</span>
        </div>

        {/* Asset Filter */}
        <select
          value={filterAsset}
          onChange={(e) => setFilterAsset(e.target.value)}
          className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-neutral-300 font-mono text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
        >
          <option value="ALL">Todos os Ativos</option>
          {availableAssets.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {/* Timeframe Filter */}
        <select
          value={filterTimeframe}
          onChange={(e) => setFilterTimeframe(e.target.value)}
          className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-neutral-300 font-mono text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
        >
          <option value="ALL">Todos Timeframes</option>
          <option value="M1">M1 (1 Minuto)</option>
          <option value="M2">M2 (2 Minutos)</option>
          <option value="M5">M5 (5 Minutos)</option>
        </select>

        <div className="text-neutral-500 text-[11px] ml-auto">
          Mostrando {filteredSignals.length} registros
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl border border-neutral-800/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-950/90 text-neutral-400 uppercase text-[10px] tracking-wider border-b border-neutral-800 font-mono">
            <tr>
              <th className="py-2.5 px-3">Horário</th>
              <th className="py-2.5 px-3">Ativo</th>
              <th className="py-2.5 px-3">TF</th>
              <th className="py-2.5 px-3">Direção</th>
              <th className="py-2.5 px-3">Score</th>
              <th className="py-2.5 px-3">Abertura ➔ Fechamento</th>
              <th className="py-2.5 px-3">Expiração</th>
              <th className="py-2.5 px-3">Resultado</th>
              <th className="py-2.5 px-3">Motivo Técnico Principal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60 text-neutral-300 font-mono">
            {filteredSignals.map((sig) => {
              const isCall = sig.direction === 'CALL';
              return (
                <tr key={sig.id} className="hover:bg-neutral-800/30 transition-colors">
                  <td className="py-2 px-3 text-neutral-400 whitespace-nowrap">{sig.formattedTime}</td>
                  <td className="py-2 px-3 font-bold text-white whitespace-nowrap">{sig.asset}</td>
                  <td className="py-2 px-3 text-cyan-400 whitespace-nowrap">{sig.timeframe}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        isCall ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isCall ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {sig.direction}
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span
                      className={
                        sig.confluenceScore >= 90
                          ? 'text-cyan-300 font-bold'
                          : sig.confluenceScore >= 75
                          ? 'text-emerald-300'
                          : 'text-neutral-300'
                      }
                    >
                      {sig.confluenceScore}/100
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {sig.exitPrice && sig.result !== 'PENDING' ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="text-neutral-300">{sig.entryPrice}</span>
                        <span className="text-neutral-500">➔</span>
                        <span
                          className={
                            sig.result === 'WIN'
                              ? 'text-emerald-400 font-bold'
                              : sig.result === 'LOSS'
                              ? 'text-rose-400 font-bold'
                              : 'text-neutral-300 font-bold'
                          }
                        >
                          {sig.exitPrice}
                        </span>
                      </span>
                    ) : (
                      sig.entryPrice
                    )}
                  </td>
                  <td className="py-2 px-3 text-neutral-400 whitespace-nowrap">{sig.expiration}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {sig.result === 'WIN' && (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                        <CheckCircle className="w-3.5 h-3.5" /> WIN*
                      </span>
                    )}
                    {sig.result === 'LOSS' && (
                      <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                        <XCircle className="w-3.5 h-3.5" /> LOSS*
                      </span>
                    )}
                    {sig.result === 'EMPATE' && (
                      <span className="text-neutral-400 font-medium">EMPATE*</span>
                    )}
                    {sig.result === 'PENDING' && (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-medium animate-pulse">
                        <Clock className="w-3.5 h-3.5" /> Em execução
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-neutral-400 font-sans text-[11px] truncate max-w-[280px]">
                    {sig.reasons[0] || 'Confluência multi-fatores'}
                  </td>
                </tr>
              );
            })}
            {filteredSignals.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-neutral-500 font-sans text-xs">
                  Nenhum sinal registrado ainda. Inicie a análise para detectar oportunidades em tempo real.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mandatory Disclaimer from Rule 9 */}
      <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1">
        <div className="flex items-center gap-1">
          <HelpCircle className="w-3 h-3 text-neutral-400" />
          <span>
            *Resultado estimado com base no feed de cotações interbancário/spot no tempo de expiração contratado. Não representa liquidação direta da Hiove.
          </span>
        </div>
      </div>
    </div>
  );
};
