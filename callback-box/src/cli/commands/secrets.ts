/**
 * `cb secrets` — plumbing for the machine-level secret store
 * (`docs/plans/secret-custody.md`, Track 2).
 *
 * Deliberately plumbing, not the boxholder's surface: the admin page and the
 * chat capture widget are where a person manages secrets, and they ride the
 * same `core/secrets/lifecycle.ts` code. This CLI exists for deploy scripts,
 * the migration, emergencies, and for AGENTS — whose intended subcommands are
 * the read-only `list`/`status` and the write-nothing `declare` (name a slot
 * you need; only the boxholder can fill or grant it).
 *
 * Two hard rules live here rather than in the store:
 *
 * - **A value never comes from argv.** `ps`, shell history, and any process
 *   listing would carry it. `set` reads stdin (piped) or prompts with no echo;
 *   a value in argument position is refused with an explanation.
 * - **Mutations refuse in an agent session without `--agent-confirmed`**, the
 *   `cb auth` pattern (`lib/agent-context.ts`) — a speed bump and an audit
 *   signal, never an authorization boundary. `declare` is exempt: it is the
 *   agent's own surface and can neither disclose nor empower anything.
 *
 * Each subcommand body is an exported plain function so doctests call it
 * directly instead of spawning the CLI (the `cb auth` precedent).
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boxSlug } from "../../lib/box-slug.js";
import { detectAgentContext } from "../../lib/agent-context.js";
import { errorMessage } from "../../lib/error-guards.js";
import { SecretLifecycleError } from "../../core/secrets/errors.js";
import {
  boxSecretStatus,
  declareSecret,
  grantSecret,
  listSecrets,
  removeSecret,
  revokeSecret,
  setSecret,
} from "../../core/secrets/lifecycle.js";
import { secretAccessLevelSchema, secretsFilePath, type SecretAccessLevel } from "../../core/secrets/store.js";
import { promptHidden } from "../lib/prompt-hidden.js";

/** Refuse a store mutation from an agent session unless a human sanctioned it. */
function refuseIfUnconfirmedAgent(opts: { action: string; agentConfirmed: boolean | undefined }): void {
  if (opts.agentConfirmed === true) return;
  const context = detectAgentContext();
  if (!context.isAgent) return;
  console.error(
    [
      `Refusing to ${opts.action}: this looks like an agent session (${context.reason}).`,
      "",
      `The secret store (${secretsFilePath()}) is MACHINE-LEVEL — one file behind every box`,
      "on this machine, not just the box you are standing in. Granting a secret hands another",
      "box a live credential; setting one rotates the single copy every box shares.",
      "",
      "If the person you are working for explicitly asked you to do this, re-run with",
      "--agent-confirmed.",
      "",
      "If you need a secret for work you are doing: `cb secrets declare <name> --note ...`",
      "names the slot, and the boxholder supplies and grants the value. Needing a credential",
      "you were not given is a question for a human, not an obstacle to work around.",
    ].join("\n"),
  );
  process.exit(1);
}

/** Fail the process with a clean line for a known lifecycle error, a message otherwise. */
function failWith(e: unknown): never {
  console.error(e instanceof SecretLifecycleError ? e.message : errorMessage(e));
  process.exit(1);
}

/** Read a piped value from stdin (everything up to EOF, one trailing newline stripped). */
async function readStdinValue(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8").replace(/\r?\n$/, "");
}

/**
 * Where the value comes from: piped stdin when this is not a terminal,
 * otherwise a no-echo prompt. Never argv.
 */
async function readSecretValue(name: string): Promise<string> {
  if (process.stdin.isTTY !== true) return readStdinValue();
  return promptHidden({
    label: `Value for "${name}" (input hidden): `,
    noTtyMessage: "stdin is not an interactive terminal; pipe the value in instead.",
  });
}

/** A `<box-or-boxRoot>` argument: an existing directory resolves to its slug, anything else IS the slug. */
async function resolveSlugArgument(boxOrRoot: string): Promise<string> {
  const candidate = path.resolve(boxOrRoot);
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return await boxSlug(candidate);
  } catch (_e) {
    // Not a path on this machine — treat the argument as a literal slug.
  }
  return boxOrRoot;
}

