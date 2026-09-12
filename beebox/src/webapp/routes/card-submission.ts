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
async function partText(part: { type: "field" | "file"; value?: unknown; toBuffer?: () => Promise<Buffer> }): Promise<string> {
  if (part.type === "field") {
    return typeof part.value === "string" ? part.value : String(part.value);
  }
  const toBuffer = part.toBuffer;
  if (toBuffer === undefined) return "";
  return (await toBuffer()).toString("utf8");
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

export function registerCardSubmissionRoutes(options: RegisterCardSubmissionRoutesOptions): void {
  const { server, boxRoot, eventBus } = options;

  server.post("/api/cards/submit", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ ok: false, message: "expected multipart/form-data" } satisfies SubmitErrorBody);
    }

    const tempDir = path.join(await ensureBoxTmpDir(boxRoot), "submissions", randomUUID());
    let tempDirCreated = false;
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
        if (part.fieldname === "card") {
          cardRel = await partText(part);
          continue;
        }
        if (part.fieldname === "records") {
          const text = await partText(part);
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

        const name = part.filename;
        if (!isBareFileName(name)) {
          part.file.resume();
          await cleanup();
          return reply.status(400).send({ ok: false, message: `invalid file name: ${name}` } satisfies SubmitErrorBody);
        }
        if (fileNames.length >= MAX_SUBMISSION_FILES) {
          part.file.resume();
          await cleanup();
          return reply
            .status(413)
            .send({ ok: false, message: `submission carries more than ${MAX_SUBMISSION_FILES} files` } satisfies SubmitErrorBody);
        }

        if (!tempDirCreated) {
          await fs.mkdir(tempDir, { recursive: true });
          tempDirCreated = true;
        }

        try {
          const written = await hashStreamToFile({
            source: part.file,
            destPath: path.join(tempDir, name),
            maxBytes: remainingBytes,
          });
          remainingBytes -= written.size;
        } catch (e) {
          await cleanup();
          if (e instanceof StreamByteLimitError) {
            return reply
              .status(413)
              .send({ ok: false, message: `submission exceeds the ${MAX_STAGED_BYTES}-byte cap` } satisfies SubmitErrorBody);
          }
          throw e;
        }
        fileNames.push(name);
      }
    } catch (e) {
      await cleanup();
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
    if (!tempDirCreated) {
      await fs.mkdir(tempDir, { recursive: true });
    }

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
