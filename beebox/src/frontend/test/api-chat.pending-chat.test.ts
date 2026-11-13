// # The first send of a new conversation carries the page's key for it
//
// A new conversation has no session id, so the page tags its activity entries
// with a key (`pendingChat`) and puts the same key on that conversation's first
// send; the box binds the key to the session once it has an id. A send into an
// existing session carries no key.

// First, and bare: the send path reads the window (API base, chat channel).
import "./helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { startChatTurn } from "../src/api-chat.js";

/** The JSON body of the POST that `startChatTurn` makes. */
async function sentBody(params: { session: string; pendingChat?: string }): Promise<Record<string, unknown>> {
  const realFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ queued: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await startChatTurn({ ...params, message: "hi", messageId: "m-1" });
  } catch (_error) { /* ignore: only the request body matters here */ }
  finally { globalThis.fetch = realFetch; }
  return body;
}

void test("the first send of a new conversation carries its pending key", async (t) => {
  const body = await sentBody({ session: "new", pendingChat: "conv-1" });
  t.check({ session: body.session, pendingChat: body.pendingChat }, { session: "new", pendingChat: "conv-1" });
});

void test("a send without a key carries none", async (t) => {
  const body = await sentBody({ session: "00000000-0000-4000-8000-000000000001" });
  t.check(body.pendingChat, undefined);
});
