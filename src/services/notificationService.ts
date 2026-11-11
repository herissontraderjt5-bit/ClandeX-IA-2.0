/**
 * Service Oficial de Notificações Push & PWA do ClandeX-IA
 * Garante entrega de notificações no Celular (Android/iOS) e PC (Windows/Mac)
 * mesmo com a tela bloqueada ou aba em segundo plano.
 */

import { SignalRecord } from '../types/trading';

class NotificationService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private deferredInstallPrompt: any = null;
  private listeners: (() => void)[] = [];
  private soundEnabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initServiceWorker();
      this.initInstallPromptListener();
    }
  }

  private async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        this.swRegistration = reg;
        console.log('[NotificationService] Service Worker registrado com sucesso:', reg.scope);
      } catch (err) {
        console.warn('[NotificationService] Falha ao registrar Service Worker:', err);
      }
    }
  }

  private initInstallPromptListener() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.notifyListeners();
      console.log('[NotificationService] PWA prompt capturado e pronto para instalação.');
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.notifyListeners();
      console.log('[NotificationService] ClandeX-IA instalado no dispositivo com sucesso!');
    });
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {}
    });
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  public getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  public canInstallPwa(): boolean {
    return !!this.deferredInstallPrompt;
  }

  /**
   * Dispara a tela nativa do navegador para o usuário baixar/instalar o app
   */
  public async promptInstallPwa(): Promise<boolean> {
    if (!this.deferredInstallPrompt) {
      return false;
    }
    try {
      this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      this.deferredInstallPrompt = null;
      this.notifyListeners();
      return choice.outcome === 'accepted';
    } catch (e) {
      console.error('[NotificationService] Erro ao disparar prompt de instalação:', e);
      return false;
    }
  }

  /**
   * Solicita autorização ao usuário para notificações no celular/PC
   */
  public async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const permission = await Notification.requestPermission();
      this.notifyListeners();
      if (permission === 'granted') {
        this.sendNotification(
          '🔔 Notificações Ativadas!',
          'Você receberá alertas em tempo real das entradas confirmadas, vitórias (WIN) e resultados no seu aparelho.',
          { tag: 'welcome-notification' }
        );
        return true;
      }
      return false;
    } catch (e) {
      console.error('[NotificationService] Erro ao solicitar permissão:', e);
      return false;
    }
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
  }

  /**
   * Envio unificado via Service Worker (celular + PC com tela bloqueada/minimizado) ou API direta
   */
  public async sendNotification(title: string, body: string, options: NotificationOptions = {}) {
    if (!this.isSupported() || Notification.permission !== 'granted') {
      return;
    }

    const defaultOptions: NotificationOptions = {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: options.tag || `notif-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      ...options,
    };

    try {
      // 1. Tenta disparar via ServiceWorkerRegistration (suporte oficial em mobile e background)
      if ('serviceWorker' in navigator) {
        const registration = this.swRegistration || (await navigator.serviceWorker.ready);
        if (registration && 'showNotification' in registration) {
          await registration.showNotification(title, defaultOptions);
          return;
        }
      }

      // 2. Fallback direto para window.Notification (desktop standard)
      new Notification(title, defaultOptions);
    } catch (err) {
      console.warn('[NotificationService] Erro ao emitir notificação nativa:', err);
      try {
        new Notification(title, defaultOptions);
      } catch {}
    }
  }

  /**
   * Notificação de Pré-Alerta (Atenção para a próxima vela)
   */
  public notifyPreAlert(signal: SignalRecord) {
    const isCall = signal.direction === 'CALL';
    const dirText = isCall ? 'CALL (COMPRA) 🟢' : 'PUT (VENDA) 🔴';
    const entryTime = signal.entryTimeFormatted || signal.formattedTime;

    this.sendNotification(
      `⚠️ PRÉ-ALERTA: ${signal.asset} ${dirText}`,
      `Fique atento! Confluência de ${signal.confluenceScore}%. Prepare sua ordem na corretora para a vela das ${entryTime} (${signal.timeframe}).`,
      {
        tag: `prealert-${signal.id}`,
        image: '/notifications/pre_alert.png',
        vibrate: [200, 100, 200],
      } as any
    );
  }

  /**
   * Notificação de Entrada Confirmada
   */
  public notifySignalConfirmed(signal: SignalRecord) {
    const isCall = signal.direction === 'CALL';
    const dirText = isCall ? 'CALL (COMPRA) 🟢' : 'PUT (VENDA) 🔴';
    const entryTime = signal.entryTimeFormatted || signal.formattedTime;

    this.sendNotification(
      `🚨 SINAL CONFIRMADO: ${signal.asset} ${dirText}`,
      `Entrada na vela das ${entryTime} (${signal.timeframe}). Confluência: ${signal.confluenceScore}%. Prepare sua ordem na corretora!`,
      {
        tag: `confirmed-${signal.id}`,
        image: '/notifications/signal_confirmed.png',
        vibrate: [300, 100, 300, 100, 300],
      } as any
    );
  }

  /**
   * Notificação de Resultado Final (WIN ou LOSS)
   */
  public notifySignalResult(signal: SignalRecord) {
    const isWin = signal.result === 'WIN';
    const isLoss = signal.result === 'LOSS';
    const isCall = signal.direction === 'CALL';
    const dirText = isCall ? 'CALL' : 'PUT';
    const openPrice = (signal.candleOpenPrice || signal.entryPrice || 0).toFixed(5);
    const closePrice = (signal.candleClosePrice || signal.exitPrice || 0).toFixed(5);

    if (isWin) {
      this.sendNotification(
        `🏆 VITÓRIA (WIN)! ${signal.asset} ${dirText}`,
        `Operação finalizada no LUCRO! Abertura: ${openPrice} ➔ Fechamento: ${closePrice}. +1 WIN adicionado ao Placar do Dia!`,
        {
          tag: `result-${signal.id}`,
          image: '/notifications/win.png',
          vibrate: [200, 100, 400],
        } as any
      );
    } else if (isLoss) {
      this.sendNotification(
        `❌ OPERAÇÃO FINALIZADA (LOSS): ${signal.asset}`,
        `Abertura: ${openPrice} ➔ Fechamento: ${closePrice}. Gerenciamento mantido para a próxima entrada.`,
        {
          tag: `result-${signal.id}`,
          image: '/notifications/loss.png',
          vibrate: [400, 150, 400],
        } as any
      );
    }
  }

  /**
   * Notificação de Sinal Cancelado (Proteção de Banca)
   */
  public notifySignalCancelled(signal: SignalRecord) {
    this.sendNotification(
      `🛡️ SINAL CANCELADO (PROTEÇÃO): ${signal.asset}`,
      signal.cancelReason || 'Entrada abortada pelo algoritmo por rejeição contrária. Capital protegido!',
      {
        tag: `cancel-${signal.id}`,
        image: '/notifications/cancelled.png',
        vibrate: [200, 100, 200],
      } as any
    );
  }
}

export const notificationService = new NotificationService();

