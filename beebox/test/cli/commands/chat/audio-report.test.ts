// # Audio-review report route
//
// Tests for `bbx chat retranscribe`/`bbx chat ask-about-audio`'s report-back
// (retranscription-in-chat plan, Track 2): `POST /api/chat/audio-review` and
// the pure report-building/skip logic the CLI call sites use before posting.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import {
  buildRetranscriptionReport,
  buildConsultedReport,
} from "../../../../src/cli/commands/chat/audio-report.js";

// ## Route: a valid retranscription body emits `chat-retranscription`
void test("Route: a valid retranscription body emits `chat-retranscription`", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const gotEvent = new Promise((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-retranscription") resolve(e.data);
    }});
  });
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/audio-review",
    payload: {
      kind: "retranscription",
      sessionId: "sess-1",
      messageId: "msg-1",
      newText: "remember to water the plants",
      service: "whisper",
      diarized: false,
      recordedAt: "2026-06-11T12:00:00Z",
    },
  });
  t.check(res, { statusCode: 200, body: { ok: true } });
  t.check(await gotEvent, {
    sessionId: "sess-1",
    messageId: "msg-1",
    newText: "remember to water the plants",
    service: "whisper",
    diarized: false,
    recordedAt: "2026-06-11T12:00:00Z",
  });
});

// ## Route: a valid consulted body emits `chat-audio-consulted`
void test("Route: a valid consulted body emits `chat-audio-consulted`", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const gotEvent = new Promise((resolve) => {
    ctx.eventBus.subscribe({ listener: (e) => {
      if (e.event === "chat-audio-consulted") resolve(e.data);
    }});
  });
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/audio-review",
    payload: {
      kind: "consulted",
      sessionId: "sess-2",
      messageId: "msg-2",
      command: "ask-about-audio",
      question: "did I say can or cannot?",
    },
  });
  t.check(res, { statusCode: 200, body: { ok: true } });
  t.check(await gotEvent, {
    sessionId: "sess-2",
    messageId: "msg-2",
    command: "ask-about-audio",
    question: "did I say can or cannot?",
  });
});

// ## Route: a missing sessionId is rejected with 400
void test("Route: a missing sessionId is rejected with 400", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/audio-review",
    payload: {
      kind: "retranscription",
      sessionId: "",
      messageId: "msg-1",
      newText: "hello",
      diarized: false,
    },
  });
  t.check(res, { statusCode: 400, body: { error: "bad-request", message: "Too small: expected string to have >=1 characters" } });
});

// ## Route: an unknown `kind` is rejected with 400
void test("Route: an unknown `kind` is rejected with 400", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/audio-review",
    payload: {
      kind: "something-else",
      sessionId: "sess-1",
      messageId: "msg-1",
    },
  });
  t.check(res, { statusCode: 400, body: { error: "bad-request", message: "Invalid discriminator value. Expected 'retranscription' | 'consulted'" } });
});

// ## `buildRetranscriptionReport`: full payload
void test("`buildRetranscriptionReport`: full payload", async (t) => {
  t.check(
    buildRetranscriptionReport({
      sessionId: "sess-1",
      messageId: "msg-1",
      newText: "the corrected text",
      service: "voxtral",
      diarized: true,
      recordedAt: "2026-06-11T12:00:00Z",
    }),
    {
    kind: "retranscription",
    sessionId: "sess-1",
    messageId: "msg-1",
    newText: "the corrected text",
    diarized: true,
    service: "voxtral",
    recordedAt: "2026-06-11T12:00:00Z",
  },
  );
});

// ## `buildRetranscriptionReport`: unknown service and no recordedAt omit those fields
void test("`buildRetranscriptionReport`: unknown service and no recordedAt omit those fields", async (t) => {
  t.check(
    buildRetranscriptionReport({
      sessionId: "sess-1",
      messageId: "msg-1",
      newText: "text",
      service: undefined,
      diarized: false,
      recordedAt: null,
    }),
    {
    kind: "retranscription",
    sessionId: "sess-1",
    messageId: "msg-1",
    newText: "text",
    diarized: false,
  },
  );
});

// ## `buildRetranscriptionReport`: null sessionId/messageId skip silently
//
// `--file` runs and old browser tabs that answered without echoing an id both
// land here — no report is attempted.
void test("--file runs and old browser tabs that answered without echoing an id both lan...", async (t) => {
  t.check(buildRetranscriptionReport({ sessionId: null, messageId: "msg-1", newText: "t", service: undefined, diarized: false, recordedAt: null }), null);
  t.check(buildRetranscriptionReport({ sessionId: "sess-1", messageId: null, newText: "t", service: undefined, diarized: false, recordedAt: null }), null);
});

// ## `buildConsultedReport`: present ids build the report; absent ones skip
void test("`buildConsultedReport`: present ids build the report; absent ones skip", async (t) => {
  t.check(buildConsultedReport({ sessionId: "sess-1", messageId: "msg-1", question: "was I whispering?" }), {
    kind: "consulted",
    sessionId: "sess-1",
    messageId: "msg-1",
    command: "ask-about-audio",
    question: "was I whispering?",
  });
  t.check(buildConsultedReport({ sessionId: null, messageId: "msg-1", question: "q" }), null);
  t.check(buildConsultedReport({ sessionId: "sess-1", messageId: null, question: "q" }), null);
});
