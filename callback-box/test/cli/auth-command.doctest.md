# `cb auth` — headless account management (plan Track F)

`src/cli/commands/auth.ts` operates directly on the credential store
(`src/webapp/local-users.ts`) — no HTTP, so it needs no setup token and works
over SSH/CI. Each subcommand's body is an exported plain function
(`runCreateUser`, `runAddUser`, `runSetPassword`, `runList`, `runRemoveUser`),
called directly here rather than spawning the CLI as a subprocess — the same
approach `test/cli/commands/upgrade.doctest.md` and `view-check.doctest.md`
use for exercising command logic. Every case drives `--password-file` so the
run is non-interactive; the interactive no-echo prompt path isn't exercised
by this tier (there's no TTY in the test harness to drive it against).

```ts setup
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCreateUser,
  runAddUser,
  runSetPassword,
  runList,
  runRemoveUser,
} from "../../src/cli/commands/auth.js";

// Small work factor keeps scrypt fast in tests (same seam local-users.doctest.md uses).
process.env.CB_AUTH_SCRYPT_N = String(2 ** 14);

const dir = await mkdtemp(join(tmpdir(), "cb-auth-cli-"));
process.env.CB_AUTH_FILE = join(dir, "auth.json");
delete process.env.CB_OWNER_EMAIL;

async function passwordFile(password) {
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
async function runCaptured(fn) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;
  let exitCode;
  console.log = (...args) => { logs.push(args.join(" ")); };
  console.error = (...args) => { errors.push(args.join(" ")); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error("__doctest_process_exit__");
  };
  try {
    await fn();
  } catch (e) {
    if (e.message !== "__doctest_process_exit__") throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
  return { logs, errors, exitCode };
}
```

## Create the first (owner) user, then list

```ts
const ownerPw = await passwordFile("correct horse battery");
const created = await runCaptured(() =>
  runCreateUser({ agentConfirmed: true,  email: "Owner@Example.com", name: "Owner Person", passwordFile: ownerPw })
);
created.logs.join("\n")
=> Created owner owner@example.com (Owner Person).

created.exitCode
=> undefined

const listed = await runCaptured(() => { runList(); });
listed.logs.join("\n")
=> owner	owner@example.com	Owner Person	«date»
```

## A second `create-user` refuses — clean message, exit 1, no stack trace

```ts continue
const secondPw = await passwordFile("whatever");
const second = await runCaptured(() =>
  runCreateUser({ agentConfirmed: true,  email: "other@example.com", name: "Other", passwordFile: secondPw })
);
second.exitCode
=> 1

second.errors.join("\n")
=> A user with email other@example.com already exists.
```

## `add-user` creates a member; list shows both

```ts continue
const memberPw = await passwordFile("s3cret-member");
const added = await runCaptured(() =>
  runAddUser({ agentConfirmed: true,  email: "Member@Example.com", name: "Member Person", passwordFile: memberPw })
);
added.logs.join("\n")
=> Added member member@example.com (Member Person).

const afterAdd = await runCaptured(() => { runList(); });
afterAdd.logs.join("\n")
=> owner	owner@example.com	Owner Person	«date»
member	member@example.com	Member Person	«date»
```

## `set-password` bumps the generation

```ts continue
const newPw = await passwordFile("n3w-secret");
const changed = await runCaptured(() =>
  runSetPassword({ agentConfirmed: true,  email: "member@example.com", passwordFile: newPw })
);
changed.logs.join("\n")
=> Password updated for member@example.com (generation 2 — prior sessions revoked).
```

## `remove-user` removes a member, but refuses to remove the owner

```ts continue
const removed = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "member@example.com" }));
removed.logs.join("\n")
=> Removed member@example.com.

const afterRemove = await runCaptured(() => { runList(); });
afterRemove.logs.join("\n")
=> owner	owner@example.com	Owner Person	«date»

const removeOwner = await runCaptured(() => runRemoveUser({ agentConfirmed: true,  email: "owner@example.com" }));
removeOwner.exitCode
=> 1

removeOwner.errors.join("\n")
=> Refusing to remove the owner account (owner@example.com).
```

## Credential changes refuse to run unsupervised in an agent session

Every case above passes `agentConfirmed: true`, because a doctest is exactly the
sanctioned non-interactive automation the flag exists to declare. Without it, a
caller that looks like an agent is refused.

This guard exists because an agent reset the boxholder's password to manufacture
credentials for a test (2026-07-30), having assumed the auth store was scoped to
the box it was standing in. It is not — one file backs every local box — and the
change was irreversible.

```ts continue
const guardPw = await passwordFile("does-not-matter");
const blocked = await runCaptured(() => runSetPassword({
  email: "owner@example.com",
  passwordFile: guardPw,
}));
blocked.exitCode
=> 1
```

The refusal names the blast radius the caller probably has not checked, and
points at asking a human rather than working around the missing credential:

```ts continue
const message = blocked.errors.join("\n");
JSON.stringify({
  saysAgent: message.includes("looks like an agent session"),
  namesGlobalScope: message.includes("GLOBAL"),
  saysUnrecoverable: message.includes("cannot be recovered"),
  namesTheFlag: message.includes("--agent-confirmed"),
  saysAsk: message.includes("stop and ask"),
})
=> {"saysAgent":true,"namesGlobalScope":true,"saysUnrecoverable":true,"namesTheFlag":true,"saysAsk":true}
```

The password is genuinely unchanged — the guard refuses before any write:

```ts continue
const stillThere = await runCaptured(() => { runList(); });
stillThere.logs.join("\n").includes("owner@example.com")
=> true
```

Removal is guarded the same way — it is the other irreversible one:

```ts continue
const blockedRemove = await runCaptured(() => runRemoveUser({ email: "owner@example.com" }));
JSON.stringify({ exitCode: blockedRemove.exitCode, refused: blockedRemove.errors.join("\n").includes("agent session") })
=> {"exitCode":1,"refused":true}
```

Read-only `list` is never gated — inspecting who exists is not a credential change:

```ts continue
const listedUnguarded = await runCaptured(() => { runList(); });
JSON.stringify({ exitCode: listedUnguarded.exitCode ?? 0, hasOwner: listedUnguarded.logs.join("\n").includes("owner@example.com") })
=> {"exitCode":0,"hasOwner":true}
```
