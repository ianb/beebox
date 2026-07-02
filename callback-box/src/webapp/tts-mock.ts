/**
 * Dev-only mock for the /api/chat/tts endpoint.
 *
 * Serves pre-generated fixture mp3s (see scripts/gen-tts-fixtures.ts) instead
 * of calling OpenAI, optionally streamed *slowly* — an initial delay before
 * the first byte plus a per-chunk delay. That lets the speech browser test
 * (dev-only /dev/speech route) observe playback timing deterministically:
 * e.g. that streaming playback starts before the whole download completes,
 * and that stop/fast-forward interrupt cleanly.
 *
 * Guarded by the caller: only invoked when NODE_ENV !== "production" and the
 * request body explicitly opts in (`mock: true`).
 */

import { sleep } from "../lib/sleep.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";

const FIXTURE_DIR = join(import.meta.dirname, "test-fixtures", "tts");
const FIXTURES = ["seg0.mp3", "seg1.mp3", "seg2.mp3"];

export interface MockTtsRequest {
  text: string;
  /** Explicit fixture filename; otherwise picked deterministically by text. */
  fixture?: string | undefined;
  /** Delay before the first byte (ms). Simulates generation latency. */
  delayMs?: number | undefined;
  /** Delay between chunks (ms). Simulates a slow stream. */
  chunkMs?: number | undefined;
  /** Bytes per streamed chunk. */
  chunkSize?: number | undefined;
}


function hashText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + (text.codePointAt(i) ?? 0)) | 0;
  }
  return Math.abs(h);
}

function pickFixture(req: MockTtsRequest): string {
  if (req.fixture && FIXTURES.includes(req.fixture)) return req.fixture;
  const name = FIXTURES[hashText(req.text) % FIXTURES.length];
  return name !== undefined ? name : "seg0.mp3";
}

export function serveMockTts(reply: FastifyReply, req: MockTtsRequest): FastifyReply {
  const file = join(FIXTURE_DIR, pickFixture(req));
  if (!existsSync(file)) {
    return reply
      .status(500)
      .send({ error: "mock TTS fixture missing — run: pnpm tsx scripts/gen-tts-fixtures.ts" });
  }

  const buf = readFileSync(file);
  const delayMs = req.delayMs !== undefined ? req.delayMs : 0;
  const chunkMs = req.chunkMs !== undefined ? req.chunkMs : 0;
  const chunkSize = req.chunkSize !== undefined ? req.chunkSize : 4096;

  async function* generate(): AsyncGenerator<Buffer> {
    if (delayMs > 0) await sleep(delayMs);
    for (let offset = 0; offset < buf.length; offset += chunkSize) {
      yield buf.subarray(offset, offset + chunkSize);
      if (chunkMs > 0) await sleep(chunkMs);
    }
  }

  reply.header("Content-Type", "audio/mpeg");
  reply.header("Cache-Control", "no-store");
  return reply.send(Readable.from(generate()));
}
