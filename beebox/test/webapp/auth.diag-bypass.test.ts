// # The diagnostic bearer reaches the whitelisted read procedures through the box scope
//
// `BBX_DIAG_API_KEY` as a bearer opens `health.check`, `debugLog.get` and
// `chat.statusAll` on a GET (`isDiagnosticBypassRequest`, `src/webapp/auth.ts`),
// applied in the box auth preHandler (`src/webapp/server-box-scope.ts`).
// `docs/server/operations.md` ("Live health") documents the call.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTestServer } from "../helpers/test-route-server.js";

const DIAG_KEY = "diag-key-for-diag-bypass-test";

void test("the diag bearer reaches health.check and debugLog.get on an auth-on box", async (t) => {
  const prior = process.env.BBX_DIAG_API_KEY;
  process.env.BBX_DIAG_API_KEY = DIAG_KEY;
  const server = await makeTestServer({ openAccess: false });
  t.teardown(async () => {
    await server.cleanup();
    if (prior === undefined) delete process.env.BBX_DIAG_API_KEY;
    else process.env.BBX_DIAG_API_KEY = prior;
  });
  const headers = { authorization: `Bearer ${DIAG_KEY}` };
  const health = await server.request({ method: "GET", url: "/api/trpc/health.check?input=%7B%22fresh%22%3Atrue%7D", headers });
  const debug = await server.request({ method: "GET", url: "/api/trpc/debugLog.get", headers });
  const wrong = await server.request({ method: "GET", url: "/api/trpc/debugLog.get", headers: { authorization: "Bearer wrong" } });
  // The health report's contents vary with the host; the status is the auth answer.
  t.check({ health: health.statusCode, debug: debug.statusCode, wrong }, {
    health: 200,
    debug: 200,
    wrong: { statusCode: 401, body: { error: "Not authenticated" } },
  });
});
