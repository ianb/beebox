# The deploy window

`deploy/server-bin/bbx-deploy-window` puts the deploy page up before a
production deploy stops the services, and takes it down when the deploy's
server-side activation script exits. The page's presence is what tells nginx
that a 502 is a deploy, so it must never outlive the deploy. The helper also
records each window, and the median of recent successful windows becomes the
page's "updates usually take" estimate.

These examples run the real helper against temporary directories in place of
`/run/beebox-deploy` and `/var/lib/beebox-deploy`.

```ts setup
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Run a file to completion; a nonzero exit is a result here, not a rejection. */
function runFile(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(file, args, { env }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
      done({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
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
  return runFile(helper, args, env);
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}
```

## Open, down, close

`open` writes the filled page, readable by the nginx worker. With no history,
the estimate is `null` and the page says "a few minutes".

```ts
const d = await tempDirs();
(await run(d.env, "open", d.template)).code
=> 0

const page = await readFile(d.page, "utf8");
/<p>\d{4}-\d\d-\d\d \d\d:\d\d UTC<\/p><script>\{"startedMs":\d{13},"typicalSeconds":null\}<\/script>/.test(page)
=> true

((await stat(d.page)).mode & 0o777).toString(8)
=> 644
```

`close` removes the page, appends the window, and reports the downtime on a
line the laptop side reads back for its own record.

```ts continue
(await run(d.env, "down")).code
=> 0

const closed = await run(d.env, "close", "0");
closed.stdout
=> Deploy window: down «int»s (ok)

await exists(d.page)
=> false

(await readFile(d.history, "utf8")).split("\t")[3]
=> ok
```

A failed activation closes the window too, recorded as failed.

```ts continue
await run(d.env, "open", d.template);
await run(d.env, "down");
(await run(d.env, "close", "1")).stdout
=> Deploy window: down «int»s (failed)

[await exists(d.page), (await readFile(d.history, "utf8")).trim().split("\n").map((line) => line.split("\t")[3]).join(",")].join(" ")
=> false ok,failed
```

```ts cleanup
await rm(d.root, { recursive: true, force: true });
```

## The estimate and a stranded window

The estimate is the median of the last ten successful windows. Failed,
abandoned, and malformed lines do not count.

```ts
const e = await tempDirs();
await run(e.env, "open", e.template);
await run(e.env, "close", "0");
const lines = [
  "100\t110\t330\tok", "200\t210\t450\tok", "300\t310\t510\tok",
  "400\t410\t9000\tfailed", "garbage", "500\t-\t-\tabandoned",
];
await writeFile(e.history, lines.join("\n") + "\n");
await run(e.env, "open", e.template);
(await readFile(e.page, "utf8")).includes('"typicalSeconds":220')
=> true
```

A deploy killed outright leaves its window open. The next `open` replaces the
page and records the lost window as abandoned instead of dropping it.

```ts continue
await run(e.env, "open", e.template);
(await readFile(e.history, "utf8")).trim().split("\n").at(-1)!.split("\t").slice(1).join(" ")
=> - - abandoned
```

A trap that fires before any window was opened has nothing to record, and a
missing template fails loudly before anything stops.

```ts continue
await run(e.env, "close", "0");
(await run(e.env, "close", "0")).code
=> 0

(await run(e.env, "open", join(e.root, "missing.html"))).stderr
=> bbx-deploy-window: page template missing or empty: «*»missing.html
```

```ts cleanup
await rm(e.root, { recursive: true, force: true });
```

## The activation script's trap

`deploy.sh` writes an EXIT trap and signal traps at the top of the server-side
activation script. Here the same lines, taken from `deploy.sh`, run around a
step that fails: the window closes, and the script keeps its own exit code, so
the deploy still fails.

```ts
const deploySh = await readFile("deploy/deploy.sh", "utf8");
const trapLines = deploySh.match(/<<'WINDOW'\n([\s\S]*?)\nWINDOW\n/)![1]!;
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
  return runFile("bash", [script], f.env);
}

const failedRun = await activation("false");
[failedRun.code, failedRun.stdout.replace(/\d+s/, "Ns"), await exists(f.page)].join(" | ")
=> 1 | Deploy window: down Ns (failed) | false
```

A SIGTERM to the activation script is turned into an ordinary exit, so the
EXIT trap still runs and the page comes down. So is a SIGPIPE, which is what
the script gets when the laptop's ssh session drops mid-deploy.

```ts continue
const signalled = await activation("kill -TERM $$; sleep 5");
[signalled.code, signalled.stdout.replace(/\d+s/, "Ns"), await exists(f.page)].join(" | ")
=> 143 | Deploy window: down Ns (failed) | false

const piped = await activation("kill -PIPE $$; sleep 5");
[piped.code, await exists(f.page)].join(" | ")
=> 141 | false

const okRun = await activation("true");
[okRun.code, okRun.stdout.replace(/\d+s/, "Ns"), await exists(f.page)].join(" | ")
=> 0 | Deploy window: down Ns (ok) | false
```

```ts cleanup
await rm(f.root, { recursive: true, force: true });
```
