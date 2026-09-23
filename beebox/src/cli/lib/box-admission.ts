/** CLI actions default to box work; lifecycle owners acquire their own gates. */
import type { Command } from "commander";
import { findBoxRoot } from "../../lib/paths.js";
import { acquireBoxWork, boxWorkEnvironment, type BoxWork } from "../../lib/box-maintenance.js";

const independentlyOwned = new Set([
  "answer", "maintenance", "migrate", "docs", "upgrade", "serve", "hub", "scheduler",
  "auth", "secrets", "boxes", "tailscale", "field-test",
]);
// Read-only commands: they mutate nothing, so there is nothing to admit. Some
// also run where no box exists at all — `agent-context --hook` fires in EVERY
// Codex session including dev worktrees, and handles that itself by resolving
// a nullable box root and exiting quietly. Admission runs in a `preAction`
// hook, so a command left out of this set never reaches its own handling.
const inspection = new Set(["health", "status", "activity", "ls", "usage", "agent-context"]);

class CliBoxRequiredError extends Error {
  constructor() {
    super("Not in a Bee Box; run this command from its box directory");
    this.name = "CliBoxRequiredError";
  }
}

function commandPath(command: Command): string[] {
  const names: string[] = [];
  for (let current = command; current.parent; current = current.parent) {
    names.unshift(current.name());
  }
  // `bbx engine <verb>` is the operator half of the same CLI, not a different
  // command: the sets below are keyed on the verb, and `engine` in front of it
  // would make every one of them miss (`bbx engine init` would look like a
  // command named "engine" and get admitted as ordinary box work, which for a
  // fresh directory means a spurious "Not in a Bee Box"). The namespace is a
  // presentation split — see `cli/surface-data.ts` — so admission looks past it.
  if (names[0] === "engine") names.shift();
  return names;
}

/** Return cleanup for parse failures; postAction handles successful actions. */
export function installBoxAdmission(program: Command): () => Promise<void> {
  let work: BoxWork | undefined;
  const inherited = process.env.BBX_BOX_WORK;
  const release = async (): Promise<void> => {
    const previous = work;
    work = undefined;
    if (inherited === undefined) delete process.env.BBX_BOX_WORK;
    else process.env.BBX_BOX_WORK = inherited;
    await previous?.release();
  };
  program.hook("preAction", async (_program, command) => {
    const [root, subcommand] = commandPath(command);
    if (!root) return;
    if (["serve", "hub", "scheduler"].includes(root)) delete process.env.BBX_BOX_WORK;
    if (independentlyOwned.has(root) || inspection.has(root)) return;
    if (root === "location" && subcommand !== "mark") return;
    const options = command.opts<Record<string, unknown>>();
    // Background URL checking writes only its ignored diagnostic cache and may
    // start after the committing parent exits. It cannot change box content.
    if (root === "validate" && !options.fix && (options.urls || options.urlsSince)) return;
    const target = root === "init" ? command.args[0] : options.box;
    // requireBoxRoot also migrates legacy state, so it must follow admission.
    const boxRoot = await findBoxRoot(typeof target === "string" ? target : process.cwd());
    if (!boxRoot) {
      // New-box initialization has no existing writers to drain.
      if (root === "init") return;
      // Remote chat is admitted by the target server, which owns its box.
      if (root === "chat" && process.env.BBX_SERVER_URL && process.env.BBX_BOX_NAME) return;
      throw new CliBoxRequiredError();
    }
    work = await acquireBoxWork(boxRoot, { reason: `bbx ${root}`, inherited });
    // Commander hooks do not wrap the action's async context. This process
    // executes one CLI action, so its explicit child environment carries it.
    process.env.BBX_BOX_WORK = work.run(boxWorkEnvironment).BBX_BOX_WORK;
  });
  program.hook("postAction", release);
  // proper-lockfile also releases held locks on process.exit (signal-exit),
  // which existing action handlers use; SIGKILL uses its stale-lock recovery.
  return release;
}
