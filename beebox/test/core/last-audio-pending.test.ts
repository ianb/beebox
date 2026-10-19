// # Last-audio loopback
//
// Tests for `bbx chat get-last-audio`'s server side: the pending-request
// registry (`createLastAudioPending`) and the two HTTP routes that connect a
// CLI long-poll to the browser tab holding the recording.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { createLastAudioPending, type LastAudioFulfillment, type LastAudioOutcome } from "../../src/core/last-audio-pending.js";
import { eventSchemas } from "../../src/core/event-bus/schemas.js";
import { AUDIO_QUESTION_MODEL, buildAudioQuestionPrompt } from "../../src/core/audio-question.js";
import { audioMimeType, missingMessageIdError } from "../../src/cli/commands/chat/audio.js";
import { makeTestServer } from "../helpers/test-route-server.js";
import { createStagingSession, addAudioChunk } from "../../src/core/capture/staging-store/core.js";
import { sealVoiceSession } from "../../src/core/voice-recording/voice-staging/core.js";

// A sealed web voice recording with two PCM chunks ("AAAA" then "BBBB",
// ASCII so the injected response's string payload stays comparable).
async function stageSealedRecording(boxRoot: string, { emissionId, sessionId }: { emissionId: string; sessionId: string }) {
  const session = await createStagingSession({ boxRoot, targetSessionId: sessionId, createdBy: null, kind: "voice" });
  const chunks: Array<[filename: string, text: string]> = [["pcm-000001.raw", "AAAA"], ["pcm-000002.raw", "BBBB"]];
  for (const [filename, text] of chunks) {
    await addAudioChunk({
      boxRoot, id: session.id, segmentId: session.id, segmentStartedAt: "2026-09-10T18:00:00.000Z",
      filename, buffer: Buffer.from(text), audioFormat: "pcm-s16le-16k",
    });
  }
  await sealVoiceSession({
    boxRoot, id: session.id, emissionId,
    hq: { emissionId, sessionId, service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
  });
  return session;
}

/** The fulfillment of an outcome that must be audio. */
function fulfilled(outcome: LastAudioOutcome): LastAudioFulfillment {
  if (outcome.status !== "audio") throw new Error(`expected an audio outcome, got ${outcome.status}`);
  return outcome.fulfillment;
}

/** The id a `chat-last-audio-request` bus event carries. */
function requestIdOf(data: unknown): string {
  return eventSchemas["chat-last-audio-request"].parse(data).requestId;
}

// ## Registry: an audio answer resolves the request
//
// `create` targets an exact `messageId`; a fulfillment must echo the same id
// back to be delivered.
void test("create targets an exact messageId; a fulfillment must echo the same id back t...", async (t) => {
  // doctest:L58
  const reg = createLastAudioPending();
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-abc" });
  const delivered = reg.fulfill(requestId, {
    audio: Buffer.from("RIFFfake"),
    contentType: "audio/wav",
    recordedAt: "2026-06-11T12:00:00Z",
    text: "hello there",
    messageId: "msg-abc",
    sessionId: "sess-1",
  });
  const result = await outcome;
  t.check(
    { delivered, status: result.status, audio: fulfilled(result).audio.toString(), recordedAt: fulfilled(result).recordedAt, pending: reg.size() },
    { delivered: "delivered", status: "audio", audio: "RIFFfake", recordedAt: "2026-06-11T12:00:00Z", pending: 0 },
  );
});

// ## Registry: no answer at all times out
void test("Registry: no answer at all times out", async (t) => {
  // doctest:L84
  const reg = createLastAudioPending();
  const { outcome } = reg.create({ timeoutMs: 20, messageId: "msg-x" });
  const result = await outcome;
  t.check(result, { status: "timeout" });
});

// ## Registry: a "none" answer resolves after the wait window
//
// A tab reporting "no audio cached" doesn't settle immediately — another tab
// might still hold the recording — but once the wait window passes with no
// audio, the request resolves `none`. `{none:true}` answers aren't targeted
// (a tab can only say "I don't have it"), so this is unaffected by echo-and-verify.
void test("A tab reporting \"no audio cached\" doesn't settle immediately — another tab mi...", async (t) => {
  // doctest:L99
  const reg = createLastAudioPending({ graceMs: 20 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-y" });
  const reported = reg.reportNone(requestId);
  const result = await outcome;
  t.check({ reported, status: result.status }, { reported: true, status: "none" });
});

// ## Registry: audio arriving within the wait window still wins
void test("Registry: audio arriving within the wait window still wins", async (t) => {
  // doctest:L112
  const reg = createLastAudioPending({ graceMs: 1000 });
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-z" });
  reg.reportNone(requestId);
  reg.fulfill(requestId, { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-z", sessionId: null });
  const result = await outcome;
  t.check({ status: result.status, audio: fulfilled(result).audio.toString() }, { status: "audio", audio: "x" });
});

// ## Registry: production default — a "none" wait is the request's OWN timeoutMs, not a fixed short window
//
// Fix (2026-08): a targeted request fans out to every connected tab, and most
// of them don't hold this exact recording — they answer `none` almost
// instantly. Without a per-request wait, that instant chorus of "none"s used
// to cut the requested wait down to a fixed short wait window (2s), so a
// background-throttled tab that DOES hold the recording could lose even though
// plenty of the caller's requested timeout remained. With no factory-level
// `graceMs` override (the production shape), a "none" arriving well within the
// window still leaves room for a slower correct answer to win.
void test("Fix (2026-08):", async (t) => {
  // doctest:L133
  const reg = createLastAudioPending();
  const { requestId, outcome } = reg.create({ timeoutMs: 300, messageId: "msg-slow" });
  reg.reportNone(requestId); // an early "none" from a tab that doesn't hold it
  await new Promise((r) => setTimeout(r, 150)); // 150ms in: past the old fixed wait, still inside this request's own 300ms window
  reg.fulfill(requestId, { audio: Buffer.from("late-but-in-window"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-slow", sessionId: null });
  const result = await outcome;
  t.check(result.status === "audio" ? { status: result.status, audio: result.fulfillment.audio.toString() } : result, { status: "audio", audio: "late-but-in-window" });
});

// ## Registry: production default — all tabs answering `none` still resolves `none` at the full window's end
void test("Registry: production default — all tabs answering `none` still resolves `none` at the full window's end", async (t) => {
  // doctest:L149
  const reg = createLastAudioPending();
  const { requestId, outcome } = reg.create({ timeoutMs: 60, messageId: "msg-nobody-has-it" });
  reg.reportNone(requestId);
  const result = await outcome;
  t.check(result, { status: "none" });
});

// ## Registry: a mismatched or missing echoed messageId is ignored, not delivered
//
// Echo-and-verify (Track 1b, load-bearing): a fulfillment whose `messageId`
// doesn't match the request's target — including a stale-tab answer that omits
// `messageId` entirely — is ignored outright. The request stays pending; a
// later, correctly-targeted answer still wins it.
void test("Echo-and-verify (Track 1b, load-bearing):", async (t) => {
  // doctest:L165
  const reg = createLastAudioPending();
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-target" });
  const mismatched = reg.fulfill(requestId, { audio: Buffer.from("wrong"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-other", sessionId: null });
  const stale = reg.fulfill(requestId, { audio: Buffer.from("stale"), contentType: "audio/wav", recordedAt: null, text: null, messageId: null, sessionId: null });
  const stillPending = reg.size();
  const correct = reg.fulfill(requestId, { audio: Buffer.from("right"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-target", sessionId: null });
  const result = await outcome;
  t.check(
    { mismatched, stale, stillPending, correct, status: result.status, audio: fulfilled(result).audio.toString() },
    { mismatched: "ignored", stale: "ignored", stillPending: 1, correct: "delivered", status: "audio", audio: "right" },
  );
});

// ## Registry: unknown and already-settled ids are refused
void test("Registry: unknown and already-settled ids are refused", async (t) => {
  // doctest:L186
  const reg = createLastAudioPending();
  const unknownFulfill = reg.fulfill("nope", { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null, messageId: null, sessionId: null });
  const unknownNone = reg.reportNone("nope");
  const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-a" });
  const first = reg.fulfill(requestId, { audio: Buffer.from("a"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-a", sessionId: null });
  const second = reg.fulfill(requestId, { audio: Buffer.from("b"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-a", sessionId: null });
  const result = await outcome;
  t.check(
    { unknownFulfill, unknownNone, first, second, winner: fulfilled(result).audio.toString() },
    { unknownFulfill: "unknown", unknownNone: false, first: "delivered", second: "unknown", winner: "a" },
  );
});

// ## Route: answering an unknown request returns 404
//
// This is also the normal multi-tab outcome — a second tab answering after
// the first tab's audio already settled the request.
void test("This is also the normal multi-tab outcome — a second tab answering after the...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L208
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/nope",
    payload: { none: true },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 404, body: { error: "unknown-request" } });
});

// ## Route: a JSON answer that isn't {none:true} is rejected
void test("Route: a JSON answer that isn't {none:true} is rejected", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L228
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/whatever",
    payload: { hello: 1 },
  });
  t.check({ status: res.statusCode, body: res.body }, {
    status: 400,
    body: { error: "bad-answer", message: 'Expected multipart audio or {"none": true}' },
  });
});

// ## Route: a request nobody answers returns 504
//
// `timeoutMs` is clamped to a 100ms minimum, so this resolves quickly.
void test("timeoutMs is clamped to a 100ms minimum, so this resolves quickly.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L247
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 1, messageId: "msg-nobody" },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 504, body: { error: "no-client", message: "No chat tab answered — the chat may not be open in a browser right now. This is a transient condition, not a missing capability: the same request can succeed later once a tab is connected." } });
});

// ## Route: a staged web recording is answered from disk, without the tab relay
//
// A web voice send's recording is staged on the box, and its finalize names
// the message's emission id. The server serves those chunks as one WAV and
// never broadcasts a relay request:
void test("A web voice send's recording is staged on the box, and its finalize names the...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L271
  const ctx = await makeTestServer();
  await stageSealedRecording(ctx.boxRoot, { emissionId: "em-staged-1", sessionId: "sess-7" });
  let relayed = false;
  ctx.eventBus.subscribe({ listener: (e) => { if (e.event === "chat-last-audio-request") relayed = true; } });
  const res = await ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 100, messageId: "em-staged-1" },
  });
  t.check(
    {
      status: res.statusCode,
      contentType: res.headers["content-type"],
      payload: res.payload,
      messageId: decodeURIComponent(res.headers["x-message-id"] ?? ""),
      sessionId: decodeURIComponent(res.headers["x-session-id"] ?? ""),
      relayed,
    },
    {
      status: 200,
      contentType: "audio/wav",
      // A WAV: RIFF header bytes, then the two PCM chunks in order.
      payload: any(String).startsWith("RIFF").endsWith("AAAABBBB"),
      messageId: "em-staged-1",
      sessionId: "sess-7",
      relayed: false,
    },
  );

  // A message id no staging session names falls through to the tab relay (here
  // nobody answers, so the short wait ends in the relay's 504):

  // doctest:L301
  const gotRelay = new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-last-audio-request") resolve(e.data.messageId);
    }});
  });
  const miss = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 1, messageId: "em-unknown" },
  });
  t.check([await gotRelay, miss.statusCode, miss.body], ["em-unknown", 504, { error: "no-client", message: "No chat tab answered — the chat may not be open in a browser right now. This is a transient condition, not a missing capability: the same request can succeed later once a tab is connected." }]);
});

