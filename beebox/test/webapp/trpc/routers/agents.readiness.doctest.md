# Agents: is there an agent that can run?

A packaged box starts with no agent account. Its boxholder has no shell to
run `claude auth login` in, so the web UI asks `agents.readiness` whether
anything can carry a chat, blocks input when nothing can, and sends the owner
to Admin → Agents. Three providers count: a Claude Code login, a Codex login,
and an OpenRouter key with at least one added model.

```ts setup
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeClaudeCli } from "../../../../src/services/claude-cli.js";
import { createFakeCodexCli } from "../../../../src/services/codex-cli/core.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { CONFIG_RELATIVE_PATH } from "../../../../src/webapp/box-config-write.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

const eventBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };

function callers(boxRoot: string, services: object) {
  const base = { boxRoot, boxSlug: "test", eventBus, services, authed: true };
  return {
    owner: appRouter.createCaller({ ...base, user: { email: "owner@example.com", name: "Owner" }, isOwner: true }).agents,
    member: appRouter.createCaller({ ...base, user: { email: "member@example.com", name: "Member" }, isOwner: false }).agents,
  };
}

async function config(boxRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(boxRoot, CONFIG_RELATIVE_PATH), "utf8"));
}

async function patchConfig(boxRoot: string, fields: Record<string, unknown>): Promise<void> {
  const current = await config(boxRoot).catch(() => ({}));
  await writeFile(join(boxRoot, CONFIG_RELATIVE_PATH), JSON.stringify({ ...current, ...fields }, null, 2));
  clearBoxConfigCache(boxRoot);
}
```

## A fresh box has nothing, and members learn only that

```ts
process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
const box = await makeTmpBox({ git: true });
const claudeCli = createFakeClaudeCli({ loggedIn: false });
const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
const { owner, member } = callers(box.root, { claudeCli, codexCli });

JSON.stringify(await owner.readiness())
=> {"claude":"not-ready","codex":"not-ready","openrouter":"not-ready","anyReady":false,"defaultReady":false}

JSON.stringify(await member.readiness())
=> {"anyReady":false}
```

With nothing usable there is nothing to switch to, so reconciling leaves the
config alone.

```ts continue
(await owner.reconcileDefault()).switched
=> false
```

## Signing in to Codex alone moves the default to Codex

The box defaults to the claude engine, which cannot run. Reconciling after the
Codex sign-in switches the engine and clears any pinned model, so Codex's own
default applies.

```ts continue
await patchConfig(box.root, { agentModel: "claude-opus-5-5" });
codexCli.status = { kind: "logged-in" };
const before = await owner.readiness();
JSON.stringify([before.anyReady, before.defaultReady])
=> [true,false]

const moved = await owner.reconcileDefault();
const saved = await config(box.root);
JSON.stringify([moved.switched, saved.agentEngine, saved.agentModel ?? null, moved.readiness.defaultReady])
=> [true,"codex",null,true]
```

## A working default is never moved

Signing in to Claude Code later changes nothing: the Codex default still runs.

```ts continue
claudeCli.loggedIn = true;
(await owner.reconcileDefault()).switched
=> false

(await config(box.root)).agentEngine
=> codex
```

## An explicit engine list gains the new default

When the owner has set which engines the box offers, the switch adds the new
default to that list instead of leaving a default the box does not offer.

```ts continue
codexCli.status = { kind: "logged-out" };
await patchConfig(box.root, { engines: { codex: true, claude: false } });
await owner.reconcileDefault();
const listed = await config(box.root);
JSON.stringify([listed.agentEngine, listed.engines])
=> ["claude",{"codex":true,"claude":true}]
```

## OpenRouter counts once a key is granted and a model is added

An OpenRouter model rides the claude engine but needs no Claude login. With
both logins gone, a granted key and an added model make the box ready, and
reconciling pins that model as the default.

```ts continue
claudeCli.loggedIn = false;
await patchConfig(box.root, { openrouterModels: [{ id: "qwen/qwen3-coder", label: "Qwen3 Coder" }] });
(await owner.readiness()).openrouter
=> not-ready

await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
const withKey = await owner.readiness();
JSON.stringify([withKey.openrouter, withKey.anyReady, withKey.defaultReady])
=> ["ready",true,false]

const pinned = await owner.reconcileDefault();
const afterPin = await config(box.root);
JSON.stringify([pinned.switched, afterPin.agentEngine, afterPin.agentModel])
=> [true,"claude","qwen/qwen3-coder"]
```

## An inconclusive probe blocks nothing and moves nothing

A Claude probe that returns no answer is not a logout (the run-time preflight
lets it through). It keeps chat unblocked, and it is not grounds to move the
default either.

```ts continue
await patchConfig(box.root, { agentModel: undefined, agentEngine: "claude" });
claudeCli.authStatus = async () => ({ probeInconclusive: true });
const unsure = await owner.readiness();
JSON.stringify([unsure.claude, unsure.defaultReady])
=> ["unknown",true]

(await owner.reconcileDefault()).switched
=> false
```

## A missing Claude CLI is not a flaky probe

When `claude` cannot be spawned at all, the probe says so. That is "no Claude
Code here", not a transient non-answer, so it does not keep chat unblocked.

```ts continue
await patchConfig(box.root, { openrouterModels: [] });
claudeCli.authStatus = async () => ({ probeInconclusive: true, error: "spawn claude ENOENT", cliMissing: true });
const missing = await owner.readiness();
JSON.stringify([missing.claude, missing.anyReady])
=> ["not-ready",false]
```

## A runnable default counts even when it is none of the three

A GLM model with its key rides the claude engine without a Claude login. When
it is the default, chat can run, so the box is not blocked.

```ts continue
await setSecret({ name: "glm", value: "placeholder-glm-key" });
await grantSecret({ slug: await boxSlug(box.root), name: "glm", access: "server" });
await patchConfig(box.root, { agentModel: "glm-5.3" });
const glm = await owner.readiness();
JSON.stringify([glm.defaultReady, glm.anyReady])
=> [true,true]
```

## Only the owner can move the default

```ts continue
await member.reconcileDefault().then(() => "ok", (error) => error.code)
=> FORBIDDEN
```

```ts cleanup
await box.cleanup();
delete process.env.BBX_SECRETS_FILE;
```
