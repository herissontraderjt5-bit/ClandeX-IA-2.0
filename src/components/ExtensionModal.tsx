import React, { useState } from 'react';
import { X, Chrome, Download, Check, Copy, ExternalLink, Shield, Code, Sparkles } from 'lucide-react';

interface ExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExtensionModal: React.FC<ExtensionModalProps> = ({ isOpen, onClose }) => {
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  if (!isOpen) return null;

  const manifestContent = JSON.stringify(
    {
      manifest_version: 3,
      name: "ClandeX-IA — HUD Flutuante Hiove",
      version: "1.0.0",
      description: "Painel flutuante com confluências de Price Action e SMC para a corretora Hiove.",
      permissions: ["storage", "activeTab"],
      host_permissions: ["https://app.hiove.com/*", "https://*.hiove.com/*", "https://hiove.io/*", "https://*.hiove.io/*"],
      action: {
        default_title: "Abrir ClandeX-IA HUD",
      },
      content_scripts: [
        {
          matches: ["https://app.hiove.com/*", "https://*.hiove.com/*", "https://hiove.io/*", "https://*.hiove.io/*"],
          js: ["content_script.js"],
          css: ["hud_styles.css"],
          run_at: "document_idle"
        }
      ]
    },
    null,
    2
  );

  const contentScriptContent = `// ClandeX-IA Hiove Injector
(function() {
  if (window.__CLANDEX_INITIALIZED__) return;
  window.__CLANDEX_INITIALIZED__ = true;

  console.log('[ClandeX-IA] Integrando painel flutuante à corretora Hiove...');

  const hudContainer = document.createElement('div');
  hudContainer.id = 'clandex-hud-root';
  hudContainer.style.position = 'fixed';
  hudContainer.style.top = '70px';
  hudContainer.style.right = '20px';
  hudContainer.style.zIndex = '999999';
  hudContainer.style.width = '380px';
  hudContainer.style.backgroundColor = 'rgba(8, 9, 12, 0.95)';
  hudContainer.style.border = '1px solid rgba(6, 182, 212, 0.4)';
  hudContainer.style.borderRadius = '16px';
  hudContainer.style.boxShadow = '0 10px 35px rgba(0,0,0,0.8), 0 0 15px rgba(6, 182, 212, 0.2)';
  hudContainer.style.color = '#e2e8f0';
  hudContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  hudContainer.style.padding = '12px';

  hudContainer.innerHTML = \`
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #262626;padding-bottom:8px;margin-bottom:10px;">
      <div style="font-weight:bold;color:#00e5ff;font-size:12px;">CLANDEX-IA • HIOVE HUD</div>
      <div style="font-size:10px;color:#4ade80;">CONECTADO</div>
    </div>
    <div style="font-size:11px;color:#a3a3a3;margin-bottom:6px;">Sincronizado com mercado aberto</div>
    <div id="clandex-signal-box" style="padding:8px;border-radius:8px;background:rgba(23,23,23,0.8);border:1px solid #404040;font-size:12px;text-align:center;font-weight:bold;">
      AGUARDANDO OPORTUNIDADE
    </div>
  \`;

  document.body.appendChild(hudContainer);
})();`;

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    downloadFile('manifest.json', manifestContent, 'application/json');
    setTimeout(() => {
      downloadFile('content_script.js', contentScriptContent, 'text/javascript');
    }, 200);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFile(id);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Chrome className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              EXTENSÃO GOOGLE CHROME PARA A CORRETORA HIOVE
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs text-neutral-300">
          <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Operação Flutuante Direta sobre a Hiove (hiove.io)
            </div>
            <p className="text-neutral-400 text-[11px] leading-relaxed">
              A extensão ClandeX-IA permite que o painel flutuante arrastável seja renderizado diretamente sobre a tela de trading da corretora Hiove, sem cobrir o gráfico de execução de ordens.
            </p>
          </div>

          {/* Step by step guide */}
          <div className="space-y-3">
            <span className="font-semibold text-white uppercase text-xs tracking-wider block">
              COMO INSTALAR NO GOOGLE CHROME (PASSO A PASSO):
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1">
                <span className="font-bold text-cyan-400 font-mono">1. BAIXAR ARQUIVOS</span>
                <p className="text-neutral-400">
                  Clique no botão abaixo para baixar os arquivos do pacote da extensão (manifest.json e content_script.js) e guarde em uma pasta chamada "clandex-extension".
                </p>
              </div>

              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1">
                <span className="font-bold text-cyan-400 font-mono">2. ABRIR EXTENSÕES</span>
                <p className="text-neutral-400">
                  No Chrome, digite na barra de endereço: <code className="text-cyan-300">chrome://extensions</code> e pressione Enter.
                </p>
              </div>

              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1">
                <span className="font-bold text-cyan-400 font-mono">3. MODO DESENVOLVEDOR</span>
                <p className="text-neutral-400">
                  Ative a chave <strong>"Modo do desenvolvedor"</strong> localizada no canto superior direito do navegador.
                </p>
              </div>

              <div className="p-2.5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-1">
                <span className="font-bold text-cyan-400 font-mono">4. CARREGAR SEM COMPACTAÇÃO</span>
                <p className="text-neutral-400">
                  Clique no botão <strong>"Carregar sem compactação"</strong> e selecione a pasta com os arquivos baixados.
                </p>
              </div>
            </div>
          </div>

          {/* Quick file view / copy */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-300 text-xs">manifest.json</span>
              <button
                onClick={() => copyToClipboard(manifestContent, 'manifest')}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
              >
                {copiedFile === 'manifest' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedFile === 'manifest' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-[10px] font-mono text-cyan-200/80 overflow-x-auto max-h-36">
              {manifestContent}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-t border-neutral-800">
          <a
            href="https://hiove.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            Visitar Hiove (hiove.io)
          </a>

          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-2 px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar Arquivos da Extensão (.js / .json)
          </button>
        </div>
      </div>
    </div>
  );
};
