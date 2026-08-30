import type { TTSVoice } from "./speech-parsing";

export interface VoiceConfig {
  voice: TTSVoice;
  baseInstructions: string;
}

export interface SpeechOptions {
  instructions?: string;
  voice?: TTSVoice;
  overrideInstructions?: boolean;
  prefetch?: PrefetchHandle;
  onPlaybackStarted?: () => void;
}

export interface PrefetchHandle {
  buffer: Promise<ArrayBuffer>;
  abort: () => void;
}

export interface ResolvedSpeechKey {
  key: string;
  instructions: string;
  voice: string;
}
