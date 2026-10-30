// # `/<slug>/browser/`: the person's view of the box browser
//
// The engine proxies agent-browser's dashboard onto the box's own origin
// (docs/plans/shared-browser.md, Track C). These tests run the real box
// server with auth on, and stand a fake dashboard in for the browser host: an
// HTTP and WebSocket server on the relay socket and a command server on the
// command socket, at the paths `browserPaths` gives. The fake encodes the
// dashboard's interface (paths, its loopback-only origin rule, the session
// stream), not this route's logic.

import t from "tap";
import "@ianbicking/tap-check/tap";
import { any, others } from "@ianbicking/tap-check/check";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { getOrCreateAgentToken } from "../../../../../src/core/agent/token.js";
import { BrowserNotInstalledError, type BrowserHostHandle } from "../../../../../src/core/browser/host/start.js";
import { browserPaths } from "../../../../../src/core/browser/paths.js";
import { EXEC_BODY } from "../../../../../src/core/browser/exec-args.js";
import { signSession } from "../../../../../src/webapp/auth.js";
import { makeTestServer, TEST_SLUG } from "../../../../helpers/test-route-server.js";

const ORIGINAL_OWNER = process.env.BBX_OWNER_EMAIL;
process.env.BBX_OWNER_EMAIL = "priya@example.com";
const SESSION = `bbx_session=${signSession({ email: "priya@example.com", name: "Priya" })}`;
const PREFIX = `/${TEST_SLUG}/browser`;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", [others]: any(String) };

// A short state directory: the relay socket path has a 100-byte limit.
const stateDir = await mkdtemp(join(tmpdir(), "bbx-bp-"));
let installed = true;
const ctx = await makeTestServer({
  openAccess: false,
  services: {
    browserHost: async (input) => {
      if (!installed) throw new BrowserNotInstalledError("no Chrome found under ~/.agent-browser/browsers");
      const handle: BrowserHostHandle = { paths: browserPaths({ ...input, stateDir }), pid: 0 };
      return handle;
    },
  },
});
const paths = browserPaths({ boxRoot: ctx.boxRoot, slug: TEST_SLUG, stateDir });
await mkdir(paths.root, { recursive: true });

/** What the fake dashboard saw of each request. */
const seen: { method: string; url: string; host: string | undefined; origin: string | undefined; cookie: string | undefined; authorization: string | undefined; body: string }[] = [];

const dashboard = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    seen.push({ method: req.method ?? "", url: req.url ?? "", host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie, authorization: req.headers.authorization, body });
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "dashboard-access-token=x; Path=/" });
      res.end("<!DOCTYPE html><html><head><script src=\"/_next/static/app.js\"></script></head><body><main>dashboard</main></body></html>");
    } else if (req.url === "/_next/static/app.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end("fetch(\"/api/sessions\");const s=`/api/session/${p}/stream`;");
    } else if (req.url === "/api/exec" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
});
const streams = new WebSocketServer({ server: dashboard });
streams.on("connection", (socket, req) => {
  socket.send(`hello ${req.url ?? ""} from origin ${req.headers.origin ?? "(none)"}`);
  socket.on("message", (data) => socket.send(`echo ${String(data)}`));
});
await new Promise<void>((resolve) => dashboard.listen(paths.relaySocket, resolve));

/** The command socket: `session list` answers `sessionList`; every request is recorded. */
let sessionList = "Active sessions:\n-> box\n";
const commands: string[][] = [];
const cli = net.createServer((conn) => {
  let text = "";
  conn.on("data", (chunk) => (text += String(chunk)));
  conn.on("end", () => {
    const { args } = EXEC_BODY.parse(JSON.parse(text));
    commands.push(args);
    const stdout = args[0] === "session" ? sessionList : "";
    conn.end(`${JSON.stringify({ exitCode: 0, stdout, stderr: "" })}\n`);
  });
});
await new Promise<void>((resolve) => cli.listen(paths.cliSocket, resolve));

