import { test } from "tap";
import {
  readEnvelopeData,
  parseDestinationsData,
  parseCommentaryResult,
  parseTabArrangementResult,
  postCommentary,
  ClerkApiError,
  parseSendResult,
  parseSendView,
  postSend,
  chooseSendDestination,
  SendUnsupportedError,
} from "../../src/platform/clerk-api.js";

test("readEnvelopeData unwraps a well-formed tRPC success envelope", async (t) => {
  const env = readEnvelopeData({ result: { data: { destinations: [] } } });
  t.same(env, { ok: true, data: { destinations: [] } });
});

test("readEnvelopeData preserves a null data payload (present, not missing)", async (t) => {
  // `data: null` is a present key — the envelope is well-formed; shape
  // validation downstream decides whether null is acceptable.
  t.same(readEnvelopeData({ result: { data: null } }), { ok: true, data: null });
});

test("readEnvelopeData rejects non-object, missing result, and missing data", async (t) => {
  t.same(readEnvelopeData(null), { ok: false });
  t.same(readEnvelopeData("nope"), { ok: false });
  t.same(readEnvelopeData([]), { ok: false });
  t.same(readEnvelopeData({}), { ok: false });
  t.same(readEnvelopeData({ result: 5 }), { ok: false });
  t.same(readEnvelopeData({ result: {} }), { ok: false });
  // A tRPC error envelope has no `result` — treated as a bad success envelope.
  t.same(readEnvelopeData({ error: { message: "boom" } }), { ok: false });
});

test("parseDestinationsData accepts the current response shape", async (t) => {
  const parsed = parseDestinationsData({
    destinations: [
      { dir: "", label: "root", symbol: null },
      { dir: "store/reading", label: "Reading", symbol: "📚" },
    ],
  });
  t.same(parsed, [
    { dir: "", label: "root", symbol: null },
    { dir: "store/reading", label: "Reading", symbol: "📚" },
  ]);
});

test("parseDestinationsData rejects skewed responses (never a silent undefined)", async (t) => {
  t.equal(parseDestinationsData({}), null, "missing destinations");
  t.equal(parseDestinationsData({ destinations: "nope" }), null, "destinations not an array");
  t.equal(parseDestinationsData({ destinations: [{ dir: 1, label: "x", symbol: null }] }), null, "dir not a string");
  t.equal(parseDestinationsData({ destinations: [{ dir: "d", label: "l", symbol: 5 }] }), null, "symbol wrong type");
  t.equal(parseDestinationsData({ destinations: [{ dir: "d" }] }), null, "missing label");
});

test("parseCommentaryResult accepts the current response shape", async (t) => {
  const parsed = parseCommentaryResult({
    created: ["box/inbox/A.webpage.card", "box/inbox/A.commentary.card"],
    open: "chat?session=new",
  });
  t.same(parsed, {
    created: ["box/inbox/A.webpage.card", "box/inbox/A.commentary.card"],
    open: "chat?session=new",
  });
});

test("parseCommentaryResult rejects skewed responses", async (t) => {
  t.equal(parseCommentaryResult({ open: "x" }), null, "missing created");
  t.equal(parseCommentaryResult({ created: [1], open: "x" }), null, "created entry not a string");
  t.equal(parseCommentaryResult({ created: [], open: 5 }), null, "open not a string");
  t.equal(parseCommentaryResult(null), null, "not a record");
});

test("parseTabArrangementResult validates the handoff response", async (t) => {
  t.same(parseTabArrangementResult({ card: "box/inbox/Tabs.card", open: "chat?session=new", transferId: "abc" }), {
    card: "box/inbox/Tabs.card",
    open: "chat?session=new",
    transferId: "abc",
  });
  t.equal(parseTabArrangementResult({ card: "x", open: "y" }), null);
  t.equal(parseTabArrangementResult({ card: "x", open: 2, transferId: "abc" }), null);
});

const box = { boxUrl: "http://localhost:3210/main/test1", slug: "test1", title: "Test" };
const capturePayload = {
  url: "https://example.com/a",
  title: "A",
  readableMarkdown: "body",
  captureId: "30000000-0000-4000-8000-000000000000",
};
const okBody = JSON.stringify({ result: { data: { created: ["_content/inbox/A.webpage.card"], open: "chat" } } });

