import { normalizeTradingPronunciation } from './pronunciationNormalizer';

/**
 * AudioPlaybackManager
 * Gerencia reprodução de áudio da IA (PCM 24kHz do Gemini Live e Web Speech API fallback)
 * Suporta controle de volume e INTERRUPÇÃO INSTANTÂNEA (Barge-in).
 */
export class AudioPlaybackManager {
  private outputAudioContext: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime: number = 0;
  private volume: number = 1.0; // 0.0 a 1.0
  private isPlaying: boolean = false;
  private speechAnimInterval: any = null;
  private onSpeechLevelChange: ((level: number) => void) | null = null;
  private onPlaybackEnded: (() => void) | null = null;

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  public setOnSpeechLevelChange(cb: (level: number) => void) {
    this.onSpeechLevelChange = cb;
  }

  public setOnPlaybackEnded(cb: () => void) {
    this.onPlaybackEnded = cb;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Reproduz chunk de áudio PCM 24kHz 16-bit Little Endian (Gemini Live)
   */
  public play24kPcmChunk(base64Pcm24k: string) {
    if (typeof window === 'undefined') return;

    try {
      if (!this.outputAudioContext) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        this.outputAudioContext = new AudioCtxClass({ sampleRate: 24000 });
      }

      const ctx = this.outputAudioContext;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const float32 = this.base64ToPcm(base64Pcm24k);
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gainNode = ctx.createGain();
      gainNode.gain.value = this.volume;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      this.activeSources.push(source);
      this.isPlaying = true;

      // Animação rítmica de mandíbula e luz
      this.startSpeechAnimation();

      source.onended = () => {
        this.activeSources = this.activeSources.filter((s) => s !== source);
        if (this.activeSources.length === 0) {
          this.isPlaying = false;
          this.stopSpeechAnimation();
          if (this.onPlaybackEnded) {
            this.onPlaybackEnded();
          }
        }
      };
    } catch (err) {
      console.error('[AudioPlaybackManager] Erro ao reproduzir chunk 24kHz:', err);
    }
  }

  /**
   * Reproduz texto via Web Speech Synthesis (voz feminina brasileira)
   */
  public speakText(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }

    this.interrupt();

    const clean = normalizeTradingPronunciation(text);
    if (!clean) {
      if (onEnd) onEnd();
      return;
    }

    this.isPlaying = true;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.08;
    utterance.pitch = 1.05;
    utterance.volume = this.volume;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = this.pickFemaleVoice(voices);
    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.isPlaying = false;
      this.stopSpeechAnimation();
      if (onEnd) onEnd();
      if (this.onPlaybackEnded) this.onPlaybackEnded();
    };

    utterance.onstart = () => {
      this.startSpeechAnimation();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    // Timeout de segurança
    const safetyMs = Math.max(2500, Math.ceil((clean.length / 10) * 1000) + 1500);
    setTimeout(() => {
      if (!ended && this.isPlaying) {
        finish();
      }
    }, safetyMs);

    try {
      window.speechSynthesis.cancel();
    } catch {}

    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    }, 20);
  }

  /**
   * INTERRUPÇÃO INSTANTÂNEA (Barge-in)
   * Corta imediatamente o som quando o trader começa a falar.
   */
  public interrupt() {
    // 1. Para fontes Web Audio ativas
    this.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    });
    this.activeSources = [];
    this.nextStartTime = 0;

    // 2. Cancela síntese de fala do navegador
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    // 3. Reseta estados de reprodução e animação
    this.isPlaying = false;
    this.stopSpeechAnimation();
  }

  private startSpeechAnimation() {
    if (this.speechAnimInterval) return;
    let phase = 0;
    this.speechAnimInterval = setInterval(() => {
      phase += 0.35;
      const baseLevel = 45 + Math.sin(phase * 4.2) * 25 + Math.sin(phase * 8.5) * 15;
      const level = Math.max(20, Math.min(95, Math.round(baseLevel)));
      if (this.onSpeechLevelChange) {
        this.onSpeechLevelChange(level);
      }
    }, 70);
  }

  private stopSpeechAnimation() {
    if (this.speechAnimInterval) {
      clearInterval(this.speechAnimInterval);
      this.speechAnimInterval = null;
    }
    if (this.onSpeechLevelChange) {
      this.onSpeechLevelChange(0);
    }
  }

  private pickFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (!voices || voices.length === 0) return null;
    const ptVoices = voices.filter((v) => v.lang.startsWith('pt') || v.lang.includes('BR'));
    if (ptVoices.length === 0) return null;

    const preferredFemaleNames = [
      'francisca', 'luciana', 'vitória', 'vitoria', 'letícia', 'leticia',
      'heloisa', 'fernanda', 'maria', 'camila', 'google português do brasil',
      'brazil female', 'female'
    ];

    for (const pref of preferredFemaleNames) {
      const match = ptVoices.find((v) => v.name.toLowerCase().includes(pref));
      if (match) return match;
    }

    const maleExclusions = ['ricardo', 'felipe', 'antonio', 'daniel', 'jorge', 'tiago', 'diego', 'carlos'];
    const femaleCandidate = ptVoices.find((v) => {
      const n = v.name.toLowerCase();
      return !maleExclusions.some((m) => n.includes(m));
    });

    return femaleCandidate || ptVoices[0];
  }

  private base64ToPcm(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  }
}
