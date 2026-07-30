/**
 * `cb auth` — manage local username/password accounts (`src/webapp/local-users.ts`).
 *
 * The headless twin of the browser setup flow (plan Track F,
 * `docs/plans/local-password-auth.md`): every subcommand operates directly on
 * the auth file, no HTTP involved, so it works over SSH/CI and needs no setup
 * token — running as the file's owner already is the authority.
 *
 * Password input has two paths: `--password-file <path>` (non-interactive —
 * required for scripts/CI/doctests, trailing newline stripped) or an
 * interactive no-echo TTY prompt (raw-mode keystroke capture, no readline
 * private-API reliance) with confirmation on account-creating commands.
 *
 * Each subcommand's body is exported as a plain async function
 * (`runCreateUser`, `runAddUser`, …) separate from the Commander wiring, so
 * `test/cli/auth-command.doctest.md` calls them directly — the `upgrade.ts`/
 * `view.ts` precedent for testing CLI command logic without spawning a
 * subprocess.
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import {
  createFirstUser,
  addUser,
  setPassword,
  removeUser,
  listUsers,
  authFilePath,
  type LocalUser,
} from "../../webapp/local-users.js";
import { detectAgentContext } from "../../lib/agent-context.js";
import {
  AuthStoreUnavailableError,
  LastOwnerRemovalError,
  NoOwnerError,
  NoSuchUserError,
  OwnerEmailMismatchError,
  OwnerExistsError,
  UserExistsError,
} from "../../webapp/local-users-errors.js";
import { errorMessage } from "../../lib/error-guards.js";

/** The known, clean-message errors `local-users.ts` throws — never a bare stack trace for these. */
const KNOWN_AUTH_ERROR_CLASSES = [
  AuthStoreUnavailableError,
  LastOwnerRemovalError,
  NoOwnerError,
  NoSuchUserError,
  OwnerEmailMismatchError,
  OwnerExistsError,
  UserExistsError,
];

function isKnownAuthError(e: unknown): e is Error {
  return KNOWN_AUTH_ERROR_CLASSES.some((cls) => e instanceof cls);
}

export class NoTtyError extends Error {
  constructor() {
    super("stdin is not an interactive terminal; pass --password-file instead of prompting.");
    this.name = "NoTtyError";
  }
}

export class PromptCancelledError extends Error {
  constructor() {
    super("Password entry cancelled.");
    this.name = "PromptCancelledError";
  }
}

export class PasswordMismatchError extends Error {
  constructor() {
    super("Passwords did not match.");
    this.name = "PasswordMismatchError";
  }
}

// --- password / text input ---------------------------------------------------

