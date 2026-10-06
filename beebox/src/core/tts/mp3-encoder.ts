/**
 * Raw 24 kHz PCM in, MP3 out, as it arrives — so streamed Gemini speech can
 * reach the browser's MediaSource player, which plays MP3 and not raw PCM or
 * WAV (`docs/plans/tts-streamed-playback.md`).
 *
 * One `ffmpeg` child per clip. ffmpeg is a required runtime tool already
 * (`deploy/deploy.sh` checks it at deploy; the server setup and the Docker
 * image install it). Measured 2026-10-05: with `-flush_packets 1` the MP3 output
 * reaches each second of audio within about 30 ms of the PCM input. The flags
 * drop the ID3 tag and the Xing header, so the first bytes a `SourceBuffer`
 * sees are audio frames; a pipe could not have the Xing header rewritten at the
 * end anyway.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { toError } from "../../shared/error-guards.js";

const FFMPEG_ARGS = [
  "-hide_banner", "-loglevel", "error",
  "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
  "-c:a", "libmp3lame", "-b:a", "64k",
  "-flush_packets", "1", "-id3v2_version", "0", "-write_xing", "0",
  "-f", "mp3", "pipe:1",
];

/** The longest tail of ffmpeg's stderr carried into an error. */
const STDERR_TAIL_CHARS = 500;

/** ffmpeg could not be started, or exited with an error. */
export class Mp3EncoderError extends Error {
  constructor(
    failure: { kind: "spawn"; reason: string } | { kind: "exit"; code: number | null; stderr: string },
    options?: ErrorOptions,
  ) {
    super(
      failure.kind === "spawn"
        ? `MP3 encoder (ffmpeg) could not start: ${failure.reason}`
        : `MP3 encoder (ffmpeg) exited with code ${String(failure.code)}${failure.stderr === "" ? "" : `: ${failure.stderr}`}`,
      options,
    );
    this.name = "Mp3EncoderError";
  }
}

type Exit = { error: Error } | { code: number | null };

/**
 * Encode `pcm` (16-bit little-endian mono 24 kHz) to MP3 chunks.
 *
 * A failure in `pcm` itself (the provider's stream) is rethrown as is, not
 * masked as an encoder error. Aborting `signal`, or stopping the iteration
 * early, kills the child. `command` is the test seam for a missing binary.
 */
export async function* pcmToMp3(
  pcm: AsyncIterable<Buffer>,
  opts?: { signal?: AbortSignal; command?: string },
): AsyncGenerator<Buffer> {
  const child = spawn(opts?.command ?? "ffmpeg", FFMPEG_ARGS, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-STDERR_TAIL_CHARS);
  });
  const exited = new Promise<Exit>((resolve) => {
    child.once("error", (error) => { resolve({ error }); });
    child.once("close", (code) => { resolve({ code }); });
  });
  // Writes to a child that has died fail with EPIPE; the exit is reported
  // below, so the write error itself is only noted.
  child.stdin.on("error", (e) => { console.debug("[tts] ffmpeg stdin closed early:", e.message); });

  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  opts?.signal?.addEventListener("abort", kill, { once: true });

  // Resolves with the PCM source's own failure, or null when it ended cleanly.
  const feeding = (async (): Promise<Error | null> => {
    try {
      for await (const chunk of pcm) {
        if (!child.stdin.write(chunk)) await Promise.race([once(child.stdin, "drain"), exited]);
      }
      child.stdin.end();
      return null;
    } catch (e) {
      kill();
      return toError(e);
    }
  })();

  try {
    for await (const chunk of child.stdout) {
      // eslint-disable-next-line no-restricted-syntax -- a child's stdout without an encoding yields Buffers; the stream is typed `any`.
      yield chunk as Buffer;
    }
    // A killed encoder (abort) can leave the source stalled; its own abort
    // (the provider fetch shares the signal) settles it later.
    const feedError = await Promise.race([feeding, exited.then(() => null)]);
    if (feedError !== null) throw feedError;
    if (opts?.signal?.aborted === true) throw toError(opts.signal.reason);
    const exit = await exited;
    if ("error" in exit) throw new Mp3EncoderError({ kind: "spawn", reason: exit.error.message }, { cause: exit.error });
    if (exit.code !== 0) throw new Mp3EncoderError({ kind: "exit", code: exit.code, stderr: stderr.trim() });
  } finally {
    opts?.signal?.removeEventListener("abort", kill);
    kill();
  }
}