export class UnexpectedFetchError extends Error {
  constructor() {
    super("unexpected extra fetch");
    this.name = "UnexpectedFetchError";
  }
}

/** What fetch throws when the connection drops before a response. */
export class NetworkDownError extends TypeError {
  constructor() {
    super("Failed to fetch");
    this.name = "NetworkDownError";
  }
}

/** Replace fetch with a scripted sequence of outcomes; returns the request bodies it saw. */
function scriptFetch(
  onTeardown: (restore: () => void) => void,
  outcomes: Array<"network" | number>,
): { bodies: unknown[] } {
  const seen: { bodies: unknown[] } = { bodies: [] };
  const original = globalThis.fetch;
  onTeardown(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (_url, init) => {
    seen.bodies.push(JSON.parse(String(init?.body)));
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new UnexpectedFetchError();
    if (outcome === "network") throw new NetworkDownError();
    return new Response(outcome === 200 ? okBody : "error", { status: outcome });
  };
  return seen;
}

/** Collects the retry log lines for one test instead of printing them. */
function captureRetryLogs(onTeardown: (restore: () => void) => void): unknown[][] {
  const lines: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => lines.push(args);
  onTeardown(() => {
    console.info = original;
  });
  return lines;
}

test("postCommentary retries a lost response with the same captureId", async (t) => {
  const logs = captureRetryLogs((restore) => t.teardown(restore));
  const seen = scriptFetch((restore) => t.teardown(restore), ["network", 503, 200]);
  const result = await postCommentary(box, { payload: capturePayload, retryDelaysMs: [0, 0] });
  t.same(result, { created: ["_content/inbox/A.webpage.card"], open: "chat" });
  t.equal(seen.bodies.length, 3);
  t.same(seen.bodies, [capturePayload, capturePayload, capturePayload]);
  t.equal(logs.length, 2);
});

test("postCommentary does not retry the box's own error answer", async (t) => {
  const seen = scriptFetch((restore) => t.teardown(restore), [409]);
  const error: unknown = await postCommentary(box, { payload: capturePayload, retryDelaysMs: [0, 0] }).catch((e: unknown) => e);
  t.ok(error instanceof ClerkApiError && error.status === 409);
  t.equal(seen.bodies.length, 1);
});

test("postCommentary gives up after its bounded retries", async (t) => {
  captureRetryLogs((restore) => t.teardown(restore));
  const seen = scriptFetch((restore) => t.teardown(restore), ["network", "network", "network"]);
  const error: unknown = await postCommentary(box, { payload: capturePayload, retryDelaysMs: [0, 0] }).catch((e: unknown) => e);
  t.ok(error instanceof ClerkApiError && error.status === 0);
  t.equal(seen.bodies.length, 3);
});

test("postCommentary still does not retry a 500", async (t) => {
  const seen = scriptFetch((restore) => t.teardown(restore), [500]);
  const error: unknown = await postCommentary(box, { payload: capturePayload, retryDelaysMs: [0, 0] }).catch((e: unknown) => e);
  t.ok(error instanceof ClerkApiError && error.status === 500);
  t.equal(seen.bodies.length, 1);
});

const sendPayload = {
  id: "40000000-0000-4000-8000-000000000000",
  note: "for Sunday",
  url: "https://example.com/trail",
  title: "Trail",
  readableMarkdown: "# Trail",
};
const sentData = {
  card: "_content/incoming/Trail-40000000-0000-4000-8000-000000000000.webpage.card",
  state: "sent",
  destination: { label: "Cooking", sessionId: "s1" },
};

/** Scripted fetch for send calls: each outcome is a status or a 200 body. */
function scriptSendFetch(
  onTeardown: (restore: () => void) => void,
  outcomes: Array<"network" | number | { data: unknown }>,
): { urls: string[]; bodies: unknown[] } {
  const seen: { urls: string[]; bodies: unknown[] } = { urls: [], bodies: [] };
  const original = globalThis.fetch;
  onTeardown(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, init) => {
    seen.urls.push(String(url));
    seen.bodies.push(JSON.parse(String(init?.body)));
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new UnexpectedFetchError();
    if (outcome === "network") throw new NetworkDownError();
    if (typeof outcome === "number") return new Response("error", { status: outcome });
    return new Response(JSON.stringify({ result: { data: outcome.data } }), { status: 200 });
  };
  return seen;
}

test("parseSendResult accepts the full send result shape", async (t) => {
  const full = {
    card: "c.webpage.card",
    state: "needs-choice",
    reason: "uncertain",
    queued: false,
    lastError: "x",
    expired: true,
    choices: [{ candidateId: "a", label: "Cooking", detail: "recent" }, { candidateId: "b", label: "Money" }],
  };
  t.same(parseSendResult(full), full);
  t.same(parseSendResult(sentData), sentData);
});

test("parseSendResult rejects skewed responses", async (t) => {
  t.equal(parseSendResult({ state: "sent" }), null, "no card");
  t.equal(parseSendResult({ card: "c", state: "lost" }), null, "unknown state");
  t.equal(parseSendResult({ card: "c", state: "sent", destination: { sessionId: "s" } }), null, "destination without label");
  t.equal(parseSendResult({ card: "c", state: "needs-choice", reason: "maybe" }), null, "unknown reason");
  t.equal(parseSendResult({ card: "c", state: "needs-choice", choices: [{ label: "x" }] }), null, "choice without id");
  t.equal(parseSendResult({ card: "c", state: "sent", queued: "yes" }), null, "queued not boolean");
});

test("parseSendView reads a quick chat view and ignores its extra fields", async (t) => {
  t.same(
    parseSendView({
      id: sendPayload.id,
      message: "for Sunday",
      createdAt: "2026-10-15T00:00:00Z",
      state: "sent",
      destination: { label: "Cooking", sessionId: "s1" },
      page: { title: "Trail", url: "https://example.com/trail" },
    }),
    { state: "sent", destination: { label: "Cooking", sessionId: "s1" } },
  );
});

test("postSend posts the payload to clerk.send and parses the answer", async (t) => {
  const seen = scriptSendFetch((restore) => t.teardown(restore), [{ data: sentData }]);
  t.same(await postSend(box, { payload: sendPayload, retryDelaysMs: [] }), sentData);
  t.same(seen.urls, ["http://localhost:3210/main/test1/api/trpc/clerk.send"]);
  t.same(seen.bodies, [sendPayload]);
});

test("postSend retries network errors and 500/502/503/504 with the same payload", async (t) => {
  const logs = captureRetryLogs((restore) => t.teardown(restore));
  const seen = scriptSendFetch((restore) => t.teardown(restore), ["network", 500, 502, 503, 504, { data: sentData }]);
  t.same(await postSend(box, { payload: sendPayload, retryDelaysMs: [0, 0, 0, 0, 0] }), sentData);
  t.equal(seen.bodies.length, 6);
  t.ok(seen.bodies.every((body) => JSON.stringify(body) === JSON.stringify(sendPayload)));
  t.equal(logs.length, 5);
});

test("postSend does not retry the box's own refusal", async (t) => {
  const seen = scriptSendFetch((restore) => t.teardown(restore), [409]);
  const error: unknown = await postSend(box, { payload: sendPayload, retryDelaysMs: [0, 0] }).catch((e: unknown) => e);
  t.ok(error instanceof ClerkApiError && error.status === 409);
  t.notOk(error instanceof SendUnsupportedError);
  t.equal(seen.bodies.length, 1);
});

test("postSend turns a 404 into SendUnsupportedError (box too old)", async (t) => {
  const seen = scriptSendFetch((restore) => t.teardown(restore), [404]);
  const error: unknown = await postSend(box, { payload: sendPayload, retryDelaysMs: [0, 0] }).catch((e: unknown) => e);
  t.ok(error instanceof SendUnsupportedError);
  t.equal(seen.bodies.length, 1);
});

test("chooseSendDestination posts the id and candidate to quickChat.choose", async (t) => {
  const seen = scriptSendFetch((restore) => t.teardown(restore), [
    { data: { id: sendPayload.id, message: "", createdAt: "x", state: "sent", destination: { label: "Money" } } },
  ]);
  t.same(await chooseSendDestination(box, { id: sendPayload.id, candidateId: "c2" }), {
    state: "sent",
    destination: { label: "Money" },
  });
  t.same(seen.urls, ["http://localhost:3210/main/test1/api/trpc/quickChat.choose"]);
  t.same(seen.bodies, [{ id: sendPayload.id, candidateId: "c2" }]);
});
