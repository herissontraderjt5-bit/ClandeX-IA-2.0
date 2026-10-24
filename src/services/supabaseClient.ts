import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppSettings, SignalRecord, WebhookLog } from '../types/trading';

export const DEFAULT_SUPABASE_URL = 'https://qxojtaqselrgitdmmora.supabase.co';

export const getSupabaseConfig = () => {
  let envUrl = '';
  let envKey = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      envUrl = import.meta.env.VITE_SUPABASE_URL || '';
      envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    }
  } catch {}

  const localKey = typeof window !== 'undefined' ? localStorage.getItem('clandex_supabase_anon_key') || '' : '';
  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('clandex_supabase_url') || '' : '';

  const url = localUrl || envUrl || DEFAULT_SUPABASE_URL;
  const key = localKey || envKey || '';

  return { url, key };
};

export const setSupabaseCredentials = (url: string, anonKey: string) => {
  if (typeof window !== 'undefined') {
    if (url) localStorage.setItem('clandex_supabase_url', url.trim());
    if (anonKey) localStorage.setItem('clandex_supabase_anon_key', anonKey.trim());
  }
};

let clientInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient | null => {
  if (clientInstance) return clientInstance;
  const { url, key } = getSupabaseConfig();
  if (url && key && key.length > 10) {
    try {
      clientInstance = createClient(url, key, {
        auth: { persistSession: false },
      });
      return clientInstance;
    } catch (e) {
      console.error('[Supabase] Falha ao inicializar cliente:', e);
      return null;
    }
  }
  return null;
};

export const isSupabaseConfigured = (): boolean => {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key && key.length > 10);
};

export const testSupabaseConnection = async (): Promise<{ success: boolean; message: string }> => {
  const sb = getSupabase();
  if (!sb) {
    return {
      success: false,
      message: 'Chave pública (Anon Key) do Supabase não configurada.',
    };
  }
  try {
    const { error } = await sb.from('signals').select('id').limit(1);
    if (error) {
      return { success: false, message: `Erro ao conectar: ${error.message}` };
    }
    return { success: true, message: 'Conexão ativa com o banco Supabase em tempo real!' };
  } catch (err: any) {
    return { success: false, message: `Falha de rede: ${err.message}` };
  }
};

/**
 * Normaliza SignalRecord para o formato da tabela SQL no Supabase
 */
export function mapSignalToRow(signal: SignalRecord) {
  return {
    id: signal.id,
    timestamp: signal.timestamp,
    formatted_time: signal.formattedTime,
    asset: signal.asset,
    timeframe: signal.timeframe,
    expiration: signal.expiration,
    direction: signal.direction,
    stage: signal.stage,
    confluence_score: signal.confluenceScore,
    entry_price: signal.entryPrice,
    exit_price: signal.exitPrice ?? null,
    result: signal.result,
    reasons: signal.reasons || [],
    ai_analysis: signal.aiAnalysis ?? null,
    candle_close_time: signal.candleCloseTime,
    expiration_timestamp: signal.expirationTimestamp,
    is_estimated_result: signal.isEstimatedResult,
    resolved_at: signal.resolvedAt ?? null,
    cancelled_at: signal.cancelledAt ?? null,
    cancel_reason: signal.cancelReason ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Converte linha do Supabase de volta para SignalRecord do app
 */
export function mapRowToSignal(row: any): SignalRecord {
  return {
    id: row.id,
    timestamp: Number(row.timestamp),
    formattedTime: row.formatted_time || new Date(Number(row.timestamp)).toLocaleTimeString('pt-BR'),
    asset: row.asset,
    timeframe: row.timeframe,
    expiration: row.expiration,
    direction: row.direction,
    stage: row.stage,
    confluenceScore: Number(row.confluence_score),
    entryPrice: Number(row.entry_price),
    exitPrice: row.exit_price !== null && row.exit_price !== undefined ? Number(row.exit_price) : undefined,
    result: row.result,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    aiAnalysis: row.ai_analysis || undefined,
    candleCloseTime: Number(row.candle_close_time),
    expirationTimestamp: Number(row.expiration_timestamp),
    isEstimatedResult: Boolean(row.is_estimated_result),
    resolvedAt: row.resolved_at ? Number(row.resolved_at) : undefined,
    cancelledAt: row.cancelled_at ? Number(row.cancelled_at) : undefined,
    cancelReason: row.cancel_reason || undefined,
  };
}

/**
 * Busca histórico de sinais do Supabase
 */
export async function fetchSignalsFromSupabase(limit = 150): Promise<SignalRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('signals')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Supabase] Erro ao carregar sinais:', error.message);
      return [];
    }
    return (data || []).map(mapRowToSignal);
  } catch (err: any) {
    console.warn('[Supabase] Falha de conexão ao carregar sinais:', err.message);
    return [];
  }
}

