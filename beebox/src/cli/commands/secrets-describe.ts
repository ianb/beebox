/**
 * `bbx secrets describe` — why a secret exists (`docs/secrets.md`, "Why a secret
 * exists").
 *
 * The store already answered "what is this key" (`note`) and "who may use it"
 * (grants). This subcommand answers the question a boxholder actually asks
 * months later, looking at a granted key: *what would break if I revoked this?*
 * The engine's own readers are covered by the built-in registry
 * (`core/secrets/uses.ts`); this is how the ad-hoc half gets said — a trick, a
 * scheduled script, a box-local integration.
 *
 * ADDING is agent-facing and unguarded, like `declare`: an agent that teaches
 * the box a new trick spending an already-granted key SHOULD append why, and a
 * reason can neither disclose a value nor widen an access level. It is scoped
 * to the agent's OWN box, though — an unguarded write that succeeds for a real
 * name and errors for an invented one would enumerate the machine's secrets by
 * guessing, so `secrets-guard.ts` answers both cases identically. REMOVING and
 * CLEARING carry the agent guard — deleting the line that justified a grant is
 * precisely the edit a human has to be behind, and an agent tidying away its own
 * stated reasons would quietly undo the record this feature exists to keep.
 *
 * Its own file rather than a block in `secrets.ts` because that file is at its
 * line limit — same reason `secrets-migrate.ts` is separate.
 */

import { Command } from "commander";
import { describeSecret } from "../../core/secrets/uses.js";
import { failWith, refuseIfAgentDescribingOtherBoxSecret, refuseIfUnconfirmedAgent } from "../lib/secrets-guard.js";

export async function runDescribeSecret(opts: {
  name: string;
  addUses?: string[] | undefined;
  removeUses?: string[] | undefined;
  clearUses?: boolean | undefined;
  agentConfirmed?: boolean | undefined;
  /** The box the command ran in — `undefined` finds it from the working
   *  directory, `null` says there is none (tests state both). */
  boxRoot?: string | null | undefined;
}): Promise<void> {
  const removing = (opts.removeUses ?? []).length > 0 || opts.clearUses === true;
  // Outside the try: the guards end the process themselves, and the lifecycle
  // catch below would reprint an exit as an error message.
  if (removing) {
    refuseIfUnconfirmedAgent({ action: "remove a secret's stated uses", agentConfirmed: opts.agentConfirmed });
  } else if ((opts.addUses ?? []).length > 0) {
    // Adding stays open to an agent, but only for its own box's secrets.
    await refuseIfAgentDescribingOtherBoxSecret({
      name: opts.name,
      boxRoot: opts.boxRoot,
      agentConfirmed: opts.agentConfirmed,
    });
  }
  try {
    const { uses } = await describeSecret({
      name: opts.name,
      addUses: opts.addUses,
      removeUses: opts.removeUses,
      clearUses: opts.clearUses,
    });
    console.log(
      uses.length === 0
        ? `"${opts.name}" now states no uses of its own.`
        : `"${opts.name}" is used for:\n${uses.map((use) => `  - ${use}`).join("\n")}`,
    );
  } catch (e) {
    failWith(e);
  }
}

/** Collect a repeatable option into a list — `--add-use A --add-use B`. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface DescribeOptions {
  addUse?: string[];
  removeUse?: string[];
  clearUses?: boolean;
  agentConfirmed?: boolean;
}

const describeCmd = new Command("describe")
  .description("Say why a secret exists — repeatable reasons, appended (the agent-facing surface)")
  .argument("<name>", "Secret name")
  .option("--add-use <reason>", "A reason this secret is used, repeatable", collect, [])
  .option("--remove-use <reason>", "Drop one stated reason (exact match)", collect, [])
  .option("--clear-uses", "Drop every stated reason")
  .option(
    "--agent-confirmed",
    "Proceed even though this looks like an agent session — only when a human explicitly asked",
  );

describeCmd.action(async (name: string) => {
  const options = describeCmd.opts<DescribeOptions>();
  await runDescribeSecret({
    name,
    addUses: options.addUse,
    removeUses: options.removeUse,
    clearUses: options.clearUses,
    agentConfirmed: options.agentConfirmed,
  });
});

export const describeCommand = describeCmd;
