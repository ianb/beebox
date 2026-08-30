/**
 * A minimal fake implementation of the server half of the scan-upload wire
 * contract (docs/scan-upload-contract.md), for exercising the client
 * against real HTTP without a beebox checkout. Route matching and
 * response shapes are deliberately literal translations of the contract —
 * this file has no other purpose than being a body double for the real
 * server routes in tests.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export interface CheckStateEntry {
  readonly state: "unknown" | "pending" | "imported" | "rejected";
  readonly reason?: string;
}

export interface PutRequestRecord {
  readonly pathHash: string;
  readonly filename: string;
  readonly authorization: string | undefined;
  readonly body: Buffer;
}

export interface FakeScanServerHandlers {
  /** Returns the check state for each requested hash. */
  checkState: (hash: string) => CheckStateEntry;
  /** Returns the PUT outcome for a given hash; receives the full request record. */
  putOutcome: (record: PutRequestRecord) => PutOutcome;
  /** Optional: gates `POST /api/scan/check` on the request's `authorization`
   * header, responding 401 when it returns `false`. Omitted means every
   * request is authorized — the default every existing test relies on. */
  checkAuthorization?: (authorization: string | undefined) => boolean;
  /** Optional: short-circuits `POST /api/scan/check` with an arbitrary
   * status + JSON body instead of the normal 200 states response — for
   * simulating a status the real server can legitimately return outside
   * the check endpoint's documented 200 shape (e.g. a 503 the client has
   * no specific handling for, carrying a `reason` in its body). */
  checkFailure?: () => { readonly status: number; readonly body: unknown };
}

export type PutOutcome =
  | { readonly status: 200; readonly body: { status: "accepted" | "duplicate" } }
  | { readonly status: 422; readonly body: { status: "rejected"; reason: string } }
  | { readonly status: 422; readonly body: { status: "hash-mismatch" } }
  | { readonly status: 413 }
  | { readonly status: 429; readonly retryAfterSeconds: number }
  /** A status this client's `interpretPutResponse` has no specific case
   * for (anything besides 200/422/413/429/503) — falls to its generic
   * "unexpected HTTP status" handling. For simulating that path with a
   * reason-carrying body. */
  | { readonly status: 500; readonly body: unknown };

export interface FakeScanServer {
  readonly url: string;
  readonly putRequests: PutRequestRecord[];
  close(): Promise<void>;
}

/** Raised when the fake server's OS-assigned TCP port can't be read back. */
class FakeServerBindError extends Error {
  constructor() {
    super("fake scan server failed to bind a TCP port");
    this.name = "FakeServerBindError";
  }
}

const CHECK_PATH = /^\/[^/]+\/api\/scan\/check$/;
const PUT_PATH = /^\/[^/]+\/api\/scan\/files\/([^/]+)$/;

export async function startFakeScanServer(
  handlers: FakeScanServerHandlers,
): Promise<FakeScanServer> {
  const putRequests: PutRequestRecord[] = [];
  const server = createServer((req, res) => {
    handleRequest({ req, res, handlers, putRequests }).catch((e: unknown) => {
      res.writeHead(500).end(String(e));
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new FakeServerBindError();
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    putRequests,
    close: () => closeServer(server),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly handlers: FakeScanServerHandlers;
  readonly putRequests: PutRequestRecord[];
}

async function handleRequest(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? "";
  if (ctx.req.method === "POST" && CHECK_PATH.test(url)) {
    await handleCheck(ctx);
    return;
  }
  const putMatch = PUT_PATH.exec(url);
  if (ctx.req.method === "PUT" && putMatch !== null) {
    const pathHash = putMatch[1];
    if (pathHash === undefined) {
      ctx.res.writeHead(400).end();
      return;
    }
    await handlePut(ctx, pathHash);
    return;
  }
  ctx.res.writeHead(404).end();
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function requestedHashes(body: unknown): string[] {
  if (typeof body !== "object" || body === null || !("hashes" in body)) return [];
  const { hashes } = body;
  if (!Array.isArray(hashes)) return [];
  return hashes.filter((entry): entry is string => typeof entry === "string");
}

async function handleCheck(ctx: RequestContext): Promise<void> {
  const { checkAuthorization, checkFailure } = ctx.handlers;
  if (checkAuthorization !== undefined && !checkAuthorization(ctx.req.headers.authorization)) {
    ctx.res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (checkFailure !== undefined) {
    const failure = checkFailure();
    ctx.res.writeHead(failure.status, { "content-type": "application/json" }).end(JSON.stringify(failure.body));
    return;
  }
  const raw = await readBody(ctx.req);
  const body: unknown = JSON.parse(raw.toString("utf-8"));
  const states: Record<string, CheckStateEntry> = {};
  for (const requestedHash of requestedHashes(body)) {
    states[requestedHash] = ctx.handlers.checkState(requestedHash);
  }
  ctx.res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ states }));
}

async function handlePut(ctx: RequestContext, pathHash: string): Promise<void> {
  const body = await readBody(ctx.req);
  const filenameHeader = ctx.req.headers["x-upload-filename"];
  const record: PutRequestRecord = {
    pathHash,
    filename: typeof filenameHeader === "string" ? filenameHeader : "",
    authorization: ctx.req.headers.authorization,
    body,
  };
  ctx.putRequests.push(record);
  const outcome = ctx.handlers.putOutcome(record);
  if (outcome.status === 429) {
    ctx.res.writeHead(429, { "retry-after": String(outcome.retryAfterSeconds) }).end();
    return;
  }
  if (outcome.status === 413) {
    ctx.res.writeHead(413).end();
    return;
  }
  ctx.res
    .writeHead(outcome.status, { "content-type": "application/json" })
    .end(JSON.stringify(outcome.body));
}
