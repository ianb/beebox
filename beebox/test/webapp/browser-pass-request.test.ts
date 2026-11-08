// The box and its browser pass (docs/plans/agent-self-view.md, Track A): the
// real box server with auth on admits a request carrying the box's own pass
// from the box's own pages, and that request is the agent, never a person,
// even when the person's session rides along (the shared browser can hold one).

import { t as tap } from "tap";
import "@ianbicking/tap-check/tap";
import { BROWSER_PASS_COOKIE, signBrowserPass } from "../../src/core/browser/pass.js";
import { signSession } from "../../src/webapp/auth.js";
import { resolveBoxIdentity } from "../../src/webapp/box-identity.js";
import { makeTestServer } from "../helpers/test-route-server.js";

const ORIGINAL_OWNER = process.env.BBX_OWNER_EMAIL;
process.env.BBX_OWNER_EMAIL = "priya@example.com";
delete process.env.BBX_PUBLIC_URL;
delete process.env.PUBLIC_URL;
delete process.env.BBX_DEV_APP_URL;
const SESSION = `bbx_session=${signSession({ email: "priya@example.com", name: "Priya" })}`;

const ctx = await makeTestServer({ openAccess: false });
const PASS = `${BROWSER_PASS_COOKIE}=${signBrowserPass(ctx.boxRoot, { ttlMs: 60_000, now: Date.now() }).value}`;
tap.teardown(async () => {
  await ctx.cleanup();
  if (ORIGINAL_OWNER === undefined) delete process.env.BBX_OWNER_EMAIL;
  else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER;
});

/** An owner-only tRPC query: 200 for the owner, refused for the agent. */
async function ownerQuery(headers: Record<string, string>): Promise<number> {
  return (await ctx.rawRequest({ method: "GET", url: "/api/trpc/voice.capabilities", headers })).statusCode;
}

void tap.test("the pass admits the agent, and an owner session beside it does not make it the owner", async (t) => {
  t.check(
    {
      sessionOnly: await ownerQuery({ cookie: SESSION }),
      passOnly: await ownerQuery({ cookie: PASS, "sec-fetch-site": "same-origin" }),
      passAndSession: await ownerQuery({ cookie: `${PASS}; ${SESSION}`, "sec-fetch-site": "same-origin" }),
      nothing: await ownerQuery({}),
      sameSitePage: await ownerQuery({ cookie: PASS, "sec-fetch-site": "same-site" }),
    },
    // 403: admitted, but an agent is refused an owner procedure; 401: not admitted.
    { sessionOnly: 200, passOnly: 403, passAndSession: 403, nothing: 401, sameSitePage: 401 },
  );
});

void tap.test("box-scoped identity readers see nobody when the pass is present", async (t) => {
  const request = { headers: { cookie: `${PASS}; ${SESSION}`, "sec-fetch-site": "same-origin" } };
  t.check(await resolveBoxIdentity({ boxRoot: ctx.boxRoot, request, openAccess: false }), { email: null, name: null, source: null });
  t.check(
    await resolveBoxIdentity({ boxRoot: ctx.boxRoot, request: { headers: { cookie: SESSION } }, openAccess: false }),
    { email: "priya@example.com", name: "Priya", source: "cookie" },
  );
});

void tap.test("the box browser's own pass cannot open the person's browser page", async (t) => {
  const response = await ctx.response({ method: "GET", url: "/browser/", headers: { cookie: PASS, "sec-fetch-site": "none", accept: "text/html" } });
  t.check({ status: response.status, body: response.body }, { status: 403, body: { error: "the browser page is for people; agents use bbx browser" } });
});
