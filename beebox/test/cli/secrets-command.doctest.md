# `bbx secrets` — the CLI plumbing

`src/cli/commands/secrets.ts` is plumbing for deploy scripts, the migration,
emergencies, and agents. Two rules live in the CLI rather than in the store: a
value never comes from argv, and mutations refuse in an agent session without
`--agent-confirmed` (the `bbx auth` pattern). Each subcommand body is an exported
function, called directly here rather than spawning the CLI.

Values below are obvious placeholders.

```ts setup
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  runDeclareSecret,
  runGrantSecret,
  runListSecrets,
  runRevokeSecret,
  runSecretsStatus,
  runSetSecret,
} from "../../src/cli/commands/secrets.js";
import { runDescribeSecret } from "../../src/cli/commands/secrets-describe.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";

// The guard is deliberately loose — a non-TTY stdin alone reads as "agent".
// Pinning both signals keeps these cases deterministic wherever the suite runs.
process.stdin.isTTY = false;
process.env.CLAUDECODE = "1";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-cli-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
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
print(`shows the pipe form: ${message.includes(`printf %s "$VALUE" | bbx secrets set mistral`)}`);
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
// The box these `status` calls run in: its slug is its directory's basename,
// so this is the "demo-box" they ask about.
const demoBox = join(dir, "demo-box");
await mkdir(demoBox);

const blocked = await runCaptured(() => runGrantSecret({ boxOrRoot: "demo-box", name: "mistral" }));
print(`exit: ${blocked.exitCode}`);
print(`named the session: ${blocked.errors.join("\n").includes("this looks like an agent session")}`);
print(`pointed at declare: ${blocked.errors.join("\n").includes("bbx secrets declare")}`);
const after = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box", boxRoot: demoBox }));
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
const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box", boxRoot: demoBox }));
print(status.logs.join("\n"));
=>
Granted "mistral" to "demo-box" with agent access.
Box: demo-box
  granted: mistral (agent)
    used for: audio transcription (Voxtral — recordings and live chat dictation); Mistral API calls from box views, through the server-side adapter
```

The `used for` line is the built-in registry's (`src/core/secrets/uses.ts`) — the
boxholder sees what the engine will actually spend a key on without having to
read the code that spends it.

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

## `declare` attributes the slot to the declaring box

Declaring grants nothing, so without attribution the slot would vanish from the
box's own view the moment it was created — and an agent that declared something
last week could not report what it was still waiting on. `declaredBy` is
recorded from the box the command ran in (here passed explicitly; the CLI finds
it from the working directory), and `status` shows it back.

```ts
const dir = await useTempStore();
const boxDir = await mkdtemp(join(tmpdir(), "weather-box-"));

const declared = await runCaptured(() =>
  runDeclareSecret({ name: "weatherapi", note: "for the forecast trick", boxRoot: boxDir }),
);
print(declared.logs.join("\n").replaceAll(basename(boxDir), "<box>"));

const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
print(status.logs.join("\n").replaceAll(basename(boxDir), "<box>"));
=>
Declared "weatherapi" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it.
Attributed to box "<box>" — it shows up in `bbx secrets status <box>`.
Box: <box>
  granted: none
  declared here: weatherapi — no value yet, not granted to this box
```

Once the boxholder supplies the value and grants it, it reports as a grant
instead — a declared slot is only news while it is still waiting:

```ts continue
await setSecret({ name: "weatherapi", value: "placeholder-value-4" });
const granted = await runCaptured(() =>
  runGrantSecret({ boxOrRoot: boxDir, name: "weatherapi", access: "agent", agentConfirmed: true }),
);
const after = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
print(after.logs.join("\n").replaceAll(basename(boxDir), "<box>"));
=>
Box: <box>
  granted: weatherapi (agent)
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
await rm(boxDir, { recursive: true, force: true });
```

## `declare --use` and `describe --add-use` say why a secret exists

Reasons are additive: a second trick spending the same key appends its own
rather than overwriting the first's. Adding one is agent-facing (an agent should
say why it now needs a key); removing one carries the agent guard, because
deleting the line that justified a grant is a human's decision.

```ts
const dir = await useTempStore();
const boxDir = await mkdtemp(join(tmpdir(), "weather-box-"));

await runCaptured(() =>
  runDeclareSecret({ name: "weatherapi", uses: ["forecasts in the morning brief"], boxRoot: boxDir }),
);
const described = await runCaptured(() =>
  runDescribeSecret({ name: "weatherapi", addUses: ["the umbrella reminder trick"], boxRoot: boxDir }),
);
print(described.logs.join("\n"));

const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
print(status.logs.join("\n").replaceAll(basename(boxDir), "<box>"));
=>
"weatherapi" is used for:
  - forecasts in the morning brief
  - the umbrella reminder trick
Box: <box>
  granted: none
  declared here: weatherapi — no value yet, not granted to this box
    also declared: forecasts in the morning brief; the umbrella reminder trick
```

Dropping a reason in an agent session is refused without `--agent-confirmed`:

