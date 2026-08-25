// Spawn a command in its own process group and return immediately.
//
// This is a primitive, not logic: `node bin/lib/detach.ts <cmd> [args…]`.
//
// TypeScript, not `.mjs`, despite running on a teardown path where startup cost
// matters: Node 24 strips types natively — no loader, no build step — and the
// difference is unmeasurable against node's own ~200ms boot (timed 2026-08-25).
// Being in `bin/**/*.ts` means it type-checks with everything else.
//
// Bash cannot do it. `cmd &` puts the child in the shell's process group and
// `disown` only drops it from the job table — it does not leave the group — so
// when the parent (a Claude Code session tearing down) is killed group-wide,
// the "backgrounded" child dies with it. That is measurable: of 109 sweeps
// triggered from SessionEnd, 15 never logged their END line, while the 44
// SessionStart and 72 codex-session-end sweeps lost none. macOS ships no
// `setsid(1)`, and `nohup` only covers SIGHUP, not a group signal. Node's
// `detached: true` calls `setsid(2)`, which is the actual primitive needed.
//
// stdio is ignored here; the child is expected to redirect its own output.
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  process.stderr.write("detach: usage: detach.ts <command> [args…]\n");
  process.exit(2);
}
spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