t.teardown(async () => {
  await ctx.cleanup();
  streams.close();
  await new Promise((resolve) => dashboard.close(resolve));
  await new Promise((resolve) => cli.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
  if (ORIGINAL_OWNER === undefined) delete process.env.BBX_OWNER_EMAIL;
  else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER;
});

// ## A signed-in person gets the dashboard, rewritten under the prefix
//
// The HTML's script path and the script's API paths move under
// `/<slug>/browser`; the page carries the browser page CSP and `no-store`;
// the dashboard's own cookie does not reach the box origin. Upstream, the
// request looks like the dashboard's own loopback page and carries none of
// the person's credentials. The page load checks that the box session exists.
void t.test("A signed-in person gets the dashboard, rewritten under the prefix", async (st) => {
  seen.length = 0;
  commands.length = 0;
  const page = await ctx.response({ method: "GET", url: "/browser/", headers: { cookie: SESSION, accept: "text/html" } });
  st.check(page, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
      "cache-control": "no-store",
      [others]: any(String),
    },
    body: `<!DOCTYPE html><html><head><script src="${PREFIX}/_next/static/app.js"></script></head><body><main>dashboard</main></body></html>`,
  });
  st.check(page.headers["set-cookie"], undefined);
  st.check(seen, [{ method: "GET", url: "/", host: "localhost", origin: "http://localhost", cookie: undefined, authorization: undefined, body: "" }]);
  st.check(commands, [["session", "list"]]);

  const script = await ctx.response({ method: "GET", url: "/browser/_next/static/app.js", headers: { cookie: SESSION } });
  st.check(script, {
    status: 200,
    headers: { "content-type": "application/javascript", [others]: any(String) },
    body: `fetch("${PREFIX}/api/sessions");const s=\`${PREFIX}/api/session/\${p}/stream\`;`,
  });
});

// ## With no box session, the page load starts one on about:blank
void t.test("With no box session, the page load starts one on about:blank", async (st) => {
  commands.length = 0;
  sessionList = "No active sessions\n";
  st.teardown(() => { sessionList = "Active sessions:\n-> box\n"; });
  await ctx.response({ method: "GET", url: "/browser/", headers: { cookie: SESSION } });
  st.check(commands, [["session", "list"], ["open", "about:blank"]]);
});

// ## A JSON POST reaches the dashboard byte for byte
//
// The proxy's scope parses no bodies; a parsed JSON body would have drained
// the stream and left the proxied POST hanging (`src/hub/server/core.ts`).
void t.test("A JSON POST reaches the dashboard byte for byte", async (st) => {
  seen.length = 0;
  const payload = "{\"args\": [\"open\",  \"https://example.com/?q=ü\"]}";
  const res = await ctx.response({ method: "POST", url: "/browser/api/exec", payload, headers: { cookie: SESSION, "content-type": "application/json", authorization: "Basic not-for-upstream" } });
  st.check(res, { status: 200, headers: { "content-type": "application/json", [others]: any(String) }, body: { success: true } });
  st.check(seen, [{ method: "POST", url: "/api/exec", host: "localhost", origin: "http://localhost", cookie: undefined, authorization: undefined, body: payload }]);
});

