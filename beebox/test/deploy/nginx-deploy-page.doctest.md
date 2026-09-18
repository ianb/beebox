# nginx serves the deploy page only during a deploy

`deploy/nginx/beebox.conf` is the production nginx site, installed by every
deploy. When the hub is not listening, nginx answers 502. If a deploy has put
its page in `/run/beebox-deploy/`, nginx answers 503 with that page instead;
otherwise the plain 502 stands, because a hub that is down without a deploy is
an outage. A 503 the hub sends itself passes through untouched.

These examples start a real nginx on the repository file. Only the listen
port, the upstream port, and the page directory are changed. This needs
`nginx` on the PATH (`brew install nginx` on macOS).

```ts setup
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (address === null || typeof address === "string") throw new TypeError("no TCP address");
  return address.port;
}

/** Replace `from` in `text`, requiring exactly `count` occurrences so drift in the site file fails here. */
function substitute(text: string, from: string, to: string, count: number): string {
  const found = text.split(from).length - 1;
  if (found !== count) throw new RangeError(`expected ${count} of ${JSON.stringify(from)} in beebox.conf, found ${found}`);
  return text.replaceAll(from, to);
}

async function get(port: number, init: RequestInit & { path?: string } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${init.path ?? "/some/box/page"}`, init);
  const body = await response.text();
  return {
    status: response.status,
    body,
    cache: response.headers.get("cache-control"),
    retryAfter: response.headers.get("retry-after"),
    deploy: response.headers.get("x-beebox-deploy"),
  };
}
```

```ts
const root = await mkdtemp(join(tmpdir(), "bbx-nginx-"));
const pageDir = join(root, "run");
await mkdir(join(root, "logs"), { recursive: true });
await mkdir(pageDir);
const port = await freePort();
const upstreamPort = await freePort();
let site = await readFile("deploy/nginx/beebox.conf", "utf8");
site = substitute(site, "listen 80 default_server;", `listen 127.0.0.1:${port};`, 1);
site = substitute(site, "listen [::]:80 default_server;", "", 1);
site = substitute(site, "http://127.0.0.1:3210", `http://127.0.0.1:${upstreamPort}`, 1);
site = substitute(site, "/run/beebox-deploy", pageDir, 2);
await writeFile(join(root, "nginx.conf"), [
  `pid ${join(root, "nginx.pid")};`,
  `error_log ${join(root, "logs/error.log")};`,
  "events {}",
  `http { access_log off; ${site} }`,
].join("\n"));
const nginx = ["-p", root, "-c", join(root, "nginx.conf")];
await execFileAsync("nginx", [...nginx, "-t", "-q"]);
await execFileAsync("nginx", nginx);
let upstream: Server | undefined;
```

With the hub down and no deploy page, a visitor gets the plain 502.

```ts continue
const outage = await get(port);
[outage.status, outage.body.includes("502 Bad Gateway"), String(outage.deploy)].join(" ")
=> 502 true null
```

With the page in place, every method gets a 503 carrying the page, marked
uncacheable, with the header the open page polls for.

```ts continue
await writeFile(join(pageDir, "deploy-in-progress.html"), "<h1>This site is updating</h1>");
const during = await get(port);
[during.status, during.body, during.cache, during.retryAfter, during.deploy].join(" | ")
=> 503 | <h1>This site is updating</h1> | no-store | 30 | in-progress

const posted = await get(port, { method: "POST", body: "{}" });
[posted.status, posted.body].join(" ")
=> 503 <h1>This site is updating</h1>

const head = await get(port, { method: "HEAD" });
[head.status, head.deploy].join(" ")
=> 503 in-progress
```

The page's internal address is not reachable from outside.

```ts continue
(await get(port, { path: "/__bbx_deploy_in_progress.html" })).status
=> 404
```

Once the hub listens, its own answers pass through, including its own 503,
even while a page file exists.

```ts continue
upstream = createServer((_request, response) => {
  response.writeHead(503, { "content-type": "application/json" }).end('{"error":"box_unavailable"}');
});
await new Promise<void>((done) => upstream!.listen(upstreamPort, "127.0.0.1", done));
const hub503 = await get(port);
[hub503.status, hub503.body, String(hub503.deploy)].join(" ")
=> 503 {"error":"box_unavailable"} null
```

```ts cleanup
upstream?.close();
await execFileAsync("nginx", [...nginx, "-s", "stop"]).catch((error: unknown) => console.warn("nginx stop failed", error));
await rm(root, { recursive: true, force: true });
```

The deploy's install step runs with the box user's PATH, which omits
`/usr/sbin`, so it names nginx by absolute path. A bare `nginx` there failed the
first deploy of this step with "command not found".

```ts
const deployScript = await readFile("deploy/deploy.sh", "utf8");
[deployScript.includes("if ! /usr/sbin/nginx -t -q; then"), /^\s*(if ! )?nginx /m.test(deployScript)].join(" ")
=> true false
```