/**
 * No-echo password prompt: raw-mode keystroke capture rather than readline's
 * undocumented output-muting private API. Handles Enter, Ctrl-C, and
 * backspace; every other keystroke is appended verbatim.
 */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new NoTtyError());
      return;
    }
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const CTRL_C_CHARCODE = 3;
    const BACKSPACE_CHARCODE = 127;
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        const code = char.codePointAt(0);
        if (char === "\n" || char === "\r") {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (code === CTRL_C_CHARCODE) {
          cleanup();
          process.stdout.write("\n");
          reject(new PromptCancelledError());
          return;
        }
        if (code === BACKSPACE_CHARCODE || char === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function promptText(label: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(label);
  } finally {
    rl.close();
  }
}

/** A trailing newline is the only thing stripped — a password's own leading/interior whitespace is significant. */
async function readPasswordFile(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf-8");
  return raw.replace(/\r?\n$/, "");
}

async function resolvePassword(opts: { passwordFile: string | undefined; confirm: boolean }): Promise<string> {
  if (opts.passwordFile) return readPasswordFile(opts.passwordFile);
  const password = await promptHidden("Password: ");
  if (opts.confirm) {
    const confirmation = await promptHidden("Confirm password: ");
    // eslint-disable-next-line security/detect-possible-timing-attacks -- not a secret-vs-guess compare: both values are the same local operator's own two keystrokes-in-flight, never a stored credential, so there's no attacker-observable channel to time.
    if (password !== confirmation) throw new PasswordMismatchError();
  }
  return password;
}

// --- output -------------------------------------------------------------------

function formatUserLine(user: LocalUser): string {
  return `${user.role}\t${user.email}\t${user.name}\t${user.created}`;
}

/**
 * Refuse an irreversible credential change when the caller looks like an agent,
 * unless a human explicitly sanctioned it with `--agent-confirmed`.
 *
 * The failure this prevents (2026-07-30): an agent hit a login wall while
 * driving the browser for a test, ran `set-password` to manufacture credentials,
 * and only afterwards found out the auth file is GLOBAL — one file behind every
 * local box, not per-box like the rest of a box's state. It reset the
 * boxholder's real password (scrypt, unrecoverable) and revoked their live
 * sessions, to get past a wall that turned out not to be what was blocking it
 * anyway.
 *
 * The message therefore does two jobs: state the blast radius the agent
 * probably has not checked, and name the correct move — ask, rather than
 * engineer around missing credentials.
 */
function refuseIfUnconfirmedAgent(opts: { action: string; agentConfirmed: boolean | undefined }): void {
  if (opts.agentConfirmed === true) return;
  const context = detectAgentContext();
  if (!context.isAgent) return;
  console.error(
    [
      `Refusing to ${opts.action}: this looks like an agent session (${context.reason}).`,
      "",
      `The local auth file (${authFilePath()}) is GLOBAL — it backs every local`,
      "box on this machine, not just the box you are standing in. Changing a password",
      "also revokes that user's live sessions, and the old password cannot be recovered",
      "(it is stored only as a scrypt hash).",
      "",
      "If the person you are working for explicitly asked you to do this, re-run with",
      "--agent-confirmed.",
      "",
      "If you are trying to authenticate so you can test something: stop and ask them",
      "instead. Needing credentials you were not given is a question for a human, not",
      "an obstacle to work around.",
    ].join("\n"),
  );
  process.exit(1);
}

// --- subcommand bodies (exported for direct testing) --------------------------

export async function runCreateUser(opts: { email?: string; name?: string; passwordFile?: string; agentConfirmed?: boolean }): Promise<void> {
  try {
    refuseIfUnconfirmedAgent({ action: "create an account", agentConfirmed: opts.agentConfirmed });
    const email = opts.email ?? (await promptText("Owner email: "));
    const name = opts.name ?? (await promptText("Owner name: "));
    const password = await resolvePassword({ passwordFile: opts.passwordFile, confirm: true });
    const owner = await createFirstUser({ email, name, password });
    console.log(`Created owner ${owner.email} (${owner.name}).`);
  } catch (e) {
    console.error(isKnownAuthError(e) ? e.message : errorMessage(e));
    process.exit(1);
  }
}

export async function runAddUser(opts: { email?: string; name?: string; passwordFile?: string; agentConfirmed?: boolean }): Promise<void> {
  try {
    refuseIfUnconfirmedAgent({ action: "add an account", agentConfirmed: opts.agentConfirmed });
    const email = opts.email ?? (await promptText("Member email: "));
    const name = opts.name ?? (await promptText("Member name: "));
    const password = await resolvePassword({ passwordFile: opts.passwordFile, confirm: true });
    const member = await addUser({ email, name, password, role: "member" });
    console.log(`Added member ${member.email} (${member.name}).`);
  } catch (e) {
    console.error(isKnownAuthError(e) ? e.message : errorMessage(e));
    process.exit(1);
  }
}

export async function runSetPassword(opts: { email?: string; passwordFile?: string; agentConfirmed?: boolean }): Promise<void> {
  try {
    refuseIfUnconfirmedAgent({ action: "change a password", agentConfirmed: opts.agentConfirmed });
    const email = opts.email ?? (await promptText("Email: "));
    const password = await resolvePassword({ passwordFile: opts.passwordFile, confirm: true });
    const user = await setPassword({ email, password });
    console.log(`Password updated for ${user.email} (generation ${user.gen} — prior sessions revoked).`);
  } catch (e) {
    console.error(isKnownAuthError(e) ? e.message : errorMessage(e));
    process.exit(1);
  }
}

export function runList(): void {
  const users = listUsers();
  if (users.length === 0) {
    console.log("No local users.");
    return;
  }
  for (const user of users) console.log(formatUserLine(user));
}

export async function runRemoveUser(opts: { email?: string; agentConfirmed?: boolean }): Promise<void> {
  try {
    refuseIfUnconfirmedAgent({ action: "remove an account", agentConfirmed: opts.agentConfirmed });
    const email = opts.email ?? (await promptText("Email to remove: "));
    await removeUser({ email });
    console.log(`Removed ${email}.`);
  } catch (e) {
    console.error(isKnownAuthError(e) ? e.message : errorMessage(e));
    process.exit(1);
  }
}

// --- Commander wiring -----------------------------------------------------

export const authCommand = new Command("auth").description("Manage local username/password accounts");

authCommand
  .command("create-user")
  .description("Create the first (owner) account — refuses if any user already exists")
  .option("--email <email>", "Owner email")
  .option("--name <name>", "Owner display name")
  .option("--password-file <path>", "Read the password from a file instead of prompting")
  .option("--agent-confirmed", "Proceed even though this looks like an agent session — only when a human explicitly asked")
  .action(async (options: { email?: string; name?: string; passwordFile?: string ; agentConfirmed?: boolean }) => {
    await runCreateUser(options);
  });

authCommand
  .command("add-user")
  .description("Add a member account")
  .option("--email <email>", "Member email")
  .option("--name <name>", "Member display name")
  .option("--password-file <path>", "Read the password from a file instead of prompting")
  .option("--agent-confirmed", "Proceed even though this looks like an agent session — only when a human explicitly asked")
  .action(async (options: { email?: string; name?: string; passwordFile?: string ; agentConfirmed?: boolean }) => {
    await runAddUser(options);
  });

authCommand
  .command("set-password")
  .description("Change a user's password (revokes their outstanding sessions)")
  .option("--email <email>", "User email")
  .option("--password-file <path>", "Read the password from a file instead of prompting")
  .option("--agent-confirmed", "Proceed even though this looks like an agent session — only when a human explicitly asked")
  .action(async (options: { email?: string; passwordFile?: string ; agentConfirmed?: boolean }) => {
    await runSetPassword(options);
  });

authCommand
  .command("list")
  .description("List local users")
  .action(() => {
    runList();
  });

authCommand
  .command("remove-user")
  .description("Remove a member account (refuses to remove the owner)")
  .option("--email <email>", "User email")
  .option("--agent-confirmed", "Proceed even though this looks like an agent session — only when a human explicitly asked")
  .action(async (options: { email?: string; agentConfirmed?: boolean }) => {
    await runRemoveUser(options);
  });
