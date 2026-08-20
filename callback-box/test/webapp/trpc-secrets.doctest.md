# The admin Secrets procedures: owner-gated, and never a value

`src/webapp/trpc/routers/secrets.ts` is the boxholder's management surface for
the machine store (`docs/plans/secret-custody.md`, Track 2's management-surface
bullet, and Decision 8 for the machine-wide view).

The load-bearing property is negative and is asserted on every response below:
**no procedure returns a secret value** — not on a read, not as an echo after a
write, not inside an error. A "just show me the key" affordance would hand every
credential on the machine to any browser session that reaches an owner's page.

Placeholder values throughout.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { setAndGrantSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const noBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };

function caller(boxRoot, opts) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: noBus,
    services: {},
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner: opts?.isOwner ?? true,
    // These procedures gate on the STRICT flag (see the open-access section at
    // the end); an ordinary owner session carries both.
    isAuthenticatedOwner: opts?.isAuthenticatedOwner ?? opts?.isOwner ?? true,
  });
}

/** The refusal code, or "allowed" — how the gating checks below read. */
async function attempt(promise) {
  try {
    await promise;
    return "allowed";
  } catch (e) {
    return e.code ?? e.message;
  }
}

/** The refusal's relay-ready message — what the boxholder actually reads. */
async function explain(promise) {
  try {
    await promise;
    return "allowed";
  } catch (e) {
    return e.message;
  }
}
```

## Owner-gated, every procedure

A box member who is not the owner gets nothing — not even the list of names,
which is why the plan can accept that names are owner-visible across boxes.

```ts
const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();
const member = caller(box.root, { isOwner: false });

print(`boxStatus: ${await attempt(member.secrets.boxStatus())}`);
print(`machineView: ${await attempt(member.secrets.machineView())}`);
print(`setValue: ${await attempt(member.secrets.setValue({ name: "mistral", value: "x" }))}`);
print(`grant: ${await attempt(member.secrets.grant({ box: "any", name: "mistral", access: "server" }))}`);
print(`remove: ${await attempt(member.secrets.remove({ name: "mistral" }))}`);
=>
boxStatus: FORBIDDEN
machineView: FORBIDDEN
setValue: FORBIDDEN
grant: FORBIDDEN
remove: FORBIDDEN
```

## Setting a value: warnings advise, they never block

The format registry warns and the save still happens — provider key formats
drift, and a hard gate would brick key entry the day a prefix changes. The
response carries the verification verdict and no value.

```ts continue
const owner = caller(box.root);
const slug = await boxSlug(box.root);

const saved = await owner.secrets.setValue({ name: "openai", value: "placeholder-openai-key", note: "embeddings" });
print(`warnings: ${JSON.stringify(saved.warnings)}`);
print(`verified: ${saved.verified.status}`);
print(`the response carries no value: ${!JSON.stringify(saved).includes("placeholder-openai-key")}`);
=>
warnings: ["Keys for this service usually start with \"sk-\"."]
verified: unchecked
the response carries no value: true
```

Adding is not granting: the name exists machine-wide and this box still cannot
resolve it until the boxholder says so.

```ts continue
const beforeGrant = await owner.secrets.boxStatus();
print(`granted here: ${JSON.stringify(beforeGrant.granted)}`);

await owner.secrets.grant({ box: slug, name: "openai", access: "server" });
const afterGrant = await owner.secrets.boxStatus();
print(`granted here: ${afterGrant.granted.map((s) => `${s.name}:${s.access}`).join(", ")}`);
print(`has a value, suspect: ${afterGrant.granted[0]?.hasValue} ${afterGrant.granted[0]?.suspect}`);
print(`status carries no value: ${!JSON.stringify(afterGrant).includes("placeholder-openai-key")}`);
=>
granted here: []
granted here: openai:server
has a value, suspect: true false
status carries no value: true
```

## Raising and lowering access

The level lives on the grant, so the same secret can be server-only for one box
and agent-resolvable for another. `setAccess` refuses when there is no grant to
change — creating one silently would be the wrong kind of surprise.

```ts continue
await owner.secrets.setAccess({ box: slug, name: "openai", access: "agent" });
print(`raised: ${(await owner.secrets.boxStatus()).granted[0]?.access}`);
await owner.secrets.setAccess({ box: slug, name: "openai", access: "server" });
print(`lowered: ${(await owner.secrets.boxStatus()).granted[0]?.access}`);
print(`ungranted name: ${await attempt(owner.secrets.setAccess({ box: slug, name: "mistral", access: "agent" }))}`);
=>
raised: agent
lowered: server
ungranted name: BAD_REQUEST
```

## The machine-wide view, and the single-box refusal

`machineView` is every name with its grants across every box — reachable from
any box's page, since there is no separate hub UI. A structurally single-box
secret refuses a second grant with the store's own explanation rather than a
bare "Bad Request".

```ts continue
await setAndGrantSecret({
  name: "telegram-bot/otherbox",
  value: JSON.stringify({ botToken: "111111:placeholder", webhookSecret: "x" }),
  slug: "otherbox",
  access: "server",
  owningBox: "otherbox",
  shareable: false,
});

