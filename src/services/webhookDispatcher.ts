import { SignalRecord, WebhookConfig, WebhookLog } from '../types/trading';

class WebhookDispatcherService {
  private logs: WebhookLog[] = [];
  private onLogsUpdated: ((logs: WebhookLog[]) => void) | null = null;

  constructor() {
    this.loadLogs();
  }

  public setCallback(cb: (logs: WebhookLog[]) => void) {
    this.onLogsUpdated = cb;
  }

  public getLogs(): WebhookLog[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
    this.saveLogs();
    if (this.onLogsUpdated) this.onLogsUpdated(this.logs);
  }

  /**
   * Dispatch a real trading signal via Webhook
   */
  public async dispatchSignal(
    signal: SignalRecord,
    event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED',
    config: WebhookConfig
  ) {
    if (!config || !config.enabled || !config.url) return;

    if (event === 'PRE_ALERT' && !config.sendPreAlert) return;
    if (event === 'CONFIRMED' && !config.sendConfirmed) return;
    if (event === 'RESULT' && !config.sendResult) return;

    try {
      const response = await fetch('/api/webhook/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          format: config.format,
          secretToken: config.secretToken,
          customHeaders: config.customHeaders,
          event,
          signal,
        }),
      });

      const data = await response.json();
      const log: WebhookLog = {
        id: `wh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        formattedTime: new Date().toLocaleTimeString('pt-BR'),
        event,
        url: config.url,
        status: data.success ? 'SUCCESS' : 'ERROR',
        httpCode: data.status,
        responseMessage: data.message || (data.success ? 'Entregue com sucesso' : 'Falha no envio'),
        payloadPreview: `${signal.asset} ${signal.direction} (${signal.timeframe})`,
      };

      this.addLog(log);
    } catch (err: any) {
      const log: WebhookLog = {
        id: `wh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        formattedTime: new Date().toLocaleTimeString('pt-BR'),
        event,
        url: config.url,
        status: 'ERROR',
        responseMessage: err.message || 'Erro de rede ao despachar webhook',
        payloadPreview: `${signal.asset} ${signal.direction}`,
      };
      this.addLog(log);
    }
  }

  /**
   * Test the webhook connection directly from UI
   */
  public async testConnection(config: WebhookConfig): Promise<{
    success: boolean;
    status: number;
    message: string;
    elapsedMs?: number;
    preview?: string;
  }> {
    if (!config.url) {
      return { success: false, status: 0, message: 'Insira uma URL de Webhook válida.' };
    }

    try {
      const response = await fetch('/api/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          format: config.format,
          secretToken: config.secretToken,
          customHeaders: config.customHeaders,
        }),
      });

      const data = await response.json();
      const log: WebhookLog = {
        id: `wh_test_${Date.now()}`,
        timestamp: Date.now(),
        formattedTime: new Date().toLocaleTimeString('pt-BR'),
        event: 'TEST',
        url: config.url,
        status: data.success ? 'SUCCESS' : 'ERROR',
        httpCode: data.status,
        responseMessage: data.message || 'Teste concluído',
        payloadPreview: 'Teste de Conexão ClandeX-IA',
      };
      this.addLog(log);

      return {
        success: data.success,
        status: data.status || 0,
        message: data.message || (data.success ? 'Conexão efetuada com sucesso!' : 'Erro na entrega'),
        elapsedMs: data.elapsedMs,
        preview: data.responsePreview,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 0,
        message: `Falha ao testar webhook: ${err.message}`,
      };
    }
  }

  private addLog(log: WebhookLog) {
    this.logs.unshift(log);
    if (this.logs.length > 50) this.logs.pop();
    this.saveLogs();
    if (this.onLogsUpdated) {
      this.onLogsUpdated(this.logs);
    }
  }

  private saveLogs() {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('clandex_webhook_logs', JSON.stringify(this.logs));
      }
    } catch {}
  }

  private loadLogs() {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('clandex_webhook_logs');
        if (stored) {
          this.logs = JSON.parse(stored);
        }
      }
    } catch {}
  }
}

export const webhookDispatcher = new WebhookDispatcherService();
