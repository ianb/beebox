/** Box subprocesses need the box owner's REAL user id, not just its effective one. */
import { execFile, type ExecFileOptions } from "node:child_process";

function run(args: string[], options: ExecFileOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { ...options, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * Deployment maintenance runs as root and drops only the effective uid, so in-process
 * file work lands as the box owner while the privileged activation spawn stays
 * available. Subprocesses inherit that split identity, and tools that read the real
 * uid see root: git-annex refuses a box it then considers foreign, which fails every
 * `git` call that spawns the filter process. Restore root for the spawn itself so the
 * child can adopt the box owner completely.
 */
export function gitAsBoxOwner(args: string[], options: ExecFileOptions): Promise<string> {
  const { getuid, geteuid, getegid, seteuid, setegid } = process;
  const uid = geteuid?.();
  const gid = getegid?.();
  if (getuid?.() !== 0 || uid === undefined || gid === undefined || uid === 0 || !seteuid || !setegid) {
    return run(args, options);
  }
  // execFile spawns before it returns, so no await happens inside the privileged window.
  setegid(0);
  seteuid(0);
  try {
    return run(args, { ...options, uid, gid });
  } finally {
    setegid(gid);
    seteuid(uid);
  }
}
