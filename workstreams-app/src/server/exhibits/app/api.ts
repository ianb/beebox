// The generic exhibit backend: documents, events, captures.
//
// Three file-backed primitives, scoped per exhibit, so an instrument never
// negotiates its own route (the story-eval save route is what this replaces).
// Everything an exhibit writes lands as ordinary files in its store directory:
// data/<key>.json, events.jsonl, captures/<name>. A later agent session reads
// them straight from disk — there is no read API beyond the documents route.
//
// These routes are registered on the exhibits app instance, so they run behind
// the same onRequest auth hook as every page (auth.ts). A second Fastify
// instance would be an unauthenticated surface, which is why this is a plugin.
//
// Three more routes are not storage: POST /api/<ws>/<exhibit>/focus brings
// the workstream's terminal tab forward, and the comment and transcribe routes
// in api-comments.ts write the boxholder's remarks to the comment store
// (docs/implemented-plans/exhibit-comments.md). Those are the origin's only grants of
// authority beyond the store.
//
// Committed apps (/apps/<name>/) write to the reserved store namespace
// store/apps/<name>/: their code is tracked, their runtime data is not, so
// using an app can never dirty a checkout.

import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyError, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { writeFileAtomic } from "../../../../../beebox/src/lib/atomic-write.js";
import { exhibitSegmentSchema } from "../../../shared/exhibits.js";
import { exhibitCommentRoutes, type ExhibitCommentOptions } from "./api-comments.js";
import {
  APPS_SEGMENT,
  DATA_DIR,
  InvalidExhibitPathError,
  STORE_MARKER,
  UninitializedStoreError,
  assertStoreInitialized,
  resolveUnderRoot,
} from "../store.js";

export const CAPTURES_DIR = "captures";
export const EVENTS_FILE = "events.jsonl";

/**
 * Captures are records of what happened in front of the developer: media and
 * data, never anything the origin would execute. `.ts`/`.tsx`/`.jsx`/`.html`/
 * `.js` are refused by omission — a page's code is authored in the checkout or
 * the store, not uploaded by a page at runtime.
 */
export const CAPTURE_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "svg",
  "webm", "mp4", "mp3", "wav", "ogg",
  "json", "csv", "txt", "md", "pdf",
] as const;

const CAPTURE_EXTENSION_SET = new Set<string>(CAPTURE_EXTENSIONS);

/** Documents and events are small structured writes; captures carry media. */
export const DOCUMENT_BODY_LIMIT = 1024 * 1024;
export const CAPTURE_BODY_LIMIT = 25 * 1024 * 1024;

/**
 * Brings a workstream's terminal tab forward (`bin/workstreams focus <name>`).
 * Structurally the workstreams origin's ActionCommandRunner, which the backend
 * passes in; a rejection's message is the CLI's last stderr line.
 */
export type FocusRunner = (request: { verb: "focus"; name: string }) => Promise<void>;

export interface ExhibitsApiOptions extends ExhibitCommentOptions {
  storeRoot: string;
  runFocus: FocusRunner;
}

/** Workstream names that have no session registry row to focus. */
const NO_SESSION_REASONS = new Map<string, string>([
  [APPS_SEGMENT, "Committed apps belong to no workstream, so there is no session to bring forward."],
  ["main", "The main checkout has no workstream session to bring forward."],
]);

export function lastLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).findLast((line) => line !== "") ?? "";
}

/** One JSONL line, as the client posts it; the server adds `at`. */
const eventEnvelopeSchema = z.object({
  log: z.string().min(1).max(120),
  data: z.unknown(),
});

/** A refusal the developer (or the page author) must be able to act on. */
export class ExhibitRequestError extends Error {
  /** Zod-style detail, when the refusal has more than one part. */
  issues: string[] = [];

  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ExhibitRequestError";
  }

  withIssues(issues: string[]): this {
    this.issues = issues;
    return this;
  }
}

function describeLimit(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}


/**
 * Create `segments` under `root` one level at a time, re-checking containment
 * after every step, so a symlink planted in the store cannot redirect a write
 * outside it. Containment itself stays in store.ts (resolveUnderRoot).
 */
