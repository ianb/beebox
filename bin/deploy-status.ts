/**
 * `bin/deploy-status [--json]` — what is deployed, did the last deploy work,
 * is one running, is prod healthy, are migrations pending, is the disk full.
 *
 * READ-ONLY. It never deploys, restarts, migrates, or writes anything, here or
 * on the server. Sources:
 *
 *   - Local, from the MAIN checkout (deploy.sh keys its state there, whichever
 *     tree invoked it): `beebox/deploy/.deploy-logs/deploys.jsonl` (one record
 *     per deploy that took the lock), `beebox/deploy/.last-deployed-sha` (the
 *     success marker), `.deploy-checkout.lock/pid` (the latest-wins lock), and
 *     `.deploy-requested`.
 *   - Remote, over ONE `ssh` to the target `beebox/deploy/deploy-target.sh`
 *     names (falling back to the main checkout's `target.env`):
 *     `/opt/beebox/beebox/deploy-info.json`, `df -Pk /`, `systemctl is-active`,
 *     the hub's passive `/healthz` with the diag key (never `/healthz/canary`,
 *     which cold-starts a box), and per box `bbx engine migrate --status
 *     --json` as the `beebox` user with `/home/beebox/.env` sourced — the same
 *     invocation shape the deploy sweep uses. That flag path reads the
 *     manifest and question cards only and takes no box-work admission.
 *
 * Each section degrades on its own to a one-line reason. Exit status is 0
 * whenever a report was printed; read the report, not the code.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deployTarget } from "./deploy-target.js";
import {
  available,
  degraded,
  parseDeployInfo,
  parseDf,
  parseDivergence,
  parseHealth,
  parseLastDeployRecord,
  parseMigrations,
  section,
  splitSections,
  type CommitsReport,
  type DeployRecord,
  type DeployStatusReport,
  type Divergence,
  type LockState,
  type Section,
} from "./deploy-status-lib.js";
import { renderText } from "./deploy-status-render.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Runs on the server as root. Every step is a read; the per-box status runs as
 * `beebox` so nothing it might touch changes owner. Prints `@@section` markers
 * the local side splits on. The diag key goes to curl on stdin, not argv.
 */
const REMOTE_SCRIPT = String.raw`
set -u -o pipefail
echo "@@section deploy-info"
cat /opt/beebox/beebox/deploy-info.json 2>/dev/null || echo "@@error /opt/beebox/beebox/deploy-info.json is missing or unreadable"
echo "@@section disk"
df -Pk / 2>&1 || echo "@@error df -Pk / failed"
echo "@@section services"
systemctl is-active beebox-hub beebox-scheduler 2>&1 || true
echo "@@section healthz"
KEY=$(grep -E '^BBX_DIAG_API_KEY=' /home/beebox/.env 2>/dev/null | cut -d= -f2- || true)
if [ -z "$KEY" ]; then
  echo "@@error BBX_DIAG_API_KEY is not set in /home/beebox/.env"
else
  printf 'Authorization: Bearer %s\n' "$KEY" | curl -s --connect-timeout 5 --max-time 15 -H @- -w '\n%{http_code}\n' http://127.0.0.1:3210/healthz || echo "000"
fi
unset KEY
echo "@@section migrations"
for boxdir in /home/beebox/boxes/*/; do
  [ -e "$boxdir/.git" ] || continue
  echo "@@box $(basename "$boxdir")"
  sudo -u beebox -H bash -lc 'set -a; source /home/beebox/.env 2>/dev/null; set +a; cd "$1" && timeout 60 bbx engine migrate --status --json' bbx-status "$boxdir" 2>&1 | tail -n 3
  echo "@@rc $?"
done
echo "@@section end"
`;

