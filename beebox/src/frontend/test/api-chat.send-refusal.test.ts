// # Which failed chat sends are refusals
//
// `startChatTurn` throws `ChatSendRejectedError` when the box recorded nothing:
// a 4xx from the send route, or a 503 from the admission gate or the hub while
// the box is closed or restarting. Other failures may have reached the box.
// A refusal keeps a fresh chat's reservation, so the retry can start the chat.

// First, and bare: the send path reads the window (API base, chat channel).
import "./helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ChatSendRejectedError, startChatTurn } from "../src/api-chat.js";

/** Each POST takes the next reply; an Error reply is a network failure. */
async function failure(...replies: Array<Response | Error>): Promise<{ refused: boolean; message: string }> {
  const realFetch = globalThis.fetch;
  let index = 0;
  globalThis.fetch = async () => {
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (reply === undefined || reply instanceof Error) throw new TypeError("Failed to fetch");
    return reply.clone();
  };
  try {
    await startChatTurn({ session: "00000000-0000-4000-8000-000000000001", message: "hi", messageId: "m-1" });
    return { refused: false, message: "sent" };
  } catch (error) {
    return { refused: error instanceof ChatSendRejectedError, message: error instanceof Error ? error.message : String(error) };
  } finally { globalThis.fetch = realFetch; }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

void test("a closed box's 503 is a refusal", async (t) => {
  // No Retry-After, so the client does not wait and retry first.
  t.check(await failure(json(503, { error: "Box is closed for deployment" })), { refused: true, message: "Box is closed for deployment" });
});

void test("a 4xx is a refusal and a 500 is not", async (t) => {
  t.check({
    gone: await failure(json(410, { error: "Conversation is not available on this machine" })),
    crashed: await failure(json(500, { error: "boom" })),
  }, {
    gone: { refused: true, message: "Conversation is not available on this machine" },
    crashed: { refused: false, message: "boom" },
  });
});

void test("the hub's 503 reads as its sentence, not its code", async (t) => {
  t.check(await failure(json(503, { error: "box_closed", message: "Box test1 is closed for deployment" })),
    { refused: true, message: "Box test1 is closed for deployment" });
});

void test("no answer after a lost response is a refusal", async (t) => {
  // The first POST may have been recorded before its response was lost.
  t.check({
    closed: await failure(new Error("lost"), json(503, { error: "Box is closed for deployment" })),
    gone: await failure(new Error("lost"), json(410, { error: "Conversation is not available on this machine" })),
  }, {
    closed: { refused: false, message: "Box is closed for deployment" },
    gone: { refused: false, message: "Conversation is not available on this machine" },
  });
});
