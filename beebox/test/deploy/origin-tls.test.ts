// # Origin TLS guards
//
// Two scripts protect the Cloudflare-to-origin leg. `check-origin-tls-ref.sh`
// refuses to deploy a commit whose nginx site has no 443 listener, because
// Cloudflare connects on 443 and that deploy would take the site offline.
// It is not wired into deploy.sh until origin TLS is activated (docs/unimplemented-plans/origin-tls.md).
// `hetzner/origin-firewall.sh` writes the origin's firewall from Cloudflare's
// published ranges. These examples run both scripts for real, with fake `curl`
// and `hcloud` commands first on the PATH.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runFile(file: string, { args, env, cwd }: { args: string[]; env: NodeJS.ProcessEnv; cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
  const outcome = await execFileAsync(file, args, { env, cwd }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code?: number | string; stdout?: string; stderr?: string }) => ({
      code: typeof error.code === "number" ? error.code : -1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }),
  );
  return { code: outcome.code, stdout: outcome.stdout.trim(), stderr: outcome.stderr.trim() };
}

const checkRef = resolve("deploy/check-origin-tls-ref.sh");
const firewall = resolve("deploy/hetzner/origin-firewall.sh");

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", ...args]);
  return stdout.trim();
}

// ## Deploying an old commit
void test("the rollback guard reads the site of the ref being deployed", async (t) => {
  const repo = await mkdtemp(join(tmpdir(), "bbx-origin-ref-"));
  t.teardown(() => rm(repo, { recursive: true, force: true }));
  await mkdir(join(repo, "beebox/deploy/nginx"), { recursive: true });
  const site = join(repo, "beebox/deploy/nginx/beebox.conf");
  await git(repo, "init", "-q");
  await writeFile(site, "server {\n  listen 80;\n  # listen 443 ssl;\n}\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "port 80 only");
  const old = await git(repo, "rev-parse", "HEAD");
  await writeFile(site, "server {\n  listen 80;\n  listen 443 ssl default_server;\n}\n");
  await git(repo, "commit", "-qam", "adds tls");
  const current = await git(repo, "rev-parse", "HEAD");

  t.check(await runFile(checkRef, { args: [repo, current], env: process.env }), { code: 0, stdout: "", stderr: "" });

  t.check(await runFile(checkRef, { args: [repo, old], env: process.env }), {
    code: 1,
    stdout: "",
    stderr: `deploy: refusing ${old}: its nginx site has no 443 listener, and Cloudflare connects to the origin on 443.
deploy: this would take the site offline. See docs/server/provisioning.md, Origin TLS, before setting BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS=1.`,
  });

  // The override exists for an operator who has already returned Cloudflare to port 80.
  t.check(await runFile(checkRef, { args: [repo, old], env: { ...process.env, BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS: "1" } }), { code: 0, stdout: "", stderr: "" });
});

const FAKE_HCLOUD = `#!/bin/sh
echo "hcloud $*" >> "$FAKE_LOG"
case "$*" in
  "server describe"*) echo 42 ;;
  "firewall list"*) cat "$FAKE_LIST" ;;
  *rules-file*) cat >> "$FAKE_LOG"; echo >> "$FAKE_LOG" ;;
esac
`;

async function fakeTools(t: { teardown: (fn: () => Promise<void>) => void }, { ipv4, list }: { ipv4: string; list: string }) {
  const root = await mkdtemp(join(tmpdir(), "bbx-origin-fw-"));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const curl = `#!/bin/sh\ncase "$*" in *ips-v4) printf '%s' '${ipv4}' ;; *ips-v6) echo 2400:cb00::/32 ;; esac\n`;
  await writeFile(join(bin, "curl"), curl);
  await writeFile(join(bin, "hcloud"), FAKE_HCLOUD);
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "hcloud"), 0o755);
  await writeFile(join(root, "list"), list);
  const log = join(root, "log");
  await writeFile(log, "");
  return { log, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_LOG: log, FAKE_LIST: join(root, "list") } };
}

const everyone = ["0.0.0.0/0", "::/0"];
const cloudflare = ["173.245.48.0/20", "2400:cb00::/32"];
const closedRules = [
  { direction: "in", protocol: "tcp", port: "22", source_ips: everyone },
  { direction: "in", protocol: "icmp", source_ips: everyone },
  { direction: "in", protocol: "tcp", port: "443", source_ips: cloudflare },
];

// ## First run: create, then attach, with SSH open and port 80 closed
void test("the firewall is created with its rules before it is attached", async (t) => {
  const { log, env } = await fakeTools(t, { ipv4: "173.245.48.0/20\n", list: "null" });
  t.check(await runFile(firewall, { args: ["beebox"], env }), { code: 0, stdout: "", stderr: "" });
  t.check(await readFile(log, "utf8"), `hcloud server describe beebox -o format={{.ID}}
hcloud firewall list -o json
hcloud firewall create --name beebox-origin --rules-file -
${JSON.stringify(closedRules)}
hcloud firewall apply-to-resource --type server --server beebox beebox-origin
`);
});

// ## Re-run on an attached firewall, during the cutover
void test("a re-run replaces the rules, opens 80 only with the flag, and does not re-attach", async (t) => {
  const list = JSON.stringify([{ name: "beebox-origin", applied_to: [{ type: "server", server: { id: 42 } }] }]);
  const { log, env } = await fakeTools(t, { ipv4: "173.245.48.0/20\n", list });
  t.check(await runFile(firewall, { args: ["beebox", "--allow-http"], env }), { code: 0, stdout: "", stderr: "" });
  const withHttp = [...closedRules, { direction: "in", protocol: "tcp", port: "80", source_ips: cloudflare }];
  t.check(await readFile(log, "utf8"), `hcloud server describe beebox -o format={{.ID}}
hcloud firewall list -o json
hcloud firewall replace-rules --rules-file - beebox-origin
${JSON.stringify(withHttp)}
`);
});

// ## An error page in place of the ranges
//
// A proxy or Cloudflare error body must never reach the firewall: a wrong list
// takes the site offline.
void test("a range list that is not CIDRs writes nothing", async (t) => {
  const { log, env } = await fakeTools(t, { ipv4: "<html>blocked</html>", list: "null" });
  const result = await runFile(firewall, { args: ["beebox"], env });
  t.check(result, { code: 1, stdout: "", stderr: str`${any(String)}does not appear to be an IPv4 or IPv6 network` });
  t.check(await readFile(log, "utf8"), "");
});
