// # Hub box picker: serves the SPA at `/`, with a minimal ACL-filtered fallback (Track D, chunk D3)
//
// `GET /` on the hub serves the SPA (its `/` route renders the styled
// box-selection page and fetches the accessible-box list from `/api/boxes`). When
// the frontend bundle isn't built it falls back to a minimal server-rendered list,
// filtered through the SAME fail-closed `allowedEmails` predicate a box uses for
// its own ACL (`canAccessBox`, `src/webapp/box-access.ts`), not a copy of it. When
// hub auth is off, every configured box is listed unconditionally (same "open"
// semantics a standalone box gets with the `openAccess` construction option).
// Either way the route is auth-gated: an unauthenticated navigation redirects to
// login.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { registerBoxPicker } from "../../../src/hub/server/box-picker.js";
import { signSession, COOKIE_NAME } from "../../../src/webapp/auth.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-box-picker-test";

const boxA = await makeTmpBox();
await boxA.write("_config/box.json", JSON.stringify({ allowedEmails: ["alice@example.com"] }));
const boxB = await makeTmpBox();
await boxB.write("_config/box.json", JSON.stringify({ allowedEmails: ["bob@example.com"] }));

const boxes = [
  { slug: "box-a", boxRoot: boxA.root },
  { slug: "box-b", boxRoot: boxB.root },
];

// A path with no index.html forces the minimal-list fallback, which is where the
// ACL filtering lives; the SPA-served case gets a real index.html below.
const NO_FRONTEND = path.join(os.tmpdir(), "box-picker-no-frontend-test");

/** The fallback page: a fixed template around one `<li>` per listed box. */
function pickerPage(slugs: string[]): string {
  const items = slugs.length === 0 ? ["<li>No boxes available.</li>"] : slugs.map((slug) => `<li><a href="/${slug}/">${slug}</a></li>`);
  return `<!DOCTYPE html>
<html>
<head>
  <title>Bee Box Hub</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    ul { padding-left: 1.25rem; }
    li { margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>Boxes</h1>
  <ul>
${items.map((item) => `    ${item}`).join("\n")}
  </ul>
</body>
</html>`;
}

async function startPicker(frontendDist: string, openAccess: boolean) {
  const app = Fastify({ logger: false });
  // The box picker reads `request.server.openAccess` (the in-process seam that
  // replaced the BBX_ALLOW_UNAUTHENTICATED env opt-out); decorate it here as the
  // real hub does in createHubServer.
  app.decorate("openAccess", openAccess);
  await app.register(fastifyCookie);
  registerBoxPicker(app, { boxes, frontendDist });
  await app.ready();
  return app;
}

// ## Frontend built: `/` serves the SPA (box list comes from /api/boxes, not the HTML)
void test("Frontend built: `/` serves the SPA (box list comes from /api/boxes, not the HTML)", async (t) => {
  t.teardown(async () => {
    try {
      await spaApp.close();
      await fs.promises.rm(distDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  // "Hub auth off" is now the explicit openAccess construction option.
  const distDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picker-dist-"));
  await fs.promises.writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const spaApp = await startPicker(distDir, true);
  const spaRes = await spaApp.inject({ method: "GET", url: "/" });
  t.check(spaRes.statusCode, 200);

  t.checkText(spaRes.body, "<!doctype html><html><body><div id=\"root\"></div></body></html>");
});

// ## Hub auth off, no frontend build: every configured box is listed, no session needed
void test("Hub auth off, no frontend build: every configured box is listed, no session needed", async (t) => {
  t.teardown(async () => {
    try {
      await openApp.close();
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const openApp = await startPicker(NO_FRONTEND, true);
  const openRes = await openApp.inject({ method: "GET", url: "/" });
  t.check(openRes.statusCode, 200);

  t.checkText(openRes.body, pickerPage(["box-a", "box-b"]));
});

// ## Hub auth on, no session: redirected to login
void test("Hub auth on, no session: redirected to login", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.BBX_SESSION_SECRET;
      await gatedApp.close();
      await boxA.cleanup();
      await boxB.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // Auth is required by default now (openAccess is false for this picker).
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-box-picker-test";
  // Paired secret: an ID-without-secret half-config is now a loud
  // MissingOAuthClientSecretError wherever auth routes register.
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-box-picker-test";
  const gatedApp = await startPicker(NO_FRONTEND, false);
  const noSessionRes = await gatedApp.inject({ method: "GET", url: "/" });
  t.check(noSessionRes.statusCode, 302);

  t.check(noSessionRes.headers.location, "/auth/login?returnTo=%2F");

  // ## Hub auth on, session for alice@example.com: only box-a is listed (fallback)

  const aliceCookie = signSession({ email: "alice@example.com", name: "Alice" });
  const aliceRes = await gatedApp.inject({ method: "GET", url: "/", headers: { cookie: `${COOKIE_NAME}=${aliceCookie}` } });
  t.check(aliceRes.statusCode, 200);

  // Only box-a is listed; box-b is absent.
  t.checkText(aliceRes.body, pickerPage(["box-a"]));

  // ## A session for an email on neither box's allowedEmails sees an empty list

  const strangerCookie = signSession({ email: "stranger@example.com", name: "Stranger" });
  const strangerRes = await gatedApp.inject({ method: "GET", url: "/", headers: { cookie: `${COOKIE_NAME}=${strangerCookie}` } });
  t.check(strangerRes.statusCode, 200);

  t.checkText(strangerRes.body, pickerPage([]));
});
