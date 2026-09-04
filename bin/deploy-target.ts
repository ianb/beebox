/**
 * The deploy target this machine is configured for — the TypeScript face of
 * `beebox/deploy/deploy-target.sh`.
 *
 * `beebox/deploy/target.env` (gitignored) is the opt-in switch that makes a
 * checkout one that deploys. Several tools besides the deploy itself need the
 * same answer — the doctor's deploy-currency and disk checks, the cross-box
 * leak scan's prod leg, feedback collection, the CSP report — and before this
 * they each read `deploy/server-ip` themselves, which is how a second source
 * of truth about "where is production" gets started.
 *
 * The bash script stays authoritative (the husky hooks and deploy.sh cannot
 * import TypeScript), so this shells out to it rather than reparsing the file.
 * The config lives in the MAIN checkout — a worktree has its own, absent copy
 * — and the script handles that fallback.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/** A configured deploy target. `sshTarget` is ready for ssh/rsync/scp. */
export interface DeployTarget {
  /** The server's IP or hostname. */
  host: string;
  /** `user@host`. */
  sshTarget: string;
  /** Where the source tree is rsynced to on the server. */
  installDir: string;
  /** Home of the service account that owns the boxes. */
  serviceHome: string;
}

function script(repoRoot: string): string {
  return path.join(repoRoot, "beebox", "deploy", "deploy-target.sh");
}

function ask(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync(script(repoRoot), args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_e) {
    // Exit 1 is the ordinary "this machine does not deploy" answer, not an
    // error; a missing or non-executable script means the same thing here.
    return null;
  }
}

/**
 * The configured target, or null when this machine has none.
 *
 * Null is not a failure to report. A checkout with no target.env is a clone
 * that was never pointed at a server — callers decide whether that is fine
 * (skip the prod leg) or fatal (a scheduled prod audit running from the wrong
 * checkout).
 */
export function deployTarget(repoRoot: string): DeployTarget | null {
  const sshTarget = ask(repoRoot, ["ssh-target"]);
  if (sshTarget === null || sshTarget === "") return null;
  const host = ask(repoRoot, ["get", "BBX_DEPLOY_HOST"]);
  if (host === null || host === "") return null;
  return {
    host,
    sshTarget,
    installDir: ask(repoRoot, ["get", "BBX_DEPLOY_INSTALL_DIR"]) ?? "/opt/beebox",
    serviceHome: ask(repoRoot, ["get", "BBX_DEPLOY_SERVICE_HOME"]) ?? "/home/beebox",
  };
}

/** Does this machine deploy at all? */
export function hasDeployTarget(repoRoot: string): boolean {
  return deployTarget(repoRoot) !== null;
}