// ## Agents and other origins are refused
//
// The agent bearer passes the box auth hook, so the page refuses it itself:
// on the dashboard it could read the profile's cookies. A request naming
// another origin is refused even with the person's cookie: a cross-site page
// could otherwise drive the browser through `/api/exec`. With no credential,
// an asset path (which the box hook lets through) is a 401 and a page load
// goes to the login page.
void t.test("Agents and other origins are refused", async (st) => {
  seen.length = 0;
  const agent = await ctx.response({ method: "GET", url: "/browser/_next/static/app.js", headers: { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` } });
  st.check(agent, { status: 403, headers: JSON_HEADERS, body: { error: "the browser page is for people; agents use bbx browser" } });

  const crossSite = await ctx.response({ method: "POST", url: "/browser/api/exec", payload: "{}", headers: { cookie: SESSION, origin: "https://evil.example", "content-type": "application/json" } });
  st.check(crossSite, { status: 403, headers: JSON_HEADERS, body: { error: "the browser page only accepts requests from its own origin" } });

  const anonymousAsset = await ctx.response({ method: "GET", url: "/browser/_next/static/app.js" });
  st.check(anonymousAsset, { status: 401, headers: JSON_HEADERS, body: { error: "Not authenticated" } });

  const anonymousPage = await ctx.response({ method: "GET", url: "/browser/", headers: { accept: "text/html" } });
  st.check(anonymousPage, { status: 302, headers: { location: `/auth/login?returnTo=${encodeURIComponent(`${PREFIX}/`)}`, [others]: any(String) }, body: "" });
  st.check(seen, []);
});

// ## `/browser` without the slash redirects relatively, so any outer prefix is kept
//
// The box cannot see a dev router's outer segment (the hub replaces the
// base-prefix header with `/<slug>`), and `browser/` from `.../<slug>/browser`
// is `.../<slug>/browser/` whatever comes before.
void t.test("`/browser` without the slash redirects relatively", async (st) => {
  const res = await ctx.response({ method: "GET", url: "/browser?x=1", headers: { cookie: SESSION } });
  st.check(res, { status: 302, headers: { location: "browser/?x=1", [others]: any(String) }, body: "" });
});

// ## The live view's WebSocket is bridged to the dashboard's session stream
//
// Upstream, the stream sees the loopback origin; messages pass both ways.
void t.test("The live view's WebSocket is bridged to the dashboard's session stream", async (st) => {
  const address = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  const socket = new WebSocket(`${address.replace("http", "ws")}${PREFIX}/api/session/9222/stream`, { headers: { cookie: SESSION } });
  st.teardown(() => socket.terminate());
  const received: string[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => socket.send("click"));
    socket.on("message", (data) => {
      received.push(String(data));
      if (received.length === 2) resolve();
    });
    socket.on("error", reject);
  });
  st.check(received, ["hello /api/session/9222/stream from origin http://localhost", "echo click"]);
});

// ## A WebSocket from the page carries Origin but no fetch metadata
//
// Chrome sends no Sec-Fetch-Site on WebSocket handshakes, and the box cannot
// rebuild the browser's origin behind the router and hub (dev smoke run,
// 2026-10-30), so a handshake with the person's SameSite=Lax session cookie
// and an unmatched Origin is bridged. One that says it is cross-site is not.
void t.test("A page's WebSocket is bridged on the session cookie; a cross-site one is refused", async (st) => {
  // The server is already listening from the bridge test above.
  const bound = ctx.server.server.address();
  const address = typeof bound === "object" && bound !== null ? `http://127.0.0.1:${String(bound.port)}` : "";
  const url = `${address.replace("http", "ws")}${PREFIX}/api/session/9222/stream`;
  const first = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie: SESSION, origin: "http://localhost:3210" } });
    st.teardown(() => socket.terminate());
    socket.on("message", (data) => resolve(String(data)));
    socket.on("error", reject);
  });
  st.check(first, "hello /api/session/9222/stream from origin http://localhost");
  const refused = await new Promise<number>((resolve) => {
    const socket = new WebSocket(url, { headers: { cookie: SESSION, origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    st.teardown(() => socket.terminate());
    socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    socket.on("error", () => resolve(-1));
  });
  st.check(refused, 403);
});

// ## No browser installed: a page that says why
void t.test("No browser installed: a page that says why", async (st) => {
  installed = false;
  st.teardown(() => { installed = true; });
  const res = await ctx.response({ method: "GET", url: "/browser/", headers: { cookie: SESSION } });
  st.check(res, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", [others]: any(String) }, body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>No browser installed</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}pre{white-space:pre-wrap;background:#f4f1ec;padding:1rem}</style></head>
<body><h1>No browser installed</h1><pre>no Chrome found under ~/.agent-browser/browsers</pre></body>
</html>
` });
});
