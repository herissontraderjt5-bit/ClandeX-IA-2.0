import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Activity,
  ExternalLink,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { UserSession } from '../types/trading';

interface AccessGateModalProps {
  isOpen: boolean;
  onSuccess: (session: UserSession) => void;
}

export const AccessGateModal: React.FC<AccessGateModalProps> = ({ isOpen, onSuccess }) => {
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length < 5) {
      setErrorMessage('Por favor, informe um endereço de e-mail válido.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/auth/validate-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: cleanEmail }),
      });

      const data = await response.json();

      if (data.access === true) {
        setSuccessMessage(data.message || 'Acesso validado com sucesso!');
        const session: UserSession = {
          email: cleanEmail,
          name: data.name || (cleanEmail === 'herisson.trader.jt5@gmail.com' ? 'Herisson' : cleanEmail.split('@')[0]),
          hasAccess: true,
          isAdmin: Boolean(data.isAdmin || cleanEmail === 'herisson.trader.jt5@gmail.com'),
          validatedAt: Date.now(),
          status: 'ACTIVE',
          source: data.cached ? 'CACHE' : 'HIOVE_API',
        };

        try {
          localStorage.setItem('clandex_user_session', JSON.stringify(session));
        } catch {}

        setTimeout(() => {
          onSuccess(session);
        }, 800);
      } else {
        setErrorMessage(
          data.message ||
            'Conta não validada na corretora Hiove. Para liberar seu acesso ao CandleX-IA, certifique-se de que sua conta na corretora Hiove está cadastrada com este e-mail e possui saldo ou depósito ativo.'
        );
      }
    } catch (err: any) {
      setErrorMessage('Não conseguimos validar agora, tente em alguns minutos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
      {/* Background Cyber Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-md p-6 bg-gradient-to-b from-[#0c1322] via-[#080d17] to-black border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.25)] overflow-hidden">
        {/* Top Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-500" />

        {/* Brand Header */}
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.3)] mb-2">
            <Lock className="w-7 h-7 text-cyan-400" />
          </div>

          <h2 className="text-xl font-black font-mono tracking-wider text-white">
            CANDLEX-IA <span className="text-cyan-400">2.0</span>
          </h2>

          <p className="text-xs font-mono text-neutral-400">
            Validação de Acesso Institucional • Corretora Hiove
          </p>
        </div>

        {/* Informative Instructions */}
        <div className="p-3 bg-neutral-900/80 border border-neutral-800 rounded-2xl text-[11px] font-mono text-neutral-300 leading-relaxed mb-5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Verificação de Conta Ativa</span>
          </div>
          <p>
            Informe o mesmo e-mail cadastrado na corretora <strong>Hiove</strong> com depósito ou saldo ativo para autenticar e liberar o seu acesso ao painel de confluências e sinais institucionais.
          </p>
        </div>

        {/* Validation Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
              E-mail da sua conta na Hiove:
            </label>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="exemplo@gmail.com"
              required
              autoFocus
              disabled={loading}
              className="w-full bg-black/60 border border-neutral-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-neutral-600 outline-none transition-all"
            />
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/60 rounded-xl flex items-start gap-2.5 text-xs font-mono text-rose-300 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Alert */}
          {successMessage && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-500/60 rounded-xl flex items-start gap-2.5 text-xs font-mono text-emerald-300 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-cyan-400 hover:from-cyan-400 hover:to-emerald-400 text-neutral-950 font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin" />
                <span>CONSULTANDO CORRETORA HIOVE...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 stroke-[2.5]" />
                <span>VALIDAR E ENTRAR NO SISTEMA</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Confidential Security Notice */}
        <div className="mt-5 pt-4 border-t border-neutral-800/80 text-center text-[10px] font-mono text-neutral-500">
          Acesso protegido por autenticação atômica criptografada via Hiove Access API.
        </div>
      </div>
    </div>
  );
};