async function ensureDirUnderRoot(root: string, segments: string[]): Promise<string> {
  let base = await fs.realpath(root);
  for (const segment of segments) {
    try {
      await fs.mkdir(path.join(base, segment));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    base = await resolveUnderRoot(base, [segment]);
  }
  return base;
}

export function requireSegment(value: string, what: string): string {
  if (!exhibitSegmentSchema.safeParse(value).success) {
    throw new ExhibitRequestError(
      400,
      `Invalid ${what} "${value}": one path segment of letters, digits, ".", "_" or "-", starting with a letter or digit.`,
    );
  }
  return value;
}

/** `<key>` names a document; the extension is the server's, not the page's. */
function documentFile(key: string): string {
  requireSegment(key, "document key");
  if (key.includes(".")) {
    throw new ExhibitRequestError(
      400,
      `Invalid document key "${key}": keys carry no extension — the server stores <key>.json.`,
    );
  }
  return `${key}.json`;
}

function captureFile(name: string): string {
  requireSegment(name, "capture name");
  const extension = path.extname(name).toLowerCase().slice(1);
  if (!CAPTURE_EXTENSION_SET.has(extension)) {
    throw new ExhibitRequestError(
      400,
      `Capture "${name}" is not an allowed kind. Captures are records: ${CAPTURE_EXTENSIONS.join(", ")}.`,
    );
  }
  return name;
}

export function parseJsonBody(body: string, what: string): unknown {
  try {
    // eslint-disable-next-line no-restricted-syntax -- JSON.parse is the parse boundary; callers treat the result as unknown.
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new ExhibitRequestError(
      400,
      `The ${what} body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface ScopeParams {
  ws: string;
  exhibit: string;
}

/**
 * The exhibit's store directory. A workstream exhibit must already exist — it
 * is the directory the page is served from — while an app's store directory is
 * created on first write, because an app's code lives in the checkout instead.
 */
export async function scopeDir(storeRoot: string, params: ScopeParams): Promise<string> {
  try {
    await assertStoreInitialized(storeRoot);
  } catch (error) {
    if (!(error instanceof UninitializedStoreError)) throw error;
    throw new ExhibitRequestError(
      503,
      `${storeRoot} is not an initialized exhibit store: it carries no ${STORE_MARKER} marker.`,
    );
  }
  const segments = [requireSegment(params.ws, "workstream"), requireSegment(params.exhibit, "exhibit name")];
  try {
    if (params.ws === APPS_SEGMENT) return await ensureDirUnderRoot(storeRoot, segments);
    return await resolveUnderRoot(storeRoot, segments);
  } catch (error) {
    if (error instanceof InvalidExhibitPathError) {
      throw new ExhibitRequestError(404, `No exhibit at ${segments.join("/")} in the store.`);
    }
    throw error;
  }
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The exhibits API. Registered with a prefix on the exhibits app so it inherits
 * that instance's auth hook; the JSON and raw halves are nested plugins because
 * content-type parsers are encapsulated per plugin.
 */
export const exhibitsApiPlugin: FastifyPluginAsync<ExhibitsApiOptions> = async (api, options) => {
  const { storeRoot, runFocus, comments, transcribe } = options;

  // eslint-disable-next-line max-params -- Fastify's setErrorHandler signature is fixed (the hub-http-error.ts precedent).
  api.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ExhibitRequestError) {
      return reply
        .code(error.status)
        .send(error.issues.length === 0 ? { error: error.message } : { error: error.message, issues: error.issues });
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply
        .code(413)
        .send({ error: `Request body is too large: this route accepts at most ${describeLimit(request.routeOptions.bodyLimit)}.` });
    }
    const status = error.statusCode ?? 500;
    request.log.error({ err: error }, "exhibit API failed");
    return reply.code(status).send({ error: status >= 500 ? "The exhibit API failed." : error.message });
  });

  api.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: `No exhibit API route for ${request.method} ${request.url}. The API is /api/<scope>/data/<key>, /api/<scope>/events, /api/<scope>/captures/<name>, POST /api/<scope>/focus, POST /api/<scope>/comments, and POST /api/transcribe.`,
    }));

  await api.register(async (json) => {
    // Parsing happens in the handlers, which own the refusal message.
    json.addContentTypeParser<string>("application/json", { parseAs: "string" }, async (_request: FastifyRequest, body: string) => body);

    json.get<{ Params: ScopeParams & { key: string } }>(
      "/:ws/:exhibit/data/:key",
      async (request, reply) => {
        const dir = await scopeDir(storeRoot, request.params);
        const file = documentFile(request.params.key);
        let resolved: string;
        try {
          resolved = await resolveUnderRoot(dir, [DATA_DIR, file]);
        } catch (error) {
          if (!(error instanceof InvalidExhibitPathError)) throw error;
          throw new ExhibitRequestError(404, `No document "${request.params.key}" in this exhibit.`);
        }
        const content = await readIfPresent(resolved);
        if (content === null) throw new ExhibitRequestError(404, `No document "${request.params.key}" in this exhibit.`);
        return reply.type("application/json; charset=utf-8").send(content);
      },
    );

    // Bounded authority: bring a workstream's terminal tab forward. No body, no
    // text reaches the CLI, and the workstream name is a validated segment.
    json.post<{ Params: ScopeParams }>("/:ws/:exhibit/focus", async (request, reply) => {
      const workstream = requireSegment(request.params.ws, "workstream");
      requireSegment(request.params.exhibit, "exhibit name");
      const noSession = NO_SESSION_REASONS.get(workstream);
      if (noSession !== undefined) {
        return reply.code(409).send({ message: "No session to focus.", detail: noSession });
      }
      await scopeDir(storeRoot, request.params);
      try {
        await runFocus({ verb: "focus", name: workstream });
      } catch (error) {
        const detail = lastLine(error instanceof Error ? error.message : String(error));
        return reply.code(409).send({ message: "Could not bring the session forward.", detail });
      }
      return reply.code(204).send();
    });

    // Nested so the comment routes share this parser and the error handler above.
    await json.register(exhibitCommentRoutes, { storeRoot, comments, transcribe });

    json.put<{ Params: ScopeParams & { key: string }; Body: string }>(
      "/:ws/:exhibit/data/:key",
      { bodyLimit: DOCUMENT_BODY_LIMIT },
      async (request, reply) => {
        const dir = await scopeDir(storeRoot, request.params);
        const file = documentFile(request.params.key);
        parseJsonBody(request.body, "document");
        const dataDir = await ensureDirUnderRoot(dir, [DATA_DIR]);
        await writeFileAtomic(path.join(dataDir, file), { content: request.body, createDir: false });
        return reply.code(200).send({ ok: true, key: request.params.key });
      },
    );

    json.post<{ Params: ScopeParams; Body: string }>(
      "/:ws/:exhibit/events",
      { bodyLimit: DOCUMENT_BODY_LIMIT },
      async (request, reply) => {
        const dir = await scopeDir(storeRoot, request.params);
        const parsed = eventEnvelopeSchema.safeParse(parseJsonBody(request.body, "event"));
        if (!parsed.success) {
          throw new ExhibitRequestError(400, 'An event is { "log": <name>, "data": <anything> }.').withIssues(
            parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
          );
        }
        const file = path.join(dir, EVENTS_FILE);
        if (await fs.lstat(file).then((stats) => stats.isSymbolicLink(), () => false)) {
          throw new ExhibitRequestError(409, `${EVENTS_FILE} is a symlink; the log is refused rather than followed.`);
        }
        // O_APPEND: concurrent appends of one short line each interleave safely,
        // and the server never reads this file back.
        await fs.appendFile(
          file,
          `${JSON.stringify({ at: new Date().toISOString(), log: parsed.data.log, data: parsed.data.data })}\n`,
        );
        return reply.code(200).send({ ok: true });
      },
    );
  });

  await api.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser<Buffer>("*", { parseAs: "buffer" }, async (_request: FastifyRequest, body: Buffer) => body);

    raw.post<{ Params: ScopeParams & { name: string }; Body: Buffer }>(
      "/:ws/:exhibit/captures/:name",
      { bodyLimit: CAPTURE_BODY_LIMIT },
      async (request, reply) => {
        const dir = await scopeDir(storeRoot, request.params);
        const file = captureFile(request.params.name);
        const capturesDir = await ensureDirUnderRoot(dir, [CAPTURES_DIR]);
        try {
          // "wx": a capture is a record of one moment, never overwritten.
          await fs.writeFile(path.join(capturesDir, file), request.body, { flag: "wx" });
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new ExhibitRequestError(409, `Capture "${file}" already exists; captures are records and are never replaced.`);
          }
          throw error;
        }
        return reply.code(201).send({ ok: true, name: file });
      },
    );
  });
};
