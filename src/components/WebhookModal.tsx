import React, { useState } from 'react';
import {
  X,
  Send,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  Code,
  Shield,
  HelpCircle,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Bot
} from 'lucide-react';
import { WebhookConfig, WebhookLog } from '../types/trading';
import { webhookDispatcher } from '../services/webhookDispatcher';

const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  url: '',
  format: 'STANDARD_JSON',
  sendPreAlert: false,
  sendConfirmed: true,
  sendResult: true,
};

interface WebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: WebhookConfig;
  onSaveConfig: (newConfig: WebhookConfig) => void;
}

export const WebhookModal: React.FC<WebhookModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [localConfig, setLocalConfig] = useState<WebhookConfig>(() => ({
    ...DEFAULT_WEBHOOK_CONFIG,
    ...(config || {}),
  }));
  const [testResult, setTestResult] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
    status?: number;
    elapsedMs?: number;
    preview?: string;
  } | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>(() => webhookDispatcher.getLogs());
  const [copiedPayload, setCopiedPayload] = useState(false);

  React.useEffect(() => {
    setLocalConfig({
      ...DEFAULT_WEBHOOK_CONFIG,
      ...(config || {}),
    });
  }, [config, isOpen]);

  React.useEffect(() => {
    webhookDispatcher.setCallback((newLogs) => {
      setLogs([...newLogs]);
    });
  }, []);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTestResult({ loading: true });
    const res = await webhookDispatcher.testConnection(localConfig);
    setTestResult({
      loading: false,
      success: res.success,
      message: res.message,
      status: res.status,
      elapsedMs: res.elapsedMs,
      preview: res.preview,
    });
    setLogs(webhookDispatcher.getLogs());
  };

  const handleSave = () => {
    onSaveConfig(localConfig);
    onClose();
  };

  const samplePayload = JSON.stringify(
    {
      event: "SIGNAL_CONFIRMED",
      source: "ClandeX-IA",
      timestamp: Date.now(),
      broker: "Hiove",
      signal: {
        id: "sig_sample_123",
        asset: "EUR/USD",
        timeframe: "M1",
        expiration: "1m",
        direction: "CALL",
        confluenceScore: 92,
        entryPrice: 1.08485,
        reasons: ["Padrão Engolfo de Alta", "SMC: Order Block Comprador", "TradingView: FORTE COMPRA"],
        tradingView: {
          symbol: "FX:EURUSD",
          recommendation: "FORTE COMPRA",
          rsi: 62,
          macdSignal: "BULLISH"
        }
      }
    },
    null,
    2
  );

  const copyPayloadExample = () => {
    navigator.clipboard.writeText(samplePayload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-900 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              EXPORTAÇÃO DE SINAIS VIA WEBHOOK (AUTOMAÇÃO EXTERNA)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs text-neutral-300">
          {/* Main Activation Toggle */}
          <div className="flex items-center justify-between p-3.5 bg-neutral-900/70 border border-neutral-800 rounded-xl">
            <div>
              <div className="font-bold text-white text-xs">Ativar Disparo Automático de Webhook</div>
              <p className="text-[11px] text-neutral-400">
                Envia requisições HTTP POST em tempo real para seu bot, servidor REST, Discord ou plataforma de automação (n8n/Zapier).
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.enabled}
                onChange={(e) => setLocalConfig({ ...localConfig, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          {/* Webhook URL Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              URL DO ENDPOINT / WEBHOOK (HTTP / HTTPS)
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://seu-servidor.com/api/sinais ou https://discord.com/api/webhooks/..."
                value={localConfig.url}
                onChange={(e) => setLocalConfig({ ...localConfig, url: e.target.value })}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testResult?.loading || !localConfig.url}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-cyan-300 font-bold rounded-xl border border-neutral-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {testResult?.loading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                )}
                {testResult?.loading ? 'Testando...' : 'Testar Conexão'}
              </button>
            </div>
          </div>

          {/* Test Result Feedback Box */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 transition-all ${
                testResult.success
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/20 border-rose-500/40 text-rose-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div className="font-bold flex items-center justify-between">
                  <span>{testResult.message}</span>
                  {testResult.elapsedMs && (
                    <span className="font-mono text-[10px] text-neutral-400">
                      {testResult.elapsedMs}ms
                    </span>
                  )}
                </div>
                {testResult.preview && (
                  <div className="text-[10px] text-neutral-400 font-mono truncate max-w-lg">
                    Resposta: {testResult.preview}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preset Format Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              FORMATO DO PAYLOAD DE EXPORTAÇÃO
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setLocalConfig({ ...localConfig, format: 'STANDARD_JSON' })}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  localConfig.format === 'STANDARD_JSON'
                    ? 'bg-cyan-500/20 border-cyan-500 text-white font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs text-cyan-400 mb-1">
                  <Code className="w-3.5 h-3.5" />
                  REST JSON Padrão
                </div>
                <p className="text-[10px] font-normal text-neutral-400">
                  Compatível com Servidores Node, Python, n8n, Zapier e APIs REST.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLocalConfig({ ...localConfig, format: 'DISCORD' })}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  localConfig.format === 'DISCORD'
                    ? 'bg-cyan-500/20 border-cyan-500 text-white font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs text-indigo-400 mb-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Discord Webhook
                </div>
                <p className="text-[10px] font-normal text-neutral-400">
                  Envia card com embeds coloridos (verde/vermelho) direto em canais do Discord.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLocalConfig({ ...localConfig, format: 'TELEGRAM' })}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  localConfig.format === 'TELEGRAM'
                    ? 'bg-cyan-500/20 border-cyan-500 text-white font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs text-sky-400 mb-1">
                  <Bot className="w-3.5 h-3.5" />
                  Telegram Bot API
                </div>
                <p className="text-[10px] font-normal text-neutral-400">
                  Mensagem formatada com Markdown para bots de canais ou grupos do Telegram.
                </p>
              </button>
            </div>
          </div>

          {/* Trigger Event Toggles */}
          <div className="space-y-2 p-3 bg-neutral-900/40 border border-neutral-800 rounded-xl">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              GATILHOS DE DISPARO DO WEBHOOK
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.sendConfirmed}
                  onChange={(e) => setLocalConfig({ ...localConfig, sendConfirmed: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Sinal Confirmado (Recomendado)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.sendPreAlert}
                  onChange={(e) => setLocalConfig({ ...localConfig, sendPreAlert: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Pré-Alerta (Aguardando)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.sendResult}
                  onChange={(e) => setLocalConfig({ ...localConfig, sendResult: e.target.checked })}
                  className="accent-cyan-400 rounded"
                />
                <span>Resultado (WIN / LOSS)</span>
              </label>
            </div>
          </div>

          {/* Security & Headers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                TOKEN SECRETO / BEARER (OPCIONAL)
              </label>
              <input
                type="password"
                placeholder="Insira token de autenticação..."
                value={localConfig.secretToken || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, secretToken: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[9px] text-neutral-500 block mt-1">
                Enviado no header <code>Authorization: Bearer</code> e <code>X-Webhook-Secret</code>.
              </span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                HEADERS PERSONALIZADOS (JSON OU CHAVE: VALOR)
              </label>
              <input
                type="text"
                placeholder='{"X-Custom-Key": "12345"}'
                value={localConfig.customHeaders || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, customHeaders: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[9px] text-neutral-500 block mt-1">
                Headers adicionais para autenticação de servidores próprios.
              </span>
            </div>
          </div>

          {/* JSON Payload Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                EXEMPLO DE PAYLOAD JSON ENVIADO
              </span>
              <button
                type="button"
                onClick={copyPayloadExample}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline cursor-pointer"
              >
                {copiedPayload ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedPayload ? 'Copiado!' : 'Copiar Exemplo'}
              </button>
            </div>
            <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-[10px] font-mono text-cyan-300 overflow-x-auto max-h-36">
              {samplePayload}
            </pre>
          </div>

          {/* Dispatch History Logs */}
          <div className="space-y-2 pt-2 border-t border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                HISTÓRICO RECENTE DE DISPAROS ({logs.length})
              </span>
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => webhookDispatcher.clearLogs()}
                  className="text-[10px] text-neutral-500 hover:text-rose-400 cursor-pointer"
                >
                  Limpar Histórico
                </button>
              )}
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-2 bg-neutral-900/60 border border-neutral-800/80 rounded-lg text-[11px] font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        log.status === 'SUCCESS' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <strong className="text-white">[{log.event}]</strong>
                    <span className="text-neutral-400 truncate max-w-[200px]">{log.payloadPreview}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={log.status === 'SUCCESS' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {log.httpCode ? `HTTP ${log.httpCode}` : log.status}
                    </span>
                    <span className="text-[10px] text-neutral-500">{log.formattedTime}</span>
                  </div>
                </div>
              ))}

              {logs.length === 0 && (
                <div className="py-4 text-center text-neutral-500 text-[11px]">
                  Nenhum webhook disparado ainda. Realize um teste para verificar a entrega.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 bg-neutral-900 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-neutral-400 hover:text-white rounded-xl text-xs font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            Salvar Configurações
          </button>
        </div>
      </div>
    </div>
  );
};
