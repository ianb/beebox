/**
 * Run a bash script on the Bee Box server.
 *
 * Why this exists: SSH key auth on the server is set up for `root` only, so
 * the entry point is always `root@`. But running write operations *as* root
 * inside beebox-owned directories leaves root-owned files behind — most
 * famously, a `git commit` run as root creates new objects under
 * `.git/objects/<prefix>/` owned by root, and the next beebox-user commit
 * that happens to hash into one of those prefixes fails with
 * "insufficient permission for adding an object to repository database".
 *
 * This module is the single chokepoint for "run something on the server":
 * SSH in as root, then immediately drop to a less-privileged user (default
 * `beebox`) via `su - <user>` before running the script. Scripts are piped
 * to the remote shell's stdin so multi-line and quoted content lands without
 * nested-quoting acrobatics.
 *
 * Caller rule: pick the lowest-privilege user that gets the job done.
 * `beebox` is the right default for anything touching a box (filesystem
 * reads/writes, git in the box, `bbx` commands). `root` is only correct for
 * server-management operations (systemctl, chown, apt, etc.) and even then
 * should be a deliberate, commented choice.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RunOnServerOptions {
  /** Bash script to run on the server. Multi-line is fine; treat it like a
   *  shell-script file's contents. `set -e` is NOT added automatically. */
  script: string;
  /** Which user to run the script as. Default `beebox` (least privilege,
   *  the owner of box files). Use `"root"` only for operations that genuinely
   *  require it (systemctl, chown, package installs) and document the why. */
  asUser?: "beebox" | "root";
  /** Override the target host. Defaults to the IP in `beebox/deploy/server-ip`. */
  host?: string;
}

export interface RunOnServerResult {
  stdout: string;
  stderr: string;
  /** Exit code from ssh (which exits with the remote command's exit code). */
  exitCode: number;
}

function defaultHost(): string {
  const p = path.join(__dirname, "..", "beebox", "deploy", "server-ip");
  return fs.readFileSync(p, "utf-8").trim();
}

export function runOnServer(opts: RunOnServerOptions): RunOnServerResult {
  const asUser = opts.asUser ?? "beebox";
  const host = opts.host ?? defaultHost();

  // When dropping to a non-root user, `su - <user> -s /bin/bash` starts a
  // login shell as that user; with our script piped to its stdin, bash runs
  // non-interactively and executes the piped commands. When asUser is root
  // we skip the `su` and run bash directly under the SSH session.
  const remoteCmd =
    asUser === "root" ? "bash -s" : `su - ${asUser} -s /bin/bash`;

  const result = spawnSync("ssh", ["-A", `root@${host}`, remoteCmd], {
    input: opts.script,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}
