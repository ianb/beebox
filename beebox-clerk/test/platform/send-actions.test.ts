import { test } from "tap";
import type { SendPayload, SendResult } from "../../src/contract/clerk-contract.generated.js";
import type { CommentaryCapture } from "../../src/domain/commentary.js";
import type { EnabledBox } from "../../src/domain/config.js";
import type { SendView } from "../../src/domain/send.js";
import { ClerkApiError, SendUnsupportedError } from "../../src/platform/clerk-api.js";
import { classifySendError, createSendActions, type SendDeps } from "../../src/platform/send-actions.js";

const boxA: EnabledBox = { boxUrl: "http://localhost:3210/main/a", slug: "a", title: "A" };
const boxB: EnabledBox = { boxUrl: "http://localhost:3210/main/b", slug: "b", title: "B" };
const capture = (title: string): CommentaryCapture => ({
  page: { title, siteName: null, byline: null, excerpt: null, markdown: title, url: `https://example.com/${title}` },
  frozenHtml: null,
});
const sent: SendResult = { card: "_content/incoming/x.webpage.card", state: "sent", destination: { label: "Cooking" } };

interface Harness {
  deps: SendDeps;
  posts: Array<{ box: string; payload: SendPayload }>;
  toasts: string[];
  captures: number[];
  setActive: (box: EnabledBox) => void;
  setCapture: (title: string | null) => void;
  postOutcomes: Array<SendResult | Error>;
}

function harness(): Harness {
  let active = boxA;
  let nextCapture: string | null = "first";
  let idCount = 0;
  const h: Harness = {
    posts: [],
    toasts: [],
    captures: [],
    postOutcomes: [],
    setActive: (box) => {
      active = box;
    },
    setCapture: (title) => {
      nextCapture = title;
    },
    deps: {
      requireActiveBox: async () => active,
      capture: async (tabId) => {
        h.captures.push(tabId);
        return nextCapture === null ? null : capture(nextCapture);
      },
      post: async (box, payload) => {
        h.posts.push({ box: box.boxUrl, payload });
        const outcome = h.postOutcomes.shift() ?? sent;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      choose: async (box, choice): Promise<SendView> => {
        h.posts.push({ box: box.boxUrl, payload: { id: choice.id, note: choice.candidateId, url: "", title: "", readableMarkdown: "" } });
        return { state: "sent", destination: { label: "Money" } };
      },
      toast: (_tabId, toast) => {
        h.toasts.push(toast.text);
      },
      newId: () => `id-${++idCount}`,
    },
  };
  return h;
}

/** Silences the expected failure logs for one test. */
function quietErrors(t: { teardown: (fn: () => void) => void }): void {
  const original = console.error;
  console.error = () => {};
  t.teardown(() => {
    console.error = original;
  });
}

function quietInfo(t: { teardown: (fn: () => void) => void }): void {
  const original = console.info;
  console.info = () => {};
  t.teardown(() => {
    console.info = original;
  });
}

test("sendToBox captures, posts, toasts, and answers with the id and box", async (t) => {
  quietInfo(t);
  const h = harness();
  const result = await createSendActions(h.deps).sendToBox({ tabId: 5, note: " look " });
  t.same(result, { kind: "send", id: "id-1", boxUrl: boxA.boxUrl, outcome: { status: "answered", view: { state: "sent", destination: { label: "Cooking" } } } });
  t.equal(h.posts[0]?.payload.id, "id-1");
  t.equal(h.posts[0]?.payload.note, "look");
  t.same(h.toasts, ["Sent to Cooking"]);
});

test("Try again reposts the kept payload to the kept box without recapturing", async (t) => {
  quietErrors(t);
  quietInfo(t);
  const h = harness();
  const actions = createSendActions(h.deps);
  h.postOutcomes.push(new ClerkApiError(0, { endpoint: "clerk.send", detail: "Failed to fetch" }));
  const first = await actions.sendToBox({ tabId: 5, note: "n" });
  t.equal(first.outcome.status, "unconfirmed");
  t.same(h.toasts, ["Couldn't confirm the send."]);

  h.setActive(boxB);
  h.setCapture("changed page");
  const retry = await actions.retrySend(first.id);
  t.equal(retry.outcome.status, "answered");
  t.equal(retry.boxUrl, boxA.boxUrl);
  t.same(h.captures, [5], "no second capture");
  t.equal(h.posts.length, 2);
  t.same(h.posts[1], h.posts[0], "same box, same payload");
});

test("Try again after the worker forgot the send answers forgotten", async (t) => {
  const h = harness();
  const result = await createSendActions(h.deps).retrySend("gone");
  t.same(result.outcome, { status: "forgotten" });
  t.equal(h.posts.length, 0);
});

test("a page that can't be captured is rejected before any post", async (t) => {
  const h = harness();
  h.setCapture(null);
  const result = await createSendActions(h.deps).sendToBox({ tabId: 5, note: "" });
  t.equal(result.outcome.status, "rejected");
  t.equal(h.posts.length, 0);
  t.equal(h.toasts.length, 1);
});

test("chooseSend goes to the box the send went to", async (t) => {
  quietInfo(t);
  const h = harness();
  const actions = createSendActions(h.deps);
  const first = await actions.sendToBox({ tabId: 5, note: "" });
  h.setActive(boxB);
  const chosen = await actions.chooseSend({ id: first.id, candidateId: "c2" });
  t.equal(chosen.boxUrl, boxA.boxUrl);
  t.equal(h.posts[1]?.box, boxA.boxUrl);
  t.same(chosen.outcome, { status: "answered", view: { state: "sent", destination: { label: "Money" } } });
});

test("classifySendError separates too old, auth, no answer, and refusals", async (t) => {
  t.same(classifySendError(new SendUnsupportedError("404")), { status: "unsupported" });
  t.equal(classifySendError(new ClerkApiError(401, { endpoint: "e", detail: "d" })).status, "auth");
  t.equal(classifySendError(new ClerkApiError(0, { endpoint: "e", detail: "d" })).status, "unconfirmed");
  t.equal(classifySendError(new ClerkApiError(503, { endpoint: "e", detail: "d" })).status, "unconfirmed");
  t.equal(classifySendError(new ClerkApiError(409, { endpoint: "e", detail: "d" })).status, "rejected");
  // A 200 whose body could not be read may have saved the send: Try again, never a new send.
  t.equal(classifySendError(new ClerkApiError(200, { endpoint: "e", detail: "malformed JSON" })).status, "unconfirmed");
});

test("chooseSend for a send the worker forgot never posts to another box", async (t) => {
  const h = harness();
  h.setActive(boxB);
  const chosen = await createSendActions(h.deps).chooseSend({ id: "gone", candidateId: "c2" });
  t.same(chosen.outcome, { status: "forgotten" });
  t.equal(h.posts.length, 0);
});
