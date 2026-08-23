# Telegram credentials live in the store, and never come back out

Telegram is the sharpest case in the custody plan: the bot token has no scoping
primitive at all — no derived credentials, no TTL, revoke-only through
BotFather — so blast-radius reduction has to come from custody rather than from
a narrower credential (`docs/plans/secret-custody.md`, "Broker escalations").

Three behaviours follow, all covered here:

- **setup writes the machine store**, not `config/connectors/telegram.secret.json`,
  as a single-box entry (`owningBox` + `shareable: false`) granted to this box.
- **status never returns the token.** It used to, on both its arms — which
  handed a live all-powerful credential to the admin frontend on every page
  load.
- **disconnect revokes the grant and drops the entry**, so nothing resolvable
  is left behind.

The token below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { loadTelegramConfig, telegramSecretName } from "../../src/connectors/telegram-helpers.js";
import { listSecrets } from "../../src/core/secrets/lifecycle.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const telegram = createFakeTelegram({ username: "example_box_bot", firstName: "Example Box" });

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: { telegram },
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}
```

## Setup stores it; status describes it without disclosing it

```ts
const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

const setup = await caller(box.root).admin.telegramSetup({ botToken: "111111:placeholder-bot-token" });
print(`setup: ${JSON.stringify({ success: setup.success, botUsername: setup.botUsername })}`);

const entry = (await listSecrets()).find((s) => s.name === telegramSecretName(slug));
print(`stored as: ${entry.name}`);
print(`single-box: ${JSON.stringify({ owningBox: entry.owningBox, shareable: entry.shareable })}`);
print(`granted: ${JSON.stringify(entry.grants)}`);
print(`the listing never carries the value: ${entry.hasValue && !JSON.stringify(entry).includes("placeholder-bot-token")}`);
=>
setup: {"success":true,"botUsername":"example_box_bot"}
stored as: telegram-bot/«*»
single-box: {"owningBox":"«*»","shareable":false}
granted: {"«*»":"server"}
the listing never carries the value: true
```

The connector reads it back out of the store — nothing was written into the box
tree:

```ts continue
const config = await loadTelegramConfig(box.root);
print(`connector resolves the token: ${config.botToken === "111111:placeholder-bot-token"}`);
print(`webhook secret is a real one: ${config.webhookSecret.length === 64}`);

const strayFile = await box.read("config/connectors/telegram.secret.json").catch(() => null);
print(`stray file in the box tree: ${strayFile}`);
=>
connector resolves the token: true
webhook secret is a real one: true
stray file in the box tree: null
```

`telegramStatus` describes the connection by the bot's username. The token is
absent from the response entirely — not masked, not truncated, absent:

```ts continue
const status = await caller(box.root).admin.telegramStatus();
JSON.stringify(status)
=> {"configured":true,"botUsername":"example_box_bot","botFirstName":"Example Box","webhookUrl":null,"boxSlug":"test"}
```

## Disconnect revokes the grant and drops the entry

Stopping at "delete the file" would leave a live token in the machine store
with a standing grant — exactly the stale-credential shape the plan exists to
end. So disconnect forgets both halves, and is idempotent either way.

```ts continue
await caller(box.root).admin.telegramDisconnect();
print(`entry remains: ${(await listSecrets()).some((s) => s.name === telegramSecretName(slug))}`);
print(`connector now reads: ${await loadTelegramConfig(box.root)}`);

await caller(box.root).admin.telegramDisconnect();
print("disconnecting twice is fine");
=>
entry remains: false
connector now reads: null
disconnecting twice is fine
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
