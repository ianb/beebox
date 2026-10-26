// # Quick chat wire contract: shared fixtures
//
// The iOS box screen and App Intent call `quickChat.submit`, `choose`, `retry`, `discard`, and `home`
// directly with the device token. The request and response shapes are pinned by
// golden fixtures in `test/mobile-contract/fixtures/quick-chat/`, which the
// native `QuickChatAPI` tests decode and encode too, so a change on either side
// fails the other's suite.
//
// - `*-request.json` is the exact POST body of one mutation (tRPC, not batched).
//   External input includes both `origin: "external"` and its platform `source`.
// - `view-*.json` is one non-batched tRPC response envelope whose `data` is a
//   `QuickChatView`, one file per face the box screen draws.
// - `home.json` is the envelope of the `home` query.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { quickChatViewSchema } from "../../../../src/core/chat/routing/quick-chat-record.js";
import { quickChatHomeSchema } from "../../../../src/core/chat/routing/quick-chat-home.js";
import {
  quickChatChooseInput, quickChatDiscardInput, quickChatRetryInput, quickChatSubmitInput,
} from "../../../../src/webapp/trpc/routers/quick-chat.js";
import { z } from "zod";
import { makeTestServer, type InjectResult } from "../../../helpers/test-route-server.js";

const DIR = "test/mobile-contract/fixtures/quick-chat";
async function fixture(name: string): Promise<object> {
  const parsed: unknown = JSON.parse(await readFile(join(DIR, name), "utf-8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${name} is not a JSON object`);
  return parsed;
}

const envelopeSchema = z.object({ result: z.object({ data: z.unknown() }) });
const errorEnvelopeSchema = z.object({ error: z.object({ message: z.string() }) });
/** The `data` of a tRPC success envelope (a fixture body or an HTTP response body). */
function dataOf(body: unknown): unknown {
  return envelopeSchema.parse(body).result.data;
}
function viewOf(body: unknown) {
  return quickChatViewSchema.parse(dataOf(body));
}
function homeOf(body: unknown) {
  return quickChatHomeSchema.parse(dataOf(body));
}
function errorMessage(res: InjectResult): string {
  return errorEnvelopeSchema.parse(res.body).error.message;
}

/** Parse with the server's schema; a field the schema would drop is a mismatch too. */
function check(schema: z.ZodType, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return `invalid: ${parsed.error.issues[0]?.message}`;
  return isDeepStrictEqual(parsed.data, value) ? "ok" : "has fields the server does not send";
}

// The generic external origin requires an allowlisted platform source, and typed
// or voice messages cannot claim an external source.
void test("The generic external origin requires an allowlisted platform source, and type...", async (t) => {
  const validBase = { id: "5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70", message: "x" };
  t.check(
    [
      quickChatSubmitInput.safeParse({ ...validBase, origin: "external" }).success,
      quickChatSubmitInput.safeParse({ ...validBase, origin: "typed", source: "apple-app-intents" }).success,
    ],
    [
    false,
    false,
  ],
  );
});

// Every fixture in the directory is one of the three kinds, and each parses with
// the schema the router uses, field for field.
void test("Every fixture in the directory is one of the three kinds, and each parses wit...", async (t) => {
  const names = (await readdir(DIR)).toSorted();
  const results: Record<string, string> = {};
  for (const name of names) {
    const body = await fixture(name);
    if (name.endsWith("request.json") && name.startsWith("submit-")) results[name] = check(quickChatSubmitInput, body);
    else if (name === "choose-request.json") results[name] = check(quickChatChooseInput, body);
    else if (name === "discard-request.json") results[name] = check(quickChatDiscardInput, body);
    else if (name === "retry-request.json") results[name] = check(quickChatRetryInput, body);
    else if (name.startsWith("home")) results[name] = check(quickChatHomeSchema, dataOf(body));
    else if (name.startsWith("view-")) results[name] = check(quickChatViewSchema, dataOf(body));
    else results[name] = "unknown fixture kind";
  }
  t.check(results, {
    "choose-request.json": "ok",
    "discard-request.json": "ok",
    "home-asleep.json": "ok",
    "home.json": "ok",
    "retry-request.json": "ok",
    "submit-external-request.json": "ok",
    "submit-request.json": "ok",
    "view-discarded.json": "ok",
    "view-needs-choice-destination-gone.json": "ok",
    "view-needs-choice-routing-unavailable.json": "ok",
    "view-needs-choice-uncertain.json": "ok",
    "view-sending-expired.json": "ok",
    "view-sending-not-delivered.json": "ok",
    "view-sending-page-no-note.json": "ok",
    "view-sent-no-session.json": "ok",
    "view-sent-queued.json": "ok",
    "view-sent.json": "ok",
  });
});

// The view fixtures cover each state and reason the box screen distinguishes, and
// a page sent from the Clerk with no note: an empty message beside `page`.
void test("The view fixtures cover each state and reason the box screen distinguishes, a...", async (t) => {
  const faces: (string | boolean | null)[][] = [];
  for (const name of (await readdir(DIR)).filter((file) => file.startsWith("view-")).toSorted()) {
    const { state, reason, lastError, expired, queued, destination, page, message } = viewOf(await fixture(name));
    faces.push([state, reason ?? null, lastError === undefined ? null : "lastError", expired ?? null, queued ?? null, destination?.sessionId === undefined ? null : "session",
      page === undefined ? null : `page${message === "" ? ", no note" : ""}`]);
  }
  t.check(faces, [
    [
      "discarded",
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    [
      "needs-choice",
      "destination-gone",
      null,
      null,
      null,
      null,
      null,
    ],
    [
      "needs-choice",
      "routing-unavailable",
      null,
      null,
      null,
      null,
      null,
    ],
    [
      "needs-choice",
      "uncertain",
      null,
      null,
      null,
      null,
      null,
    ],
    [
      "sending",
      null,
      "lastError",
      true,
      null,
      "session",
      null,
    ],
    [
      "sending",
      null,
      "lastError",
      null,
      null,
      "session",
      null,
    ],
    [
      "sending",
      null,
      "lastError",
      null,
      null,
      "session",
      "page, no note",
    ],
    [
      "sent",
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    [
      "sent",
      null,
      null,
      null,
      true,
      "session",
      null,
    ],
    [
      "sent",
      null,
      null,
      null,
      null,
      "session",
      null,
    ],
  ]);
});

// The request fixtures go over the real HTTP tRPC adapter as the phone sends
// them. With no OpenRouter key the submitted thought is stored as
// `routing-unavailable`, its response envelope parses as a view, and the discard
// fixture ends it. `home` answers an envelope that parses as the home schema.
// `retry` of a record that is not `sending` answers it unchanged.
void test("The request fixtures go over the real HTTP tRPC adapter as the phone sends them.", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const server = await makeTestServer();
  const submit = await server.request({ method: "POST", url: "/api/trpc/quickChat.submit", payload: await fixture("submit-request.json") });
  t.check([submit.statusCode, check(quickChatViewSchema, dataOf(submit.body)), viewOf(submit.body).state, viewOf(submit.body).reason], [
    200,
    "ok",
    "needs-choice",
    "routing-unavailable",
  ]);

  const home = await server.request({ method: "GET", url: "/api/trpc/quickChat.home" });
  t.check([home.statusCode, check(quickChatHomeSchema, dataOf(home.body)), homeOf(home.body).open.length], [
    200,
    "ok",
    1,
  ]);

  const retry = await server.request({ method: "POST", url: "/api/trpc/quickChat.retry", payload: await fixture("retry-request.json") });
  t.check([retry.statusCode, check(quickChatViewSchema, dataOf(retry.body)), viewOf(retry.body).state], [
    200,
    "ok",
    "needs-choice",
  ]);

  const discard = await server.request({ method: "POST", url: "/api/trpc/quickChat.discard", payload: await fixture("discard-request.json") });
  t.check([discard.statusCode, viewOf(discard.body).state], [
    200,
    "discarded",
  ]);

  // A box from before `retry` answers 404 for it, with a message the phone tells
  // apart from a missing record's 404 (`QuickChatAPI.APIError.isUnknownProcedure`)
  // before it falls back to a repeated `submit`.
  //
  // The server logs each failed procedure; these two are failures by design, so
  // the log is captured and shown.

  const logged: string[] = [];
  const { error: logError } = console;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  let unknown: InjectResult = { statusCode: 0, body: null };
  let missing: InjectResult = { statusCode: 0, body: null };
  try {
    unknown = await server.request({ method: "POST", url: "/api/trpc/quickChat.noSuchProcedure", payload: await fixture("retry-request.json") });
    missing = await server.request({ method: "POST", url: "/api/trpc/quickChat.retry", payload: { id: "00000000-0000-4000-8000-000000000000", channel: "ios-native" } });
  } finally { console.error = logError; }
  t.check(({ unknown: [unknown.statusCode, errorMessage(unknown)], missing: [missing.statusCode, errorMessage(missing)], logged }), {
    unknown: [
      404,
      "No procedure found on path \"quickChat.noSuchProcedure\"",
    ],
    missing: [
      404,
      "This message is no longer stored.",
    ],
    logged: [
      "[trpc] unknown quickChat.noSuchProcedure failed: No procedure found on path \"quickChat.noSuchProcedure\"",
      "[trpc] mutation quickChat.retry failed: This message is no longer stored.",
    ],
  });
});
