import React from 'react';
import { AppSettings } from '../types/trading';
import { X, Sliders, Volume2, Shield, RefreshCw } from 'lucide-react';

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
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleResetDefaults = () => {
    const defaults: AppSettings = {
      ...localSettings,
      weights: {
        marketStructure: 25,
        priceAction: 25,
        supportResistance: 20,
        smc: 20,
        volatility: 10,
      },
      thresholds: {
        observation: 60,
        strong: 75,
        veryStrong: 90,
      },
      soundEnabled: true,
      preAlertSound: true,
      confirmedSound: true,
      defaultExpiration: '1m',
      activeMode: 'REAL',
    };
    setLocalSettings(defaults);
  };

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">CONFIGURAÇÕES DE CONFLUÊNCIAS & IA</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs text-neutral-300">
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

          {/* Weights Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-xs uppercase tracking-wider">
                PESOS DOS PILARES (TOTAL = 100)
              </span>
              <button
                onClick={handleResetDefaults}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
              >
                <RefreshCw className="w-3 h-3" /> Redefinir
              </button>
            </div>

            {/* Slider 1: Market Structure */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Estrutura de Mercado:</span>
                <span className="font-mono text-cyan-400 font-bold">{localSettings.weights.marketStructure} pts</span>
              </div>
              <input
                type="range"
                min="10"
                max="40"
                value={localSettings.weights.marketStructure}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    weights: { ...localSettings.weights, marketStructure: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Slider 2: Price Action */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Price Action:</span>
                <span className="font-mono text-cyan-400 font-bold">{localSettings.weights.priceAction} pts</span>
              </div>
              <input
                type="range"
                min="10"
                max="40"
                value={localSettings.weights.priceAction}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    weights: { ...localSettings.weights, priceAction: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Slider 3: Support & Resistance */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Suporte e Resistência:</span>
                <span className="font-mono text-cyan-400 font-bold">{localSettings.weights.supportResistance} pts</span>
              </div>
              <input
                type="range"
                min="5"
                max="35"
                value={localSettings.weights.supportResistance}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    weights: { ...localSettings.weights, supportResistance: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Slider 4: SMC */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Smart Money Concepts (SMC):</span>
                <span className="font-mono text-cyan-400 font-bold">{localSettings.weights.smc} pts</span>
              </div>
              <input
                type="range"
                min="5"
                max="35"
                value={localSettings.weights.smc}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    weights: { ...localSettings.weights, smc: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Slider 5: Volatility */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-neutral-400">Contexto de Volatilidade:</span>
                <span className="font-mono text-cyan-400 font-bold">{localSettings.weights.volatility} pts</span>
              </div>
              <input
                type="range"
                min="5"
                max="20"
                value={localSettings.weights.volatility}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    weights: { ...localSettings.weights, volatility: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Thresholds Section */}
          <div className="space-y-3 pt-2 border-t border-neutral-800">
            <span className="font-semibold text-white text-xs uppercase tracking-wider block">
              GATILHOS DE CLASSIFICAÇÃO
            </span>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-neutral-400 block mb-1">Observação:</span>
                <input
                  type="number"
                  min="50"
                  max="70"
                  value={localSettings.thresholds.observation}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      thresholds: { ...localSettings.thresholds, observation: Number(e.target.value) },
                    })
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-1.5 font-mono text-center text-white"
                />
              </div>

              <div>
                <span className="text-neutral-400 block mb-1">Confluência Forte:</span>
                <input
                  type="number"
                  min="70"
                  max="85"
                  value={localSettings.thresholds.strong}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      thresholds: { ...localSettings.thresholds, strong: Number(e.target.value) },
                    })
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-1.5 font-mono text-center text-white"
                />
              </div>

              <div>
                <span className="text-neutral-400 block mb-1">Muito Forte:</span>
                <input
                  type="number"
                  min="85"
                  max="98"
                  value={localSettings.thresholds.veryStrong}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      thresholds: { ...localSettings.thresholds, veryStrong: Number(e.target.value) },
                    })
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-1.5 font-mono text-center text-white"
                />
              </div>
            </div>
          </div>

          {/* Audio Toggles */}
          <div className="space-y-2 pt-2 border-t border-neutral-800">
            <span className="font-semibold text-white text-xs uppercase tracking-wider block">
              ALERTAS SONOROS
            </span>
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
