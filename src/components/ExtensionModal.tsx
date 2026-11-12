import React, { useState } from 'react';
import { X, Chrome, Download, Check, Copy, ExternalLink, ShieldCheck, Sparkles, FolderOpen, Zap, Layers } from 'lucide-react';
import { HIOVE_LOGIN_URL } from './HioveBrokerBackground';

interface ExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExtensionModal: React.FC<ExtensionModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'INSTRUCOES' | 'MANIFEST' | 'CONTENT_SCRIPT' | 'PAGE_HOOK'>('INSTRUCOES');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  if (!isOpen) return null;

  const manifestContent = JSON.stringify(
    {
      manifest_version: 3,
      name: "ClandeX-IA — Sincronizador de Cotações Hiove",
      version: "2.0.0",
      description: "Sincroniza as cotações em tempo real da corretora Hiove diretamente com o ClandeX-IA para apuração perfeita de WIN e LOSS no placar.",
      permissions: ["storage", "activeTab"],
      host_permissions: [
        "https://app.hiove.com/*",
        "https://*.hiove.com/*",
        "https://hiove.io/*",
        "https://*.hiove.io/*",
        "http://localhost:*/*",
        "http://127.0.0.1:*/*"
      ],
      background: {
        service_worker: "background.js"
      },
      content_scripts: [
        {
          matches: [
            "https://app.hiove.com/*",
            "https://*.hiove.com/*",
            "https://hiove.io/*",
            "https://*.hiove.io/*"
          ],
          js: ["content_script.js"],
          css: ["hud_styles.css"],
          run_at: "document_start",
          all_frames: true
        }
      ],
      web_accessible_resources: [
        {
          resources: ["page_hook.js"],
          matches: ["https://app.hiove.com/*", "https://*.hiove.com/*", "https://hiove.io/*", "https://*.hiove.io/*"]
        }
      ]
    },
    null,
    2
  );

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
    // Baixa o arquivo README explicativo e arquivos essenciais
    const readmeContent = `========================================================================
CLANDEX-IA 2.0 — EXTENSÃO CHROME PARA SINCRONIZAÇÃO DE COTAÇÃO DA HIOVE
========================================================================

COMO INSTALAR NO GOOGLE CHROME (30 Segundos):
1. No Chrome, digite: chrome://extensions e aperte ENTER.
2. Ative a chave "Modo do desenvolvedor" no canto superior direito.
3. Clique em "Carregar sem compactação" no canto superior esquerdo.
4. Selecione esta pasta onde estes arquivos estão salvos.
5. Abra a Hiove! Um badge verde confirmará a sincronização com 0ms de delay!
========================================================================`;
    downloadFile('README.txt', readmeContent, 'text/plain');
    setTimeout(() => downloadFile('manifest.json', manifestContent, 'application/json'), 150);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFile(id);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Chrome className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <span>EXTENSÃO CHROME • COTAÇÃO DIRETA DA HIOVE</span>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                  0ms LATÊNCIA
                </span>
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-neutral-800/80 bg-neutral-900/40 text-xs font-mono">
          <button
            onClick={() => setActiveTab('INSTRUCOES')}
            className={`px-3 py-2 border-b-2 font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${activeTab === 'INSTRUCOES'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-neutral-400 hover:text-white'
              }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Passo a Passo Rápido</span>
          </button>
          <button
            onClick={() => setActiveTab('MANIFEST')}
            className={`px-3 py-2 border-b-2 font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${activeTab === 'MANIFEST'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-neutral-400 hover:text-white'
              }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>manifest.json</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-neutral-300 custom-scrollbar">
          {activeTab === 'INSTRUCOES' && (
            <div className="space-y-4">
              {/* Ready on Disk Banner */}
              <div className="p-3 bg-emerald-950/30 border border-emerald-500/50 rounded-xl space-y-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>A Extensão já está pronta e gravada no seu projeto!</span>
                </div>
                <p className="text-neutral-300 text-[11px] leading-relaxed">
                  Os arquivos da extensão foram criados na pasta pública do projeto. Você não precisa baixar nada se estiver no mesmo computador onde o projeto roda:
                </p>
                <div className="flex items-center justify-between p-2 bg-black/70 border border-emerald-500/40 rounded-lg font-mono text-[10px] text-emerald-200">
                  <div className="flex items-center gap-1.5 truncate">
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">public/clandex-extension</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard('public/clandex-extension', 'folder_path')}
                    className="ml-2 px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 hover:bg-emerald-900 text-emerald-300 cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    {copiedFile === 'folder_path' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedFile === 'folder_path' ? 'Copiado' : 'Copiar Caminho'}</span>
                  </button>
                </div>
              </div>

              {/* Step by step guide */}
              <div className="space-y-2.5">
                <span className="font-semibold text-white uppercase text-xs tracking-wider block font-mono">
                  COMO ATIVAR NO CHROME / EDGE / BRAVE (EM 4 PASSOS):
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl space-y-1">
                    <span className="font-bold text-cyan-400 font-mono">1. ABRIR EXTENSÕES</span>
                    <p className="text-neutral-400">
                      No navegador Google Chrome ou Brave, digite na barra de endereços: <code className="text-cyan-300 font-mono bg-black/60 px-1 py-0.5 rounded">chrome://extensions</code> e pressione Enter.
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl space-y-1">
                    <span className="font-bold text-cyan-400 font-mono">2. MODO DESENVOLVEDOR</span>
                    <p className="text-neutral-400">
                      Ative a chave seletora <strong>"Modo do desenvolvedor"</strong> (Developer mode) localizada no canto superior direito da tela de extensões.
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl space-y-1">
                    <span className="font-bold text-emerald-400 font-mono">3. CARREGAR SEM COMPACTAÇÃO</span>
                    <p className="text-neutral-400">
                      Clique no botão <strong>"Carregar sem compactação"</strong> (Load unpacked) no canto superior esquerdo.
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl space-y-1">
                    <span className="font-bold text-emerald-400 font-mono">4. SELECIONAR A PASTA</span>
                    <p className="text-neutral-400">
                      Navegue até a pasta do projeto e selecione a pasta: <strong className="text-emerald-300">public/clandex-extension</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* What Happens Next */}
              <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 text-cyan-300 font-bold font-mono">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>O que acontece após ativar?</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-neutral-300">
                  <li>O ClandeX-IA detectará a extensão instantaneamente e o selo mudará para <strong className="text-emerald-400">"HIOVE CORRETORA (FEED DIRETO) • 0ms"</strong>.</li>
                  <li>A cotação de abertura e fechamento da vela será extraída <strong>diretamente da corretora Hiove</strong> em tempo real.</li>
                  <li>Zero divergência de placar: o WIN e LOSS baterão exatamente com o que a corretora finalizou!</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'MANIFEST' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-300 text-xs font-mono">public/clandex-extension/manifest.json</span>
                <button
                  onClick={() => copyToClipboard(manifestContent, 'manifest')}
                  className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline cursor-pointer"
                >
                  {copiedFile === 'manifest' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedFile === 'manifest' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-[10.5px] font-mono text-cyan-200/90 overflow-x-auto max-h-60 custom-scrollbar">
                {manifestContent}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-t border-neutral-800">
          <a
            href={HIOVE_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            <span>Abrir Hiove (app.hiove.com) ↗</span>
          </a>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadAll}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Baixar Instruções (.txt)</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              Entendido / Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