function parseAccess(raw: string | undefined): SecretAccessLevel {
  if (raw === undefined) return "server";
  const parsed = secretAccessLevelSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`Unknown access level "${raw}" — use "server" (default) or "agent".`);
    process.exit(1);
  }
  return parsed.data;
}

// --- subcommand bodies (exported for direct testing) --------------------------

export async function runSetSecret(opts: {
  name: string;
  argvValue?: string | undefined;
  note?: string | undefined;
  formatHint?: string | undefined;
  agentConfirmed?: boolean | undefined;
}): Promise<void> {
  // Both guards run OUTSIDE the try: they end the process themselves, and
  // funnelling them through the lifecycle catch would reprint their exit as an
  // error message.
  if (opts.argvValue !== undefined) {
    console.error(
      [
        "Refusing to take a secret value from the command line: arguments are visible to",
        "every process on the machine (`ps`) and land in shell history.",
        "",
        `Pipe it instead:  printf %s "$VALUE" | cb secrets set ${opts.name}`,
        "or run the command with no value argument to be prompted (input hidden).",
      ].join("\n"),
    );
    process.exit(1);
  }
  refuseIfUnconfirmedAgent({ action: "set a secret value", agentConfirmed: opts.agentConfirmed });
  try {
    const value = await readSecretValue(opts.name);
    await setSecret({ name: opts.name, value, note: opts.note, formatHint: opts.formatHint });
    console.log(`Stored "${opts.name}" (${value.length} characters). It is granted to no box yet.`);
  } catch (e) {
    failWith(e);
  }
}

export async function runRemoveSecret(opts: { name: string; agentConfirmed?: boolean | undefined }): Promise<void> {
  refuseIfUnconfirmedAgent({ action: "remove a secret", agentConfirmed: opts.agentConfirmed });
  try {
    await removeSecret(opts.name);
    console.log(`Removed "${opts.name}". Any grant naming it now reads as a dangling grant.`);
  } catch (e) {
    failWith(e);
  }
}

export async function runDeclareSecret(opts: {
  name: string;
  note?: string | undefined;
  formatHint?: string | undefined;
}): Promise<void> {
  try {
    const { created } = await declareSecret({ name: opts.name, note: opts.note, formatHint: opts.formatHint });
    console.log(
      created
        ? `Declared "${opts.name}" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it.`
        : `"${opts.name}" already exists; its note and format hint were refreshed.`,
    );
  } catch (e) {
    failWith(e);
  }
}

export async function runListSecrets(): Promise<void> {
  try {
    const listing = await listSecrets();
    if (listing.length === 0) {
      console.log("No secrets on this machine.");
      return;
    }
    for (const entry of listing) {
      const grants = Object.entries(entry.grants).map(([slug, access]) => `${slug}:${access}`);
      console.log(
        [
          entry.name,
          entry.hasValue ? "set" : "EMPTY",
          `updated=${entry.updated}`,
          `grants=${grants.length === 0 ? "none" : grants.join(",")}`,
          entry.shareable === false ? `single-box=${entry.owningBox ?? "unnamed"}` : undefined,
          entry.note === undefined ? undefined : `note=${entry.note}`,
        ]
          .filter((part) => part !== undefined)
          .join("\t"),
      );
    }
  } catch (e) {
    failWith(e);
  }
}

export async function runGrantSecret(opts: {
  boxOrRoot: string;
  name: string;
  access?: string | undefined;
  agentConfirmed?: boolean | undefined;
}): Promise<void> {
  refuseIfUnconfirmedAgent({ action: "grant a secret to a box", agentConfirmed: opts.agentConfirmed });
  const access = parseAccess(opts.access);
  try {
    const slug = await resolveSlugArgument(opts.boxOrRoot);
    await grantSecret({ slug, name: opts.name, access });
    console.log(`Granted "${opts.name}" to "${slug}" with ${access} access.`);
  } catch (e) {
    failWith(e);
  }
}

export async function runRevokeSecret(opts: {
  boxOrRoot: string;
  name: string;
  agentConfirmed?: boolean | undefined;
}): Promise<void> {
  refuseIfUnconfirmedAgent({ action: "revoke a grant", agentConfirmed: opts.agentConfirmed });
  try {
    const slug = await resolveSlugArgument(opts.boxOrRoot);
    await revokeSecret({ slug, name: opts.name });
    console.log(`Revoked "${opts.name}" from "${slug}".`);
  } catch (e) {
    failWith(e);
  }
}

