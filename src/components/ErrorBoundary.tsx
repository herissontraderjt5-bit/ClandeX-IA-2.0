import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, ShieldAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ClandeX-IA ErrorBoundary] Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetStorage = () => {
    try {
      localStorage.removeItem('clandex_active_strategies');
      localStorage.removeItem('clandex_settings');
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#05070c] text-white flex items-center justify-center p-4 font-mono select-none">
          <div className="max-w-md w-full bg-neutral-900/90 border border-rose-500/50 rounded-2xl p-6 shadow-[0_0_50px_rgba(244,63,94,0.25)] space-y-4">
            <div className="flex items-center gap-3 border-b border-rose-500/30 pb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/60 flex items-center justify-center text-rose-400">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-sm font-black text-rose-300">CLANDEX-IA • RECUPERAÇÃO</h1>
                <p className="text-[10px] text-neutral-400">Ocorreu um erro inesperado na renderização</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/60 border border-neutral-800 text-[11px] text-neutral-300 space-y-2">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Mensagem do Erro:</span>
              </div>
              <div className="text-[10px] text-rose-300 bg-rose-950/30 p-2 rounded border border-rose-500/30 font-mono break-all max-h-32 overflow-y-auto">
                {this.state.error?.message || 'Erro desconhecido.'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={this.handleReload}
                className="py-2.5 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-500/30 transition-all active:scale-98"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Recarregar IA</span>
              </button>

              <button
                onClick={this.handleResetStorage}
                className="py-2.5 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-neutral-700 transition-all active:scale-98"
              >
                <span>Resetar Cache</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