// ## Route: a non-HQ send is found by its finalize `emissionId` too
//
// A voice send with HQ dictation off still names the message it sealed for —
// `voice.emissionId`, written by finalize independent of `hq` — so
// `get-last-audio` finds it without an `hqRequest`:
void test("A voice send with HQ dictation off still names the message it sealed for — vo...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L329
  const ctx = await makeTestServer();
  const session = await createStagingSession({ boxRoot: ctx.boxRoot, targetSessionId: "sess-9", createdBy: null, kind: "voice" });
  await addAudioChunk({
    boxRoot: ctx.boxRoot, id: session.id, segmentId: session.id, segmentStartedAt: "2026-09-10T18:00:00.000Z",
    filename: "pcm-000001.raw", buffer: Buffer.from("CCCC"), audioFormat: "pcm-s16le-16k",
  });
  await sealVoiceSession({ boxRoot: ctx.boxRoot, id: session.id, emissionId: "em-no-hq-1", hq: null });
  const res = await ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 100, messageId: "em-no-hq-1" },
  });
  t.check(
    { status: res.statusCode, payload: res.payload },
    { status: 200, payload: any(String).startsWith("RIFF").endsWith("CCCC") },
  );
});

// ## Route: a request without messageId is rejected before any wait
//
// Track 1b removed the untargeted "latest" mode entirely — every request must
// name the exact message it wants.
void test("Track 1b removed the untargeted \"latest\" mode entirely — every request must n...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L360
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 1 },
  });
  t.check({ status: res.statusCode, body: res.body }, {
    status: 400,
    body: { error: "bad-request", message: "messageId is required — Invalid input: expected string, received undefined" },
  });
});

