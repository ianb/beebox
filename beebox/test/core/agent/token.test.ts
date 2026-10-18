// # Agent loopback token
//
// Tests for the per-box agent token (`.beebox/agent-token`) that lets
// box agents' `bbx chat ...` loopback calls through the per-box auth wall in
// production. See `src/core/agent/token.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { getOrCreateAgentToken, verifyAgentBearer, resolveAgentToken } from "../../../src/core/agent/token.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { makeTestServer } from "../../helpers/doctest-server.js";

/** The `error` field of a JSON error body. */
function errorOf(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

// ## Token generation is idempotent and stays put
void test("Token generation is idempotent and stays put", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L21
  const box = await makeTmpBox();
  const first = getOrCreateAgentToken(box.root);
  const second = getOrCreateAgentToken(box.root);
  const onDisk = (await box.read(".beebox/agent-token")).trim();
  print(`length: ${first.length}`);
  print(`stable: ${first === second}`);
  await t.checkText(out.with(print(`persisted: ${first === onDisk}`)), `length: 64
stable: true
persisted: true`);

  // Verification accepts exactly `Bearer <token>` and nothing else:

  // doctest:L37
  print(`good: ${verifyAgentBearer(box.root, `Bearer ${first}`)}`);
  print(`wrong token: ${verifyAgentBearer(box.root, `Bearer ${"x".repeat(64)}`)}`);
  print(`no scheme: ${verifyAgentBearer(box.root, first)}`);
  await t.checkText(out.with(print(`missing header: ${verifyAgentBearer(box.root, undefined)}`)), `good: true
wrong token: false
no scheme: false
missing header: false`);
});

// ## Verification never creates the token file
//
// Only spawners (buildScriptEnv) provision the token; a verify against a box
// with no token must fail rather than mint one an attacker could race.
void test("Only spawners (buildScriptEnv) provision the token; a verify against a box wi...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L58
  const box = await makeTmpBox();
  print(`verify: ${verifyAgentBearer(box.root, "Bearer " + "x".repeat(64))}`);
  const files = await box.list(".beebox").catch(() => "");
  await t.checkText(out.with(print(`token file created: ${files.includes(".beebox/agent-token")}`)), `verify: false
token file created: false`);
});

// ## resolveAgentToken prefers the env var
void test("resolveAgentToken prefers the env var", async (t) => {
  // doctest:L74
  process.env.BBX_AGENT_TOKEN = "t".repeat(64);
  const resolved = resolveAgentToken();
  delete process.env.BBX_AGENT_TOKEN;
  await t.checkText(resolved === "t".repeat(64), "true");
});

// ## resolveAgentToken has no cwd fallback
//
// Without the env var it returns null — it never guesses a token file from
// `process.cwd()`, which is a box *subdirectory* in landmark sessions.
void test("Without the env var it returns null — it never guesses a token file from proc...", async (t) => {
  // doctest:L87
  delete process.env.BBX_AGENT_TOKEN;
  t.check(resolveAgentToken(), null);
});

// ## Auth wall: agent bearer passes where anonymous requests 401
//
// With auth enabled, an unauthenticated loopback POST is rejected; the same
// request with the box's agent bearer gets through the wall (and then fails
// route validation — proof it reached the handler).
void test("With auth enabled, an unauthenticated loopback POST is rejected; the same req...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L99
  // Auth is always-on by default; the test-server helper opens the wall
  // (openAccess: true) so most route tests run open. Construct with
  // openAccess: false here to exercise the wall.
  const ctx = await makeTestServer({ openAccess: false });
  const anon = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: {} });
  print(`anonymous: ${anon.statusCode} ${errorOf(anon.body)}`);
  const token = getOrCreateAgentToken(ctx.boxRoot);
  const authed = await ctx.request({
    method: "POST",
    url: "/api/chat/self-note",
    payload: {},
    headers: { authorization: `Bearer ${token}` },
  });
  print(`with bearer: ${authed.statusCode} ${errorOf(authed.body)}`);
  // messageId is required since the targeted-fetch change
  // (docs/implemented-plans/retranscription-in-chat.md, Track 1b) — this test only
  // exercises the bearer wall, so any id works; no tab answers → 504.
  const audio = await ctx.request({
    method: "POST",
    url: "/api/chat/last-audio/request",
    payload: { timeoutMs: 1, messageId: "msg-agent-token-test" },
    headers: { authorization: `Bearer ${token}` },
  });
  await t.checkText(out.with(print(`last-audio with bearer: ${audio.statusCode} ${errorOf(audio.body)}`)), `anonymous: 401 Not authenticated
with bearer: 400 body is required
last-audio with bearer: 504 no-client`);
});
