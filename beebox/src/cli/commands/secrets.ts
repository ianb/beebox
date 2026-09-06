/**
 * `bbx secrets` — plumbing for the machine-level secret store
 * (`docs/implemented-plans/secret-custody.md`, Track 2).
 *
 * Deliberately plumbing, not the boxholder's surface: the admin page and the
 * chat capture widget are where a person manages secrets, and they ride the
 * same `core/secrets/lifecycle.ts` code. This CLI exists for deploy scripts,
 * the migration, emergencies, and for AGENTS — whose intended subcommands are
 * `status` for their OWN box and the write-nothing `declare` (name a slot you
 * need; only the boxholder can fill or grant it).
 *
 * Three hard rules live here rather than in the store:
 *
 * - **A value never comes from argv.** `ps`, shell history, and any process
 *   listing would carry it. `set` reads stdin (piped) or prompts with no echo;
 *   a value in argument position is refused with an explanation.
 * - **Mutations refuse in an agent session without `--agent-confirmed`**, the
 *   `bbx auth` pattern (`lib/agent-context.ts`) — a speed bump and an audit
 *   signal, never an authorization boundary. `declare` is exempt: it is the
 *   agent's own surface and can neither disclose nor empower anything.
 * - **An agent sees its own box, not the machine.** `list` is the machine-wide
 *   inventory of names and grants, so it carries the same agent refusal as the
 *   mutations; `status <box>` refuses in an agent session for any box but the
 *   one the command is standing in. Neither discloses a value, but a map of
 *   every credential on the machine is not an agent's view of the store.
 *
 * Each subcommand body is an exported plain function so doctests call it
 * directly instead of spawning the CLI (the `bbx auth` precedent).
 */

import { Command } from "commander";
import { boxSlug } from "../../lib/box-slug.js";
import { findBoxRoot } from "../../lib/paths.js";
import {
  boxSecretStatus,
  declareSecret,
  grantSecret,
  listSecrets,
  removeSecret,
  revokeSecret,
  setSecret,
} from "../../core/secrets/lifecycle.js";
import { secretAccessLevelSchema, type SecretAccessLevel } from "../../core/secrets/store.js";
import { formatSecretUsesLines } from "../../core/secrets/uses.js";
import { describeCommand } from "./secrets-describe.js";
import { promptHidden } from "../lib/prompt-hidden.js";
import {
  failWith,
  refuseIfAgentAskingAboutAnotherBox,
  refuseIfUnconfirmedAgent,
  resolveSlugArgument,
} from "../lib/secrets-guard.js";
import { copyGrantsCommand, migrateCommand } from "./secrets-migrate.js";

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
        `Pipe it instead:  printf %s "$VALUE" | bbx secrets set ${opts.name}`,
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

async function runRemoveSecret(opts: { name: string; agentConfirmed?: boolean | undefined }): Promise<void> {
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
  /** Why the slot is wanted — appended to whatever the entry already says. */
  uses?: string[] | undefined;
  /** The declaring box; omitted, it is found from the working directory. */
  boxRoot?: string | undefined;
}): Promise<void> {
  try {
    // Attribution, not access: recording which box asked is what lets
    // `bbx secrets status <box>` show the slot back. Best-effort — `bbx secrets
    // declare` run from outside a box still declares, just anonymously.
    const boxRoot = opts.boxRoot ?? (await findBoxRoot(process.cwd()));
    const declaredBy = boxRoot === null ? undefined : await boxSlug(boxRoot);
    const { created } = await declareSecret({
      name: opts.name,
      note: opts.note,
      formatHint: opts.formatHint,
      uses: opts.uses,
      declaredBy,
    });
    console.log(
      created
        ? `Declared "${opts.name}" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it.`
        : `"${opts.name}" already exists; its note and format hint were refreshed.`,
    );
    if (declaredBy !== undefined) {
      console.log(`Attributed to box "${declaredBy}" — it shows up in \`bbx secrets status ${declaredBy}\`.`);
    }
  } catch (e) {
    failWith(e);
  }
}

export async function runListSecrets(opts?: { agentConfirmed?: boolean | undefined }): Promise<void> {
  // `list` is the machine-wide inventory — every secret name on the box's
  // machine, and which boxes hold them. That is the boxholder's view, not an
  // agent's: an agent's is its own box (`bbx secrets status <its own box>`).
  refuseIfUnconfirmedAgent({ action: "list every secret on this machine", agentConfirmed: opts?.agentConfirmed });
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
          ...formatSecretUsesLines(entry.uses),
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

export async function runSecretsStatus(opts: {
  boxOrRoot: string;
  /** The box the command ran in; omitted, it is found from the working directory. */
  boxRoot?: string | null | undefined;
}): Promise<void> {
  const slug = await resolveSlugArgument(opts.boxOrRoot);
  // Outside the try: the guard ends the process itself, and the lifecycle catch
  // below would reprint its exit as an error.
  await refuseIfAgentAskingAboutAnotherBox({ slug, boxRoot: opts.boxRoot });
  try {
    const status = await boxSecretStatus(slug);
    console.log(`Box: ${status.slug}`);
    if (status.granted.length === 0) {
      console.log("  granted: none");
    } else {
      for (const grant of status.granted) {
        console.log(`  granted: ${grant.name} (${grant.access}${grant.hasValue ? "" : ", NO VALUE YET"})`);
        for (const line of formatSecretUsesLines(grant.uses)) console.log(`    ${line}`);
      }
    }
    for (const name of status.emptySlots) {
      console.log(`  empty slot: ${name} — declared but never filled; ask the boxholder to supply it`);
    }
    for (const name of status.danglingGrants) {
      console.log(`  dangling grant: ${name} — the secret it names no longer exists`);
    }
    for (const slot of status.declaredHere) {
      console.log(
        `  declared here: ${slot.name} — ${slot.hasValue ? "has a value" : "no value yet"}, not granted to this box`,
      );
      for (const line of formatSecretUsesLines(slot.uses)) console.log(`    ${line}`);
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
// ruleset caps a function at two positional parameters (the `bbx hub add-box`
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

const declareCmd = secretsCommand
  .command("declare")
  .description("Create an empty, ungranted slot for a secret you need (the agent-facing surface)")
  .argument("<name>", "Secret name")
  .option("--note <note>", "What this secret is for, and where to obtain it")
  .option("--format-hint <hint>", "Expected shape of the value, e.g. a prefix")
  // Repeatable and additive: one key usually earns its grant several times over,
  // and a second trick's reason must not overwrite the first's.
  .option("--use <reason>", "Why you need it, repeatable", (value: string, previous: string[]) => [...previous, value], []);

declareCmd.action(async (name: string) => {
  const options = declareCmd.opts<{ note?: string; formatHint?: string; use?: string[] }>();
  await runDeclareSecret({ name, note: options.note, formatHint: options.formatHint, uses: options.use });
});

secretsCommand
  .command("list")
  .description("List secret names and metadata across the machine (never values)")
  .option("--agent-confirmed", AGENT_CONFIRMED_HELP)
  .action(async (options: { agentConfirmed?: boolean }) => {
    await runListSecrets(options);
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

// The two bulk/provisioning subcommands live in their own module (the file-size
// rule, and they share only the guards in `cli/lib/secrets-guard.ts`).
secretsCommand.addCommand(describeCommand);
secretsCommand.addCommand(copyGrantsCommand);
secretsCommand.addCommand(migrateCommand);
