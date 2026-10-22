// # `bbx auth` — headless account management (plan Track F)
//
// `src/cli/commands/auth.ts` operates directly on the credential store
// (`src/webapp/local-users.ts`) — no HTTP, so it needs no setup token and works
// over SSH/CI. Each subcommand's body is an exported plain function
// (`runCreateUser`, `runAddUser`, `runSetPassword`, `runList`, `runRemoveUser`),
// called directly here rather than spawning the CLI as a subprocess — the same
// approach `test/cli/commands/upgrade.test.ts` and `test/cli/commands/view/command.check.test.ts`
// use for exercising command logic. Every case drives `--password-file` so the
// run is non-interactive; the interactive no-echo prompt path isn't exercised
// by this tier (there's no TTY in the test harness to drive it against).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCreateUser,
  runAddUser,
  runSetPassword,
  runList,
  runRemoveUser,
} from "../../../src/cli/commands/auth.js";

// Small work factor keeps scrypt fast in tests (same seam test/webapp/local-users.test.ts uses).
process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
// Keep the agent-safety guard deterministic when the suite itself runs in a TTY.
process.stdin.isTTY = false;

const dir = await mkdtemp(join(tmpdir(), "bbx-auth-cli-"));
process.env.BBX_AUTH_FILE = join(dir, "auth.json");
delete process.env.BBX_OWNER_EMAIL;

/** The agent-session refusal for `action`; only the detection reason varies with the environment. */
const refusal = (action: string) => str`Refusing to ${action}: this looks like an agent session (${any(String)}).

The local auth file (${join(dir, "auth.json")}) is GLOBAL — it backs every local
box on this machine, not just the box you are standing in. Changing a password
also revokes that user's live sessions, and the old password cannot be recovered
(it is stored only as a scrypt hash).

If the person you are working for explicitly asked you to do this, re-run with
--agent-confirmed.

If you are trying to authenticate so you can test something: stop and ask them
instead. Needing credentials you were not given is a question for a human, not
an obstacle to work around.`;

async function passwordFile(password: string) {
  const file = join(dir, `pw-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(file, `${password}\n`);
  return file;
}

/**
 * Run a `run*` action with console.log/console.error captured and
 * `process.exit` trapped (the actions call `process.exit(1)` on a known auth
 * error — letting that reach the real `process.exit` would kill the test
 * runner, so it's swapped for a throw-and-catch during the call only).
 */
async function runCaptured(fn: () => unknown) {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;
  let exitCode: number | undefined;
  console.log = (...args) => { logs.push(args.join(" ")); };
  console.error = (...args) => { errors.push(args.join(" ")); };
  process.exit = (code?: number | string | null) => {
    exitCode = Number(code ?? 0);
    throw new Error("__test_process_exit__");
  };
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__test_process_exit__") throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
  return { logs, errors, exitCode };
}

// ## Create the first (owner) user, then list
void test("Create the first (owner) user, then list", async (t) => {
  const ownerPw = await passwordFile("correct horse battery");
  const created = await runCaptured(() =>
    runCreateUser({ agentConfirmed: true,  email: "Owner@Example.com", name: "Owner Person", passwordFile: ownerPw })
  );
  t.check(created, { logs: ["Created owner owner@example.com (Owner Person)."], errors: [], exitCode: undefined });

  const listed = await runCaptured(() => { runList(); });
  t.check(listed, { logs: [str`owner	owner@example.com	Owner Person	${isoDate()}`], errors: [], exitCode: undefined });

  // ## A second `create-user` refuses — clean message, exit 1, no stack trace

  const secondPw = await passwordFile("whatever");
  const second = await runCaptured(() =>
    runCreateUser({ agentConfirmed: true,  email: "other@example.com", name: "Other", passwordFile: secondPw })
  );
  t.check(second, { logs: [], errors: ["A user with email other@example.com already exists."], exitCode: 1 });

  // ## `add-user` creates a member; list shows both

  const memberPw = await passwordFile("s3cret-member");
  const added = await runCaptured(() =>
    runAddUser({ agentConfirmed: true,  email: "Member@Example.com", name: "Member Person", passwordFile: memberPw })
  );
  t.check(added, { logs: ["Added member member@example.com (Member Person)."], errors: [], exitCode: undefined });

  const afterAdd = await runCaptured(() => { runList(); });
  t.check(afterAdd, {
    logs: [
      str`owner	owner@example.com	Owner Person	${isoDate()}`,
      str`member	member@example.com	Member Person	${isoDate()}`,
    ],
    errors: [],
    exitCode: undefined,
  });

  // ## `set-password` bumps the generation

  const newPw = await passwordFile("n3w-secret");
  const changed = await runCaptured(() =>
    runSetPassword({ agentConfirmed: true,  email: "member@example.com", passwordFile: newPw })
  );
  t.check(changed, { logs: ["Password updated for member@example.com (generation 2 — prior sessions revoked)."], errors: [], exitCode: undefined });

  // ## `remove-user` removes a member, but refuses to remove the owner

  const removed = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "member@example.com" }));
  t.check(removed, { logs: ["Removed member@example.com."], errors: [], exitCode: undefined });

  const afterRemove = await runCaptured(() => { runList(); });
  t.check(afterRemove, { logs: [str`owner	owner@example.com	Owner Person	${isoDate()}`], errors: [], exitCode: undefined });

  const removeOwner = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "owner@example.com" }));
  t.check(removeOwner, { logs: [], errors: ["Refusing to remove the owner account (owner@example.com)."], exitCode: 1 });

  // ## Credential changes refuse to run unsupervised in an agent session
  //
  // Every case above passes `agentConfirmed: true`, because a test is exactly the
  // sanctioned non-interactive automation the flag exists to declare. Without it, a
  // caller that looks like an agent is refused.
  //
  // This guard exists because an agent reset the boxholder's password to manufacture
  // credentials for a test (2026-07-30), having assumed the auth store was scoped to
  // the box it was standing in. It is not — one file backs every local box — and the
  // change was irreversible.

  const guardPw = await passwordFile("does-not-matter");
  const blocked = await runCaptured(() => runSetPassword({
    email: "owner@example.com",
    passwordFile: guardPw,
  }));
  t.check(blocked, { logs: [], errors: [refusal("change a password"), "__test_process_exit__"], exitCode: 1 });

  // The refusal names the blast radius the caller probably has not checked, and
  // points at asking a human rather than working around the missing credential:

  // The password is genuinely unchanged — the guard refuses before any write:

  const stillThere = await runCaptured(() => { runList(); });
  t.check(stillThere, { logs: [str`owner	owner@example.com	Owner Person	${isoDate()}`], errors: [], exitCode: undefined });

  // Removal is guarded the same way — it is the other irreversible one:

  const blockedRemove = await runCaptured(() => runRemoveUser({ email: "owner@example.com" }));
  t.check(blockedRemove, { logs: [], errors: [refusal("remove an account"), "__test_process_exit__"], exitCode: 1 });

  // Read-only `list` is never gated — inspecting who exists is not a credential change:

  const listedUnguarded = await runCaptured(() => { runList(); });
  t.check(listedUnguarded, { logs: [str`owner	owner@example.com	Owner Person	${isoDate()}`], errors: [], exitCode: undefined });
});
