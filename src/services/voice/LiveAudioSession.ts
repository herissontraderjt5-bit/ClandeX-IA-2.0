import { tradingContextAdapter } from './TradingContextAdapter';
import { MicrophoneManager } from './MicrophoneManager';
import { AudioPlaybackManager } from './AudioPlaybackManager';
import { normalizeTradingPronunciation } from './pronunciationNormalizer';

export type AssistantState =
  | 'DESCONECTADO'
  | 'CONECTANDO'
  | 'OUVINDO'
  | 'PROCESSANDO'
  | 'FALANDO'
  | 'ERRO';

export interface TurnMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export class LiveAudioSession {
  private state: AssistantState = 'DESCONECTADO';
  private ws: WebSocket | null = null;
  private micManager: MicrophoneManager;
  private audioPlayback: AudioPlaybackManager;
  private conversationHistory: TurnMessage[] = [];
  private onStateChange: ((state: AssistantState) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private onAiResponse: ((text: string) => void) | null = null;
  private isProcessingTurn: boolean = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(micManager: MicrophoneManager, audioPlayback: AudioPlaybackManager) {
    this.micManager = micManager;
    this.audioPlayback = audioPlayback;

    // Conecta áudio do microfone ao envio de streaming
    this.micManager.setOnAudioChunk((pcmBase64) => {
      this.handleMicrophoneChunk(pcmBase64);
    });

    // Quando a reprodução termina, volta a ouvir o usuário
    this.audioPlayback.setOnPlaybackEnded(() => {
      if (this.state === 'FALANDO') {
        this.setState('OUVINDO');
      }
    });
  }

  public setOnStateChange(cb: (state: AssistantState) => void) {
    this.onStateChange = cb;
  }

  public setOnError(cb: (err: string) => void) {
    this.onError = cb;
  }

  public setOnTranscript(cb: (text: string) => void) {
    this.onTranscript = cb;
  }

  public setOnAiResponse(cb: (text: string) => void) {
    this.onAiResponse = cb;
  }

  public getState(): AssistantState {
    return this.state;
  }

  public getHistory(): TurnMessage[] {
    return [...this.conversationHistory];
  }

  private setState(newState: AssistantState) {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }

  /**
   * Inicia a sessão conversacional ao vivo
   */
  public async startSession(): Promise<boolean> {
    if (this.state === 'OUVINDO' || this.state === 'FALANDO' || this.state === 'CONECTANDO') {
      return true;
    }

    this.setState('CONECTANDO');
    this.reconnectAttempts = 0;

    // 1. Tenta inicializar WebSocket com backend /api/live
    const wsConnected = await this.connectWebSocket();
    if (wsConnected) {
      const micOk = await this.micManager.start();
      if (!micOk) {
        this.disconnect();
        this.setState('ERRO');
        if (this.onError) this.onError('Permissão de microfone negada.');
        return false;
      }
      this.setState('OUVINDO');
      return true;
    }

    // 2. Modo Cliente Direto (Vercel / Sem servidor WebSocket ativo)
    console.log('[LiveAudioSession] Operando com modelo Gemini 3.8 Live / Gemini 3.8.');
    const micOk = await this.micManager.start();
    if (!micOk) {
      this.disconnect();
      this.setState('ERRO');
      if (this.onError) this.onError('Permissão de microfone negada.');
      return false;
    }

    this.setState('OUVINDO');
    return true;
  }

  /**
   * Encerra com segurança todos os recursos da sessão
   */
  public disconnect() {
    this.setState('DESCONECTADO');
    this.isProcessingTurn = false;

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'stop' }));
        }
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.micManager.stop();
    this.audioPlayback.interrupt();
  }

  /**
   * Interrompe imediatamente a fala da IA (Barge-in do usuário)
   */
  public interrupt() {
    this.audioPlayback.interrupt();
    if (this.state === 'FALANDO') {
      this.setState('OUVINDO');
    }
  }

  /**
   * Processa o turno falado do trader (transcrito ou detectado)
   */
  public async handleUserSpeechTurn(userText: string) {
    const clean = (userText || '').trim();
    if (!clean || this.isProcessingTurn) return;

    // Se a IA estava falando, o usuário interrompeu:
    this.interrupt();

    this.isProcessingTurn = true;
    this.setState('PROCESSANDO');

    const userTurn: TurnMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: clean,
      timestamp: Date.now(),
    };
    this.conversationHistory.push(userTurn);
    if (this.onTranscript) this.onTranscript(clean);

    // Se houver WebSocket ativo, envia pelo canal:
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'turn_complete', text: clean }));
      this.isProcessingTurn = false;
      return;
    }

    // Modo Vercel / Cliente: gera resposta inteligente com memória de contexto
    try {
      const replyText = await this.generateModelResponse(clean);
      const modelTurn: TurnMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: replyText,
        timestamp: Date.now(),
      };
      this.conversationHistory.push(modelTurn);
      if (this.onAiResponse) this.onAiResponse(replyText);

      this.setState('FALANDO');
      this.audioPlayback.speakText(replyText, () => {
        this.isProcessingTurn = false;
        if (this.state === 'FALANDO') {
          this.setState('OUVINDO');
        }
      });
    } catch (err: any) {
      console.warn('[LiveAudioSession] Erro ao responder:', err);
      this.setState('OUVINDO');
      this.isProcessingTurn = false;
    }
  }

  private handleMicrophoneChunk(pcmBase64: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'audio', audio: pcmBase64 }));
    }
  }

  private async connectWebSocket(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    return new Promise((resolve) => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/live`;
        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        const timeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            try { socket.close(); } catch {}
            resolve(false);
          }
        }, 1500);

        socket.onopen = () => {
          clearTimeout(timeout);
          const currentAsset = tradingContextAdapter.getCurrentAsset();
          const currentAnalysis = tradingContextAdapter.getMarketAnalysis();
          socket.send(
            JSON.stringify({
              type: 'start',
              voiceName: 'Aoede',
              marketContext: {
                asset: currentAsset.symbol,
                assetName: currentAsset.name,
                currentPrice: currentAsset.currentPrice,
                timeframe: tradingContextAdapter.getCurrentTimeframe(),
                marketAnalysis: currentAnalysis,
              },
            })
          );
          resolve(true);
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'audio' && data.audio) {
              this.setState('FALANDO');
              this.audioPlayback.play24kPcmChunk(data.audio);
            }
            if (data.type === 'text' && data.text) {
              if (this.onAiResponse) this.onAiResponse(data.text);
            }
            if (data.type === 'user_text' && data.userText) {
              if (this.onTranscript) this.onTranscript(data.userText);
            }
            if (data.type === 'error') {
              console.warn('[LiveAudioSession] Mensagem de erro do servidor:', data.error);
            }
          } catch {}
        };

        socket.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };

        socket.onclose = () => {
          clearTimeout(timeout);
          if (this.state === 'OUVINDO' || this.state === 'FALANDO') {
            this.handleReconnect();
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[LiveAudioSession] Tentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => {
        if (this.state !== 'DESCONECTADO') {
          this.startSession();
        }
      }, 1000);
    }
  }

  private async generateModelResponse(promptText: string): Promise<string> {
    const cleanPrompt = promptText.trim();
    const apiKey = this.getGeminiKey();

    // 1. Chamada inteligente para os modelos ativos da Google com histórico e contexto institucional
    if (apiKey && apiKey.length > 15) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const contextSummary = tradingContextAdapter.getContextSummary();

        // Histórico recente para memória de contexto (últimas 4 mensagens)
        const recentHistory = this.conversationHistory.slice(-4).map((h) => `${h.role === 'user' ? 'Trader' : 'CandleX'}: ${h.text}`).join('\n');

        const systemInstruction = `Você é a CandleX, assistente inteligente e mentora de trading institucional de Opções Binárias e Forex para o aplicativo CandleX-IA.
Você está conversando por voz em tempo real diretamente com o trader humano.
DIRETRIZES DA PERSONALIDADE CANDLEX:
1. Responda DIRETAMENTE à pergunta do trader em Português do Brasil com naturalidade, clareza e autoridade amigável.
2. Seja sempre concisa: estritamente 1 a 2 frases faladas. Não faça discursos longos.
3. NUNCA use formatação markdown, asteriscos, numerações ou tópicos.
4. Mantenha a memória da conversa (entenda perguntas como "e no gráfico de cinco minutos?").
5. Domine Price Action, Suporte/Resistência, Tendência, SMC, Rompimento, Rejeição, CALL, PUT, M1 e M5.
6. Nunca invente dados e nunca prometa lucros.
7. PRONÚNCIA OBRIGATÓRIA DE ATIVOS: NUNCA soletre pares de moedas ou ativos (NUNCA diga "E-U-R U-S-D", "G-B-P U-S-D" ou "S-O-L"). Fale sempre o nome completo e natural: "Euro USD", "GBP USD", "Bitcoin USD", "Ethereum USD", "Solana USD", "Dólar Iene". NUNCA use barras ("/") ou hifens ao citar o par.
CONTEXTO ATUALIZADO DO PAINEL:\n${contextSummary}
HISTÓRICO RECENTE:\n${recentHistory}`;

        const candidateModels = [
          (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_LIVE_MODEL) || 'gemini-3.8-live',
          (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_MODEL) || 'gemini-3.8-flash',
          'gemini-3.5-flash-lite',
          'gemini-3.5-flash',
        ];
        for (const model of candidateModels) {
          try {
            const fetchPromise = ai.models.generateContent({
              model,
              contents: cleanPrompt,
              config: {
                systemInstruction,
                temperature: 0.4,
              },
            });
            const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2800));
            const response: any = await Promise.race([fetchPromise, timeoutPromise]);
            if (response && response.text) {
              const cleanText = normalizeTradingPronunciation(response.text);
              if (cleanText) return cleanText;
            }
          } catch {}
        }
      } catch {}
    }

    // 2. Fallback determinístico caso offline ou sem chave
    return this.generateDeterministicLocalResponse(cleanPrompt);
  }

  private generateDeterministicLocalResponse(prompt: string): string {
    const q = prompt.toLowerCase();
    const asset = tradingContextAdapter.getCurrentAsset();
    const tf = tradingContextAdapter.getCurrentTimeframe();
    const analysis = tradingContextAdapter.getMarketAnalysis();
    const signal = tradingContextAdapter.getCurrentSignal();

    if (q.includes('tá me ouvindo') || q.includes('consegue me ouvir') || q.includes('alô') || q.includes('fala comigo')) {
      return 'Estou te ouvindo perfeitamente! Pode falar sua dúvida sobre as operações.';
    }

    if (q.includes('como está') || q.includes('como tá') || q.includes('o que você acha') || q.includes('análise')) {
      return `O par ${asset.symbol} está em tendência de ${analysis.trend} no timeframe ${tf}. A força compradora é ${analysis.buyerStrength} e a vendedora é ${analysis.sellerStrength}.`;
    }

    if (q.includes('devo entrar') || q.includes('posso entrar') || q.includes('compro ou vendo') || q.includes('sinal') || q.includes('vale a pena')) {
      if (signal) {
        return `Temos um sinal ativo de ${signal.direction} em ${signal.asset} com ${signal.confluenceScore}% de confluência. Aguarde a confirmação e respeite seu gerenciamento.`;
      }
      return `No momento não há sinal com confluência suficiente no ${asset.symbol}. Recomendo aguardar uma oportunidade mais clara para preservar sua banca.`;
    }

    if (q.includes('cinco minutos') || q.includes('m5')) {
      return `No gráfico de cinco minutos do ${asset.symbol}, a estrutura segue a tendência de ${analysis.trend}. Fique atento aos níveis de suporte e resistência.`;
    }

    const cleanSubject = prompt.replace(/[?!.]/g, '').trim();
    return `Sobre "${cleanSubject}": no gráfico de ${asset.symbol}, a tendência é de ${analysis.trend}. Pode me perguntar se vale a pena entrar agora ou quais são as taxas de suporte!`;
  }

  private getGeminiKey(): string {
    let key = '';
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || '';
      }
    } catch {}
    if (!key && typeof process !== 'undefined' && process.env) {
      key = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    }
    if (!key && typeof window !== 'undefined') {
      key = localStorage.getItem('clandex_gemini_api_key') || '';
    }
    return key.trim();
  }
}
