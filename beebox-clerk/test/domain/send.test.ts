import { test } from "tap";
import {
  buildSendPayload,
  sendChatUrl,
  sendConfirmed,
  sendToastText,
  sendViewText,
  UNCONFIRMED_TEXT,
  UNSUPPORTED_TEXT,
} from "../../src/domain/send.js";

const SEND_ID = "40000000-0000-4000-8000-000000000000";
const page = {
  title: "Trail",
  siteName: "Example",
  byline: null,
  excerpt: "",
  markdown: "# Trail",
  url: "https://example.com/trail",
};

test("buildSendPayload carries the id, the trimmed note, and the page", async (t) => {
  t.same(buildSendPayload({ capture: { page, frozenHtml: "<html></html>" }, id: SEND_ID, note: "  ask Odette \n" }), {
    id: SEND_ID,
    note: "ask Odette",
    url: "https://example.com/trail",
    title: "Trail",
    readableMarkdown: "# Trail",
    siteName: "Example",
    frozenHtml: "<html></html>",
  });
});

test("buildSendPayload uses the commentary fallbacks for an empty page", async (t) => {
  const payload = buildSendPayload({ capture: { page: { ...page, title: "", markdown: "" }, frozenHtml: null }, id: SEND_ID, note: "" });
  t.equal(payload.title, "https://example.com/trail");
  t.equal(payload.readableMarkdown, "[https://example.com/trail](https://example.com/trail)");
  t.equal(payload.note, "");
  t.notOk("frozenHtml" in payload);
});

test("sendViewText names each state", async (t) => {
  t.equal(sendViewText({ state: "sent", destination: { label: "Cooking", sessionId: "s1" } }), "Sent to Cooking");
  t.equal(sendViewText({ state: "sent", queued: true, destination: { label: "Cooking" } }), "Queued in Cooking");
  t.equal(sendViewText({ state: "needs-choice", reason: "uncertain" }), "Not sure where this goes");
  t.equal(sendViewText({ state: "needs-choice", reason: "routing-unavailable" }), "Could not sort this");
  t.equal(sendViewText({ state: "needs-choice", reason: "destination-gone" }), "That chat is gone");
  t.equal(
    sendViewText({ state: "sending", destination: { label: "Cooking" }, lastError: "chat busy" }),
    "Saved, not delivered yet: chat busy",
  );
});

test("sendToastText follows the outcome", async (t) => {
  t.same(sendToastText({ status: "answered", view: { state: "sent", destination: { label: "Cooking" } } }), {
    text: "Sent to Cooking",
    isError: false,
  });
  t.same(sendToastText({ status: "answered", view: { state: "needs-choice", reason: "uncertain" } }), {
    text: "Saved. Choose where it goes on the box screen.",
    isError: false,
  });
  t.same(sendToastText({ status: "answered", view: { state: "sending", lastError: "x" } }), {
    text: "Saved, not delivered yet.",
    isError: true,
  });
  t.same(sendToastText({ status: "unconfirmed", message: "network" }), { text: UNCONFIRMED_TEXT, isError: true });
  t.same(sendToastText({ status: "unsupported" }), { text: UNSUPPORTED_TEXT, isError: true });
});

test("sendConfirmed is true only when the box answered", async (t) => {
  t.ok(sendConfirmed({ status: "answered", view: { state: "needs-choice" } }));
  t.notOk(sendConfirmed({ status: "unconfirmed", message: "x" }));
  t.notOk(sendConfirmed({ status: "rejected", message: "x" }));
  t.notOk(sendConfirmed({ status: "forgotten" }));
});

test("sendChatUrl opens the named session, or nothing without one", async (t) => {
  t.equal(
    sendChatUrl("http://localhost:3210/main/test1/", { state: "sent", destination: { label: "C", sessionId: "a b" } }),
    "http://localhost:3210/main/test1/chat?session=a%20b",
  );
  t.equal(sendChatUrl("http://localhost:3210/main/test1", { state: "sent", destination: { label: "C" } }), null);
});
