import { DEFAULT_TTS_INSTRUCTIONS, DEFAULT_VOICE as SHARED_DEFAULT_VOICE } from "@shared/tts-backends.js";
import type { TTSVoice } from "./speech-parsing";

export interface VoiceConfig {
  voice: TTSVoice;
  baseInstructions: string;
  /** The engine the box speaks with — part of the audio cache key. */
  backend: string;
}

/**
 * What the client speaks with before the box's own config has loaded. Shares
 * its constants with the server (`shared/tts-backends.ts`) so the two cannot
 * drift; lives here rather than in `tts-client.ts` because the type does.
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  // eslint-disable-next-line no-restricted-syntax -- the shared default is one of VOICE_MODELS, which is what TTSVoice is
  voice: SHARED_DEFAULT_VOICE as TTSVoice,
  baseInstructions: DEFAULT_TTS_INSTRUCTIONS,
  backend: "openai",
};


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
