// # A real box browser host: start, drive through the relay, stop, recover
//
// docs/plans/shared-browser.md, "What will hold this after it ships". On the
// dev machine (no private network), the engine-side `ensureBrowserHost`
// starts a real `bbx engine browser-host`, and the test drives the dashboard
// only through the relay socket, as the engine's routes will. It records the
// dashboard, daemon and Chrome pids and checks that none survives a graceful
// stop, nor a SIGKILL of the host followed by a new start: `dashboard start`
// and the daemon detach, so only the next host's stale cleanup reaches them.
// A login cookie set by a local page must survive both restarts. A dashboard
// that dies alone (it is detached from the host) is noticed by the next
// `ensureBrowserHost`, which starts a new host. The
// command socket answers the agent's commands with agent-browser's text output.
// A host whose engine is already gone when it starts stops by itself.
//
// Skips, saying why, when no Chrome is installed for agent-browser.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";
import { ensureBrowserHost, stopBrowserHosts, type BrowserHostHandle } from "../../../../src/core/browser/host/start.js";
import { pidsNaming, processTable } from "../../../../src/core/browser/host-process/run.js";
import { sendBrowserCommand } from "../../../../src/core/browser/command-socket.js";

const execFileAsync = promisify(execFile);

/** agent-browser's own Chrome for Testing under the real home (tests run with a temporary HOME). */
function findChrome(): string | undefined {
  const given = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (given !== undefined && given !== "") return given;
  const root = path.join(os.userInfo().homedir, ".agent-browser", "browsers");
  if (!existsSync(root)) return undefined;
  for (const version of readdirSync(root).toSorted().toReversed()) {
    for (const candidate of [
      path.join(root, version, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(root, version, "chrome-linux64", "chrome"),
      path.join(root, version, "chrome"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

interface ExecReply {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
}

/** `POST /api/exec` on the dashboard, through the relay socket. */
function exec(handle: BrowserHostHandle, args: string[]): Promise<ExecReply> {
  const body = JSON.stringify({ args: ["--session", "box", ...args] });
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: handle.paths.relaySocket,
        path: "/api/exec",
        method: "POST",
        // The dashboard accepts a loopback Origin that matches Host.
        headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () => {
          // eslint-disable-next-line no-restricted-syntax -- the dashboard's reply shape, checked whole by the caller
          resolve(JSON.parse(text) as ExecReply);
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

/** The dashboard runs agent-browser with JSON output; this keeps the parts the test reads. */
async function run(handle: BrowserHostHandle, args: string[]): Promise<{ exitCode: number; success: boolean; title: string | undefined; url: string | undefined }> {
  const reply = await exec(handle, args);
  // eslint-disable-next-line no-restricted-syntax -- agent-browser's JSON reply; the fields read are checked whole by the caller
  const parsed = JSON.parse(reply.stdout) as { success: boolean; data: { title?: string; url?: string } };
  return { exitCode: reply.exit_code, success: parsed.success, title: parsed.data.title, url: parsed.data.url };
}

/** The page title, read through the dashboard. */
async function title(handle: BrowserHostHandle): Promise<string | undefined> {
  return (await run(handle, ["get", "title"])).title;
}

interface Pids {
  dashboard: number;
  daemon: number;
  chrome: number[];
}

async function recordPids(handle: BrowserHostHandle): Promise<Pids> {
  const read = (name: string): number => Number(readFileSync(path.join(handle.paths.socketDir, name), "utf8").trim());
  return { dashboard: read("dashboard.pid"), daemon: read("box.pid"), chrome: pidsNaming(await processTable(), handle.paths.profile) };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_e) {
    return false;
  }
}

function survivors(pids: Pids): number[] {
  return [pids.dashboard, pids.daemon, ...pids.chrome].filter((pid) => alive(pid));
}

const chrome = findChrome();

void test("A real browser host starts, serves the dashboard through the relay, and leaves nothing behind", { skip: chrome === undefined ? "no Chrome for agent-browser (run `agent-browser install`)" : false }, async (t) => {
  process.env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
  // Short paths: the daemon's socket must stay under the Unix limit.
  const stateDir = await fs.mkdtemp("/tmp/bbxb-");
  const boxRoot = await fs.mkdtemp("/tmp/bbxbox-");
  // A local site whose login sets a persistent cookie; `/` shows it in the title.
  const site = http.createServer((req, res) => {
    const cookie = req.headers.cookie ?? "none";
    if (req.url === "/login") res.setHeader("set-cookie", "login=priya; Max-Age=86400; Path=/");
    res.setHeader("content-type", "text/html");
    res.end(`<title>${req.url === "/login" ? "logged in" : cookie}</title>`);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const address = site.address();
  const siteUrl = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
  t.teardown(async () => {
    await stopBrowserHosts();
    site.close();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(boxRoot, { recursive: true, force: true });
  });
  // A stale dev bundle is rebuilt on first run; do that outside the host's 20 s start window.
  await execFileAsync(path.join(PACKAGE_ROOT, "bin", "bbx"), ["--version"]);
  const box = { boxRoot, stateDir };

  // First run: open a page, log in, stop gracefully.
  const first = await ensureBrowserHost(box);
  // A second call returns the running host.
  t.check(await ensureBrowserHost(box), first);
  // The command socket runs the agent's commands with agent-browser's text output.
  t.check(await sendBrowserCommand(first.paths.cliSocket, ["open", "data:text/html,<title>hi</title>"]), {
    exitCode: 0, stdout: "✓ hi\n  data:text/html,<title>hi</title>\n", stderr: "",
  });
  // It launched the browser with the box viewport, the size the dashboard maps clicks onto
  // (G2, 2026-10-30: without it the page was 1280x577 and clicks landed low).
  const size = await sendBrowserCommand(first.paths.cliSocket, ["eval", "`${String(innerWidth)}x${String(innerHeight)}`"]);
  // Page output comes between nonce-marked boundary lines.
  t.check({ ...size, stdout: size.stdout.split("\n")[1] }, { exitCode: 0, stdout: "\"1280x720\"", stderr: "" });
  t.check(await run(first, ["open", "data:text/html,<title>hi</title><h1>hi</h1>"]), {
    exitCode: 0, success: true, title: "hi", url: "data:text/html,<title>hi</title><h1>hi</h1>",
  });
  t.check(await title(first), "hi");
  t.check(await sendBrowserCommand(first.paths.cliSocket, ["get", "title"]), { exitCode: 0, stdout: "hi\n", stderr: "" });
  // The host checks the arguments again, whatever the engine did.
  t.check(await sendBrowserCommand(first.paths.cliSocket, ["--profile", "/tmp/other", "open", "about:blank"]), {
    exitCode: 2, stdout: "", stderr: "bbx browser: --profile is fixed for the box browser; the box uses one browser profile\n",
  });
  await run(first, ["open", `${siteUrl}/login`]);
  t.check(await title(first), "logged in");
  const firstPids = await recordPids(first);
  await stopBrowserHosts();
  t.check(await eventually(() => survivors(firstPids).length === 0 && "gone", { label: "first run's processes exit", timeoutMs: 10_000 }), "gone");
  // The relay and command sockets are removed.
  t.check([existsSync(first.paths.relaySocket), existsSync(first.paths.cliSocket)], [false, false]);

  // Second run: the login survived; then the host is killed outright.
  const second = await ensureBrowserHost(box);
  await run(second, ["open", siteUrl]);
  t.check(await title(second), "login=priya");
  const secondPids = await recordPids(second);
  process.kill(-second.pid, "SIGKILL");

  // Third run: started after the kill, it clears what the killed host left.
  const third = await eventually(async () => {
    const handle = await ensureBrowserHost(box);
    return handle.pid !== second.pid && handle;
  }, { label: "a new host after the kill", timeoutMs: 30_000 });
  // The killed host's dashboard, daemon and Chrome are gone.
  t.check(survivors(secondPids), []);
  await run(third, ["open", siteUrl]);
  t.check(await title(third), "login=priya");
  const thirdPids = await recordPids(third);
  // One dashboard runs: the new one.
  t.check(alive(thirdPids.dashboard), true);

  // Fourth run: the dashboard dies alone; the next call replaces the host.
  process.kill(thirdPids.dashboard, "SIGKILL");
  t.check(await eventually(() => !alive(thirdPids.dashboard) && "dead", { label: "the dashboard exits" }), "dead");
  const fourth = await ensureBrowserHost(box);
  await run(fourth, ["open", siteUrl]);
  t.check(await title(fourth), "login=priya");
  const fourthPids = await recordPids(fourth);
  // The old host was stopped; a new dashboard serves the relay.
  t.check({ oldHost: alive(third.pid), oldDashboard: alive(thirdPids.dashboard), newDashboard: alive(fourthPids.dashboard) }, { oldHost: false, oldDashboard: false, newDashboard: true });
});

// An engine that exits while its host is still starting (a dev reload) left the
// host running for hours: it read its parent after it had already been
// reparented (2026-10-30). The host watches the engine pid it was given.
void test("A host whose engine is already gone stops by itself", { skip: chrome === undefined ? "no Chrome for agent-browser (run `agent-browser install`)" : false }, async (t) => {
  process.env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
  const stateDir = await fs.mkdtemp("/tmp/bbxb-");
  const boxRoot = await fs.mkdtemp("/tmp/bbxbox-");
  t.teardown(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(boxRoot, { recursive: true, force: true });
  });
  const gone = spawn("true");
  const deadPid = gone.pid ?? 0;
  await new Promise((resolve) => gone.once("exit", resolve));
  const host = spawn(path.join(PACKAGE_ROOT, "bin", "bbx"), ["engine", "browser-host", "--box", boxRoot, "--state-dir", stateDir, "--engine-pid", String(deadPid)], { stdio: "ignore" });
  t.teardown(() => {
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGKILL");
  });
  const code = await new Promise<number | null>((resolve) => host.once("exit", resolve));
  t.check(code, 0);
});