// ## Route: full loop — long-poll answered by a multipart upload
//
// The "browser" learns the server-minted request id from the transient
// `chat-last-audio-request` bus event (the same instance the route emits on —
// no id is caller-supplied). The long-poll is started, the "browser" answers with
// audio + metadata fields, and the long-poll response carries the bytes and the
// metadata headers.
void test("The \"browser\" learns the server-minted request id from the transient chat-las...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L383
  const ctx = await makeTestServer();
  const gotId = new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-last-audio-request") resolve(requestIdOf(e.data));
    }});
  });
  const longPoll = ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 5000, messageId: "msg-plants-1" },
  });
  // The id is emitted synchronously as the request parks.
  const requestId = await gotId;
  const boundary = "----cbtestboundary";
  const upload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="recordedAt"',
    "",
    "2026-06-11T12:00:00Z",
    `--${boundary}`,
    'Content-Disposition: form-data; name="text"',
    "",
    "remember to water the plants",
    `--${boundary}`,
    'Content-Disposition: form-data; name="messageId"',
    "",
    "msg-plants-1",
    `--${boundary}`,
    'Content-Disposition: form-data; name="sessionId"',
    "",
    "sess-42",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
    "Content-Type: audio/wav",
    "",
    "RIFFfakewavbytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const answer = await ctx.request({
    method: "POST",
    url: `/api/chat/last-audio/${requestId}`,
    payload: upload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  const res = await longPoll;
  t.check(
    {
      answer: answer.body,
      status: res.statusCode,
      contentType: res.headers["content-type"],
      recordedAt: res.headers["x-recorded-at"],
      text: decodeURIComponent(res.headers["x-message-text"] ?? ""),
      messageId: decodeURIComponent(res.headers["x-message-id"] ?? ""),
      sessionId: decodeURIComponent(res.headers["x-session-id"] ?? ""),
      audio: res.payload,
    },
    {
      answer: { ok: true },
      status: 200,
      contentType: "audio/wav",
      recordedAt: "2026-06-11T12:00:00Z",
      text: "remember to water the plants",
      messageId: "msg-plants-1",
      sessionId: "sess-42",
      audio: "RIFFfakewavbytes",
    },
  );
});

