// # The deploy window
//
// `deploy/server-bin/bbx-deploy-window` puts the deploy page up before a
// production deploy stops the services, and takes it down when the deploy's
// server-side activation script exits. The page's presence is what tells nginx
// that a 502 is a deploy, so it must never outlive the deploy. The helper also
// records each window, and the median of recent successful windows becomes the
// page's "updates usually take" estimate.
//
// These examples run the real helper against temporary directories in place of
// `/run/beebox-deploy` and `/var/lib/beebox-deploy`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Run a file to completion; a nonzero exit is a result here, not a rejection. */
async function runFile(file: string, { args, env }: { args: string[]; env: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string; stderr: string }> {
  const outcome = await execFileAsync(file, args, { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code?: number | string; stdout?: string; stderr?: string }) => ({
      code: typeof error.code === "number" ? error.code : -1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }),
  );
  return { code: outcome.code, stdout: outcome.stdout.trim(), stderr: outcome.stderr.trim() };
}

const helper = resolve("deploy/server-bin/bbx-deploy-window");

async function tempDirs() {
  const root = await mkdtemp(join(tmpdir(), "bbx-deploy-window-"));
  const env = { ...process.env, BBX_DEPLOY_WINDOW_RUN_DIR: join(root, "run"), BBX_DEPLOY_WINDOW_STATE_DIR: join(root, "state") };
  const template = join(root, "template.html");
  await writeFile(template, "<p>__BBX_STARTED_UTC__</p><script>{\"startedMs\":__BBX_STARTED_MS__,\"typicalSeconds\":__BBX_TYPICAL_SECONDS__}</script>");
  return { root, env, template, page: join(root, "run/deploy-in-progress.html"), history: join(root, "state/windows.tsv") };
}

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return runFile(helper, { args, env });
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}

const seconds = any(String).matches(/^-?\d+$/);
const epoch = any(String).matches(/^\d{10}$/);
const startedUtc = any(String).matches(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
const startedMs = any(String).matches(/^\d{13}$/);

// ## Open, down, close
//
// `open` writes the filled page, readable by the nginx worker. With no history,
// the estimate is `null` and the page says "a few minutes".
void test("open writes the filled page, readable by the nginx worker.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(d.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L54
  const d = await tempDirs();
  t.check(await run(d.env, "open", d.template), { code: 0, stdout: "", stderr: "" });

  // doctest:L58
  const page = await readFile(d.page, "utf8");
  t.check(page, str`<p>${startedUtc}</p><script>{"startedMs":${startedMs},"typicalSeconds":null}</script>`);

  // doctest:L62
  await t.checkText(((await stat(d.page)).mode & 0o777).toString(8), "644");

  // `close` removes the page, appends the window, and reports the downtime on a
  // line the laptop side reads back for its own record.

  // doctest:L70
  t.check(await run(d.env, "down"), { code: 0, stdout: "", stderr: "" });

  // doctest:L73
  const closed = await run(d.env, "close", "0");
  t.check(closed, { code: 0, stdout: str`Deploy window: down ${seconds}s (ok)`, stderr: "" });

  // doctest:L77
  t.check(await exists(d.page), false);

  // doctest:L80
  t.check(await readFile(d.history, "utf8"), str`${epoch}\t${epoch}\t${epoch}\tok\n`);

  // A failed activation closes the window too, recorded as failed.

  // doctest:L87
  await run(d.env, "open", d.template);
  await run(d.env, "down");
  t.check(await run(d.env, "close", "1"), { code: 0, stdout: str`Deploy window: down ${seconds}s (failed)`, stderr: "" });

  // doctest:L92
  t.check(await exists(d.page), false);
  t.check(await readFile(d.history, "utf8"), str`${epoch}\t${epoch}\t${epoch}\tok\n${epoch}\t${epoch}\t${epoch}\tfailed\n`);
});

// ## The estimate and a stranded window
//
// The estimate is the median of the last ten successful windows. Failed,
// abandoned, and malformed lines do not count.
void test("The estimate is the median of the last ten successful windows.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(e.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L106
  const e = await tempDirs();
  await run(e.env, "open", e.template);
  await run(e.env, "close", "0");
  const lines = [
    "100\t110\t330\tok", "200\t210\t450\tok", "300\t310\t510\tok",
    "400\t410\t9000\tfailed", "garbage", "500\t-\t-\tabandoned",
  ];
  await writeFile(e.history, lines.join("\n") + "\n");
  await run(e.env, "open", e.template);
  t.check(await readFile(e.page, "utf8"), str`<p>${startedUtc}</p><script>{"startedMs":${startedMs},"typicalSeconds":220}</script>`);

  // A deploy killed outright leaves its window open. The next `open` replaces the
  // page and records the lost window as abandoned instead of dropping it.

  // doctest:L123
  await run(e.env, "open", e.template);
  t.check(await readFile(e.history, "utf8"), str`${lines.join("\n")}\n${epoch}\t-\t-\tabandoned\n`);

  // A trap that fires before any window was opened has nothing to record, and a
  // missing template fails loudly before anything stops.

  // doctest:L132
  await run(e.env, "close", "0");
  t.check(await run(e.env, "close", "0"), { code: 0, stdout: "", stderr: "" });

  // doctest:L136
  t.check(await run(e.env, "open", join(e.root, "missing.html")), {
    code: 1,
    stdout: "",
    stderr: `bbx-deploy-window: page template missing or empty: ${join(e.root, "missing.html")}`,
  });
});

// ## The activation script's trap
//
// `deploy.sh` writes an EXIT trap and signal traps at the top of the server-side
// activation script. Here the same lines, taken from `deploy.sh`, run around a
// step that fails: the window closes, and the script keeps its own exit code, so
// the deploy still fails.
void test("deploy.sh writes an EXIT trap and signal traps at the top of the server-side...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(f.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L152
  const deploySh = await readFile("deploy/deploy.sh", "utf8");
  const trapLines = deploySh.match(/<<'WINDOW'\n([\S\s]*?)\nWINDOW\n/)![1]!;
  const f = await tempDirs();
  async function activation(body: string) {
    const script = join(f.root, "activate.sh");
    await writeFile(script, [
      "set -euo pipefail",
      trapLines.replaceAll("/usr/local/sbin/bbx-deploy-window", helper),
      `${helper} open ${f.template}`,
      `${helper} down`,
      body,
    ].join("\n"));
    await chmod(script, 0o755);
    return runFile("bash", { args: [script], env: f.env });
  }

  // doctest:L168
  const failedRun = await activation("false");
  t.check(failedRun, { code: 1, stdout: str`Deploy window: down ${seconds}s (failed)`, stderr: "" });
  t.check(await exists(f.page), false);

  // A SIGTERM to the activation script is turned into an ordinary exit, so the
  // EXIT trap still runs and the page comes down. So is a SIGPIPE, which is what
  // the script gets when the laptop's ssh session drops mid-deploy.

  // doctest:L178
  const signalled = await activation("kill -TERM $$; sleep 5");
  t.check(signalled, { code: 143, stdout: str`Deploy window: down ${seconds}s (failed)`, stderr: "" });
  t.check(await exists(f.page), false);

  // doctest:L182
  const piped = await activation("kill -PIPE $$; sleep 5");
  t.check(piped, { code: 141, stdout: str`Deploy window: down ${seconds}s (failed)`, stderr: "" });
  t.check(await exists(f.page), false);

  // doctest:L186
  const okRun = await activation("true");
  t.check(okRun, { code: 0, stdout: str`Deploy window: down ${seconds}s (ok)`, stderr: "" });
  t.check(await exists(f.page), false);
});