function git(args: string[]): string | null {
  const result = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function mainCheckout(): string | null {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common === null ? null : path.dirname(common);
}

function readIfPresent(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function lastNonEmptyLine(text: string | null): string | null {
  return text?.split("\n").findLast((entry) => entry.trim() !== "")?.trim() ?? null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but is not ours to signal — still alive.
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

function lockState(mainRoot: string): LockState {
  const lockDir = path.join(mainRoot, ".deploy-checkout.lock");
  if (!existsSync(lockDir)) {
    return { state: "free", requestedSha: lastNonEmptyLine(readIfPresent(path.join(mainRoot, ".deploy-requested"))) };
  }
  const pid = Number(lastNonEmptyLine(readIfPresent(path.join(lockDir, "pid"))));
  if (!Number.isInteger(pid) || pid <= 0) return { state: "stale", pid: null };
  if (!pidAlive(pid)) return { state: "stale", pid };
  const logTail = lastNonEmptyLine(readIfPresent(path.join(mainRoot, "beebox", "deploy", ".last-deploy.log")));
  return { state: "held", pid, alive: true, since: statSync(lockDir).mtime.toISOString(), logTail };
}

function lastDeploy(mainRoot: string): Section<DeployRecord> {
  const file = path.join(mainRoot, "beebox", "deploy", ".deploy-logs", "deploys.jsonl");
  const text = readIfPresent(file);
  if (text === null) return degraded(`no deploy record at ${file}; this machine has not run deploy.sh`);
  const record = parseLastDeployRecord(text);
  return record === null ? degraded(`${file} holds no parseable record`) : available(record);
}

function divergence(from: string, to: string): Section<Divergence> {
  const out = git(["rev-list", "--left-right", "--count", `${from}...${to}`]);
  const parsed = out === null ? null : parseDivergence(out);
  return parsed === null ? degraded(`cannot compare ${from.slice(0, 9)} with ${to}`) : available(parsed);
}

function commits(args: { info: Section<string>; mainRoot: string }): Section<CommitsReport> {
  let deployed: { ref: string; subject: string | null; deployedAt: string | null; source: CommitsReport["source"] } | null = null;
  let serverReason = "";
  if (args.info.ok) {
    const info = parseDeployInfo(args.info.data);
    if (info === null) serverReason = "server deploy-info.json is unparseable";
    else deployed = { ref: info.hash, subject: info.subject, deployedAt: info.deployedAt, source: "server" };
  } else {
    serverReason = args.info.reason;
  }
  if (deployed === null) {
    const marker = lastNonEmptyLine(readIfPresent(path.join(args.mainRoot, "beebox", "deploy", ".last-deployed-sha")));
    if (marker === null) return degraded(`${serverReason}; no local .last-deployed-sha either`);
    deployed = { ref: marker, subject: null, deployedAt: null, source: "local-marker" };
  }
  const sha = git(["rev-parse", "--verify", "--quiet", `${deployed.ref}^{commit}`]);
  const missing = degraded<Divergence>(`deployed ${deployed.ref.slice(0, 9)} is not in local history`);
  const headRef = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
  return available({
    source: deployed.source,
    deployedSha: sha ?? deployed.ref,
    subject: deployed.subject ?? (sha === null ? null : git(["log", "-1", "--format=%s", sha])),
    deployedAt: deployed.deployedAt,
    main: sha === null ? missing : divergence(sha, "main"),
    head: { ref: headRef, divergence: sha === null ? missing : divergence(sha, "HEAD") },
  });
}

function remoteTranscript(sshTarget: string): Section<string> {
  const result = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", sshTarget, "bash -s"],
    { input: REMOTE_SCRIPT, encoding: "utf8", timeout: 240_000 },
  );
  if (result.error !== undefined) return degraded(`ssh did not run: ${result.error.message}`);
  if (result.status === 255) return degraded(`ssh to the deploy target failed: ${lastNonEmptyLine(result.stderr) ?? "no detail"}`);
  if (!result.stdout.includes("@@section end")) {
    return degraded(`remote status script ended early (exit ${String(result.status)}): ${lastNonEmptyLine(result.stderr) ?? "no detail"}`);
  }
  return available(result.stdout);
}

/** Sections that come from the server, each degraded to `reason` when there is no transcript. */
function remoteSections(transcript: Section<string>): Map<string, Section<string>> {
  if (transcript.ok) return splitSections(transcript.data);
  return new Map(["deploy-info", "disk", "services", "healthz", "migrations"].map((name) => [name, degraded<string>(transcript.reason)]));
}

export function collect(): DeployStatusReport {
  const mainRoot = mainCheckout();
  if (mainRoot === null) {
    const reason = "not inside a git checkout of this repository";
    return { commits: degraded(reason), lastDeploy: degraded(reason), lock: degraded(reason), health: degraded(reason), disk: degraded(reason), migrations: degraded(reason) };
  }
  const target = deployTarget(REPO_ROOT);
  const transcript = target === null
    ? degraded<string>(`no deploy target: beebox/deploy/target.env is absent here and in the main checkout (${mainRoot})`)
    : remoteTranscript(target.sshTarget);
  const remote = remoteSections(transcript);
  const services = section(remote, "services");
  const healthz = section(remote, "healthz");
  const disk = section(remote, "disk");
  const migrations = section(remote, "migrations");
  const parsedDisk = disk.ok ? parseDf(disk.data) : null;
  return {
    commits: commits({ info: section(remote, "deploy-info"), mainRoot }),
    lastDeploy: lastDeploy(mainRoot),
    lock: available(lockState(mainRoot)),
    health: !healthz.ok ? degraded(healthz.reason) : parseHealth({ healthz: healthz.data, services: services.ok ? services.data : "" }),
    disk: !disk.ok ? degraded(disk.reason) : parsedDisk === null ? degraded("df output was unparseable") : available(parsedDisk),
    migrations: migrations.ok ? available(parseMigrations(migrations.data)) : degraded(migrations.reason),
  };
}

function main(argv: string[]): number {
  const unknown = argv.filter((arg) => arg !== "--json");
  if (unknown.length > 0 || argv.includes("--help")) {
    console.error("usage: bin/deploy-status [--json]   (read-only report of production deploy state)");
    return 2;
  }
  const report = collect();
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : renderText(report, new Date()));
  return 0;
}

if (process.argv[1] === import.meta.filename) process.exitCode = main(process.argv.slice(2));
