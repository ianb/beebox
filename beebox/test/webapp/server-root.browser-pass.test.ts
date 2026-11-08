// The SPA fallback and the box browser pass (docs/implemented-plans/agent-self-view.md):
// in hub mode a box serves its app document only to a known identity; the box
// browser's pass for the box the URL names counts, a pass for another box or
// from a same-site page does not. Without this, a production card page opened
// with `bbx browser open /views/...` answered 401 (cross-model review, 2026-11-08).

import { t as tap, test } from "tap";
import "@ianbicking/tap-check/tap";
import Fastify from "fastify";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { TEST_FRONTEND_PATH } from "../helpers/test-server.js";
import { registerSpaFallback } from "../../src/webapp/server-root/root-routes.js";
import { BROWSER_PASS_COOKIE, signBrowserPass } from "../../src/core/browser/pass.js";

const ORIGINAL = { hub: process.env.BBX_HUB_SECRET, id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
process.env.BBX_HUB_SECRET = "test-hub-secret-for-pass-spa-fallback";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-for-pass-spa-fallback";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret-for-pass-spa-fallback";

const box = await makeTmpBox();
const other = await makeTmpBox();
const server = Fastify();
registerSpaFallback(server, { frontendPath: TEST_FRONTEND_PATH, boxes: [{ slug: "test", boxRoot: box.root }, { slug: "other", boxRoot: other.root }] });
const pass = `${BROWSER_PASS_COOKIE}=${signBrowserPass(box.root, { ttlMs: 60_000, now: Date.now() }).value}`;

tap.teardown(async () => {
  await server.close();
  await box.cleanup();
  await other.cleanup();
  for (const [key, value] of [["BBX_HUB_SECRET", ORIGINAL.hub], ["GOOGLE_OAUTH_CLIENT_ID", ORIGINAL.id], ["GOOGLE_OAUTH_CLIENT_SECRET", ORIGINAL.secret]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function status(url: string, headers: Record<string, string>): Promise<number> {
  return (await server.inject({ method: "GET", url, headers })).statusCode;
}

void test("the box's own pass loads its app document; nothing else does", async (t) => {
  t.check(
    {
      ownBox: await status("/test/views/_content/a.card", { cookie: pass, "sec-fetch-site": "none" }),
      otherBox: await status("/other/views/_content/a.card", { cookie: pass, "sec-fetch-site": "none" }),
      sameSitePage: await status("/test/views/_content/a.card", { cookie: pass, "sec-fetch-site": "same-site" }),
      nothing: await status("/test/views/_content/a.card", {}),
    },
    { ownBox: 200, otherBox: 401, sameSitePage: 401, nothing: 401 },
  );
});
