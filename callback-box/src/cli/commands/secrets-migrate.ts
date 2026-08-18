/**
 * `cb secrets migrate` and `cb secrets copy-grants` — the two plumbing
 * subcommands that exist for scripts and operators rather than for daily use
 * (`docs/plans/secret-custody.md`, "Rollout shape").
 *
 * `migrate` moves a machine's per-box `config/connectors/*.secret.json` files
 * into the store, once. `copy-grants` is what `deploy/add-box.sh
 * --secrets-from` now does instead of copying files between box trees — the
 * copy was the rotation hazard the whole plan exists to end.
 *
 * Nothing here prints a value. The summaries are names, slugs, and counts,
 * because this command's whole job is to handle credentials in bulk and the
 * one thing an operator's terminal scrollback must never end up holding is the
 * keys themselves.
 */

import { Command } from "commander";
import { copyBoxGrants } from "../../core/secrets/lifecycle.js";
import {
  applySecretMigration,
  enumerateLegacySecrets,
  planSecretMigration,
  type MigrationPlan,
} from "../../core/secrets/migrate.js";
import { failWith, refuseIfUnconfirmedAgent, resolveSlugArgument } from "../lib/secrets-guard.js";

const AGENT_CONFIRMED_HELP =
  "Proceed even though this looks like an agent session — only when a human explicitly asked";

/** The plan, as the operator reads it before deciding to run it for real. */
function printPlan(plan: MigrationPlan): void {
  console.log(`Boxes examined: ${plan.boxes.length === 0 ? "none" : plan.boxes.map((box) => box.slug).join(", ")}`);
  if (plan.entries.length === 0) {
    console.log("No legacy connector secret files to migrate.");
  }
  for (const entry of plan.entries) {
    const state = entry.alreadyInStore ? "already in the store (left as it is)" : "new entry";
    const single = entry.singleBox ? ", single-box" : "";
    console.log(`  ${entry.name} — ${state}${single}; grants: ${entry.grants.join(", ")}`);
  }
  for (const conflict of plan.conflicts) {
    console.log(
      `  CONFLICT: "${conflict.slug}" holds a different value for "${conflict.contestedName}" than the box that ` +
        `kept that name. Its value is parked as "${conflict.parkedAs}".`,
    );
    console.log(
      `            Readers ask for "${conflict.contestedName}", so "${conflict.slug}" keeps working through its ` +
        "legacy file until you decide which key it should use.",
    );
  }
  for (const skip of plan.skipped) {
    console.log(`  skipped ${skip.file} — ${skip.reason}`);
  }
}

export async function runMigrateSecrets(opts: {
  root?: string | undefined;
  dryRun?: boolean | undefined;
  agentConfirmed?: boolean | undefined;
}): Promise<void> {
  if (opts.dryRun !== true) {
    refuseIfUnconfirmedAgent({
      action: "migrate every box's connector secrets into the machine store",
      agentConfirmed: opts.agentConfirmed,
    });
  }
  try {
    const inventory = await enumerateLegacySecrets({ root: opts.root });
    printPlan(await planSecretMigration(inventory));
    if (opts.dryRun === true) {
      console.log("");
      console.log("Dry run — nothing was written.");
      return;
    }
    // Apply re-plans under the lock; its conflict list, not the preview's, is
    // what actually happened.
    const result = await applySecretMigration(inventory);
    console.log("");
    console.log(`Created ${result.created.length} entr${result.created.length === 1 ? "y" : "ies"}, ` +
      `wrote ${result.granted.length} grant${result.granted.length === 1 ? "" : "s"}, ` +
      `left ${result.untouched.length} existing entr${result.untouched.length === 1 ? "y" : "ies"} untouched.`);
    if (result.conflicts.length > 0) {
      console.log(`${result.conflicts.length} box/name pair(s) held a conflicting value and were parked — see the CONFLICT lines above.`);
    }
    console.log("The original files are LEFT IN PLACE — readers still fall back to them during the transition.");
    console.log("Check each box with `cb secrets status <box>`, then delete the files in a separate pass.");
  } catch (e) {
    failWith(e);
  }
}

export async function runCopyGrants(opts: {
  fromBoxOrRoot: string;
  toBoxOrRoot: string;
  agentConfirmed?: boolean | undefined;
}): Promise<void> {
  refuseIfUnconfirmedAgent({ action: "copy one box's grants to another", agentConfirmed: opts.agentConfirmed });
  try {
    const fromSlug = await resolveSlugArgument(opts.fromBoxOrRoot);
    const toSlug = await resolveSlugArgument(opts.toBoxOrRoot);
    if (fromSlug === toSlug) {
      console.error(`"${fromSlug}" is both the source and the target — nothing to copy.`);
      process.exit(1);
    }
    const result = await copyBoxGrants({ fromSlug, toSlug });
    if (!result.sourceHadGrants) {
      // The exact phrase `deploy/add-box.sh` greps for to decide whether this
      // machine predates the store. Keep the two in step.
      console.log(`Nothing copied: "${fromSlug}" has no grants at all.`);
    } else if (result.copied.length === 0) {
      console.log(`Nothing copied: every grant "${fromSlug}" holds is single-box.`);
    }
    for (const grant of result.copied) {
      console.log(`Granted "${grant.name}" to "${toSlug}" with ${grant.access} access (from "${fromSlug}").`);
    }
    for (const skip of result.skipped) {
      console.log(`Skipped "${skip.name}" — ${skip.reason}.`);
    }
  } catch (e) {
    failWith(e);
  }
}

interface MigrateOptions {
  root?: string;
  dryRun?: boolean;
  agentConfirmed?: boolean;
}

// Options come from `.opts()` rather than an action's third parameter — the
// ruleset caps a function at two positional parameters.
export const migrateCommand = new Command("migrate")
  .description("Move every box's legacy config/connectors/*.secret.json into the machine store (originals stay)")
  .option("--root <dir>", "Parent directory of the boxes to migrate (default: the registered boxes in boxes.json)")
  .option("--dry-run", "Print the plan and write nothing")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP);

migrateCommand.action(async () => {
  await runMigrateSecrets(migrateCommand.opts<MigrateOptions>());
});

export const copyGrantsCommand = new Command("copy-grants")
  .description("Give one box the same grants another box holds (single-box secrets are skipped)")
  .argument("<from>", "Source box slug or box root path")
  .argument("<to>", "Target box slug or box root path")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP);

copyGrantsCommand.action(async (fromBoxOrRoot: string, toBoxOrRoot: string) => {
  await runCopyGrants({ fromBoxOrRoot, toBoxOrRoot, ...copyGrantsCommand.opts<{ agentConfirmed?: boolean }>() });
});
