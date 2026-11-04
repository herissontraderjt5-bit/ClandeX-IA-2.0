/**
 * Utilitários para padronização e exibição no Horário Oficial de Brasília (BRT - UTC-3)
 */

export const BRASILIA_TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata um timestamp (segundos ou milissegundos) ou objeto Date no Horário Oficial de Brasília
 * Exemplo: "14:35:00"
 */
export function formatBrasiliaTime(
  dateOrTimestamp: number | Date = Date.now(),
  includeSeconds = true
): string {
  let date: Date;
  if (typeof dateOrTimestamp === 'number') {
    // Se for timestamp Unix em segundos (10 dígitos), converte para milissegundos
    date = dateOrTimestamp < 1e11 ? new Date(dateOrTimestamp * 1000) : new Date(dateOrTimestamp);
  } else {
    date = dateOrTimestamp;
  }

  return date.toLocaleTimeString('pt-BR', {
    timeZone: BRASILIA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

/**
 * Formata a data completa no Horário Oficial de Brasília
 * Exemplo: "04/11/2026"
 */
export function formatBrasiliaDate(dateOrTimestamp: number | Date = Date.now()): string {
  let date: Date;
  if (typeof dateOrTimestamp === 'number') {
    date = dateOrTimestamp < 1e11 ? new Date(dateOrTimestamp * 1000) : new Date(dateOrTimestamp);
  } else {
    date = dateOrTimestamp;
  }

  return date.toLocaleDateString('pt-BR', {
    timeZone: BRASILIA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

