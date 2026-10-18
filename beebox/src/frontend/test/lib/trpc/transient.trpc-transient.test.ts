// # A box that did not answer: classified once, retried for queries (`lib/trpc/transient.ts`)
//
// A deploy restarts the hub, and for about a minute nginx answers every request
// with its own HTML 502 page. The tRPC batch link used to parse that page as JSON,
// so the person saw `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` —
// and because every query had `retry: false`, they saw it for good.
//
// Now the transport (`fetchFromBox`, used by `trpcFetch`) turns a 502/503/504 or a
// request that never reached a server into a `BoxUnreachableError`, and the
// client's `retryLink` retries **queries** that failed that way. These examples
// run the real `httpBatchStreamLink` and `retryLink` against a real tRPC server
// behind a stand-in gateway, composed the way `buildTrpcLink` composes them. The
// delay is zero here; the real schedule is checked at the end.

import { test } from "tap";
import "agent-doctest/tap";
import http from "node:http";
import assert from "node:assert";
import { initTRPC, TRPCError } from "@trpc/server";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { createTRPCClient, httpBatchStreamLink, retryLink } from "@trpc/client";
import { fetchFromBox, unreachableCause, shouldRetryOperation, isBoxUnreachable, retryDelayMs, MAX_RETRIES } from "../../../src/lib/trpc/transient.js";

const NGINX_502 = "<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>";

/**
 * A box behind a gateway that answers the first `outage` requests with nginx's
 * 502 page. `reached` counts the calls that got through to a procedure.
 */