const machine = await owner.secrets.machineView();
print(`names: ${machine.secrets.map((s) => s.name).join(", ")}`);
print(`grants: ${JSON.stringify(machine.secrets.map((s) => s.grants))}`);
print(`probe described: ${machine.secrets.map((s) => s.probe).join(" | ")}`);
print(`no values anywhere: ${!JSON.stringify(machine).includes("placeholder")}`);
=>
names: openai, telegram-bot/otherbox
grants: [{"«*»":"server"},{"otherbox":"server"}]
probe described: lists OpenAI models | calls the Telegram bot's getMe
no values anywhere: true
```

```ts continue
print(await attempt(owner.secrets.grant({ box: slug, name: "telegram-bot/otherbox", access: "server" })));
print(await explain(owner.secrets.grant({ box: slug, name: "telegram-bot/otherbox", access: "server" })));
=>
BAD_REQUEST
The secret "telegram-bot/otherbox" is marked single-box (it belongs to "otherbox") and cannot also be granted to "«*»". Some credentials bind to one box structurally — a Telegram bot token routes to a single webhook URL — so sharing one would break the box already using it. Create a separate secret for this box.
```

## Revoking, and removing machine-wide

Removing an entry deliberately leaves grants naming it behind, as *stale*
grants: the remediation differs from "never granted", and every view says so.

```ts continue
await owner.secrets.remove({ name: "openai" });
const stale = await owner.secrets.boxStatus();
print(`granted: ${JSON.stringify(stale.granted)}`);
print(`dangling: ${JSON.stringify(stale.danglingGrants)}`);

await owner.secrets.revoke({ box: slug, name: "openai" });
print(`after revoking the stale grant: ${JSON.stringify((await owner.secrets.boxStatus()).danglingGrants)}`);
print(`revoking again: ${await attempt(owner.secrets.revoke({ box: slug, name: "openai" }))}`);
=>
granted: []
dangling: ["openai"]
after revoking the stale grant: []
revoking again: BAD_REQUEST
```

## Every view carries what a secret is used for

The admin page is where a boxholder decides whether a grant still earns its
keep, so both views answer "what breaks if I revoke this?" — the built-in
registry's reasons where the engine reads the name itself, plus whatever a save
declared, plus (once resolves happen) the purposes actually observed. Still no
value, on either view.

```ts continue
const withUse = await owner.secrets.setValue({
  name: "weatherapi",
  value: "placeholder-weather-key",
  uses: ["forecasts in the morning brief"],
});
await owner.secrets.setValue({ name: "mistral", value: "placeholder-mistral-key" });
await owner.secrets.grant({ box: slug, name: "weatherapi", access: "agent" });
await owner.secrets.grant({ box: slug, name: "mistral", access: "server" });
const granted = (await owner.secrets.boxStatus()).granted;
print(`mistral built-in: ${granted.find((s) => s.name === "mistral")?.uses.builtin.join(" | ")}`);
print(`weatherapi: ${JSON.stringify(granted.find((s) => s.name === "weatherapi")?.uses)}`);
print(`saving one carries no value back: ${!JSON.stringify(withUse).includes("placeholder-weather-key")}`);
=>
mistral built-in: audio transcription (Voxtral — recordings and live chat dictation) | Mistral API calls from box views, through the server-side adapter
weatherapi: {"builtin":[],"declared":["forecasts in the morning brief"],"observed":[]}
saving one carries no value back: true
```

A rotation appends rather than replaces — the reasons outlive the key, which is
the point of writing them down:

```ts continue
await owner.secrets.setValue({ name: "weatherapi", value: "placeholder-weather-key-2", uses: ["tide times"] });
const machine2 = await owner.secrets.machineView();
print(JSON.stringify(machine2.secrets.find((s) => s.name === "weatherapi")?.uses.declared));
print(`still no values: ${!JSON.stringify(machine2).includes("placeholder-weather-key")}`);
=>
["forecasts in the morning brief","tide times"]
still no values: true
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## Open access is not an owner here

Every other owner surface in the app treats an open-access box — one whose
boxholder deliberately opted out of the auth wall — as the owner: `ctx.isOwner`
folds `identity.source === "open"` in, and those surfaces are box-scoped, so
that is the right answer for them.

This store is not box-scoped. It spans every box on the machine, so these
procedures gate on `isAuthenticatedOwner` instead: a real signed-in owner
identity, never an opt-out. Otherwise a single box served openly would become a
grant surface for its neighbours' credentials.

```ts
const dir = await mkdtemp(join(tmpdir(), "cb-secrets-open-"));
process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();
const open = caller(box.root, { isOwner: true, isAuthenticatedOwner: false });

print(`boxStatus: ${await attempt(open.secrets.boxStatus())}`);
print(`machineView: ${await attempt(open.secrets.machineView())}`);
print(`formatHints: ${await attempt(open.secrets.formatHints())}`);
print(`setValue: ${await attempt(open.secrets.setValue({ name: "mistral", value: "x" }))}`);
print(`grant: ${await attempt(open.secrets.grant({ box: "any", name: "mistral", access: "server" }))}`);
print(`setAccess: ${await attempt(open.secrets.setAccess({ box: "any", name: "mistral", access: "agent" }))}`);
print(`revoke: ${await attempt(open.secrets.revoke({ box: "any", name: "mistral" }))}`);
print(`remove: ${await attempt(open.secrets.remove({ name: "mistral" }))}`);
=>
boxStatus: FORBIDDEN
machineView: FORBIDDEN
formatHints: FORBIDDEN
setValue: FORBIDDEN
grant: FORBIDDEN
setAccess: FORBIDDEN
revoke: FORBIDDEN
remove: FORBIDDEN
```

The refusal says which session it wants, so the boxholder is not left guessing
why an admin page they can reach refuses one section of itself:

```ts continue
print(await explain(open.secrets.boxStatus()));
=> secrets management requires an authenticated owner session — open-access does not qualify (the store is machine-level, spanning every box on this host)
```

Other owner surfaces are unchanged — the same open-access context still reaches
them:

```ts continue
const telegram = await open.admin.telegramStatus();
print(`telegramStatus: ${JSON.stringify(telegram.configured)}`);
=> telegramStatus: false
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
