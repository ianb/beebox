// # `POST /api/secrets/resolve` — the loopback resolver for box code
//
// The one interface that discloses a stored value to code running outside a server
// process: an agent-authored trick asks its OWN box, with the box's
// `BBX_AGENT_TOKEN`, and gets back a value it holds in memory for the length of one
// outbound call (`docs/secrets.md`, `docs/implemented-plans/secret-custody.md` Track 2).
//
// It is a raw route rather than a tRPC procedure because it must require the
// **agent auth source specifically** — the tRPC context folds cookie, hub header,
// mobile token, browse key and agent bearer into one `authed` flag, and only the
// last of those is box code.
//
// Values below are obvious placeholders.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer, TEST_SLUG, type TestServer } from "../../helpers/test-route-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { secretsLogDir } from "../../../src/core/secrets/store.js";

const storeDir = await mkdtemp(join(tmpdir(), "bbx-secrets-route-"));
const priorStoreFile = process.env.BBX_SECRETS_FILE;
process.env.BBX_SECRETS_FILE = join(storeDir, "secrets.json");

/** Every access-log line written so far, oldest segment first. */
async function accessLog() {
  const dir = secretsLogDir();
  const segments = (await readdir(dir)).toSorted();
  const texts = await Promise.all(segments.map((s) => readFile(join(dir, s), "utf-8")));
  return texts.join("").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
}

/** A resolve attempt for `weatherapi` with the given headers. */
function attempt(ctx: TestServer, headers: Record<string, string>) {
  return ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "weatherapi", purpose: "weather-trick" },
    headers,
  });
}

// ## An `agent`-level grant resolves, with the token as a bearer
void test("An `agent`-level grant resolves, with the token as a bearer", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await rm(storeDir, { recursive: true, force: true });
      // Assigning undefined would store the string "undefined", a relative path.
      if (priorStoreFile === undefined) delete process.env.BBX_SECRETS_FILE;
      else process.env.BBX_SECRETS_FILE = priorStoreFile;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L52
  const ctx = await makeTestServer();
  const token = getOrCreateAgentToken(ctx.boxRoot);
  const agentAuth = { authorization: `Bearer ${token}` };

  // doctest:L56
  await setSecret({ name: "weatherapi", value: "placeholder-weather-key" });
  await grantSecret({ slug: TEST_SLUG, name: "weatherapi", access: "agent" });

  // doctest:L59
  const res = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "weatherapi", purpose: "weather-trick" },
    headers: agentAuth,
  });
  t.check(res, { statusCode: 200, body: { value: "placeholder-weather-key", suspect: false } });

  // ## A `server`-level grant refuses with the exact kind the agent can act on
  //
  // The message is written for relay: the agent reads it out to the boxholder, who
  // knows which button raises the grant.

  // doctest:L78
  await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
  await grantSecret({ slug: TEST_SLUG, name: "mistral", access: "server" });

  // doctest:L81
  const serverOnly = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "mistral", purpose: "weather-trick" },
    headers: agentAuth,
  });
  t.check(serverOnly, {
    statusCode: 403,
    body: {
      kind: "agent-access-not-granted",
      message: "The secret \"mistral\" is granted to this box (\"test\") for server use only, and box code asked for the value. Ask the boxholder to raise the grant to agent access.",
    },
  });

  // ## An unknown name is a 404 that names the fix

  // doctest:L101
  const unknown = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "no-such-service", purpose: "weather-trick" },
    headers: agentAuth,
  });
  t.check(unknown, {
    statusCode: 404,
    body: {
      kind: "unknown-secret",
      message: "No secret named \"no-such-service\" exists on this machine. It can be declared (bbx secrets declare no-such-service), but only the boxholder can supply its value.",
    },
  });

  // ## Nothing but the agent bearer opens it
  //
  // This test server runs in open access — no auth wall at all — and the route still
  // refuses every credential that is not the box's own agent token. A wrong bearer,
  // a session cookie, and the hub's authenticated-email header all get the same 401.

  // doctest:L123
  const notAgent = {
    statusCode: 401,
    body: {
      kind: "not-agent-authenticated",
      message: "Resolving a secret requires this box's agent token — send it as `Authorization: Bearer $BBX_AGENT_TOKEN` from code running in the box. A browser session, a hub identity header, or a device token is deliberately not enough: this is the only interface that discloses a stored value, so it accepts only the box's own code.",
    },
  };
  t.check({
    noCredential: await attempt(ctx, {}),
    wrongBearer: await attempt(ctx, { authorization: "Bearer not-the-agent-token-0000000000000000" }),
    sessionCookie: await attempt(ctx, { cookie: "bbx_session=placeholder-session" }),
    hubIdentityHeader: await attempt(ctx, { "x-bbx-authenticated-email": "someone@example.com" }),
  }, { noCredential: notAgent, wrongBearer: notAgent, sessionCookie: notAgent, hubIdentityHeader: notAgent });

  // ## Every resolve and refusal is logged with its purpose, never its value

  // doctest:L137
  const log = await accessLog();
  t.check(log, [
    { ts: isoDate(), box: "test", secret: "weatherapi", purpose: "weather-trick", event: "resolve" },
    {
      ts: isoDate(),
      box: "test",
      secret: "mistral",
      purpose: "weather-trick",
      event: "refuse",
      refusal: "agent-access-not-granted",
    },
    {
      ts: isoDate(),
      box: "test",
      secret: "no-such-service",
      purpose: "weather-trick",
      event: "refuse",
      refusal: "unknown-secret",
    },
  ]);

  // A body that is not `{name, purpose}` is a 400 — the purpose is a short label
  // for that log, not a payload.

  // doctest:L151
  const bad = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "weatherapi" },
    headers: agentAuth,
  });
  t.check(bad, {
    statusCode: 400,
    body: {
      kind: "bad-request",
      message: "Expected a JSON body of {name, purpose}: Invalid input: expected string, received undefined",
    },
  });

  // `purpose` is constrained to that label shape — `^[a-z0-9][a-z0-9-]{0,39}$` — so
  // agent-authored callers cannot write a newline, a JSON blob, or a whole prompt
  // into the boxholder's access log:

  // doctest:L166
  async function badPurpose(purpose: string) {
    const reply = await ctx.request({
      method: "POST",
      url: "/api/secrets/resolve",
      payload: { name: "weatherapi", purpose },
      headers: agentAuth,
    });
    return reply;
  }
  const badLabel = {
    statusCode: 400,
    body: {
      kind: "bad-request",
      message: "Expected a JSON body of {name, purpose}: purpose must be a short label: lowercase letters, digits and dashes, 40 characters max, e.g. weather-trick",
    },
  };
  t.check([
    await badPurpose("weather\ntrick"),
    await badPurpose("WeatherTrick"),
    await badPurpose(""),
    await badPurpose("a".repeat(41)),
  ], [badLabel, badLabel, badLabel, badLabel]);
  // None of those refusals was logged.
  t.check(await accessLog(), log);
});