async function boxBehindGateway(outage: number) {
  const t = initTRPC.create();
  const reached = { ping: 0, send: 0, broken: 0, slow: 0 };
  const router = t.router({
    ping: t.procedure.query(() => { reached.ping++; return "pong"; }),
    // The first call is still running when every connection is cut, the way a
    // deploy kills the hub mid-stream; the retry finds the box serving again.
    slow: t.procedure.query(async () => {
      reached.slow++;
      if (reached.slow === 1) {
        setTimeout(() => { server.closeAllConnections(); }, 50);
        await new Promise((resolve) => { setTimeout(resolve, 200); });
      }
      return "slow answer";
    }),
    send: t.procedure.mutation(() => { reached.send++; return "sent"; }),
    broken: t.procedure.query(() => {
      reached.broken++;
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "a bug in the procedure" });
    }),
  });
  const handler = createHTTPHandler({ router });
  let refused = 0;
  const server = http.createServer((req, res) => {
    if (refused < outage) {
      refused++;
      res.writeHead(502, { "content-type": "text/html" });
      res.end(NGINX_502);
      return;
    }
    handler(req, res);
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const client = createTRPCClient<typeof router>({
    links: [
      retryLink({
        retry: ({ op, attempts, error }) =>
          shouldRetryOperation({ type: op.type, attempts, error, idempotent: op.context["idempotent"] === true }),
        retryDelayMs: () => 0,
      }),
      httpBatchStreamLink({ url, fetch: fetchFromBox }),
    ],
  });
  const close = () => new Promise<void>((resolve) => { server.close(() => resolve()); });
  return { client, url, reached, refused: () => refused, close };
}

/** Settle a promise into what a person or a caller would see. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (e) {
    return e;
  }
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

// ## A query rides over a restart
//
// Three 502s, then the box is back. The caller sees only the answer.
void test("Three 502s, then the box is back.", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L98
  const box = await boxBehindGateway(3);
  t.check(await box.client.ping.query(), "pong");

  // doctest:L102
  t.check({ refused: box.refused(), reached: box.reached.ping }, {
    refused: 3,
    reached: 1,
  });
});

// ## A connection cut partway through a batch
//
// A batch answers 200 and streams each result as it resolves, so the status
// cannot reveal an outage that starts mid-stream. Here `ping` is delivered, then
// the connection dies while `slow` is still running. `ping` keeps its answer; only
// `slow` is retried, and the caller sees both answers.
void test("A batch answers 200 and streams each result as it resolves, so the status can...", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L118
  const box = await boxBehindGateway(0);
  t.check(await Promise.all([box.client.ping.query(), box.client.slow.query()]), [
    "pong",
    "slow answer",
  ]);

  // doctest:L122
  t.check(box.reached.slow, 2);
});

// ## When the outage outlasts the retries, the message says what happened
//
// After `MAX_RETRIES` retries the query fails. What reaches the caller is the
// sentence to show, and the transport fact stays available as the cause — never
// the JSON parser's complaint about `<!DOCTYPE`.
void test("After MAXRETRIES retries the query fails.", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L137
  const box = await boxBehindGateway(1_000);
  const error = await settle(box.client.ping.query());

  // doctest:L140
  t.check(messageOf(error), "The box did not answer — it may be restarting. Try again in a moment.");

  // doctest:L143
  t.check(unreachableCause(error)?.detail, "HTTP 502 from the gateway");

  // doctest:L146
  await t.checkText(box.refused() === MAX_RETRIES + 1, "true");
});

// ## A mutation is never replayed
//
// A 502 probably means the request never reached the app, but "probably" is not
// enough to send something twice. The mutation fails once with the same message,
// and the person's own retry is what sends it.
void test("A 502 probably means the request never reached the app, but \"probably\" is not...", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L161
  const box = await boxBehindGateway(1);
  t.check(messageOf(await settle(box.client.send.mutate())), "The box did not answer — it may be restarting. Try again in a moment.");

  // doctest:L165
  t.check({ refused: box.refused(), reached: box.reached.send }, {
    refused: 1,
    reached: 0,
  });

  // doctest:L168
  t.check(await box.client.send.mutate(), "sent");
});

// ## A mutation opted in as idempotent IS replayed
//
// `voiceRecording.claim`/`.fallBack` pass `{ context: { idempotent: true } }` per
// call (`lib/trpc/index.ts` reads it off `op.context`), since the server has no
// way to mark a procedure idempotent that a client link can see. With that flag
// set, a 502 is retried exactly like a query.
void test("voiceRecording.claim/.fallBack pass { context:", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L184
  const box = await boxBehindGateway(1);
  t.check(messageOf(await box.client.send.mutate(undefined, { context: { idempotent: true } })), "sent");

  // doctest:L188
  t.check({ refused: box.refused(), reached: box.reached.send }, {
    refused: 1,
    reached: 1,
  });
});

// ## An opted-in mutation still needs an outage to retry
//
// `isBoxUnreachable` is the same test the retry link applies, exported for the
// voice-staging queue (`lib/audio/voice-staging-queue.ts`) to reuse rather than
// re-derive.
void test("isBoxUnreachable is the same test the retry link applies, exported for the vo...", async (t) => {
  // doctest:L203
  const notUnreachable = new Error("a bug in the procedure");

  // doctest:L205
  t.check(shouldRetryOperation({ type: "mutation", attempts: 1, error: notUnreachable, idempotent: true }), false);

  // doctest:L208
  t.check(isBoxUnreachable(notUnreachable), false);
});

// ## A procedure's own failure is an answer, not an outage
//
// The stream link's HTTP status is 200 once the server starts writing, so a
// procedure error rides in the body and never looks like a gateway. It reaches the
// caller on the first attempt, with its own message.
void test("The stream link's HTTP status is 200 once the server starts writing, so a pro...", async (t) => {
  t.teardown(async () => {
    try {
      await box.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L219
  const box = await boxBehindGateway(0);
  t.check(messageOf(await settle(box.client.broken.query())), "a bug in the procedure");

  // doctest:L223
  t.check(box.reached.broken, 1);

  // `fetchFromBox` passes every other status through as a response, for the caller
  // to handle — a 404 here, and a 401 in `trpcFetch`, which has its own
  // session-ended handling that must not become a retry loop.

  // doctest:L232
  t.check((await fetchFromBox(`${box.url}/nope`)).status, 404);

  // A cancelled request is not an outage either: the abort passes through unchanged,
  // so a query React Query cancels is never retried.

  // doctest:L240
  const aborted = await settle(fetchFromBox(box.url, { signal: AbortSignal.abort() }));
  t.check(aborted instanceof Error ? aborted.name : aborted, "AbortError");
});

// ## A request that never reached a server
//
// Nothing listening at all is the same failure, with no status to report.
void test("Nothing listening at all is the same failure, with no status to report.", async (t) => {
  // doctest:L254
  const box = await boxBehindGateway(0);
  await box.close();
  const error = await settle(fetchFromBox(box.url));

  // doctest:L258
  t.check({ name: error instanceof Error ? error.name : null, status: unreachableCause(error)?.status }, {
    name: "BoxUnreachableError",
    status: null,
  });

  // doctest:L261
  t.check(unreachableCause(error)?.detail, "fetch failed");
});

// ## The schedule is sized to a deploy restart
//
// A production deploy keeps the site down for about 160-190 s, and a request
// can land at its very start. The retries span about 211 s, then stop.
void test("A production deploy keeps the site down for about 160-190 s, and a request ca...", async (t) => {
  // doctest:L271
  const delays = Array.from({ length: MAX_RETRIES }, (_, i) => retryDelayMs(i + 1));
  t.check(delays, [
    1000,
    2000,
    4000,
    8000,
    16000,
    30000,
    30000,
    30000,
    30000,
    30000,
    30000,
  ]);

  // doctest:L275
  t.check(delays.reduce((sum, ms) => sum + ms, 0), 211000);
});
