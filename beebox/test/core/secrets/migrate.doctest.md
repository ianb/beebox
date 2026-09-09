# Migrating per-box secret files into the store

`bbx secrets migrate` is the one-time move from every box's
`_config/connectors/*.secret.json` into the machine store
(`docs/implemented-plans/secret-custody.md`, "Rollout shape"). Three boxes below stand in
for a real machine: two that share one Mistral key, one that has a *different*
one, a Deepgram file (multi-field), a Telegram file (structurally per-box), an
OAuth *token* file that must not be migrated at all, and a malformed file.

Values are obvious placeholders, and the point of several assertions is that
none of them appears in the output.

```ts setup
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCopyGrants, runMigrateSecrets } from "../../../src/cli/commands/secrets-migrate.js";
import { listSecrets, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { loadSecretStore } from "../../../src/core/secrets/store.js";

/** A minimal shapeVersion-3 box whose slug is its (one) root directory name. */
async function makeBox(root, slug, files) {
  const boxRoot = join(root, slug);
  await mkdir(join(boxRoot, "_config", "connectors"), { recursive: true });
  await mkdir(join(boxRoot, ".beebox"), { recursive: true });
  await writeFile(join(boxRoot, "package.json"), JSON.stringify({ name: slug, dependencies: { "beebox": "*" } }));
  await writeFile(join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(boxRoot, "_config", "connectors", name), content);
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
  const dir = await mkdtemp(join(tmpdir(), "bbx-migrate-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
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
for `mistral`, which gamma is not granted, so gamma's Mistral connector reads as
not configured until the boxholder decides which key it should use. Its legacy
file is left in place but is no longer a fallback — a name that exists in the
store fails closed on a refusal (`src/core/secrets/legacy-fallback.ts`), which
is what makes a revoked grant actually revoke.

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
            Readers ask for "mistral" and "gamma" holds no grant for it, so that connector reads as NOT CONFIGURED — a name that exists in the store no longer falls back to a legacy file. Decide which key the box should use, then grant it.
  skipped <boxes>/gamma/_config/connectors/google.secret.json — no store name is defined for "google" — left in place
  skipped <boxes>/gamma/_config/connectors/openai.secret.json — unreadable or not valid JSON («*»)
Dry run — nothing was written.
```

`google.secret.json` holding OAuth *tokens* is exactly why an unrecognized file
is reported rather than imported under a guessed name: an entry no reader ever
asks for would be a credential moved for nothing.

```ts continue
print(`store file exists: ${existsSync(process.env.BBX_SECRETS_FILE)}`);
=> store file exists: false
```

Not merely "an empty store" — the file itself must not appear. Planning reads
lock-free rather than going through `mutateSecretStore`, which always writes
back what its callback saw.

## Applying it

The same plan, written under one lock. Multi-field credentials become the JSON
string their consumer parses (`secrets/json-secret.ts`), with a fixed key order
so two boxes holding one credential dedupe instead of differing by key order.

```ts continue
const applied = await runCaptured(() => runMigrateSecrets({ root: boxes, agentConfirmed: true }));
print(applied.logs.slice(-4).join("\n"));
=>
Created 4 entries, wrote 5 grants, left 0 existing entries untouched.
1 box/name pair(s) held a conflicting value and were parked — see the CONFLICT lines above.
The original files are LEFT IN PLACE — readers still fall back to them during the transition.
Check each box with `bbx secrets status <box>`, then delete the files in a separate pass.
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
print(again.logs.find((line) => line.startsWith("Created")));
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

Two ways to copy nothing are deliberately worded differently, because
`deploy/add-box.sh` reads them: a source with **no grants at all** is a machine
that predates the store, and the script falls back to the old file copy; a
source whose grants are **all single-box** must NOT trigger that fallback, or
the new box would be handed the very Telegram token the skip just refused.

```ts continue
const noGrants = await runCaptured(() => runCopyGrants({ fromBoxOrRoot: "zeta", toBoxOrRoot: "delta", agentConfirmed: true }));
const onlySingle = await runCaptured(() => runCopyGrants({ fromBoxOrRoot: "gamma", toBoxOrRoot: "delta", agentConfirmed: true }));
print(noGrants.logs[0]);
print(onlySingle.logs[0]);
=>
Nothing copied: "zeta" has no grants at all.
Nothing copied: every grant "gamma" holds is single-box.
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

## A value already in the store wins its name

The dangerous case: the store already holds `mistral`, and a box's legacy file
holds a *different* key. Granting that box `mistral` would silently switch it
onto another box's credential — silently, because the grant succeeds and the
legacy fallback then never runs. So the stored value keeps the name, only boxes
whose file matches it are granted, and every other distinct value is parked:
ONE entry per distinct value, not one per box, so two boxes that agree with each
other still share an entry.

```ts
const machine = await makeMachine();
await setSecret({ name: "mistral", value: JSON.parse(MISTRAL_SHARED).apiKey + "-rotated" });

const planned = await runCaptured(() => runMigrateSecrets({ root: machine.boxes, dryRun: true }));
print(planned.logs.filter((line) => line.includes("mistral")).join("\n"));
=>
  mistral — already in the store (left as it is); grants: 
  mistral/alpha — new entry, single-box; grants: alpha, beta
  mistral/gamma — new entry, single-box; grants: gamma
  CONFLICT: "alpha" holds a different value for "mistral" than the box that kept that name. Its value is parked as "mistral/alpha".
            Readers ask for "mistral" and "alpha" holds no grant for it, so that connector reads as NOT CONFIGURED — a name that exists in the store no longer falls back to a legacy file. Decide which key the box should use, then grant it.
  CONFLICT: "beta" holds a different value for "mistral" than the box that kept that name. Its value is parked as "mistral/alpha".
            Readers ask for "mistral" and "beta" holds no grant for it, so that connector reads as NOT CONFIGURED — a name that exists in the store no longer falls back to a legacy file. Decide which key the box should use, then grant it.
  CONFLICT: "gamma" holds a different value for "mistral" than the box that kept that name. Its value is parked as "mistral/gamma".
            Readers ask for "mistral" and "gamma" holds no grant for it, so that connector reads as NOT CONFIGURED — a name that exists in the store no longer falls back to a legacy file. Decide which key the box should use, then grant it.
```

Applying it grants nobody the rotated key they do not have:

```ts continue
const applied = await runCaptured(() => runMigrateSecrets({ root: machine.boxes, agentConfirmed: true }));
print(applied.logs.slice(-4).join("\n"));
const grants = (await loadSecretStore()).value.grants;
print(`alpha: ${JSON.stringify(grants["alpha"])}`);
=>
Created 4 entries, wrote 5 grants, left 1 existing entry untouched.
3 box/name pair(s) held a conflicting value and were parked — see the CONFLICT lines above.
The original files are LEFT IN PLACE — readers still fall back to them during the transition.
Check each box with `bbx secrets status <box>`, then delete the files in a separate pass.
alpha: {"mistral/alpha":"server","telegram-bot/alpha":"server"}
```

```ts cleanup
await rm(machine.dir, { recursive: true, force: true });
```
