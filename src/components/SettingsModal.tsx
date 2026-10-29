import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types/trading';
import { X, Sliders, Volume2, Shield, RefreshCw, CheckCircle2, Sparkles, Clock, Check } from 'lucide-react';
import { marketDataManager } from '../services/marketData';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    // Preserva pesos institucionais padrão calibrados
    const calibratedSettings: AppSettings = {
      ...localSettings,
      weights: {
        marketStructure: localSettings.weights?.marketStructure ?? 25,
        priceAction: localSettings.weights?.priceAction ?? 25,
        supportResistance: localSettings.weights?.supportResistance ?? 20,
        smc: localSettings.weights?.smc ?? 20,
        volatility: localSettings.weights?.volatility ?? 10,
      },
      thresholds: {
        observation: localSettings.thresholds?.observation ?? 60,
        strong: localSettings.thresholds?.strong ?? 75,
        veryStrong: localSettings.thresholds?.veryStrong ?? 90,
      },
    };
    onSaveSettings(calibratedSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">CONFIGURAÇÕES • CANDLEX-IA</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-neutral-300">
          {/* Card Informativo de Parâmetros Institucionais Padronizados */}
          <div className="p-3.5 bg-gradient-to-br from-cyan-950/40 via-neutral-900/70 to-neutral-950 border border-cyan-500/30 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>PADRÃO INSTITUCIONAL ATIVO</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" /> Calibrado
              </span>
            </div>
            <p className="text-[11px] text-neutral-300 leading-relaxed">
              Todos os pesos dos pilares de confluência, gatilhos de assertividade e integrações de IA e banco de dados estão pré-configurados com o padrão institucional do CandleX-IA para máxima assertividade na Hiove.
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] font-mono text-neutral-400">
              <div className="p-1.5 bg-black/40 rounded border border-neutral-800 flex items-center justify-between">
                <span>Estrutura / Price Action:</span>
                <span className="text-cyan-400 font-bold">25% / 25%</span>
              </div>
              <div className="p-1.5 bg-black/40 rounded border border-neutral-800 flex items-center justify-between">
                <span>Suporte & Res. / SMC:</span>
                <span className="text-cyan-400 font-bold">20% / 20%</span>
              </div>
              <div className="p-1.5 bg-black/40 rounded border border-neutral-800 flex items-center justify-between">
                <span>Gatilho Confirmação:</span>
                <span className="text-emerald-400 font-bold">≥ 75%</span>
              </div>
              <div className="p-1.5 bg-black/40 rounded border border-neutral-800 flex items-center justify-between">
                <span>Motor de IA Neural:</span>
                <span className="text-emerald-400 font-bold">Ativo</span>
              </div>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-2">
            <span className="font-semibold text-white block text-xs">MODO DE OPERAÇÃO & COTAÇÕES</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLocalSettings({ ...localSettings, activeMode: 'REAL' })}
                className={`py-2 px-3 rounded-lg border text-center font-medium transition-all cursor-pointer ${
                  localSettings.activeMode === 'REAL'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                MERCADO REAL (Ao Vivo)
              </button>
              <button
                type="button"
                onClick={() => setLocalSettings({ ...localSettings, activeMode: 'DEMO' })}
                className={`py-2 px-3 rounded-lg border text-center font-medium transition-all cursor-pointer ${
                  localSettings.activeMode === 'DEMO'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                DEMO / TESTE SIMULADO
              </button>
            </div>
          </div>

          {/* Sincronização de Cronograma com a Corretora Hiove */}
          <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-white block text-xs">SINCRONISMO COM A HIOVE (CRONOGRAMA)</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await marketDataManager.syncServerTime();
                }}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Calibrar Relógio
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Sincroniza o relógio da IA com a virada de vela na corretora Hiove para envio milimétrico dos alertas aos 5 segundos finais.
            </p>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Ajuste Fino de Segundos:</span>
                <span className="font-mono text-cyan-400 font-bold">
                  {(localSettings.timerOffsetSeconds || 0) > 0 ? `+${localSettings.timerOffsetSeconds || 0}` : (localSettings.timerOffsetSeconds || 0)}s
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="-15"
                  max="15"
                  step="1"
                  value={localSettings.timerOffsetSeconds || 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setLocalSettings({ ...localSettings, timerOffsetSeconds: val });
                    marketDataManager.setManualOffsetSec(val);
                  }}
                  className="flex-1 accent-cyan-400 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => {
                    setLocalSettings({ ...localSettings, timerOffsetSeconds: 0 });
                    marketDataManager.setManualOffsetSec(0);
                  }}
                  className="px-2.5 py-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded cursor-pointer transition-colors"
                >
                  Zerar
                </button>
              </div>
            </div>
          </div>

          {/* Audio Toggles */}
          <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-white block text-xs uppercase tracking-wider">
                ALERTAS SONOROS
              </span>
            </div>
            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.soundEnabled}
                  onChange={(e) => setLocalSettings({ ...localSettings, soundEnabled: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Habilitar Áudio Global</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.preAlertSound}
                  onChange={(e) => setLocalSettings({ ...localSettings, preAlertSound: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Som de Pré-Alerta (Duplo Beep suave)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.confirmedSound}
                  onChange={(e) => setLocalSettings({ ...localSettings, confirmedSound: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Som de Sinal Confirmado (Harmonia CALL/PUT)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 bg-neutral-900 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-neutral-400 hover:text-white rounded-xl text-xs font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
          >
            Salvar Preferências
          </button>
        </div>
      </div>
    </div>
  );
};
