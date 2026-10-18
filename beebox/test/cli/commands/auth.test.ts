// # `bbx auth` — headless account management (plan Track F)
//
// `src/cli/commands/auth.ts` operates directly on the credential store
// (`src/webapp/local-users.ts`) — no HTTP, so it needs no setup token and works
// over SSH/CI. Each subcommand's body is an exported plain function
// (`runCreateUser`, `runAddUser`, `runSetPassword`, `runList`, `runRemoveUser`),
// called directly here rather than spawning the CLI as a subprocess — the same
// approach `test/cli/commands/upgrade.doctest.md` and `view-check.doctest.md`
// use for exercising command logic. Every case drives `--password-file` so the
// run is non-interactive; the interactive no-echo prompt path isn't exercised
// by this tier (there's no TTY in the test harness to drive it against).

import { test } from "tap";
import "agent-doctest/tap";
import { isoDate, str } from "agent-doctest/check";
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

// Small work factor keeps scrypt fast in tests (same seam local-users.doctest.md uses).
process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
// Keep the agent-safety guard deterministic when the suite itself runs in a TTY.
process.stdin.isTTY = false;

const dir = await mkdtemp(join(tmpdir(), "bbx-auth-cli-"));
process.env.BBX_AUTH_FILE = join(dir, "auth.json");
delete process.env.BBX_OWNER_EMAIL;

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
    throw new Error("__doctest_process_exit__");
  };
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__doctest_process_exit__") throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
  return { logs, errors, exitCode };
}

// ## Create the first (owner) user, then list
void test("Create the first (owner) user, then list", async (t) => {
  // doctest:L75
  const ownerPw = await passwordFile("correct horse battery");
  const created = await runCaptured(() =>
    runCreateUser({ agentConfirmed: true,  email: "Owner@Example.com", name: "Owner Person", passwordFile: ownerPw })
  );
  t.check(created.logs.join("\n"), "Created owner owner@example.com (Owner Person).");

  // doctest:L82
  t.check(created.exitCode, undefined);

  // doctest:L85
  const listed = await runCaptured(() => { runList(); });
  t.check(listed.logs.join("\n"), str`owner	owner@example.com	Owner Person	${isoDate()}`);

  // ## A second `create-user` refuses — clean message, exit 1, no stack trace

  // doctest:L93
  const secondPw = await passwordFile("whatever");
  const second = await runCaptured(() =>
    runCreateUser({ agentConfirmed: true,  email: "other@example.com", name: "Other", passwordFile: secondPw })
  );
  t.check(second.exitCode, 1);

  // doctest:L100
  t.check(second.errors.join("\n"), "A user with email other@example.com already exists.");

  // ## `add-user` creates a member; list shows both

  // doctest:L107
  const memberPw = await passwordFile("s3cret-member");
  const added = await runCaptured(() =>
    runAddUser({ agentConfirmed: true,  email: "Member@Example.com", name: "Member Person", passwordFile: memberPw })
  );
  t.check(added.logs.join("\n"), "Added member member@example.com (Member Person).");

  // doctest:L114
  const afterAdd = await runCaptured(() => { runList(); });
  await t.checkText(afterAdd.logs.join("\n"), `owner	owner@example.com	Owner Person	«date»
member	member@example.com	Member Person	«date»`);

  // ## `set-password` bumps the generation

  // doctest:L123
  const newPw = await passwordFile("n3w-secret");
  const changed = await runCaptured(() =>
    runSetPassword({ agentConfirmed: true,  email: "member@example.com", passwordFile: newPw })
  );
  t.check(changed.logs.join("\n"), "Password updated for member@example.com (generation 2 — prior sessions revoked).");

  // ## `remove-user` removes a member, but refuses to remove the owner

  // doctest:L134
  const removed = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "member@example.com" }));
  t.check(removed.logs.join("\n"), "Removed member@example.com.");

  // doctest:L138
  const afterRemove = await runCaptured(() => { runList(); });
  t.check(afterRemove.logs.join("\n"), str`owner	owner@example.com	Owner Person	${isoDate()}`);

  // doctest:L142
  const removeOwner = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "owner@example.com" }));
  t.check(removeOwner.exitCode, 1);

  // doctest:L146
  t.check(removeOwner.errors.join("\n"), "Refusing to remove the owner account (owner@example.com).");

  // ## Credential changes refuse to run unsupervised in an agent session
  //
  // Every case above passes `agentConfirmed: true`, because a doctest is exactly the
  // sanctioned non-interactive automation the flag exists to declare. Without it, a
  // caller that looks like an agent is refused.
  //
  // This guard exists because an agent reset the boxholder's password to manufacture
  // credentials for a test (2026-07-30), having assumed the auth store was scoped to
  // the box it was standing in. It is not — one file backs every local box — and the
  // change was irreversible.

  // doctest:L162
  const guardPw = await passwordFile("does-not-matter");
  const blocked = await runCaptured(() => runSetPassword({
    email: "owner@example.com",
    passwordFile: guardPw,
  }));
  t.check(blocked.exitCode, 1);

  // The refusal names the blast radius the caller probably has not checked, and
  // points at asking a human rather than working around the missing credential:

  // doctest:L175
  const message = blocked.errors.join("\n");
  t.check(
    {
      saysAgent: message.includes("looks like an agent session"),
      namesGlobalScope: message.includes("GLOBAL"),
      saysUnrecoverable: message.includes("cannot be recovered"),
      namesTheFlag: message.includes("--agent-confirmed"),
      saysAsk: message.includes("stop and ask"),
    },
    {
    saysAgent: true,
    namesGlobalScope: true,
    saysUnrecoverable: true,
    namesTheFlag: true,
    saysAsk: true,
  },
  );

  // The password is genuinely unchanged — the guard refuses before any write:

  // doctest:L189
  const stillThere = await runCaptured(() => { runList(); });
  await t.checkText(stillThere.logs.join("\n").includes("owner@example.com"), "true");

  // Removal is guarded the same way — it is the other irreversible one:

  // doctest:L197
  const blockedRemove = await runCaptured(() => runRemoveUser({ email: "owner@example.com" }));
  t.check({ exitCode: blockedRemove.exitCode, refused: blockedRemove.errors.join("\n").includes("agent session") }, {
    exitCode: 1,
    refused: true,
  });

  // Read-only `list` is never gated — inspecting who exists is not a credential change:

  // doctest:L205
  const listedUnguarded = await runCaptured(() => { runList(); });
  t.check({ exitCode: listedUnguarded.exitCode ?? 0, hasOwner: listedUnguarded.logs.join("\n").includes("owner@example.com") }, {
    exitCode: 0,
    hasOwner: true,
  });
});
