// # `bbx browser`: agent-browser arguments go to the box's exec route untouched
//
// docs/plans/shared-browser.md, Track D. The command posts its arguments to
// `POST /<slug>/api/browser/exec` with the agent bearer and prints what came
// back, with agent-browser's exit code; a refusal from the server goes to
// stderr with exit code 1. The server here is a real box server with the auth
// wall up; only the browser host behind it is substituted, by a fake command
// socket that echoes the arguments it received.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import net from "node:net";
import { makeTestServer, TEST_SLUG } from "../../../helpers/test-route-server.js";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";
import { browserPaths, type BrowserPaths } from "../../../../src/core/browser/paths.js";
import type { BrowserHostHandle } from "../../../../src/core/browser/host/start.js";
import { browserCommand, BROWSER_USAGE } from "../../../../src/cli/commands/browser/command.js";
import { selectVerb, surfaceKeys } from "../../../../src/cli/entry/select-verb.js";
import { SURFACE } from "../../../../src/cli/entry/surface-data.js";

/** A command socket that answers each request with its own arguments, exit code 3. */
async function echoCommandSocket(paths: BrowserPaths): Promise<() => Promise<void>> {
  await fs.mkdir(paths.root, { recursive: true });
  const server = net.createServer({ allowHalfOpen: true }, (conn) => {
    let text = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk: string) => (text += chunk));
    conn.on("end", () => {
      // eslint-disable-next-line no-restricted-syntax -- the test's own client wrote this request
      const { args } = JSON.parse(text) as { args: string[] };
      conn.end(`${JSON.stringify({ exitCode: 3, stdout: `${args.join(" ")}\n`, stderr: "warning\n" })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(paths.cliSocket, resolve));
  return () => new Promise((resolve) => server.close(() => resolve()));
}

const SHELL_VARS = ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"] as const;

async function boxServer(t: Test): Promise<void> {
  const saved = SHELL_VARS.map((name) => [name, process.env[name]] as const);
  const stateDir = await fs.mkdtemp("/tmp/bbxc-");
  const ctx = await makeTestServer({
    openAccess: false,
    services: {
      browserHost: async (input) => {
        const handle: BrowserHostHandle = { paths: browserPaths({ ...input, stateDir }), pid: 1 };
        return handle;
      },
    },
  });
  const closeSocket = await echoCommandSocket(browserPaths({ boxRoot: ctx.boxRoot, slug: TEST_SLUG, stateDir }));
  process.env.BBX_SERVER_URL = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  process.env.BBX_BOX_NAME = TEST_SLUG;
  process.env.BBX_AGENT_TOKEN = getOrCreateAgentToken(ctx.boxRoot);
  t.teardown(async () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeSocket();
    await ctx.cleanup();
    await fs.rm(stateDir, { recursive: true, force: true });
  });
}

/** Run `bbx browser <argv>` in-process and collect what it printed and its exit code. */
async function runBrowser(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | string | undefined }> {
  const out = { stdout: "", stderr: "" };
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    out.stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    out.stderr += String(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    await browserCommand.parseAsync(argv, { from: "user" });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return { ...out, exitCode };
}

// `snapshot -i` keeps its option: unknown options are agent-browser's, not bbx's.
void test("Arguments reach agent-browser as given, and its output and exit code come back", async (t) => {
  await boxServer(t);
  t.check(await runBrowser(["snapshot", "-i"]), { stdout: "snapshot -i\n", stderr: "warning\n", exitCode: 3 });
});

// `browser-host` is an engine verb; `bbx browser host --x` must not reach it.
// The run selects the `browser` module, and `host --x` is passed along like
// any other arguments (agent-browser then reports `host` as unknown).
void test("`bbx browser host --x` is agent-browser's arguments, not the engine verb", async (t) => {
  await boxServer(t);
  t.check(selectVerb(["browser", "host", "--x"], surfaceKeys(SURFACE)), { kind: "verb", key: "browser" });
  t.check(await runBrowser(["host", "--x"]), { stdout: "host --x\n", stderr: "warning\n", exitCode: 3 });
});

void test("A refusal from the server goes to stderr with exit code 1", async (t) => {
  await boxServer(t);
  t.check(await runBrowser(["--cdp", "9222", "open", "https://example.com"]), {
    stdout: "",
    stderr: "bbx browser: --cdp is fixed for the box browser; the box uses one browser profile (HTTP 400)\n",
    exitCode: 1,
  });
});

void test("With no arguments it prints the short help", async (t) => {
  t.check(await runBrowser([]), { stdout: BROWSER_USAGE, stderr: "", exitCode: undefined });
});
