// # `POST /api/browser/exec`: the agent's commands reach the box browser, nothing else does
//
// docs/plans/shared-browser.md, Track C. The route accepts only the per-box
// agent bearer (a person's cookie would let any page the person has open drive
// the browser), refuses the flags that would leave the box browser with a
// message naming the flag, starts the browser host, and returns what the host's
// command socket answered. A box with no browser installed gets 503 with the
// reason. The browser host is substituted: a fake command socket records what
// reached it and answers with a canned reply.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import net from "node:net";
import { makeTestServer, TEST_SLUG } from "../../../helpers/test-route-server.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";
import { signSession } from "../../../../src/webapp/auth.js";
import { PAGE_READ_ARGS } from "../../../../src/core/browser/page-read.js";
import { readBrowserQuestions } from "../../../../src/core/browser/question.js";
import { BrowserPathTooLongError, browserPaths, type BrowserPaths } from "../../../../src/core/browser/paths.js";
import { BrowserNotInstalledError, type BrowserHostHandle, type EnsureBrowserHostInput } from "../../../../src/core/browser/host/start.js";

/** A command socket that records each request and answers with `reply`. */
async function fakeCommandSocket(paths: BrowserPaths): Promise<{ requests: unknown[]; reply: unknown; close: () => Promise<void> }> {
  await fs.mkdir(paths.root, { recursive: true });
  const requests: unknown[] = [];
  const fake: { requests: unknown[]; reply: unknown; close: () => Promise<void> } = {
    requests,
    reply: { exitCode: 0, stdout: "Example Domain\n", stderr: "" },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = net.createServer({ allowHalfOpen: true }, (conn) => {
    let text = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk: string) => (text += chunk));
    conn.on("end", () => {
      requests.push(JSON.parse(text));
      conn.end(`${JSON.stringify(fake.reply)}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(paths.cliSocket, resolve));
  return fake;
}

async function setup(t: Test) {
  const priorOwner = process.env.BBX_OWNER_EMAIL;
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  // Short: the socket path must stay under the Unix limit.
  const stateDir = await fs.mkdtemp("/tmp/bbxe-");
  const hostCalls: EnsureBrowserHostInput[] = [];
  let installed = true;
  let hostError: Error | null = null;
  const ctx = await makeTestServer({
    openAccess: false,
    services: {
      browserHost: async (input) => {
        hostCalls.push(input);
        if (hostError !== null) throw hostError;
        if (!installed) throw new BrowserNotInstalledError("the server has no browser installed (/opt/beebox-browser/chrome is missing; the deploy installs it)");
        const handle: BrowserHostHandle = { paths: browserPaths({ ...input, stateDir }), pid: 1 };
        return handle;
      },
    },
  });
  const socket = await fakeCommandSocket(browserPaths({ boxRoot: ctx.boxRoot, stateDir }));
  t.teardown(async () => {
    await socket.close();
    await ctx.cleanup();
    await fs.rm(stateDir, { recursive: true, force: true });
    if (priorOwner === undefined) delete process.env.BBX_OWNER_EMAIL;
    else process.env.BBX_OWNER_EMAIL = priorOwner;
  });
  const exec = (args: unknown, headers: Record<string, string>) => ctx.request({ method: "POST", url: "/api/browser/exec", payload: { args }, headers });
  return {
    ctx, socket, hostCalls, exec,
    browserRoot: browserPaths({ boxRoot: ctx.boxRoot, stateDir }).root,
    agent: { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` },
    uninstall: () => (installed = false),
    failHost: (e: Error) => (hostError = e),
  };
}

void test("The agent bearer runs a command through the host's command socket", async (t) => {
  const { ctx, socket, hostCalls, exec, agent } = await setup(t);
  t.check(await exec(["get", "title"], agent), { statusCode: 200, body: { exitCode: 0, stdout: "Example Domain\n", stderr: "" } });
  t.check({ hostCalls, requests: socket.requests }, {
    hostCalls: [{ boxRoot: ctx.boxRoot }],
    requests: [{ args: ["get", "title"] }],
  });
});

// The person's signed-in session passes the box's auth wall, and is still refused here.
void test("A person's session cookie is refused", async (t) => {
  const { socket, hostCalls, exec } = await setup(t);
  const cookie = `bbx_session=${signSession({ email: "owner@example.com", name: "Owner" })}`;
  t.check(await exec(["get", "title"], { cookie }), {
    statusCode: 403,
    body: { error: "The browser exec route is for the box's agent (bbx browser); people open the browser from the profile menu's Web browser item" },
  });
  t.check({ hostCalls, requests: socket.requests }, { hostCalls: [], requests: [] });
});

void test("A flag that would leave the box browser is refused, naming the flag", async (t) => {
  const { socket, hostCalls, exec, agent } = await setup(t);
  t.check(await exec(["--profile", "/home/me/.config/google-chrome", "open", "https://example.com"], agent), {
    statusCode: 400,
    body: { error: "bbx browser: --profile is fixed for the box browser; the box uses one browser profile" },
  });
  t.check(await exec([], agent), {
    statusCode: 400,
    body: { error: "bbx browser: ✖ Too small: expected array to have >=1 items\n  → at args" },
  });
  t.check({ hostCalls, requests: socket.requests }, { hostCalls: [], requests: [] });
});

// A bare 500 sent the box's agent looking for a missing Chromium (2026-10-30).
void test("A socket path over the limit answers 503 with the reason", async (t) => {
  const { exec, agent, failHost } = await setup(t);
  failHost(new BrowserPathTooLongError("/a/long/path.sock"));
  t.check(await exec(["get", "url"], agent), {
    statusCode: 503,
    body: { error: "The box browser's socket path is 17 bytes, over the 100-byte limit for Unix sockets: /a/long/path.sock. Use a shorter box slug or home directory." },
  });
});

void test("A box with no browser installed answers 503 with the reason", async (t) => {
  const { socket, exec, agent, uninstall } = await setup(t);
  uninstall();
  t.check(await exec(["open", "https://example.com"], agent), {
    statusCode: 503,
    body: { error: "This box has no browser installed: the server has no browser installed (/opt/beebox-browser/chrome is missing; the deploy installs it)" },
  });
  t.check(socket.requests, []);
});

// `bbx browser ask` is the agent's, like exec: a person's cookie is refused. A
// browser that cannot say what page it is on saves nothing, because the person
// would be asked about a page nobody can name.
void test("The ask route is the agent's, and a failed page read saves nothing", async (t) => {
  const { ctx, agent, socket, browserRoot } = await setup(t);
  const ask = (headers: Record<string, string>, payload: Record<string, string>) => ctx.response({ method: "POST", url: "/api/browser/ask", payload, headers });
  const body = { question: "Solve the check", sessionId: "chat-a" };
  t.check((await ask({ cookie: `bbx_session=${signSession({ email: "owner@example.com", name: "Owner" })}` }, body)).status, 403);
  t.check((await ask(agent, { question: " ", sessionId: "chat-a" })).status, 400);
  socket.reply = { exitCode: 1, stdout: "", stderr: "no page\n" };
  t.check((await ask(agent, body)).status, 502);
  t.check(readBrowserQuestions(browserRoot), []);
  socket.reply = { exitCode: 0, stdout: "https://shop.example/check\n", stderr: "" };
  t.check((await ask(agent, body)).status, 200);
  t.check(readBrowserQuestions(browserRoot).map((q) => [q.sessionId, q.question, q.pageUrl]), [["chat-a", "Solve the check", "https://shop.example/check"]]);
});

// `bbx webpage save --browser`: the agent's only, and output that was cut off is never a page.
void test("The page route is the agent's, and reads the whole page in one evaluation", async (t) => {
  const { ctx, agent, socket } = await setup(t);
  const read = (headers: Record<string, string>) => ctx.response({ method: "POST", url: "/api/browser/page", payload: {}, headers });
  t.check((await read({ cookie: `bbx_session=${signSession({ email: "owner@example.com", name: "Owner" })}` })).status, 403);
  socket.reply = { exitCode: 0, stdout: `${JSON.stringify(JSON.stringify({ url: "https://a.example/", html: "<html></html>" }))}\n`, stderr: "" };
  const ok = await read(agent);
  t.check([ok.status, ok.body], [200, { url: "https://a.example/", html: "<html></html>" }]);
  t.check(socket.requests.at(-1), { args: PAGE_READ_ARGS, fullOutput: true });
  socket.reply = { exitCode: 0, stdout: '"cut off\n[bbx browser: stdout truncated at 20 MB]\n', stderr: "" };
  t.check((await read(agent)).status, 502);
});

// docs/implemented-plans/agent-self-view.md, Track B: the box's pass goes in before the
// agent's command, so the agent can open its own box's pages.
void test("With an app URL, the box's pass is set before the agent's command", async (t) => {
  const prior = process.env.BBX_DEV_APP_URL;
  process.env.BBX_DEV_APP_URL = "http://localhost:3210/wt";
  t.teardown(() => {
    if (prior === undefined) delete process.env.BBX_DEV_APP_URL;
    else process.env.BBX_DEV_APP_URL = prior;
  });
  const { socket, exec, agent } = await setup(t);
  t.check(await exec(["open", "http://localhost:3210/wt/test1/views/a.md"], agent), { statusCode: 200, body: { exitCode: 0, stdout: "Example Domain\n", stderr: "" } });
  t.check(socket.requests, [
    { args: ["cookies", "set", "bbx_browser_pass", any(String), "--url", "http://localhost:3210/wt/", "--path", "/wt/", "--httpOnly", "--sameSite", "Strict", "--expires", any(String)] },
    { args: ["open", "http://localhost:3210/wt/test1/views/a.md"] },
  ]);
});

void test("A pass the browser refuses is a note after the command's own output", async (t) => {
  const prior = process.env.BBX_DEV_APP_URL;
  process.env.BBX_DEV_APP_URL = "http://localhost:3210/wt";
  t.teardown(() => {
    if (prior === undefined) delete process.env.BBX_DEV_APP_URL;
    else process.env.BBX_DEV_APP_URL = prior;
  });
  const { socket, exec, agent } = await setup(t);
  socket.reply = { exitCode: 1, stdout: "", stderr: "✗ failed\n" };
  t.check(await exec(["get", "url"], agent), {
    statusCode: 200,
    body: { exitCode: 1, stdout: "", stderr: "✗ failed\nnote: could not refresh the box browser's pass, so this box's own pages may ask for a login: the browser refused the box's pass: ✗ failed\n" },
  });
});

// docs/implemented-plans/agent-self-view.md, Track C: a path starting with / is a page of this box.
void test("A box path is opened as this box's page; --card refuses other screenshot arguments", async (t) => {
  const prior = process.env.BBX_DEV_APP_URL;
  process.env.BBX_DEV_APP_URL = "http://localhost:3210/wt";
  t.teardown(() => {
    if (prior === undefined) delete process.env.BBX_DEV_APP_URL;
    else process.env.BBX_DEV_APP_URL = prior;
  });
  const { socket, exec, agent } = await setup(t);
  await exec(["open", "/views/_content/a.card"], agent);
  t.check(socket.requests.slice(1), [{ args: ["open", `http://localhost:3210/wt/${TEST_SLUG}/views/_content/a.card`] }]);
  t.check(await exec(["screenshot", "--card", "--full"], agent), {
    statusCode: 200,
    body: { exitCode: 1, stdout: "", stderr: "bbx browser: --card takes no other screenshot arguments; it captures the open card to _tmp/browser/ and prints the path\n" },
  });
});
