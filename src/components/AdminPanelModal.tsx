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
  Send,
  Lock,
  Sparkles,
  ExternalLink,
  Sliders,
} from 'lucide-react';
import { MemberRecord } from '../types/trading';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminEmail: string;
  onLogout?: () => void;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  adminEmail,
  onLogout,
}) => {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, activeCount: 0, pendingCount: 0 });
  const [hioveKeyPreview, setHioveKeyPreview] = useState<string>('');

  // Novo membro manual
  const [newEmail, setNewEmail] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Testador de e-mail na API da Hiove
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Busca e filtro
  const [searchFilter, setSearchFilter] = useState('');

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/members?adminEmail=${encodeURIComponent(adminEmail)}`, {
        headers: {
          'x-admin-email': adminEmail,
        },
      });
      const data = await res.json();
      if (data.success) {
        setMembers(data.members || []);
        setStats({
          total: data.total || 0,
          activeCount: data.activeCount || 0,
          pendingCount: data.pendingCount || 0,
        });
        if (data.hioveKeyPreview) setHioveKeyPreview(data.hioveKeyPreview);
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
      const res = await fetch('/api/admin/manual-grant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          adminEmail,
          email: newEmail.trim().toLowerCase(),
          notes: newNotes.trim() || 'Liberado manualmente pelo administrador Herisson',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Acesso liberado com sucesso para ${newEmail}!` });
        setNewEmail('');
        setNewNotes('');
        fetchMembers();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Falha ao liberar membro.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Erro de conexão com o servidor.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revogar acesso
  const handleRevoke = async (email: string) => {
    if (!confirm(`Deseja realmente revogar o acesso de ${email}?`)) return;

    try {
      const res = await fetch('/api/admin/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ adminEmail, email, notes: 'Acesso revogado pelo administrador' }),
      });
      const data = await res.json();
      if (data.success) {
        fetchMembers();
      } else {
        alert(data.error || 'Erro ao revogar');
      }
    } catch (err) {
      alert('Falha ao conectar com servidor.');
    }
  };

  // Excluir membro
  const handleDelete = async (email: string) => {
    if (!confirm(`Deseja excluir ${email} permanentemente do registro?`)) return;

    try {
      const res = await fetch('/api/admin/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ adminEmail, email }),
      });
      const data = await res.json();
      if (data.success) {
        fetchMembers();
      }
    } catch {}
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

  const filteredMembers = members.filter((m) =>
    m.email.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-gradient-to-b from-[#0b101c] via-[#080d16] to-black border border-cyan-500/50 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.3)] overflow-hidden font-mono">
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
                  ADM EXCLUSIVO
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Gestão de Membros CandleX-IA & Validação de Acesso Corretora Hiove
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchMembers}
              disabled={loading}
              title="Recarregar Lista"
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
                Total Registros
              </span>
              <div className="text-2xl font-black text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" />
                <span>{stats.total}</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl space-y-1">
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">
                Membros Liberados
              </span>
              <div className="text-2xl font-black text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>{stats.activeCount}</span>
              </div>
            </div>

            <div className="p-3 bg-rose-950/30 border border-rose-500/40 rounded-2xl space-y-1">
              <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider block">
                Depósito Pendente
              </span>
              <div className="text-2xl font-black text-rose-300 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <span>{stats.pendingCount}</span>
              </div>
            </div>

            <div className="p-3 bg-neutral-900/80 border border-neutral-800 rounded-2xl space-y-1">
              <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider block">
                Chave API Hiove
              </span>
              <div className="text-xs font-bold text-cyan-300 truncate pt-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">{hioveKeyPreview || 'hiove_da2db...673e'}</span>
              </div>
            </div>
          </div>

          {/* 2. Grid com Testador da API Hiove e Liberação Manual */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Testar E-mail na API da Hiove */}
            <div className="p-4 bg-gradient-to-b from-neutral-900/90 to-black border border-cyan-500/30 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-cyan-300 font-bold">
                <Search className="w-4 h-4 text-cyan-400" />
                <span>Consultar Status Real na API Hiove</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Envie o e-mail do cliente para verificar na Hiove se já possui cadastro e depósito confirmado.
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
                  {isTesting ? 'Consultando...' : 'Testar'}
                </button>
              </form>

              {testResult && (
                <div className="p-3 bg-black/60 rounded-xl border border-neutral-800 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Resposta da API:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded ${
                        testResult.access === true
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : 'bg-rose-950 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      {testResult.access === true ? '✅ Acesso: TRUE (Depositou)' : '❌ Acesso: FALSE (Sem Depósito)'}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    HTTP Status: {testResult.status || 200}
                  </div>
                  {testResult.raw && (
                    <pre className="text-[9px] text-neutral-400 bg-neutral-950 p-1.5 rounded overflow-x-auto">
                      {JSON.stringify(testResult.raw, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Box 2: Liberação Manual de Membro */}
            <div className="p-4 bg-gradient-to-b from-neutral-900/90 to-black border border-emerald-500/30 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-emerald-300 font-bold">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Liberar Acesso Manualmente</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Libere imediatamente o acesso de um membro no banco de dados sem depender de consulta da Hiove.
              </p>

              <form onSubmit={handleAddManual} className="space-y-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e-mail do aluno/membro"
                  className="w-full bg-black/70 border border-neutral-700 rounded-xl px-3 py-2 text-white placeholder:text-neutral-600 outline-none focus:border-emerald-400"
                />
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Observação (ex: Aluno Mentoria VIP)"
                  className="w-full bg-black/70 border border-neutral-700 rounded-xl px-3 py-1.5 text-white placeholder:text-neutral-600 outline-none focus:border-emerald-400 text-[11px]"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-neutral-950 font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Liberando...' : 'Liberar Membro Agora'}
                </button>
              </form>

              {actionMessage && (
                <div
                  className={`p-2 rounded-xl text-[11px] font-bold ${
                    actionMessage.type === 'success'
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-950/40 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  {actionMessage.text}
                </div>
              )}
            </div>
          </div>

          {/* 3. Tabela de Membros Cadastrados */}
          <div className="p-4 bg-neutral-900/80 border border-neutral-800 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-white font-bold">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Base de Membros Cadastrados</span>
                <span className="text-[10px] text-neutral-400">({filteredMembers.length})</span>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filtrar por e-mail..."
                  className="w-full pl-8 pr-3 py-1.5 bg-black/60 border border-neutral-700 rounded-xl text-white placeholder:text-neutral-500 outline-none focus:border-cyan-400 text-[11px]"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-800 text-[10px] text-neutral-400 uppercase tracking-wider">
                    <th className="py-2 px-3">E-mail</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Origem</th>
                    <th className="py-2 px-3">Data</th>
                    <th className="py-2 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 font-mono">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-neutral-500">
                        Nenhum membro encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((m) => {
                      const isMaster = m.email === adminEmail;
                      return (
                        <tr key={m.email} className="hover:bg-neutral-800/30 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <span>{m.email}</span>
                              {isMaster && (
                                <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-black">
                                  MASTER ADM
                                </span>
                              )}
                            </div>
                            {m.notes && (
                              <div className="text-[10px] text-neutral-400">{m.notes}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                                m.hasAccess
                                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40'
                                  : 'bg-rose-950/50 text-rose-300 border-rose-500/40'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  m.hasAccess ? 'bg-emerald-400' : 'bg-rose-400'
                                }`}
                              />
                              {m.hasAccess ? 'LIBERADO' : 'PENDENTE'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[10px] text-neutral-400">
                            {m.source === 'ADMIN_BYPASS'
                              ? 'Admin Master'
                              : m.source === 'ADMIN_MANUAL'
                              ? 'Manual'
                              : 'API Hiove'}
                          </td>
                          <td className="py-2.5 px-3 text-[10px] text-neutral-400">
                            {new Date(m.firstValidatedAt).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {!isMaster && (
                              <div className="flex items-center justify-end gap-1.5">
                                {m.hasAccess ? (
                                  <button
                                    onClick={() => handleRevoke(m.email)}
                                    title="Revogar Acesso"
                                    className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-500/40 rounded-lg transition-colors cursor-pointer text-[10px]"
                                  >
                                    Bloquear
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setNewEmail(m.email);
                                      handleAddManual({ preventDefault: () => {} } as any);
                                    }}
                                    title="Liberar Acesso"
                                    className="px-2 py-1 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 rounded-lg transition-colors cursor-pointer text-[10px]"
                                  >
                                    Liberar
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(m.email)}
                                  title="Excluir Registro"
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
            <span>Sessão ativa como <strong>{adminEmail}</strong></span>
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
