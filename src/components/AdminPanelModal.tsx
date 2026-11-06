import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Search,
  UserPlus,
  RefreshCw,
  Key,
  Trash2,
  AlertTriangle,
  Clock,
  Calendar,
  Sparkles,
  Shield,
  Activity,
  Flame,
  Check,
  Ban,
} from 'lucide-react';
import { MemberRecord } from '../types/trading';
import {
  fetchMembersRegistry,
  updateMemberAccessDays,
  grantMemberManual,
  revokeMember,
  deleteMember,
  ADMIN_MASTER_EMAIL,
} from '../services/memberService';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminEmail: string;
  onLogout?: () => void;
}

function formatTimeAgo(ts?: number): string {
  if (!ts) return 'Nunca acessou';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Agora mesmo';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Há ${diffDays} dias`;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  adminEmail,
  onLogout,
}) => {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, activeCount: 0, pendingCount: 0, onlineCount: 0 });
  const [hioveKeyPreview, setHioveKeyPreview] = useState<string>('');

  // Novo membro manual
  const [newEmail, setNewEmail] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newDays, setNewDays] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Testador de e-mail na API da Hiove
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Busca e filtro por tab
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'ACTIVE' | 'EXPIRED'>('ALL');

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const data = await fetchMembersRegistry(adminEmail);
      if (data.success) {
        setMembers(data.members || []);
        setStats({
          total: data.total || 0,
          activeCount: data.activeCount || 0,
          pendingCount: data.pendingCount || 0,
          onlineCount: data.onlineCount || 0,
        });
      }
    } catch (err) {
      console.error('Falha ao carregar membros:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMembers();
      setActionMessage(null);
      setTestResult(null);

      // Atualiza automaticamente em tempo real enquanto o Painel ADM estiver aberto
      const interval = setInterval(fetchMembers, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Liberação manual
  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newEmail.includes('@')) {
      setActionMessage({ type: 'error', text: 'Por favor, informe um e-mail válido.' });
      return;
    }

    setIsSubmitting(true);
    setActionMessage(null);

    try {
      const res = await grantMemberManual(adminEmail, newEmail.trim().toLowerCase(), newDays, newNotes.trim());
      if (res.success) {
        setActionMessage({
          type: 'success',
          text: `Acesso liberado com sucesso para ${newEmail} (${newDays >= 9999 ? 'Vitalício' : `${newDays} dias`})!`,
        });
        setNewEmail('');
        setNewNotes('');
        await fetchMembers();
      } else {
        setActionMessage({ type: 'error', text: res.error || 'Falha ao liberar membro.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Erro de conexão com o banco de dados.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Atualizar dias de acesso
  const handleUpdateDays = async (targetEmail: string, days: number) => {
    setActionMessage(null);
    try {
      const res = await updateMemberAccessDays(adminEmail, targetEmail, days);
      if (res.success) {
        setActionMessage({
          type: 'success',
          text: `Licença de ${targetEmail} configurada para ${days >= 9999 ? 'Vitalício' : `${days} dias`} com sucesso!`,
        });
        await fetchMembers();
      } else {
        setActionMessage({ type: 'error', text: res.error || 'Falha ao atualizar dias de acesso.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Erro ao atualizar dias de acesso.' });
    }
  };

  // Revogar acesso
  const handleRevoke = async (email: string) => {
    if (!confirm(`Deseja realmente revogar/bloquear o acesso de ${email}?`)) return;

    try {
      const res = await revokeMember(adminEmail, email);
      if (res.success) {
        setActionMessage({ type: 'success', text: `Acesso de ${email} bloqueado com sucesso.` });
        await fetchMembers();
      } else {
        alert(res.error || 'Erro ao revogar');
      }
    } catch {
      alert('Falha ao conectar com servidor.');
    }
  };

  // Excluir membro
  const handleDelete = async (email: string) => {
    if (!confirm(`Deseja excluir ${email} permanentemente do registro?`)) return;

    try {
      const res = await deleteMember(adminEmail, email);
      if (res.success) {
        setActionMessage({ type: 'success', text: `${email} excluído da base.` });
        await fetchMembers();
      }
    } catch { }
  };

  // Testar e-mail na API da Hiove
  const handleTestHiove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail || !testEmail.includes('@')) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/test-hiove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ adminEmail, email: testEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      setTestResult(data.result);
    } catch {
      setTestResult({ error: 'Falha ao comunicar com a API da Hiove.' });
    } finally {
      setIsTesting(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    const matchSearch = m.email.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (m.name && m.name.toLowerCase().includes(searchFilter.toLowerCase()));
    if (!matchSearch) return false;

    if (statusFilter === 'ONLINE') return m.isOnline;
    if (statusFilter === 'ACTIVE') return m.status === 'ACTIVE';
    if (statusFilter === 'EXPIRED') return m.status === 'EXPIRED' || m.status === 'REVOKED';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[94vh] flex flex-col bg-gradient-to-b from-[#0b101c] via-[#080d16] to-black border border-cyan-500/50 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.3)] overflow-hidden font-mono">
        {/* Top Accent Header Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-cyan-400 to-emerald-400" />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]">
              <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-wide">
                  PAINEL DE ADMINISTRADOR <span className="text-amber-400">MASTER</span>
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  HERISSON EXCLUSIVO
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Monitoramento de Usuários Online na IA, Gestão de Dias de Acesso & Licenças Hiove
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchMembers}
              disabled={loading}
              title="Atualizar Base de Dados"
              className="p-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:border-cyan-400 text-neutral-300 hover:text-white transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:border-rose-400 text-neutral-300 hover:text-rose-400 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1 text-xs">
          {/* 1. Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-neutral-900/80 border border-neutral-800 rounded-2xl space-y-1">
              <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider block">
                Total de Usuários
              </span>
              <div className="text-2xl font-black text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" />
                <span>{stats.total}</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-950/40 border border-emerald-500/50 rounded-2xl space-y-1 relative overflow-hidden">
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Online Agora (Usando IA)
              </span>
              <div className="text-2xl font-black text-emerald-300 flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                <span>{stats.onlineCount}</span>
              </div>
            </div>

            <div className="p-3 bg-cyan-950/30 border border-cyan-500/40 rounded-2xl space-y-1">
              <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block">
                Licenças Ativas
              </span>
              <div className="text-2xl font-black text-cyan-300 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                <span>{stats.activeCount}</span>
              </div>
            </div>

            <div className="p-3 bg-rose-950/30 border border-rose-500/40 rounded-2xl space-y-1">
              <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider block">
                Expirados / Bloqueados
              </span>
              <div className="text-2xl font-black text-rose-300 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <span>{stats.pendingCount}</span>
              </div>
            </div>
          </div>

          {/* Feedback Message Bar */}
          {actionMessage && (
            <div
              className={`p-3 rounded-2xl text-xs font-bold flex items-center justify-between border ${actionMessage.type === 'success'
                ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : 'bg-rose-950/50 text-rose-300 border-rose-500/50'
                }`}
            >
              <span>{actionMessage.text}</span>
              <button
                onClick={() => setActionMessage(null)}
                className="text-neutral-400 hover:text-white text-xs underline cursor-pointer"
              >
                Fechar
              </button>
            </div>
          )}

          {/* 2. Grid: Cadastro Manual de Cliente com Dias + Consulta Hiove */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Liberar Membro com Dias de Acesso */}
            <div className="p-4 bg-gradient-to-b from-neutral-900/90 to-black border border-emerald-500/40 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-emerald-300 font-bold">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Cadastrar / Liberar Cliente com Dias</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Libere um aluno ou cliente definindo quantos dias de acesso ele terá. Salva instantaneamente na nuvem.
              </p>

              <form onSubmit={handleAddManual} className="space-y-2.5">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e-mail do cliente ou aluno"
                  className="w-full bg-black/70 border border-neutral-700 rounded-xl px-3 py-2 text-white placeholder:text-neutral-600 outline-none focus:border-emerald-400"
                />

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-neutral-400 font-bold">Dias de Acesso:</span>
                  {[1, 7, 15, 30, 90, 365, 9999].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setNewDays(d)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${newDays === d
                        ? 'bg-emerald-500 text-neutral-950 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-700 hover:text-white'
                        }`}
                    >
                      {d === 1 ? '24h (1d)' : d === 9999 ? 'Vitalício' : `${d}d`}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Observação (ex: Aluno VIP, Grupo Telegram)"
                  className="w-full bg-black/70 border border-neutral-700 rounded-xl px-3 py-1.5 text-white placeholder:text-neutral-600 outline-none focus:border-emerald-400 text-[11px]"
                />

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-neutral-950 font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSubmitting ? 'Salvando...' : `Liberar Acesso (${newDays === 1 ? '24 Horas / 1 Dia' : newDays === 9999 ? 'Vitalício' : `${newDays} Dias`})`}</span>
                </button>
              </form>
            </div>

            {/* Box 2: Testar E-mail na API da Hiove */}
            <div className="p-4 bg-gradient-to-b from-neutral-900/90 to-black border border-cyan-500/30 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-cyan-300 font-bold">
                <Search className="w-4 h-4 text-cyan-400" />
                <span>Consultar E-mail na Corretora Hiove</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Verifique se o cliente já realizou cadastro pelo seu link e confirmou depósito na corretora.
              </p>

              <form onSubmit={handleTestHiove} className="flex gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="cliente@exemplo.com"
                  className="flex-1 bg-black/70 border border-neutral-700 rounded-xl px-3 py-2 text-white placeholder:text-neutral-600 outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={isTesting}
                  className="px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  {isTesting ? 'Buscando...' : 'Testar'}
                </button>
              </form>

              {testResult && (
                <div className="p-3 bg-black/60 rounded-xl border border-neutral-800 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Status Hiove:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded ${testResult.access === true
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-950 text-rose-300 border border-rose-500/40'
                        }`}
                    >
                      {testResult.access === true ? '✅ Acesso Aprovado (Depositou)' : '❌ Sem Depósito Confirmado'}
                    </span>
                  </div>
                  {testResult.access === true && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewEmail(testEmail);
                        setNewDays(30);
                        setNewNotes('Confirmado via teste API Hiove');
                      }}
                      className="text-cyan-400 underline text-[10px] cursor-pointer hover:text-cyan-300"
                    >
                      Copiar para o formulário de liberação manual
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. Tabela de Membros Cadastrados & Usuários Online */}
          <div className="p-4 bg-neutral-900/80 border border-neutral-800 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-white font-bold">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span>Base de Usuários & Controle de Dias de Acesso</span>
                  <span className="text-[10px] text-neutral-400">({filteredMembers.length})</span>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Mostra quem está online usando a IA em tempo real e permite alterar os dias de acesso com um clique.
                </p>
              </div>

              {/* Status Tabs Filter */}
              <div className="flex items-center gap-1 bg-black/60 p-1 rounded-xl border border-neutral-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${statusFilter === 'ALL' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-neutral-400'
                    }`}
                >
                  Todos ({members.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ONLINE')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${statusFilter === 'ONLINE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-neutral-400'
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Online ({stats.onlineCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ACTIVE')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${statusFilter === 'ACTIVE' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-neutral-400'
                    }`}
                >
                  Ativos ({stats.activeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('EXPIRED')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${statusFilter === 'EXPIRED' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'text-neutral-400'
                    }`}
                >
                  Expirados ({stats.pendingCount})
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Pesquisar por e-mail ou nome..."
                className="w-full pl-8 pr-3 py-1.5 bg-black/60 border border-neutral-700 rounded-xl text-white placeholder:text-neutral-500 outline-none focus:border-cyan-400 text-[11px]"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-800 text-[10px] text-neutral-400 uppercase tracking-wider">
                    <th className="py-2.5 px-3">E-mail / Usuário</th>
                    <th className="py-2.5 px-3">Origem</th>
                    <th className="py-2.5 px-3">Status da IA</th>
                    <th className="py-2.5 px-3">Dias de Acesso (Controle ADM)</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 font-mono text-xs">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-neutral-500">
                        Nenhum usuário encontrado com os filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((m) => {
                      const isMaster = m.email.toLowerCase() === ADMIN_MASTER_EMAIL.toLowerCase();
                      const remainingDays = isMaster
                        ? 9999
                        : m.expiresAt
                          ? Math.max(0, Math.ceil((m.expiresAt - Date.now()) / (86400 * 1000)))
                          : (m.accessDays || 30);
                      const isExpired = !isMaster && (m.status === 'EXPIRED' || remainingDays <= 0);

                      return (
                        <tr key={m.email} className={`hover:bg-neutral-800/30 transition-colors ${m.isOnline ? 'bg-emerald-950/10' : ''}`}>
                          {/* Coluna 1: Email & Presença Online */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-xs">{m.email}</span>
                              {isMaster ? (
                                <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-black">
                                  MASTER ADM
                                </span>
                              ) : m.isOnline ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-500/40 px-2 py-0.5 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  ONLINE AGORA
                                </span>
                              ) : (
                                <span className="text-[10px] text-neutral-500">
                                  {formatTimeAgo(m.lastActiveAt || m.lastCheckedAt)}
                                </span>
                              )}
                            </div>
                            {m.notes && (
                              <div className="text-[10px] text-neutral-400 mt-0.5">{m.notes}</div>
                            )}
                          </td>

                          {/* Coluna 2: Origem */}
                          <td className="py-3 px-3">
                            {isMaster ? (
                              <span className="text-[10px] text-amber-300 font-bold">Admin Master</span>
                            ) : m.source === 'HIOVE_API' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                                API Hiove
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950/60 text-purple-300 border border-purple-500/30">
                                Liberação Manual
                              </span>
                            )}
                          </td>

                          {/* Coluna 3: Status */}
                          <td className="py-3 px-3">
                            {isMaster ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/50 text-amber-300 border border-amber-500/40">
                                ATIVO ILIMITADO
                              </span>
                            ) : isExpired ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/50 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                                <XCircle className="w-3 h-3 text-rose-400" /> EXPIRADO
                              </span>
                            ) : m.status === 'REVOKED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-900 text-rose-400 border border-rose-600/40">
                                BLOQUEADO
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/50 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> LIBERADO
                              </span>
                            )}
                          </td>

                          {/* Coluna 4: Dias de Acesso (Controle Total) */}
                          <td className="py-3 px-3">
                            {isMaster ? (
                              <span className="text-amber-400 font-bold text-xs">Acesso Vitalício (∞)</span>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`font-black text-xs ${remainingDays > 5
                                      ? 'text-emerald-300'
                                      : remainingDays > 0
                                        ? 'text-amber-300'
                                        : 'text-rose-400'
                                      }`}
                                  >
                                    {remainingDays >= 9999
                                      ? 'Vitalício (∞)'
                                      : m.expiresAt && m.expiresAt > Date.now()
                                        ? (() => {
                                          const diffMs = m.expiresAt - Date.now();
                                          const diffHours = Math.ceil(diffMs / (3600 * 1000));
                                          if (diffHours <= 24) {
                                            return `${diffHours}h restantes (1 dia)`;
                                          }
                                          return `${Math.ceil(diffMs / (86400 * 1000))} dias restantes`;
                                        })()
                                        : remainingDays > 0
                                          ? `${remainingDays} dias restantes`
                                          : '0 dias (Expirado)'}
                                  </span>
                                </div>

                                {/* Botões Rápidos de Configuração de Dias (com 24h / 1d) */}
                                <div className="flex items-center gap-1 flex-wrap text-[9px]">
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateDays(m.email, 1)}
                                    title="Definir 24 horas (1 dia) de acesso"
                                    className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-500/50 hover:bg-emerald-500 hover:text-black text-emerald-300 rounded font-bold transition-colors cursor-pointer"
                                  >
                                    +24h (1d)
                                  </button>
                                  {[7, 15, 30, 90, 365].map((d) => (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => handleUpdateDays(m.email, d)}
                                      title={`Definir ${d} dias de acesso`}
                                      className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-700 hover:border-cyan-400 text-neutral-300 hover:text-white rounded transition-colors cursor-pointer"
                                    >
                                      +{d}d
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateDays(m.email, 9999)}
                                    title="Definir Acesso Vitalício"
                                    className="px-1.5 py-0.5 bg-amber-950/60 border border-amber-600/50 text-amber-300 hover:bg-amber-900/60 rounded transition-colors cursor-pointer font-bold"
                                  >
                                    Vitalício
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Coluna 5: Ações */}
                          <td className="py-3 px-3 text-right">
                            {!isMaster && (
                              <div className="flex items-center justify-end gap-1.5">
                                {m.status === 'ACTIVE' && !isExpired ? (
                                  <button
                                    onClick={() => handleRevoke(m.email)}
                                    title="Bloquear Acesso"
                                    className="px-2.5 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-500/40 rounded-lg transition-colors cursor-pointer text-[10px]"
                                  >
                                    Bloquear
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUpdateDays(m.email, 30)}
                                    title="Renovar Acesso por 30 Dias"
                                    className="px-2.5 py-1 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 rounded-lg transition-colors cursor-pointer text-[10px]"
                                  >
                                    Renovar (+30d)
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(m.email)}
                                  title="Excluir Registro da Nuvem"
                                  className="p-1 hover:text-rose-400 text-neutral-500 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Sessão ativa como <strong>{adminEmail}</strong> (Controle Total Master)</span>
          </div>

          <div className="flex items-center gap-3">
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-rose-400 hover:text-rose-300 text-[11px] underline cursor-pointer"
              >
                Trocar de Conta / Sair
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-colors cursor-pointer"
            >
              Fechar Painel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