// ## Route: a stale-tab answer with no echoed messageId is ignored, then a correct answer wins
//
// Echo-and-verify (Track 1b, load-bearing): a stale pre-1b tab still answers
// with whatever it last retained and no `messageId` field at all. That answer
// must not win a targeted request — it's ignored (200, `ok:false`), the
// long-poll keeps waiting, and a subsequent correctly-targeted answer delivers.
void test("Echo-and-verify (Track 1b, load-bearing): (line 459)", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L460
  const ctx = await makeTestServer();
  const gotId = new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-last-audio-request") resolve(requestIdOf(e.data));
    }});
  });
  const longPoll = ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 5000, messageId: "msg-real" },
  });
  const requestId = await gotId;
  function multipartUpload(boundary: string, fields: Record<string, string>): string {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(fields)) {
      if (name === "file") continue;
      parts.push(`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, "", value);
    }
    parts.push(
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
      "Content-Type: audio/wav",
      "",
      fields.file ?? "",
      `--${boundary}--`,
      ""
    );
    return parts.join("\r\n");
  }
  const staleBoundary = "----cbteststale";
  const staleAnswer = await ctx.request({
    method: "POST",
    url: `/api/chat/last-audio/${requestId}`,
    payload: multipartUpload(staleBoundary, {
      recordedAt: "2026-06-11T12:00:00Z",
      text: "no identity here",
      file: "STALEWAVBYTES",
    }),
    headers: { "content-type": `multipart/form-data; boundary=${staleBoundary}` },
  });
  const rightBoundary = "----cbtestright";
  const rightAnswer = await ctx.request({
    method: "POST",
    url: `/api/chat/last-audio/${requestId}`,
    payload: multipartUpload(rightBoundary, {
      recordedAt: "2026-06-11T12:05:00Z",
      text: "the real message",
      messageId: "msg-real",
      sessionId: "sess-real",
      file: "REALWAVBYTES",
    }),
    headers: { "content-type": `multipart/form-data; boundary=${rightBoundary}` },
  });
  const res = await longPoll;
  t.check(
    {
      staleAnswer: staleAnswer.body,
      rightAnswer: rightAnswer.body,
      status: res.statusCode,
      messageId: decodeURIComponent(res.headers["x-message-id"] ?? ""),
      audio: res.payload,
    },
    {
      staleAnswer: { ok: false, ignored: true, message: "messageId did not match the pending request's target" },
      rightAnswer: { ok: true },
      status: 200,
      messageId: "msg-real",
      audio: "REALWAVBYTES",
    },
  );
});

// ## Route: an answer with a mismatched messageId is ignored, not delivered
//
// The wrong tab answers first; the request stays open, and the right tab's
// answer is the one delivered. (This used to end on the poll's 100ms timeout
// instead, which on a loaded host expired before the mismatched answer arrived:
// 2026-10-07, `unknown-request`.)
void test("The wrong tab answers first; the request stays open, and the right tab's answ...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L539
  const ctx = await makeTestServer();
  const gotId = new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-last-audio-request") resolve(requestIdOf(e.data));
    }});
  });
  const longPoll = ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 30_000, messageId: "msg-wanted" },
  });
  const requestId = await gotId;
  const boundary = "----cbtestmismatch";
  const uploadFor = (messageId: string, bytes: string) => [
    `--${boundary}`,
    'Content-Disposition: form-data; name="messageId"',
    "",
    messageId,
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
    "Content-Type: audio/wav",
    "",
    bytes,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const answerWith = (messageId: string, bytes: string) => ctx.request({
    method: "POST",
    url: `/api/chat/last-audio/${requestId}`,
    payload: uploadFor(messageId, bytes),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  const wrong = await answerWith("msg-someone-elses", "WRONGWAVBYTES");
  const right = await answerWith("msg-wanted", "RIGHTWAVBYTES");
  const res = await longPoll;
  t.check(
    { wrong: wrong.body, right: right.body, status: res.statusCode, audio: res.payload },
    {
      wrong: { ok: false, ignored: true, message: "messageId did not match the pending request's target" },
      right: { ok: true },
      status: 200,
      audio: "RIGHTWAVBYTES",
    },
  );
});

// ## Route: a targeted request where the tab answers none resolves not-available
//
// A tab that doesn't hold the requested recording answers `{none:true}` — the
// request resolves the same "not available" outcome as no tab answering at all,
// never wrong audio.
void test("A tab that doesn't hold the requested recording answers {none:true} — the req...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L596
  const ctx = await makeTestServer();
  const gotId = new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-last-audio-request") resolve(requestIdOf(e.data));
    }});
  });
  const longPoll = ctx.rawRequest({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 5000, messageId: "msg-not-held" },
  });
  const requestId = await gotId;
  const answer = await ctx.request({
    method: "POST",
    url: `/api/chat/last-audio/${requestId}`,
    payload: { none: true },
  });
  const res = await longPoll;
  t.check(
    { answer: answer.body, status: res.statusCode, body: JSON.parse(res.payload) },
    { answer: { ok: true }, status: 404, body: { error: "no-audio", message: "No recording is cached for this message — it was typed, or its audio predates the chat tab's current load. This is about this one message, not the box: other messages in this conversation may still have audio, so try again on a later one rather than giving up." } },
  );
});

// ## CLI: the required `--message` error is agent-legible
//
// `retranscribe`/`ask-about-audio`/`get-last-audio` all require `--message <id>`
// (unless `--file` supplies the audio directly for the first two) — validated
// before any HTTP request. The Commander actions call `process.exit`, which
// would kill the test process, so this pins the extracted, unit-testable error
// text instead of invoking the command.
void test("retranscribe/ask-about-audio/get-last-audio all require --message <id> (unles...", async (t) => {
  // doctest:L636
  await t.checkText(missingMessageIdError("bbx chat get-last-audio"), "bbx chat get-last-audio: requires --message <id> — read message-id=\"…\" off the <speech> wrapper of the message you mean");
  await t.checkText(missingMessageIdError("bbx chat retranscribe"), "bbx chat retranscribe: requires --message <id> — read message-id=\"…\" off the <speech> wrapper of the message you mean");
});

// ## ask-about-audio helpers
//
// Audio questions use the model selected by the bakeoff for full-audio
// understanding:
void test("Audio questions use the model selected by the bakeoff for full-audio understa...", async (t) => {
  // doctest:L649
  t.check(AUDIO_QUESTION_MODEL, "gemini-3.7-flash");
});

// `audioMimeType` maps `--file` extensions to MIME types; unknown extensions
// are rejected rather than guessed:
void test("audioMimeType maps --file extensions to MIME types; unknown extensions are re...", async (t) => {
  // doctest:L657
  t.check(
    [audioMimeType("/tmp/x/clip.WAV"), audioMimeType("voice.m4a"), audioMimeType("song.mp3"), audioMimeType("notes.txt")],
    ["audio/wav", "audio/mp4", "audio/mpeg", null],
  );
});

// The model prompt wraps the caller's question with framing that keeps the
// answer addressed to the asker, not the recording's speaker. Context and a
// known transcript are optional labeled sections:
void test("The model prompt wraps the caller's question with framing that keeps the answ...", async (t) => {
  // doctest:L673
  const bare = buildAudioQuestionPrompt({ question: "What language is spoken?" });
  await t.checkText(bare, `Listen to the attached audio recording (a voice message from the user of a personal-assistant system) and answer the question below about it.
Answer the question directly and concretely, addressing the person who asked — do not address the speaker in the recording. Quote or transcribe the relevant moments of the audio when that supports the answer.
«blankline»
Question: What language is spoken?`);

  // doctest:L684
  const full = buildAudioQuestionPrompt({
    question: "Did the transcript get the Spanish right?",
    context: "The user is practicing Spanish for a trip.",
    transcript: "No. No.",
  });
  await t.checkText(full, `Listen to the attached audio recording (a voice message from the user of a personal-assistant system) and answer the question below about it.
Answer the question directly and concretely, addressing the person who asked — do not address the speaker in the recording. Quote or transcribe the relevant moments of the audio when that supports the answer.
«blankline»
Context from the conversation, provided by the assistant asking the question:
The user is practicing Spanish for a trip.
«blankline»
For reference, the system's automated transcription of this recording. It may contain errors — trust the audio over the transcript, and point out meaningful discrepancies when they bear on the question:
No. No.
«blankline»
Question: Did the transcript get the Spanish right?`);
});
