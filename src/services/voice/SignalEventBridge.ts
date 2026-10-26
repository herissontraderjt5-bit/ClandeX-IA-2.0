import { SignalRecord } from '../../types/trading';
import { AudioPlaybackManager } from './AudioPlaybackManager';

export interface SignalEventBridgeOptions {
  enabled: boolean;
  onAnnounceStart?: () => void;
  onAnnounceEnd?: () => void;
  isUserSpeaking?: () => boolean;
}

/**
 * SignalEventBridge
 * Conecta os eventos do CandleX-IA ao assistente de voz para avisos falados automáticos.
 */
export class SignalEventBridge {
  private enabled: boolean = true;
  private announcedSignalIds = new Set<string>();
  private audioPlayback: AudioPlaybackManager | null = null;
  private isUserSpeaking: (() => boolean) | null = null;
  private onAnnounceStart: (() => void) | null = null;
  private onAnnounceEnd: (() => void) | null = null;

  constructor(options?: SignalEventBridgeOptions) {
    if (options) {
      this.enabled = options.enabled;
      this.isUserSpeaking = options.isUserSpeaking || null;
      this.onAnnounceStart = options.onAnnounceStart || null;
      this.onAnnounceEnd = options.onAnnounceEnd || null;
    }
  }

  public setAudioPlayback(manager: AudioPlaybackManager) {
    this.audioPlayback = manager;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setUserSpeakingCheck(fn: () => boolean) {
    this.isUserSpeaking = fn;
  }

  /**
   * Processa evento de sinal vindo do signalEngine
   */
  public handleSignalEvent(signal: SignalRecord, event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED') {
    if (!this.enabled || !this.audioPlayback) return;

    // Se o trader estiver falando ao microfone, prioriza o usuário e não interrompe
    if (this.isUserSpeaking && this.isUserSpeaking()) {
      return;
    }

    const now = Date.now();

    // 1. Sinal Confirmado (CALL / PUT)
    if (event === 'CONFIRMED') {
      // Evita repetição do mesmo sinal
      if (this.announcedSignalIds.has(signal.id)) return;
      this.announcedSignalIds.add(signal.id);

      // Não anuncia sinais vencidos (mais de 20 segundos atrás)
      if (now - signal.timestamp > 20000) return;

      const dirText = signal.direction === 'CALL' ? 'CALL, compra' : 'PUT, venda';
      const spokenText = `Atenção! O CandleX-IA identificou um sinal de ${dirText} no par ${signal.asset}, timeframe ${signal.timeframe}. Confluência de ${signal.confluenceScore} por cento.`;

      if (this.onAnnounceStart) this.onAnnounceStart();
      this.audioPlayback.speakText(spokenText, () => {
        if (this.onAnnounceEnd) this.onAnnounceEnd();
      });
    }

    // 2. Sinal Cancelado por Proteção
    if (event === 'CANCELLED') {
      const cancelKey = `cancel-${signal.id}`;
      if (this.announcedSignalIds.has(cancelKey)) return;
      this.announcedSignalIds.add(cancelKey);

      const cancelText = `Atenção: sinal no par ${signal.asset} cancelado por proteção do algoritmo. Preserve seu capital.`;
      if (this.onAnnounceStart) this.onAnnounceStart();
      this.audioPlayback.speakText(cancelText, () => {
        if (this.onAnnounceEnd) this.onAnnounceEnd();
      });
    }
  }

  public clearHistory() {
    this.announcedSignalIds.clear();
  }
}

export const signalEventBridge = new SignalEventBridge({ enabled: true });
