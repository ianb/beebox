# Migrating per-box secret files into the store

`cb secrets migrate` is the one-time move from every box's
`config/connectors/*.secret.json` into the machine store
(`docs/plans/secret-custody.md`, "Rollout shape"). Three boxes below stand in
for a real machine: two that share one Mistral key, one that has a *different*
one, a Deepgram file (multi-field), a Telegram file (structurally per-box), an
OAuth *token* file that must not be migrated at all, and a malformed file.

Values are obvious placeholders, and the point of several assertions is that
none of them appears in the output.

```ts setup
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCopyGrants, runMigrateSecrets } from "../../../src/cli/commands/secrets-migrate.js";
import { listSecrets } from "../../../src/core/secrets/lifecycle.js";
import { loadSecretStore } from "../../../src/core/secrets/store.js";

/** A minimal v2 box whose slug is its package directory name. */
async function makeBox(root, slug, files) {
  const packageRoot = join(root, slug);
  await mkdir(join(packageRoot, "content", "config", "connectors"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: slug, dependencies: { "callback-box": "*" } }));
  await writeFile(join(packageRoot, "content", ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(packageRoot, "content", "config", "connectors", name), content);
  }
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
  process.exit = (code) => { exitCode = code ?? 0; throw new Error("__doctest_process_exit__"); };
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

const MISTRAL_SHARED = JSON.stringify({ apiKey: "placeholder-shared-mistral" });

async function makeMachine() {
  const dir = await mkdtemp(join(tmpdir(), "cb-migrate-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  const boxes = join(dir, "boxes");
  await mkdir(boxes);
  await makeBox(boxes, "alpha", {
    "mistral.secret.json": MISTRAL_SHARED,
    "telegram.secret.json": JSON.stringify({ botToken: "111:placeholder", webhookSecret: "placeholder-hook" }),
  });
  await makeBox(boxes, "beta", {
    "mistral.secret.json": MISTRAL_SHARED,
    "deepgram.secret.json": JSON.stringify({ projectId: "placeholder-project", apiKey: "placeholder-deepgram" }),
  });
  await makeBox(boxes, "gamma", {
    "mistral.secret.json": JSON.stringify({ apiKey: "placeholder-other-mistral" }),
    "google.secret.json": JSON.stringify({ refresh_token: "placeholder-token" }),
    "openai.secret.json": "{not json",
  });
  return { dir, boxes };
}
```

## The plan: dedupe, park conflicts, leave tokens alone

`--dry-run` writes nothing, so it needs no `--agent-confirmed`. Alpha and beta
hold the same Mistral key, so it becomes ONE entry with two grants — the
property the file-copy status quo could not offer, since rotation now touches
one place. Gamma's differing key is parked under `mistral/gamma`: readers ask
for `mistral`, so gamma keeps working through its legacy file (left in place)
until the boxholder decides which key it should use.

```ts
const { dir, boxes } = await makeMachine();
const planned = await runCaptured(() => runMigrateSecrets({ root: boxes, dryRun: true }));
print(planned.logs.filter((line) => line !== "").join("\n").replaceAll(boxes, "<boxes>"));
=>
Boxes examined: alpha, beta, gamma
  deepgram — new entry; grants: beta
  mistral — new entry; grants: alpha, beta
  mistral/gamma — new entry, single-box; grants: gamma
  telegram-bot/alpha — new entry, single-box; grants: alpha
  CONFLICT: "gamma" holds a different value for "mistral" than the box that kept that name. Its value is parked as "mistral/gamma".
            Readers ask for "mistral", so "gamma" keeps working through its legacy file until you decide which key it should use.
  skipped <boxes>/gamma/content/config/connectors/google.secret.json — no store name is defined for "google" — left in place
  skipped <boxes>/gamma/content/config/connectors/openai.secret.json — unreadable or not valid JSON («*»)
Dry run — nothing was written.
```

`google.secret.json` holding OAuth *tokens* is exactly why an unrecognized file
is reported rather than imported under a guessed name: an entry no reader ever
asks for would be a credential moved for nothing.

```ts continue
const store = await loadSecretStore();
print(`wrote nothing: ${JSON.stringify(store.value)}`);
=> wrote nothing: {"secrets":{},"grants":{}}
```

## Applying it

The same plan, written under one lock. Multi-field credentials become the JSON
string their consumer parses (`secrets/json-secret.ts`), with a fixed key order
so two boxes holding one credential dedupe instead of differing by key order.

```ts continue
const applied = await runCaptured(() => runMigrateSecrets({ root: boxes, agentConfirmed: true }));
print(applied.logs.slice(-3).join("\n"));
=>
Created 4 entries, wrote 5 grants, left 0 existing entries untouched.
The original files are LEFT IN PLACE — readers still fall back to them during the transition.
Check each box with `cb secrets status <box>`, then delete the files in a separate pass.
```

```ts continue
const after = await loadSecretStore();
print(JSON.stringify(after.value.grants, null, 2));
print(`deepgram value: ${after.value.secrets["deepgram"]?.value}`);
print(`single-box flags: ${after.value.secrets["telegram-bot/alpha"]?.shareable} ${after.value.secrets["mistral"]?.shareable}`);
=>
{
  "beta": {
    "deepgram": "server",
    "mistral": "server"
  },
  "alpha": {
    "mistral": "server",
    "telegram-bot/alpha": "server"
  },
  "gamma": {
    "mistral/gamma": "server"
  }
}
deepgram value: {"apiKey":"placeholder-deepgram","projectId":"placeholder-project"}
single-box flags: false undefined
```

Nothing the migration printed carried a value:

```ts continue
const printed = [...planned.logs, ...applied.logs].join("\n");
print(`leaked a key: ${printed.includes("placeholder-shared-mistral") || printed.includes("placeholder-deepgram")}`);
=> leaked a key: false
```

## Re-running is a no-op

An entry already in the store is never rewritten — the migration is safe to run
again after a box is added, and a rotated key is not silently reverted to what
the stale file still holds.

```ts continue
const again = await runCaptured(() => runMigrateSecrets({ root: boxes, agentConfirmed: true }));
print(again.logs.slice(-3)[0]);
=> Created 0 entries, wrote 0 grants, left 4 existing entries untouched.
```

## `copy-grants`: provisioning a new box

What `deploy/add-box.sh --secrets-from` does now. Access levels come across
unchanged; a single-box secret is skipped with a note rather than failing the
run, because the new box needs its own Telegram bot, not alpha's.

```ts continue
const copied = await runCaptured(() => runCopyGrants({ fromBoxOrRoot: "alpha", toBoxOrRoot: "delta", agentConfirmed: true }));
print(copied.logs.join("\n"));
print(`delta now: ${JSON.stringify((await loadSecretStore()).value.grants["delta"])}`);
=>
Granted "mistral" to "delta" with server access (from "alpha").
Skipped "telegram-bot/alpha" — single-box secret (belongs to "alpha") — set this box up with its own.
delta now: {"mistral":"server"}
```

And the store still holds one copy of the shared key, now granted to three
boxes — which is the whole point of the exercise:

```ts continue
const listing = await listSecrets();
print(listing.map((entry) => `${entry.name}: ${Object.keys(entry.grants).join(",")}`).join("\n"));
=>
deepgram: beta
mistral: beta,alpha,delta
mistral/gamma: gamma
telegram-bot/alpha: alpha
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
