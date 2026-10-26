/**
 * MicrophoneManager
 * Gerencia captura do microfone, Web Audio API, conversão para PCM 16kHz e medidor VU RMS.
 */
export class MicrophoneManager {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isMuted: boolean = false;
  private onAudioChunk: ((base64Pcm16k: string) => void) | null = null;
  private onVolumeChange: ((level: number) => void) | null = null;

  public setOnAudioChunk(cb: (base64Pcm16k: string) => void) {
    this.onAudioChunk = cb;
  }

  public setOnVolumeChange(cb: (level: number) => void) {
    this.onVolumeChange = cb;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public async start(): Promise<boolean> {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('[MicrophoneManager] getUserMedia não suportado neste navegador.');
      return false;
    }

    try {
      this.stop();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass({ sampleRate: 16000 });
      this.audioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      this.sourceNode = source;

      // ScriptProcessor para captura de chunks contínuos
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      this.processorNode = processor;

      processor.onaudioprocess = (e) => {
        if (this.isMuted) {
          if (this.onVolumeChange) this.onVolumeChange(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // Calcula RMS de volume (0 a 100)
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const level = Math.min(100, Math.round(rms * 450));
        if (this.onVolumeChange) {
          this.onVolumeChange(level);
        }

        // Se houver callback e áudio audível, resampleia e envia PCM 16kHz
        if (this.onAudioChunk) {
          const resampled = this.resampleTo16k(inputData, ctx.sampleRate);
          const pcmBase64 = this.pcmToBase64(resampled);
          if (pcmBase64) {
            this.onAudioChunk(pcmBase64);
          }
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      return true;
    } catch (err) {
      console.error('[MicrophoneManager] Erro ao iniciar microfone:', err);
      this.stop();
      return false;
    }
  }

  public stop() {
    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
      } catch {}
      this.processorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((t) => t.stop());
      } catch {}
      this.mediaStream = null;
    }

    if (this.onVolumeChange) {
      this.onVolumeChange(0);
    }
  }

  private resampleTo16k(inputData: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === 16000) return inputData;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = i * ratio;
      const indexFloor = Math.floor(originalIndex);
      const indexCeil = Math.min(inputData.length - 1, Math.ceil(originalIndex));
      const fraction = originalIndex - indexFloor;
      result[i] = inputData[indexFloor] * (1 - fraction) + inputData[indexCeil] * fraction;
    }
    return result;
  }

  private pcmToBase64(float32Array: Float32Array): string {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
