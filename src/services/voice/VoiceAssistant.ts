import { MicrophoneManager } from './MicrophoneManager';
import { AudioPlaybackManager } from './AudioPlaybackManager';
import { LiveAudioSession, AssistantState } from './LiveAudioSession';
import { tradingContextAdapter } from './TradingContextAdapter';
import { signalEventBridge } from './SignalEventBridge';

export interface VoiceAssistantEvents {
  onStateChange?: (state: AssistantState) => void;
  onTranscript?: (text: string) => void;
  onAiResponse?: (text: string) => void;
  onMicLevel?: (level: number) => void;
  onSpeechLevel?: (level: number) => void;
  onError?: (error: string) => void;
}

export class VoiceAssistant {
  private micManager: MicrophoneManager;
  private playbackManager: AudioPlaybackManager;
  private session: LiveAudioSession;

  constructor() {
    this.micManager = new MicrophoneManager();
    this.playbackManager = new AudioPlaybackManager();
    this.session = new LiveAudioSession(this.micManager, this.playbackManager);

    // Conecta o SignalEventBridge ao playback manager
    signalEventBridge.setAudioPlayback(this.playbackManager);
    signalEventBridge.setUserSpeakingCheck(() => this.session.getState() === 'PROCESSANDO' || this.playbackManager.getIsPlaying());
  }

  public setEvents(events: VoiceAssistantEvents) {
    if (events.onStateChange) this.session.setOnStateChange(events.onStateChange);
    if (events.onTranscript) this.session.setOnTranscript(events.onTranscript);
    if (events.onAiResponse) this.session.setOnAiResponse(events.onAiResponse);
    if (events.onError) this.session.setOnError(events.onError);
    if (events.onMicLevel) this.micManager.setOnVolumeChange(events.onMicLevel);
    if (events.onSpeechLevel) this.playbackManager.setOnSpeechLevelChange(events.onSpeechLevel);
  }

  public async start(): Promise<boolean> {
    return this.session.startSession();
  }

  public stop() {
    this.session.disconnect();
  }

  public interrupt() {
    this.session.interrupt();
  }

  public toggleMute(): boolean {
    const next = !this.micManager.getIsMuted();
    this.micManager.setMuted(next);
    return next;
  }

  public isMuted(): boolean {
    return this.micManager.getIsMuted();
  }

  public setVolume(vol: number) {
    this.playbackManager.setVolume(vol);
  }

  public getVolume(): number {
    return this.playbackManager.getVolume();
  }

  public getState(): AssistantState {
    return this.session.getState();
  }

  public handleUserSpeechTurn(transcript: string) {
    return this.session.handleUserSpeechTurn(transcript);
  }

  public getTradingContext() {
    return tradingContextAdapter;
  }

  public getSignalBridge() {
    return signalEventBridge;
  }
}

export const voiceAssistant = new VoiceAssistant();