/**
 * Salva ou atualiza um sinal no Supabase
 */
export async function upsertSignalToSupabase(signal: SignalRecord): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const row = mapSignalToRow(signal);
    const { error } = await sb.from('signals').upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase] Erro ao salvar sinal:', error.message);
    }
  } catch (err: any) {
    console.warn('[Supabase] Falha ao enviar sinal:', err.message);
  }
}

/**
 * Limpa histórico de sinais no Supabase
 */
export async function clearSignalsFromSupabase(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from('signals').delete().neq('id', '');
    if (error) {
      console.warn('[Supabase] Erro ao limpar sinais:', error.message);
    }
  } catch (err: any) {
    console.warn('[Supabase] Falha ao limpar sinais:', err.message);
  }
}

/**
 * Busca configurações do usuário no Supabase
 */
export async function fetchSettingsFromSupabase(): Promise<AppSettings | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    if (error || !data) return null;

    return {
      weights: data.weights,
      thresholds: data.thresholds,
      soundEnabled: data.sound_enabled,
      preAlertSound: data.pre_alert_sound,
      confirmedSound: data.confirmed_sound,
      autoAiAnalysis: data.auto_ai_analysis,
      defaultExpiration: data.default_expiration,
      panelMinimized: data.panel_minimized,
      panelPosition: data.panel_position,
      panelSize: data.panel_size,
      activeMode: data.active_mode,
      webhook: data.webhook,
    };
  } catch {
    return null;
  }
}

/**
 * Salva configurações do usuário no Supabase
 */
export async function saveSettingsToSupabase(settings: AppSettings): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const row = {
      id: 'default',
      weights: settings.weights,
      thresholds: settings.thresholds,
      sound_enabled: settings.soundEnabled,
      pre_alert_sound: settings.preAlertSound,
      confirmed_sound: settings.confirmedSound,
      auto_ai_analysis: settings.autoAiAnalysis,
      default_expiration: settings.defaultExpiration,
      panel_minimized: settings.panelMinimized,
      panel_position: settings.panelPosition,
      panel_size: settings.panelSize,
      active_mode: settings.activeMode,
      webhook: settings.webhook,
      updated_at: new Date().toISOString(),
    };
    await sb.from('app_settings').upsert(row, { onConflict: 'id' });
  } catch (err: any) {
    console.warn('[Supabase] Falha ao salvar configurações:', err.message);
  }
}

/**
 * Insere log de webhook no Supabase
 */
export async function insertWebhookLogToSupabase(log: WebhookLog): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from('webhook_logs').insert({
      id: log.id,
      timestamp: log.timestamp,
      formatted_time: log.formattedTime,
      event: log.event,
      url: log.url,
      status: log.status,
      http_code: log.httpCode ?? null,
      response_message: log.responseMessage ?? null,
      payload_preview: log.payloadPreview ?? null,
    });
  } catch (err: any) {
    console.warn('[Supabase] Falha ao registrar log de webhook:', err.message);
  }
}

/**
 * Carrega logs de webhook do Supabase
 */
export async function fetchWebhookLogsFromSupabase(limit = 50): Promise<WebhookLog[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('webhook_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data.map((row: any) => ({
      id: row.id,
      timestamp: Number(row.timestamp),
      formattedTime: row.formatted_time,
      event: row.event,
      url: row.url,
      status: row.status,
      httpCode: row.http_code,
      responseMessage: row.response_message,
      payloadPreview: row.payload_preview,
    }));
  } catch {
    return [];
  }
}
