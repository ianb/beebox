/**
 * `POST /api/cards/submit` — multipart submission intake for any card type
 * whose schema declares `submissions` (see `CardSubmissions`,
 * `src/cards/schema.ts`). Generic over the schema hook: `browser-task` is
 * the first user, but a second card type needs no second route.
 *
 * Multipart layout: a `card` field naming the box-relative target card, a
 * `records` part holding the JSON manifest, and zero or more file parts. This
 * stays a raw Fastify route (not tRPC) for the same reason chat/bulk uploads
 * do: streamed binary parts don't fit the tRPC request/response shape.
 *
 * The route does the IO-shell work — stream parts to a temp dir, parse the
 * manifest, enforce the byte/file caps — and hands off to
 * `acceptSubmission` (`src/core/cards/accept-submission.ts`) for everything
 * that touches the card and its attach scope.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import type { EventBus } from "../../core/event-bus.js";
import { acceptSubmission } from "../../core/cards/accept-submission.js";
import { ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { hashStreamToFile, StreamByteLimitError } from "../../lib/hash-stream-to-file.js";
import { MAX_STAGED_BYTES } from "../../core/capture/staging-limits.js";
import { getBoxTime } from "../../lib/time.js";
import type { SubmissionIssue } from "../../cards/index.js";

/** Hard ceiling on the number of file parts one submission may carry. */
const MAX_SUBMISSION_FILES = 200;

interface RegisterCardSubmissionRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

/** A multipart field/file part's value as text, whichever form busboy handed us. */
/** The `card` path field and the `records` manifest are the only text parts; each has its own cap. */
const MAX_CARD_FIELD_BYTES = 4096;
const MAX_RECORDS_BYTES = 8 * 1024 * 1024;

/** A text part grew past its cap; the route answers 413 and drains the rest. */
class TextPartTooLargeError extends Error {
  constructor(name: string, cap: number) {
    super(`${name} exceeds ${String(cap)} bytes`);
    this.name = "TextPartTooLargeError";
  }
}

async function partText(
  part: { fieldname: string; type: "field" | "file"; value?: unknown; file?: AsyncIterable<Buffer | string> },
  maxBytes: number,
): Promise<string> {
  if (part.type === "field") {
    const value = typeof part.value === "string" ? part.value : String(part.value);
    if (Buffer.byteLength(value) > maxBytes) throw new TextPartTooLargeError(part.fieldname, maxBytes);
    return value;
  }
  // A file part is read off its stream directly, under the same cap as a
  // field. `part.toBuffer()` is not used: under `request.parts()` it reaches
  // for an internal buffer that only exists on attached-field parsing.
  if (part.file === undefined) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) throw new TextPartTooLargeError(part.fieldname, maxBytes);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** True when a submitted part's filename is a bare basename — no traversal, no dotfile. */
function isBareFileName(name: string): boolean {
  return name !== "" && !name.includes("/") && !name.includes("\\") && !name.startsWith(".");
}

interface SubmitErrorBody {
  ok: false;
  message: string;
  issues?: SubmissionIssue[];
}

type ReceiveFilePartResult =
  | { ok: true; name: string; size: number }
  | { ok: false; status: 400 | 413; message: string };

/**
 * Stream one uploaded file part into the temp dir under the running byte
 * budget. Refuses duplicates, non-bare names, and the file-count cap before
 * writing; drains a refused part so the multipart iterator can continue.
 */
