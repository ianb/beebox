/**
 * OpenAI Audio service — typed interface for Whisper transcription and TTS.
 *
 * Real implementation calls the OpenAI REST API.
 * Fake records calls and returns placeholder responses.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
}

export interface TTSResult {
  /** Audio data as a Buffer or ReadableStream */
  audio: Buffer;
  contentType: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface OpenAIAudioService {
  transcribe(audio: Buffer, opts?: {
    filename?: string;
    contentType?: string;
    prompt?: string;
  }): Promise<TranscriptionResult>;

  textToSpeech(text: string, opts?: {
    voice?: string;
    instructions?: string;
  }): Promise<TTSResult>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createOpenAIAudioService(apiKey: string): OpenAIAudioService {
  return {
    async transcribe(audio, opts) {
      const boundary = `----formdata-${Date.now()}`;
      const filename = opts?.filename ?? "audio.webm";
      const contentType = opts?.contentType ?? "audio/webm";

      const parts: Buffer[] = [];
      const addField = (name: string, value: string) => {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      };

      // File field
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ));
      parts.push(audio);
      parts.push(Buffer.from("\r\n"));

      addField("model", "whisper-1");
      addField("response_format", "verbose_json");
      if (opts?.prompt) addField("prompt", opts.prompt);

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.concat(parts),
      });

      if (!res.ok) {
        throw new Error(`OpenAI transcription error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json() as { text: string; duration: number; language: string };
      return { text: data.text, duration: data.duration, language: data.language };
    },

    async textToSpeech(text, opts) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts-2025-03-20",
          input: text,
          voice: opts?.voice ?? "alloy",
          response_format: "mp3",
          instructions: opts?.instructions ?? "Fast and concise, but with a friendly lilting tone.",
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI TTS error: ${res.status} ${await res.text()}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      return { audio: Buffer.from(arrayBuffer), contentType: "audio/mpeg" };
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeOpenAIAudioOptions {
  /** Text to return from transcribe(). Default: "transcribed text" */
  transcriptionText?: string;
}

export interface FakeOpenAIAudioService extends OpenAIAudioService {
  /** Transcription calls recorded */
  transcriptions: Array<{ filename?: string; prompt?: string }>;
  /** TTS calls recorded */
  speeches: Array<{ text: string; voice?: string; instructions?: string }>;
}

export function createFakeOpenAIAudio(
  opts?: FakeOpenAIAudioOptions,
): FakeOpenAIAudioService {
  const fake: FakeOpenAIAudioService = {
    transcriptions: [],
    speeches: [],

    async transcribe(_audio, callOpts) {
      const entry: { filename?: string; prompt?: string } = {};
      if (callOpts?.filename) entry.filename = callOpts.filename;
      if (callOpts?.prompt) entry.prompt = callOpts.prompt;
      fake.transcriptions.push(entry);
      return {
        text: opts?.transcriptionText ?? "transcribed text",
        duration: 1.5,
        language: "en",
      };
    },

    async textToSpeech(text, callOpts) {
      const entry: { text: string; voice?: string; instructions?: string } = { text };
      if (callOpts?.voice) entry.voice = callOpts.voice;
      if (callOpts?.instructions) entry.instructions = callOpts.instructions;
      fake.speeches.push(entry);
      // Return a minimal valid MP3 frame (silence)
      return {
        audio: Buffer.from([0xFF, 0xFB, 0x90, 0x00]),
        contentType: "audio/mpeg",
      };
    },
  };

  return fake;
}
