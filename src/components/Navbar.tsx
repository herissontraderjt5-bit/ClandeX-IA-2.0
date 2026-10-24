import React from 'react';
import {
  Activity,
  Sliders,
  Volume2,
  VolumeX,
  Chrome,
  ExternalLink,
  Shield,
  Layers,
  Radio,
  Clock
} from 'lucide-react';
import { AppSettings, DataSourceInfo } from '../types/trading';

interface NavbarProps {
  dataSource: DataSourceInfo;
  settings: AppSettings;
  activeTab: 'COCKPIT' | 'HUD_ONLY' | 'EXTENSION';
  onChangeTab: (tab: 'COCKPIT' | 'HUD_ONLY' | 'EXTENSION') => void;
  onOpenSettings: () => void;
  onToggleSound: () => void;
  onOpenExtensionModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  dataSource,
  settings,
  activeTab,
  onChangeTab,
  onOpenSettings,
  onToggleSound,
  onOpenExtensionModal,
}) => {
  const [time, setTime] = React.useState(new Date().toLocaleTimeString('pt-BR'));

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('pt-BR'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-30 w-full bg-neutral-950/80 backdrop-blur-xl border-b border-neutral-800/80 px-4 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center glow-cyan">
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-wider text-white">CLANDEX-IA</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/30 font-semibold">
                v1.0 • HIOVE
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 hidden sm:block">
              Inteligência Artificial & Confluências para Opções Binárias
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center p-1 bg-neutral-900 border border-neutral-800 rounded-xl text-xs">
          <button
            onClick={() => onChangeTab('COCKPIT')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'COCKPIT'
                ? 'bg-neutral-800 text-cyan-300 font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Cockpit Completo
          </button>
          <button
            onClick={() => onChangeTab('HUD_ONLY')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'HUD_ONLY'
                ? 'bg-neutral-800 text-cyan-300 font-bold shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            Foco no Painel HUD
          </button>
          <button
            onClick={onOpenExtensionModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-neutral-400 hover:text-cyan-300 font-medium transition-colors cursor-pointer"
          >
            <Chrome className="w-3.5 h-3.5 text-cyan-400" />
            Extensão Chrome
          </button>
        </div>

        {/* Live Feed Status & Quick Controls */}
        <div className="flex items-center gap-3">
          {/* Market Clock */}
          <div className="hidden lg:flex items-center gap-1.5 font-mono text-xs text-neutral-400 bg-neutral-900/60 px-3 py-1.5 rounded-lg border border-neutral-800/80">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{time}</span>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900/80 border border-neutral-800 rounded-lg text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                dataSource.status === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-rose-400'
              }`}
            />
            <span className="text-[11px] text-neutral-300 hidden md:inline">
              {dataSource.sourceType === 'DEMO_MODE' ? 'MODO DEMO' : 'MERCADO REAL'}
            </span>
            <span className="text-neutral-500 text-[10px]">({dataSource.latencyMs}ms)</span>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={onToggleSound}
            title={settings.soundEnabled ? 'Silenciar Áudio' : 'Ativar Sons'}
            className="p-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            {settings.soundEnabled ? (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-neutral-500" />
            )}
          </button>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="Configurações Técnicas"
            className="p-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
