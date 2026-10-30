import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Sparkles,
  UserPlus,
  Coins,
  KeyRound,
  Zap,
  Check,
} from 'lucide-react';
import { UserSession } from '../types/trading';

export const HIOVE_AFFILIATE_URL = 'https://hiove.io/gSBstV';

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

    // 1. Bypass Imediato para o Administrador Master (Herisson)
    // Permite logar instantaneamente sem depender de backend, conexão ou saldo
    const MASTER_ADMIN_EMAIL = 'herisson.trader.jt5@gmail.com';
    if (cleanEmail === MASTER_ADMIN_EMAIL) {
      setSuccessMessage('Bem-vindo, Herisson! Acesso de Administrador Master liberado.');
      const session: UserSession = {
        email: cleanEmail,
        name: 'Herisson',
        hasAccess: true,
        isAdmin: true,
        validatedAt: Date.now(),
        status: 'ACTIVE',
        source: 'ADMIN_BYPASS',
      };

      try {
        localStorage.setItem('clandex_user_session', JSON.stringify(session));
      } catch {}

      setTimeout(() => {
        onSuccess(session);
      }, 500);
      return;
    }

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
        setSuccessMessage('Conta Hiove e depósito confirmados! Acesso liberado.');
        const session: UserSession = {
          email: cleanEmail,
          name: data.name || cleanEmail.split('@')[0],
          hasAccess: true,
          hasDeposit: true,
          isAdmin: false,
          validatedAt: Date.now(),
          status: 'ACTIVE',
          source: data.cached ? 'CACHE' : 'HIOVE_API',
        };

        try {
          localStorage.setItem('clandex_user_session', JSON.stringify(session));
        } catch {}

        setTimeout(() => {
          onSuccess(session);
        }, 600);
      } else {
        setErrorMessage(
          data.message ||
            'Não conseguimos validar agora, tente em alguns minutos.'
        );
      }
    } catch {
      setErrorMessage(
        'Não conseguimos validar agora, tente em alguns minutos.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
      {/* Background Cyber Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-lg max-h-[94vh] overflow-y-auto p-5 sm:p-6 bg-gradient-to-b from-[#0c1322] via-[#080d17] to-black border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.25)] custom-scrollbar">
        {/* Top Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-amber-400 to-emerald-400" />

        {/* Brand Header */}
        <div className="text-center space-y-1.5 mb-5 pt-1">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.3)] mb-1">
            <Lock className="w-7 h-7 text-cyan-400" />
          </div>

          <h2 className="text-xl font-black font-mono tracking-wider text-white">
            CANDLEX-IA <span className="text-cyan-400">2.0</span>
          </h2>

          <p className="text-xs font-mono text-neutral-400">
            Acesso Institucional Exclusivo • Corretora Hiove
          </p>
        </div>

        {/* Informative Instructions for Registered Users */}
        <div className="p-3 bg-neutral-900/80 border border-neutral-800 rounded-2xl text-[11px] font-mono text-neutral-300 leading-relaxed mb-4 space-y-1">
          <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Já tem conta com depósito na Hiove?</span>
          </div>
          <p className="text-neutral-400 text-[10.5px]">
            Digite o mesmo e-mail cadastrado na corretora <strong>Hiove</strong> para autenticar e liberar seu acesso imediato aos sinais institucionais e IA.
          </p>
        </div>

        {/* Validation Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
              E-mail da sua conta na Hiove:
            </label>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="seu-email@gmail.com"
              required
              autoFocus
              disabled={loading}
              className="w-full bg-black/60 border border-neutral-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-neutral-600 outline-none transition-all"
            />
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/60 rounded-xl space-y-2 text-xs font-mono text-rose-300 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
              <div className="pt-1 border-t border-rose-500/20">
                <a
                  href={HIOVE_AFFILIATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 hover:text-amber-200 underline"
                >
                  <span>Clique aqui para criar sua conta na Hiove ↗</span>
                </a>
              </div>
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
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-cyan-400 hover:from-cyan-400 hover:to-emerald-400 text-neutral-950 font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
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

        {/* Visual Divider */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-[10px] font-mono uppercase">
            <span className="bg-[#080d17] px-3 text-amber-400 font-bold tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-amber-400" />
              Ainda não tem conta na corretora?
            </span>
          </div>
        </div>

        {/* Step-by-Step Registration & $10 Deposit Card */}
        <div className="p-4 bg-gradient-to-b from-amber-500/10 via-[#0e1628] to-black/90 border border-amber-500/40 rounded-2xl space-y-3.5 shadow-[0_0_25px_rgba(245,158,11,0.12)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs font-mono">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <span>Passo a Passo para Liberar Acesso</span>
            </div>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
              Depósito Mínimo: $10
            </span>
          </div>

          <div className="space-y-2.5 text-[11px] font-mono">
            {/* Passo 1 */}
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/50 border border-neutral-800/80">
              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 font-black text-xs shrink-0 border border-cyan-500/40">
                1
              </div>
              <div className="space-y-0.5">
                <div className="text-white font-bold flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Cadastrar sua Conta</span>
                </div>
                <p className="text-neutral-300 text-[10.5px] leading-relaxed">
                  Clique no botão abaixo e crie sua conta na corretora oficial <strong>Hiove</strong>.
                </p>
              </div>
            </div>

            {/* Passo 2 */}
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/50 border border-neutral-800/80">
              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-300 font-black text-xs shrink-0 border border-emerald-500/40">
                2
              </div>
              <div className="space-y-0.5">
                <div className="text-white font-bold flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Fazer Depósito Mínimo ($10)</span>
                </div>
                <p className="text-neutral-300 text-[10.5px] leading-relaxed">
                  Deposite a partir de apenas <strong className="text-emerald-400">$10 dólares</strong> (via PIX rápido ou Criptomoeda) para ativar sua conta na corretora.
                </p>
              </div>
            </div>

            {/* Passo 3 */}
            <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/50 border border-neutral-800/80">
              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-purple-500/20 text-purple-300 font-black text-xs shrink-0 border border-purple-500/40">
                3
              </div>
              <div className="space-y-0.5">
                <div className="text-white font-bold flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-purple-400" />
                  <span>Acessar o CandleX-IA</span>
                </div>
                <p className="text-neutral-300 text-[10.5px] leading-relaxed">
                  Volte a esta tela, digite o mesmo e-mail cadastrado na Hiove no formulário acima e clique em <strong className="text-cyan-300">Validar e Entrar</strong> para acesso vitalício!
                </p>
              </div>
            </div>
          </div>

          {/* Botão de Ação Direta para Criar Conta */}
          <a
            href={HIOVE_AFFILIATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-emerald-500 to-cyan-500 hover:from-amber-400 hover:via-emerald-400 hover:to-cyan-400 text-neutral-950 font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(245,158,11,0.35)] transition-all cursor-pointer group active:scale-98 text-center"
          >
            <span>CRIAR CONTA NA HIOVE (DEPÓSITO MÍNIMO $10)</span>
            <ExternalLink className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>

          {/* Vantagens Rápidas */}
          <div className="grid grid-cols-3 gap-1 pt-1 text-center font-mono text-[9px] text-neutral-400">
            <div className="flex items-center justify-center gap-1 bg-black/40 py-1 px-1.5 rounded-lg border border-neutral-800/60">
              <Check className="w-3 h-3 text-emerald-400" />
              <span>PIX Instantâneo</span>
            </div>
            <div className="flex items-center justify-center gap-1 bg-black/40 py-1 px-1.5 rounded-lg border border-neutral-800/60">
              <Check className="w-3 h-3 text-cyan-400" />
              <span>Corretora Hiove</span>
            </div>
            <div className="flex items-center justify-center gap-1 bg-black/40 py-1 px-1.5 rounded-lg border border-neutral-800/60">
              <Check className="w-3 h-3 text-amber-400" />
              <span>CandleX Liberado</span>
            </div>
          </div>
        </div>

        {/* Confidential Security Notice */}
        <div className="mt-4 pt-3 border-t border-neutral-800/80 text-center text-[10px] font-mono text-neutral-500">
          Acesso protegido por autenticação atômica criptografada via Hiove Access API.
        </div>
      </div>
    </div>
  );
};