```ts continue
const blocked = await runCaptured(() =>
  runDescribeSecret({ name: "weatherapi", clearUses: true, boxRoot: boxDir }),
);
print(`exit: ${blocked.exitCode}`);
print(`named the action: ${blocked.errors.join("\n").includes("remove a secret's stated uses")}`);

const cleared = await runCaptured(() =>
  runDescribeSecret({ name: "weatherapi", clearUses: true, agentConfirmed: true }),
);
print(cleared.logs.join("\n"));
=>
exit: 1
named the action: true
"weatherapi" now states no uses of its own.
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
await rm(boxDir, { recursive: true, force: true });
```

## `describe --add-use` is scoped to the agent's own box

Adding a reason is unguarded *for the box the agent is standing in* — its own
grants, and the slots it declared and is still waiting on. Anything else is
refused, because an unguarded write that succeeded for a real name and errored
for an invented one would enumerate the machine's secrets one guess at a time.
So the refusal is uniform: another box's secret and a name that does not exist
get the same words.

```ts
const dir = await useTempStore();
const ownBox = join(dir, "own-box");
await mkdir(ownBox);
await setSecret({ name: "weatherapi", value: "placeholder-value-5" });
await grantSecret({ slug: "own-box", name: "weatherapi", access: "agent" });
await setSecret({ name: "someone-elses", value: "placeholder-value-6" });

const mine = await runCaptured(() =>
  runDescribeSecret({ name: "weatherapi", addUses: ["the umbrella reminder trick"], boxRoot: ownBox }),
);
print(`own-box exit: ${mine.exitCode}`);
print(mine.logs.join("\n"));
=>
own-box exit: undefined
"weatherapi" is used for:
  - the umbrella reminder trick
```

A secret this box holds no grant on, and a name nobody ever declared, are
answered identically — the only difference between the two messages is the name
the caller supplied:

```ts continue
const foreign = await runCaptured(() =>
  runDescribeSecret({ name: "someone-elses", addUses: ["curiosity"], boxRoot: ownBox }),
);
const unknown = await runCaptured(() =>
  runDescribeSecret({ name: "no-such-secret", addUses: ["curiosity"], boxRoot: ownBox }),
);
print(`exits: ${foreign.exitCode} ${unknown.exitCode}`);
print(`same words: ${foreign.errors.join("\n").replaceAll("someone-elses", "X") === unknown.errors.join("\n").replaceAll("no-such-secret", "X")}`);
print(`names the scoping: ${foreign.errors.join("\n").includes(`the box you are working in ("own-box")`)}`);
=>
exits: 1 1
same words: true
names the scoping: true
```

`--agent-confirmed` — a human explicitly asked — carries it through, and outside
a box there is no own-box view at all:

```ts continue
const confirmed = await runCaptured(() =>
  runDescribeSecret({ name: "someone-elses", addUses: ["the boxholder asked"], boxRoot: ownBox, agentConfirmed: true }),
);
print(confirmed.logs.join("\n"));

const nowhere = await runCaptured(() =>
  runDescribeSecret({ name: "weatherapi", addUses: ["curiosity"], boxRoot: null }),
);
print(`outside a box exit: ${nowhere.exitCode}`);
print(`says why: ${nowhere.errors.join("\n").includes("not inside a box")}`);
=>
"someone-elses" is used for:
  - the boxholder asked
outside a box exit: 1
says why: true
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## `list` prints names and metadata, never values

```ts
const dir = await useTempStore();
await setSecret({ name: "mistral", value: "placeholder-value-3", note: "transcription" });
const listed = await runCaptured(() => runListSecrets({ agentConfirmed: true }));
print(`leaks the value: ${listed.logs.join("\n").includes("placeholder-value-3")}`);
print(listed.logs.join("\n"));
=>
leaks the value: false
mistral	set	updated=«*»	grants=none	note=transcription	used for: audio transcription (Voxtral — recordings and live chat dictation); Mistral API calls from box views, through the server-side adapter
```

## An agent sees its own box, not the machine

`list` is the machine-wide inventory — every secret name and which boxes hold
them — so it carries the same agent refusal as the mutations. `status` is
per-box and stays open to an agent, but only for the box the command is
standing in. Neither discloses a value; what is withheld is the map.

```ts continue
const listBlocked = await runCaptured(() => runListSecrets());
print(`list exit: ${listBlocked.exitCode}`);
print(`named the session: ${listBlocked.errors.join("\n").includes("list every secret on this machine")}`);

const ownBox = join(dir, "own-box");
const otherBox = join(dir, "other-box");
await mkdir(ownBox);
await mkdir(otherBox);

const own = await runCaptured(() => runSecretsStatus({ boxOrRoot: "own-box", boxRoot: ownBox }));
print(`own box exit: ${own.exitCode}`);
print(own.logs.join("\n"));

const other = await runCaptured(() => runSecretsStatus({ boxOrRoot: "other-box", boxRoot: ownBox }));
print(`other box exit: ${other.exitCode}`);
print(`says which box it is in: ${other.errors.join("\n").includes(`the box you are working in is "own-box"`)}`);

const nowhere = await runCaptured(() => runSecretsStatus({ boxOrRoot: "own-box", boxRoot: null }));
print(`outside a box exit: ${nowhere.exitCode}`);
print(`says why: ${nowhere.errors.join("\n").includes("not inside a box")}`);
=>
list exit: 1
named the session: true
own box exit: undefined
Box: own-box
  granted: none
other box exit: 1
says which box it is in: true
outside a box exit: 1
says why: true
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
