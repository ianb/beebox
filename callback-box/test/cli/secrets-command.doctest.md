# `cb secrets` — the CLI plumbing

`src/cli/commands/secrets.ts` is plumbing for deploy scripts, the migration,
emergencies, and agents. Two rules live in the CLI rather than in the store: a
value never comes from argv, and mutations refuse in an agent session without
`--agent-confirmed` (the `cb auth` pattern). Each subcommand body is an exported
function, called directly here rather than spawning the CLI.

Values below are obvious placeholders.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDeclareSecret,
  runGrantSecret,
  runListSecrets,
  runRevokeSecret,
  runSecretsStatus,
  runSetSecret,
} from "../../src/cli/commands/secrets.js";
import { setSecret } from "../../src/core/secrets/lifecycle.js";

// The guard is deliberately loose — a non-TTY stdin alone reads as "agent".
// Pinning both signals keeps these cases deterministic wherever the suite runs.
process.stdin.isTTY = false;
process.env.CLAUDECODE = "1";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-cli-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** Run a `run*` action with console output captured and `process.exit` trapped. */
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
    if (!(e instanceof Error) || e.message !== "__doctest_process_exit__") throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
  return { logs, errors, exitCode };
}
```

## A value in argument position is refused

`ps` and shell history see every argument, so the argv form is rejected before
anything else happens — including before the agent check, so the message an
operator sees names the real problem.

```ts
const dir = await useTempStore();
const refused = await runCaptured(() =>
  runSetSecret({ name: "mistral", argvValue: "placeholder-value-1", agentConfirmed: true }),
);
const message = refused.errors.join("\n");
print(`exit: ${refused.exitCode}`);
print(`names the leak: ${message.includes("visible to")} ${message.includes("shell history")}`);
print(`shows the pipe form: ${message.includes(`printf %s "$VALUE" | cb secrets set mistral`)}`);
=>
exit: 1
names the leak: true true
shows the pipe form: true
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## Mutations refuse in an agent session; `declare` does not

`grant` hands another box a live credential, so it needs a human's explicit
say-so. `declare` — name a slot you need — is the agent's own surface: it can
neither disclose nor empower anything, so it runs unguarded.

```ts
const dir = await useTempStore();
await setSecret({ name: "mistral", value: "placeholder-value-2" });

const blocked = await runCaptured(() => runGrantSecret({ boxOrRoot: "demo-box", name: "mistral" }));
print(`exit: ${blocked.exitCode}`);
print(`named the session: ${blocked.errors.join("\n").includes("this looks like an agent session")}`);
print(`pointed at declare: ${blocked.errors.join("\n").includes("cb secrets declare")}`);
const after = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box" }));
print(`granted anything: ${!after.logs.join("\n").includes("granted: none")}`);

const declared = await runCaptured(() => runDeclareSecret({ name: "weatherapi", note: "for a trick" }));
print(`declare exit: ${declared.exitCode}`);
print(declared.logs.join("\n"));
=>
exit: 1
named the session: true
pointed at declare: true
granted anything: false
declare exit: undefined
Declared "weatherapi" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it.
```

With `--agent-confirmed` — the flag that asserts a human asked — the same grant
goes through, and `status` reports it:

```ts continue
const granted = await runCaptured(() =>
  runGrantSecret({ boxOrRoot: "demo-box", name: "mistral", access: "agent", agentConfirmed: true }),
);
print(granted.logs.join("\n"));
const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box" }));
print(status.logs.join("\n"));
=>
Granted "mistral" to "demo-box" with agent access.
Box: demo-box
  granted: mistral (agent)
```

An unknown access level is refused rather than silently downgraded:

```ts continue
const bad = await runCaptured(() =>
  runGrantSecret({ boxOrRoot: "demo-box", name: "mistral", access: "root", agentConfirmed: true }),
);
print(`exit: ${bad.exitCode}`);
print(bad.errors.join("\n"));
=>
exit: 1
Unknown access level "root" — use "server" (default) or "agent".
```

```ts continue
const revoked = await runCaptured(() =>
  runRevokeSecret({ boxOrRoot: "demo-box", name: "mistral", agentConfirmed: true }),
);
print(revoked.logs.join("\n"));
=> Revoked "mistral" from "demo-box".
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## `list` prints names and metadata, never values

```ts
const dir = await useTempStore();
await setSecret({ name: "mistral", value: "placeholder-value-3", note: "transcription" });
const listed = await runCaptured(() => runListSecrets());
print(`leaks the value: ${listed.logs.join("\n").includes("placeholder-value-3")}`);
print(listed.logs.join("\n"));
=>
leaks the value: false
mistral	set	updated=«*»	grants=none	note=transcription
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
