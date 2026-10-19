// # The deploy takes over the nginx site
//
// `deploy/server-bin/bbx-nginx-site` installs `deploy/nginx/beebox.conf` as the
// server's only enabled site, runs `nginx -t` every time, and reloads nginx when
// it changed something. Production's live site was a hand-made file named
// `callback` in `sites-enabled`, claiming `default_server` on port 80 like the
// repo file does. The first deploy of this step enabled the repo file next to it,
// which left a configuration nginx could no longer start with. These examples
// run the helper against a real nginx, from that same layout.
//
// This needs `nginx` on the PATH (`brew install nginx` on macOS).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
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

/** One GET on a connection of its own (`agent: false`), resolving to the
 *  status and the deploy-page header. A pooled keep-alive connection is what
 *  failed here: fetch reused an idle socket held by a worker the reload was
 *  retiring, and the worker closed it under the next request (ECONNRESET on
 *  2026-10-09, UND_ERR_SOCKET "other side closed" on 2026-10-17). A fresh
 *  connection is accepted by whichever workers hold the listener now. */
async function getOnce(port: number): Promise<{ status: number; deployPage: string | undefined }> {
  return new Promise((done, fail) => {
    const req = httpGet({ host: "127.0.0.1", port, path: "/any/path", agent: false }, (res) => {
      res.resume();
      res.on("end", () => {
        const header = res.headers["x-beebox-deploy"];
        done({ status: res.statusCode ?? -1, deployPage: typeof header === "string" ? header : undefined });
      });
      res.on("error", fail);
    });
    req.on("error", fail);
  });
}

/** Poll until the reloaded configuration serves the deploy page; until then
 *  the old configuration answers. */
async function statusWithPage(port: number): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await getOnce(port);
    if (response.deployPage === "in-progress") return response.status;
    await new Promise((done) => setTimeout(done, 50));
  }
  return -1;
}

// ## From the old layout to the repo site
//
// nginx runs on the old `callback` site. The helper installs the repo site,
// moves `callback` aside, tests, and reloads; with a deploy page present, the
// running nginx now serves it.
void test("nginx runs on the old callback site.", async (t) => {
  t.teardown(async () => {
    try {
      await runFile(p.nginxBin, { args: ["-s", "stop"], env: p.env });
      await rm(p.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const p = await productionLike();
  await runFile(p.nginxBin, { args: [], env: p.env });
  await writeFile(join(p.pageDir, "deploy-in-progress.html"), "<h1>updating</h1>");
  const first = await runFile(helper, { args: ["install", p.src], env: p.env });
  t.check(first, {
    code: 0,
    stdout: str`nginx: installed the repo site file
  nginx: disabled ${p.etc}/sites-enabled/callback (kept as ${p.etc}/pre-deploy-owned/callback.${any(String).matches(/^\d{8}T\d{6}Z$/)})
  nginx: reloaded`,
    stderr: "",
  });

  t.check(await enabled(p.etc), str`beebox -> ${any(String)}/sites-available/beebox`);

  t.check(await statusWithPage(p.port), 503);

  // A second deploy with nothing to change still tests the configuration, prints
  // nothing, and does not reload.

  const again = await runFile(helper, { args: ["install", p.src], env: p.env });
  t.check(again, { code: 0, stdout: "", stderr: any(String) });
});

// ## The state the first deploy left behind
//
// Production after the failed first deploy: the repo site enabled next to
// `callback`, both `default_server`, so `nginx -t` fails. The helper repairs it.
// (nginx cannot start on this configuration, so here the reload is a no-op; in
// production the running master still holds the older configuration.)
void test("Production after the failed first deploy:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(q.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const q = await productionLike();
  await runFile("cp", { args: [q.src, join(q.etc, "sites-available/beebox")], env: q.env });
  await runFile("ln", { args: ["-s", join(q.etc, "sites-available/beebox"), join(q.etc, "sites-enabled/beebox")], env: q.env });
  t.check(await runFile(q.nginxBin, { args: ["-t", "-q"], env: q.env }), {
    code: 1,
    stdout: "",
    stderr: `nginx: [emerg] a duplicate default server for 127.0.0.1:${String(q.port)} in ${q.etc}/sites-enabled/callback:1
nginx: configuration file ${q.etc}/nginx.conf test failed`,
  });

  const repaired = await runFile(helper, { args: ["install", q.src], env: { ...q.env, BBX_NGINX_RELOAD: "true" } });
  t.check(repaired, {
    code: 0,
    stdout: str`nginx: disabled ${q.etc}/sites-enabled/callback (kept as ${q.etc}/pre-deploy-owned/callback.${any(String).matches(/^\d{8}T\d{6}Z$/)})
  nginx: reloaded`,
    stderr: "",
  });

  t.check(await enabled(q.etc), str`beebox -> ${any(String)}/sites-available/beebox`);
});

// ## A site nginx rejects
//
// When the new configuration fails `nginx -t`, both site directories come back
// exactly as they were, nothing is reloaded, and the deploy fails before
// anything stops.
void test("When the new configuration fails nginx -t, both site directories come back ex...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(r.root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const r = await productionLike();
  await writeFile(r.src, "server { this is not nginx; }\n");
  const rejected = await runFile(helper, { args: ["install", r.src], env: r.env });
  t.check(rejected, {
    code: 1,
    stdout: str`nginx: installed the repo site file
  nginx: disabled ${r.etc}/sites-enabled/callback (kept as ${r.etc}/pre-deploy-owned/callback.${any(String).matches(/^\d{8}T\d{6}Z$/)})`,
    stderr: `nginx: [emerg] unknown directive "this" in ${r.etc}/sites-enabled/beebox:1
nginx: configuration file ${r.etc}/nginx.conf test failed
  FAILED: nginx -t rejects the configuration with the repo site; restored the previous sites.`,
  });

  t.check(
    {
      enabled: await enabled(r.etc),
      available: await readdir(join(r.etc, "sites-available")),
      etc: await readdir(r.etc),
      preDeployOwned: await readdir(join(r.etc, "pre-deploy-owned")),
    },
    {
      enabled: "callback",
      available: ["callback"],
      etc: ["nginx.conf", "pre-deploy-owned", "sites-available", "sites-enabled"],
      preDeployOwned: [],
    },
  );
});

// The deploy runs the helper by absolute path, and the helper names nginx by
// absolute path: the activation script has the box user's PATH, which omits
// `/usr/sbin`.
void test("The deploy runs the helper by absolute path, and the helper names nginx by ab...", async (t) => {
  const deploySh = await readFile("deploy/deploy.sh", "utf8");
  const helperSh = await readFile(helper, "utf8");
  // Both are whole shell scripts: a narrow check on the one line under test in each.
  t.check(deploySh, any(String).includes('/usr/local/sbin/bbx-nginx-site install "$stage_dir/beebox/deploy/nginx/beebox.conf"'));
  t.check(helperSh, any(String).includes('nginx_bin="${BBX_NGINX_BIN:-/usr/sbin/nginx}"'));
});
