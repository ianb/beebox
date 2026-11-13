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

async function failure(response: Response): Promise<{ refused: boolean; message: string }> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => response.clone();
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