async function receiveFilePart(opts: {
  part: { filename: string; file: Readable };
  tempDir: string;
  fileNames: readonly string[];
  remainingBytes: number;
}): Promise<ReceiveFilePartResult> {
  const { part, tempDir, fileNames, remainingBytes } = opts;
  const name = part.filename;
  let refusal: ReceiveFilePartResult | null = null;
  if (fileNames.includes(name)) refusal = { ok: false, status: 400, message: `duplicate file name: ${name}` };
  else if (!isBareFileName(name)) refusal = { ok: false, status: 400, message: `invalid file name: ${name}` };
  else if (fileNames.length >= MAX_SUBMISSION_FILES) {
    refusal = { ok: false, status: 413, message: `submission carries more than ${MAX_SUBMISSION_FILES} files` };
  }
  if (refusal !== null) {
    part.file.resume();
    return refusal;
  }
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const written = await hashStreamToFile({ source: part.file, destPath: path.join(tempDir, name), maxBytes: remainingBytes });
    return { ok: true, name, size: written.size };
  } catch (e) {
    if (e instanceof StreamByteLimitError) {
      return { ok: false, status: 413, message: `submission exceeds the ${MAX_STAGED_BYTES}-byte cap` };
    }
    throw e;
  }
}

export function registerCardSubmissionRoutes(options: RegisterCardSubmissionRoutesOptions): void {
  const { server, boxRoot, eventBus } = options;

  server.post("/api/cards/submit", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ ok: false, message: "expected multipart/form-data" } satisfies SubmitErrorBody);
    }

    const tempDir = path.join(await ensureBoxTmpDir(boxRoot), "submissions", randomUUID());
    let cardRel: string | undefined;
    let manifestSeen = false;
    let manifest: unknown;
    const fileNames: string[] = [];
    let remainingBytes = MAX_STAGED_BYTES;

    const cleanup = async (): Promise<void> => {
      await fs.rm(tempDir, { recursive: true, force: true });
    };

    try {
      for await (const part of request.parts()) {
        if (part.fieldname === "card" || part.fieldname === "records") {
          // Each protocol part arrives exactly once; a second copy is a
          // malformed request, not "the later one wins".
          if ((part.fieldname === "card" && cardRel !== undefined) || (part.fieldname === "records" && manifestSeen)) {
            if (part.type === "file") part.file.resume();
            await cleanup();
            return reply.status(400).send({ ok: false, message: `duplicate ${part.fieldname} part` } satisfies SubmitErrorBody);
          }
        }
        if (part.fieldname === "card") {
          cardRel = await partText(part, MAX_CARD_FIELD_BYTES);
          continue;
        }
        if (part.fieldname === "records") {
          const text = await partText(part, MAX_RECORDS_BYTES);
          manifestSeen = true;
          try {
            manifest = JSON.parse(text);
          } catch (_e) {
            await cleanup();
            return reply.status(400).send({ ok: false, message: "records must be valid JSON" } satisfies SubmitErrorBody);
          }
          continue;
        }
        if (part.type !== "file") continue;

        const received = await receiveFilePart({ part, tempDir, fileNames, remainingBytes });
        if (!received.ok) {
          await cleanup();
          return reply.status(received.status).send({ ok: false, message: received.message } satisfies SubmitErrorBody);
        }
        remainingBytes -= received.size;
        fileNames.push(received.name);
      }
    } catch (e) {
      await cleanup();
      if (e instanceof TextPartTooLargeError) {
        return reply.status(413).send({ ok: false, message: e.message } satisfies SubmitErrorBody);
      }
      throw e;
    }

    if (cardRel === undefined || cardRel === "") {
      await cleanup();
      return reply.status(400).send({ ok: false, message: "missing card field" } satisfies SubmitErrorBody);
    }
    if (!manifestSeen) {
      await cleanup();
      return reply.status(400).send({ ok: false, message: "missing records part" } satisfies SubmitErrorBody);
    }
    // A batch with no file parts still needs its (empty) temp dir for the helper.
    await fs.mkdir(tempDir, { recursive: true });

    const result = await acceptSubmission({
      boxRoot,
      cardRel,
      tempDir,
      fileNames,
      manifest,
      eventBus,
      now: () => getBoxTime(boxRoot),
    });

    if (!result.ok) {
      const body: SubmitErrorBody = { ok: false, message: result.message };
      if (result.issues !== undefined) body.issues = result.issues;
      return reply.status(result.status).send(body);
    }
    return reply.status(200).send({ ok: true, batch: result.batch, count: result.count, dir: result.dir });
  });
}
