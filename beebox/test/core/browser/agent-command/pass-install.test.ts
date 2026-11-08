// Installing the box browser pass: once per host, refreshed when under 30
// minutes are left, with the cookie attributes that keep it to the box's own
// app, and a plain reason (never a throw) when it cannot be installed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ExecReply } from "../../../../src/core/browser/command-socket.js";
import { ensureBrowserPass, passCookieArgs } from "../../../../src/core/browser/agent-command/pass-install.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const DEV_ENV = { BBX_DEV_APP_URL: "http://localhost:3210/my-worktree" };

const DONE: ExecReply = { exitCode: 0, stdout: "✓ Done", stderr: "" };

function recorder(reply: ExecReply): { calls: string[][]; send: (args: readonly string[]) => Promise<ExecReply> } {
  const calls: string[][] = [];
  return { calls, send: (args) => { calls.push([...args]); return Promise.resolve(reply); } };
}

void test("the cookie is HttpOnly, Strict, and scoped to the app's path; Secure only on https", (t) => {
  const pass = { value: "v.sig", exp: NOW + 60 * MINUTE };
  t.check(
    {
      dev: passCookieArgs(new URL("http://localhost:3210/my-worktree"), pass),
      production: passCookieArgs(new URL("https://box.example.com"), pass),
    },
    {
      dev: ["cookies", "set", "bbx_browser_pass", "v.sig", "--url", "http://localhost:3210/my-worktree/", "--path", "/my-worktree/", "--httpOnly", "--sameSite", "Strict", "--expires", "1800003600"],
      production: ["cookies", "set", "bbx_browser_pass", "v.sig", "--url", "https://box.example.com/", "--path", "/", "--httpOnly", "--sameSite", "Strict", "--expires", "1800003600", "--secure"],
    },
  );
  t.end();
});

void test("a host gets one pass, and a new one only when under 30 minutes are left", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const host = {};
  const { calls, send } = recorder(DONE);
  const run = (now: number): ReturnType<typeof ensureBrowserPass> => ensureBrowserPass({ host, boxRoot: box.root, send, env: DEV_ENV, now });
  t.check(
    [await run(NOW), await run(NOW + 29 * MINUTE), await run(NOW + 31 * MINUTE)],
    [{ status: "installed" }, { status: "current" }, { status: "installed" }],
  );
  t.check(calls.map((args) => args.slice(0, 3)), [["cookies", "set", "bbx_browser_pass"], ["cookies", "set", "bbx_browser_pass"]]);
});

void test("no app URL, a remote plain-http URL, or a refused cookie is a reason, not a throw", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const ok = recorder(DONE);
  const refused = recorder({ exitCode: 1, stdout: "", stderr: "✗ cookie rejected" });
  const retryHost = {};
  t.check(
    {
      noUrl: await ensureBrowserPass({ host: {}, boxRoot: box.root, send: ok.send, env: {}, now: NOW }),
      plainHttp: await ensureBrowserPass({ host: {}, boxRoot: box.root, send: ok.send, env: { BBX_PUBLIC_URL: "http://box.example.com" }, now: NOW }),
      refused: await ensureBrowserPass({ host: retryHost, boxRoot: box.root, send: refused.send, env: DEV_ENV, now: NOW }),
      sentWhenNoUrl: ok.calls.length,
    },
    {
      noUrl: { status: "no-app-url", reason: "this box has no public URL, so its browser cannot open the box's pages" },
      plainHttp: { status: "no-app-url", reason: "the box browser needs an https public URL (or http on localhost): http://box.example.com" },
      refused: { status: "failed", reason: "the browser refused the box's pass: ✗ cookie rejected" },
      sentWhenNoUrl: 0,
    },
  );
  // A refused install is retried on the same host's next command: nothing was recorded.
  t.check(await ensureBrowserPass({ host: retryHost, boxRoot: box.root, send: ok.send, env: DEV_ENV, now: NOW }), { status: "installed" });
});
