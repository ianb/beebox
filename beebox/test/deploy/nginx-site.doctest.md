# The deploy takes over the nginx site

`deploy/server-bin/bbx-nginx-site` installs `deploy/nginx/beebox.conf` as the
server's only enabled site, runs `nginx -t` every time, and reloads nginx when
it changed something. Production's live site was a hand-made file named
`callback` in `sites-enabled`, claiming `default_server` on port 80 like the
repo file does. The first deploy of this step enabled the repo file next to it,
which left a configuration nginx could no longer start with. These examples
run the helper against a real nginx, from that same layout.

This needs `nginx` on the PATH (`brew install nginx` on macOS).

```ts setup
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
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

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (address === null || typeof address === "string") throw new TypeError("no TCP address");
  return address.port;
}

const helper = resolve("deploy/server-bin/bbx-nginx-site");

/** A scratch /etc/nginx laid out like production before the takeover. */
async function productionLike() {
  const root = await mkdtemp(join(tmpdir(), "bbx-nginx-site-"));
  const etc = join(root, "etc");
  const pageDir = join(root, "run");
  await mkdir(join(etc, "sites-available"), { recursive: true });
  await mkdir(join(etc, "sites-enabled"));
  await mkdir(join(root, "logs"));
  await mkdir(pageDir);
  const port = await freePort();
  const upstreamPort = await freePort();
  const callback = `server { listen 127.0.0.1:${port} default_server; server_name _; location / { proxy_pass http://127.0.0.1:${upstreamPort}; } }\n`;
  await writeFile(join(etc, "sites-available/callback"), callback);
  await writeFile(join(etc, "sites-enabled/callback"), callback);
  await writeFile(join(etc, "nginx.conf"), [
    `pid ${join(root, "nginx.pid")};`,
    `error_log ${join(root, "logs/error.log")};`,
    "events {}",
    `http { access_log off; include ${join(etc, "sites-enabled")}/*; }`,
  ].join("\n"));
  const nginxBin = join(root, "nginx");
  await writeFile(nginxBin, `#!/bin/sh\nexec nginx -p "${root}" -c "${join(etc, "nginx.conf")}" "$@"\n`);
  await chmod(nginxBin, 0o755);
  let site = await readFile("deploy/nginx/beebox.conf", "utf8");
  site = site.replace("listen 80 default_server;", `listen 127.0.0.1:${port} default_server;`)
    .replace("listen [::]:80 default_server;", "")
    .replace("http://127.0.0.1:3210", `http://127.0.0.1:${upstreamPort}`)
    .replaceAll("/run/beebox-deploy", pageDir);
  const src = join(root, "beebox.conf");
  await writeFile(src, site);
  const env = { ...process.env, BBX_NGINX_ETC: etc, BBX_NGINX_BIN: nginxBin, BBX_NGINX_RELOAD: `${nginxBin} -s reload` };
  return { root, etc, pageDir, port, src, env, nginxBin };
}

async function enabled(etc: string): Promise<string> {
  const names = await readdir(join(etc, "sites-enabled"));
  const described = await Promise.all(names.map(async (name) => {
    const path = join(etc, "sites-enabled", name);
    return (await lstat(path)).isSymbolicLink() ? `${name} -> ${await readlink(path)}` : name;
  }));
  return described.join(", ");
}

async function statusWithPage(port: number): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/any/path`);
    await response.text();
    if (response.headers.get("x-beebox-deploy") === "in-progress") return response.status;
    await new Promise((done) => setTimeout(done, 50));
  }
  return -1;
}
```

## From the old layout to the repo site

nginx runs on the old `callback` site. The helper installs the repo site,
moves `callback` aside, tests, and reloads; with a deploy page present, the
running nginx now serves it.

```ts
const p = await productionLike();
await runFile(p.nginxBin, [], p.env);
await writeFile(join(p.pageDir, "deploy-in-progress.html"), "<h1>updating</h1>");
const first = await runFile(helper, ["install", p.src], p.env);
[first.code, ...first.stdout.replace(/callback\.\d{8}T\d{6}Z/, "callback.STAMP").replaceAll(p.etc, "ETC").split("\n").map((line) => line.trim())].join("\n")
=> 0
nginx: installed the repo site file
nginx: disabled ETC/sites-enabled/callback (kept as ETC/pre-deploy-owned/callback.STAMP)
nginx: reloaded

await enabled(p.etc)
=> beebox -> «*»/sites-available/beebox

await statusWithPage(p.port)
=> 503
```

A second deploy with nothing to change still tests the configuration, prints
nothing, and does not reload.

```ts continue
const again = await runFile(helper, ["install", p.src], p.env);
[again.code, again.stdout].join("|")
=> 0|
```

```ts cleanup
await runFile(p.nginxBin, ["-s", "stop"], p.env);
await rm(p.root, { recursive: true, force: true });
```

## The state the first deploy left behind

Production after the failed first deploy: the repo site enabled next to
`callback`, both `default_server`, so `nginx -t` fails. The helper repairs it.
(nginx cannot start on this configuration, so here the reload is a no-op; in
production the running master still holds the older configuration.)

```ts
const q = await productionLike();
await runFile("cp", [q.src, join(q.etc, "sites-available/beebox")], q.env);
await runFile("ln", ["-s", join(q.etc, "sites-available/beebox"), join(q.etc, "sites-enabled/beebox")], q.env);
(await runFile(q.nginxBin, ["-t", "-q"], q.env)).stderr.includes("duplicate default server")
=> true

const repaired = await runFile(helper, ["install", q.src], { ...q.env, BBX_NGINX_RELOAD: "true" });
[repaired.code, repaired.stdout.includes("disabled"), repaired.stdout.includes("installed")].join(" ")
=> 0 true false

await enabled(q.etc)
=> beebox -> «*»/sites-available/beebox
```

```ts cleanup
await rm(q.root, { recursive: true, force: true });
```

## A site nginx rejects

When the new configuration fails `nginx -t`, both site directories come back
exactly as they were, nothing is reloaded, and the deploy fails before
anything stops.

```ts
const r = await productionLike();
await writeFile(r.src, "server { this is not nginx; }\n");
const rejected = await runFile(helper, ["install", r.src], r.env);
[rejected.code, rejected.stderr.includes("restored the previous sites")].join(" ")
=> 1 true

[await enabled(r.etc), (await readdir(join(r.etc, "sites-available"))).join(","), (await readdir(r.etc)).includes("pre-deploy-owned") ? (await readdir(join(r.etc, "pre-deploy-owned"))).length : 0].join(" | ")
=> callback | callback | 0
```

```ts cleanup
await rm(r.root, { recursive: true, force: true });
```

The deploy runs the helper by absolute path, and the helper names nginx by
absolute path: the activation script has the box user's PATH, which omits
`/usr/sbin`.

```ts
const deploySh = await readFile("deploy/deploy.sh", "utf8");
const helperSh = await readFile(helper, "utf8");
[deploySh.includes('/usr/local/sbin/bbx-nginx-site install "$stage_dir/beebox/deploy/nginx/beebox.conf"'), helperSh.includes('nginx_bin="${BBX_NGINX_BIN:-/usr/sbin/nginx}"')].join(" ")
=> true true
```