export async function runSecretsStatus(opts: { boxOrRoot: string }): Promise<void> {
  try {
    const slug = await resolveSlugArgument(opts.boxOrRoot);
    const status = await boxSecretStatus(slug);
    console.log(`Box: ${status.slug}`);
    if (status.granted.length === 0) {
      console.log("  granted: none");
    } else {
      for (const grant of status.granted) {
        console.log(`  granted: ${grant.name} (${grant.access}${grant.hasValue ? "" : ", NO VALUE YET"})`);
      }
    }
    for (const name of status.emptySlots) {
      console.log(`  empty slot: ${name} — declared but never filled; ask the boxholder to supply it`);
    }
    for (const name of status.danglingGrants) {
      console.log(`  dangling grant: ${name} — the secret it names no longer exists`);
    }
  } catch (e) {
    failWith(e);
  }
}

// --- Commander wiring -----------------------------------------------------

const AGENT_CONFIRMED_HELP =
  "Proceed even though this looks like an agent session — only when a human explicitly asked";

interface SetOptions {
  note?: string;
  formatHint?: string;
  agentConfirmed?: boolean;
}

interface GrantOptions {
  access?: string;
  agentConfirmed?: boolean;
}

export const secretsCommand = new Command("secrets").description(
  "Manage the machine-level secret store (values are never printed)",
);

// Options come from `.opts()` rather than an action's third parameter — the
// ruleset caps a function at two positional parameters (the `cb hub add-box`
// precedent).
const setCmd = secretsCommand
  .command("set")
  .description("Store or rotate a secret's value (piped stdin, or a hidden prompt — never an argument)")
  .argument("<name>", "Secret name")
  .argument("[value]", "REFUSED — a value in argv leaks to `ps` and shell history")
  .option("--note <note>", "What this secret is for")
  .option("--format-hint <hint>", "Format registry key or inline hint")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP);

setCmd.action(async (name: string, value: string | undefined) => {
  await runSetSecret({ name, argvValue: value, ...setCmd.opts<SetOptions>() });
});

secretsCommand
  .command("rm")
  .description("Remove a secret (grants naming it become dangling grants)")
  .argument("<name>", "Secret name")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP)
  .action(async (name: string, options: { agentConfirmed?: boolean }) => {
    await runRemoveSecret({ name, ...options });
  });

secretsCommand
  .command("declare")
  .description("Create an empty, ungranted slot for a secret you need (the agent-facing surface)")
  .argument("<name>", "Secret name")
  .option("--note <note>", "What this secret is for, and where to obtain it")
  .option("--format-hint <hint>", "Expected shape of the value, e.g. a prefix")
  .action(async (name: string, options: { note?: string; formatHint?: string }) => {
    await runDeclareSecret({ name, ...options });
  });

secretsCommand
  .command("list")
  .description("List secret names and metadata (never values)")
  .action(async () => {
    await runListSecrets();
  });

const grantCmd = secretsCommand
  .command("grant")
  .description("Grant a box access to a secret")
  .argument("<box>", "Box slug or box root path")
  .argument("<name>", "Secret name")
  .option("--access <level>", "server (default) or agent")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP);

grantCmd.action(async (boxOrRoot: string, name: string) => {
  await runGrantSecret({ boxOrRoot, name, ...grantCmd.opts<GrantOptions>() });
});

const revokeCmd = secretsCommand
  .command("revoke")
  .description("Withdraw a box's grant")
  .argument("<box>", "Box slug or box root path")
  .argument("<name>", "Secret name")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP);

revokeCmd.action(async (boxOrRoot: string, name: string) => {
  await runRevokeSecret({ boxOrRoot, name, ...revokeCmd.opts<{ agentConfirmed?: boolean }>() });
});

secretsCommand
  .command("status")
  .description("What one box is granted, plus its empty slots and dangling grants")
  .argument("<box>", "Box slug or box root path")
  .action(async (boxOrRoot: string) => {
    await runSecretsStatus({ boxOrRoot });
  });
