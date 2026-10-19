// # The machine-level secret store
//
// `src/core/secrets/store.ts` holds one 0600 JSON file per machine
// (`$BBX_SECRETS_FILE`, default `~/.config/beebox/secrets.json`); the lifecycle
// operations in `src/core/secrets/lifecycle.ts` are the only writers. Design:
// `docs/implemented-plans/secret-custody.md`, Track 2.
//
// Every value below is an obvious placeholder — a real-looking key must never
// appear in a fixture.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecretStore, secretsFilePath } from "../../../src/core/secrets/store.js";
import {
  boxSecretStatus,
  declareSecret,
  grantSecret,
  listSecrets,
  removeSecret,
  revokeSecret,
  setAndGrantSecret,
  setSecret,
} from "../../../src/core/secrets/lifecycle.js";

/** Point the store at a fresh temp file; returns the directory to clean up. */
async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## Round trip: set, grant, and the file's mode
//
// Adding a secret and granting it are separate acts — adding makes the name
// grantable machine-wide, granting is the per-box opt-in.
void test("Adding a secret and granting it are separate acts — adding makes the name gra...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  await setSecret({ name: "mistral", value: "placeholder-value-1", note: "transcription" });
  await grantSecret({ slug: "demo-box", name: "mistral", access: "server" });
  const loaded = await loadSecretStore();
  t.check(loaded, {
    ok: true,
    value: {
      secrets: { mistral: { value: "placeholder-value-1", note: "transcription", updated: isoDate() } },
      grants: { "demo-box": { mistral: "server" } },
      cloudflarePublishConnections: {},
      cloudflarePublishBindings: {},
    },
  });
  t.check((await stat(secretsFilePath())).mode & 0o777, 0o600);

  // `list` returns metadata only — a value never leaves the store through it:

  const listing = await listSecrets();
  t.check(listing, [
    {
      name: "mistral",
      hasValue: true,
      note: "transcription",
      updated: isoDate(),
      formatHint: undefined,
      verified: undefined,
      owningBox: undefined,
      shareable: undefined,
      declaredBy: undefined,
      grants: { "demo-box": "server" },
      lastUsed: undefined,
      uses: {
        builtin: [
          "audio transcription (Voxtral — recordings and live chat dictation)",
          "Mistral API calls from box views, through the server-side adapter",
        ],
        declared: [],
        observed: [],
      },
    },
  ]);

  // A missing store file is an EMPTY store, not an error — the first-run case:

  await rm(secretsFilePath());
  const empty = await loadSecretStore();
  t.check(empty, { ok: true, value: { secrets: {}, grants: {}, cloudflarePublishConnections: {}, cloudflarePublishBindings: {} } });
});

// ## A corrupt store fails closed
//
// A hand-edit that leaves invalid JSON — or a file that parses but does not match
// the schema — makes the whole machine read as "no grants" rather than degrading
// to a partial parse. Mutating operations refuse rather than overwrite it.
void test("A hand-edit that leaves invalid JSON — or a file that parses but does not mat...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  await writeFile(secretsFilePath(), "{ not json");
  const broken = await loadSecretStore();
  t.check(broken, { ok: false, error: str`invalid JSON (${any(String)})` });

  await writeFile(secretsFilePath(), JSON.stringify({ secrets: { x: { value: 3 } } }));
  const invalid = await loadSecretStore();
  t.check(invalid, { ok: false, error: str`does not match the store schema (${any(String)})` });

  await t.checkThrows(async () => (await listSecrets()), "SecretStoreAccessError");

  await t.checkThrows(async () => (await setSecret({ name: "mistral", value: "placeholder-value-2" })), "SecretStoreAccessError");
});

// ## Declare, grant, revoke, and per-box status
//
// `declare` is the agent's surface: it creates an empty, ungranted slot and can
// neither supply a value nor grant it. `status` is scoped to one box.
void test("declare is the agent's surface:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  t.check(await declareSecret({ name: "weatherapi", note: "for a trick" }), { created: true });
  t.check(await declareSecret({ name: "weatherapi" }), { created: false });
  await grantSecret({ slug: "demo-box", name: "weatherapi", access: "agent" });
  await setSecret({ name: "mistral", value: "placeholder-value-3" });
  await grantSecret({ slug: "demo-box", name: "mistral", access: "server" });
  const status = await boxSecretStatus("demo-box");
  // Each granted row also carries `uses` (why the secret exists) — that is
  // `uses.test.ts`'s subject, projected away here to keep this shape readable.
  t.check({
    ...status,
    granted: status.granted.map((grant) => ({ name: grant.name, access: grant.access, hasValue: grant.hasValue })),
  }, {
    slug: "demo-box",
    granted: [
      { name: "mistral", access: "server", hasValue: true },
      { name: "weatherapi", access: "agent", hasValue: false },
    ],
    emptySlots: ["weatherapi"],
    danglingGrants: [],
    declaredHere: [],
  });

  // `declaredHere` is the other half of a box's view: slots that box declared and
  // holds no grant for yet — empty here because nothing recorded a `declaredBy`
  // (`bbx secrets declare` does; see the CLI doctest).
  //
  // Removing a secret deliberately leaves its grants behind, so the resolver can
  // report a *stale grant* rather than the misleading "no such secret":

  await removeSecret("mistral");
  t.check((await boxSecretStatus("demo-box")).danglingGrants, ["mistral"]);
  await revokeSecret({ slug: "demo-box", name: "mistral" });
  t.check((await boxSecretStatus("demo-box")).danglingGrants, []);

  // Revoking a grant the box does not hold is an error, not a silent no-op:

  await t.checkThrows(async () => (await revokeSecret({ slug: "demo-box", name: "mistral" })), "SecretGrantNotFoundError");
});

// ## Single-box secrets refuse a second grant, with an explanation
//
// A bucket-scoped publish token works for one bucket only, so a second grant would not
// merely be unwise — it would break the box that already uses it.
void test("A bucket-scoped publish token works for one bucket only, so a second grant wo...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  await setSecret({
    name: "bucket-token/demo-box",
    value: "placeholder-value-4",
    owningBox: "demo-box",
    shareable: false,
  });
  await grantSecret({ slug: "demo-box", name: "bucket-token/demo-box", access: "server" });
  t.check((await boxSecretStatus("demo-box")).granted, [
    { name: "bucket-token/demo-box", access: "server", hasValue: true, uses: { builtin: [], declared: [], observed: [] } },
  ]);

  await t.checkThrows(async () => (await grantSecret({ slug: "other-box", name: "bucket-token/demo-box", access: "server" })), "SecretNotShareableError: The secret \"bucket-token/demo-box\" is marked single-box (it belongs to \"demo-box\") and cannot also be granted to \"other-box\". Some credentials bind to one box structurally — a bucket-scoped publish token works for one bucket only — so sharing one would break the box already using it. Create a separate secret for this box.");

  // Granting a name that does not exist is refused too — a grant never conjures an
  // entry:

  await t.checkThrows(async () => (await grantSecret({ slug: "demo-box", name: "nonexistent", access: "server" })), "SecretNotFoundError");

  // `setAndGrantSecret` reads ownership off the STORE, never off its own arguments:
  // a flow that passes an `owningBox` naming itself cannot take over an entry
  // another box owns, and cannot hand an entry it does own to a third box.

  await t.checkThrows(
    async () => (await setAndGrantSecret({
      name: "bucket-token/demo-box",
      value: "placeholder-value-5",
      slug: "other-box",
      access: "server",
      owningBox: "other-box",
      shareable: false,
    })),
    "SecretNotShareableError: The secret \"bucket-token/demo-box\" is marked single-box (it belongs to \"demo-box\") and cannot also be granted to \"other-box\". Some credentials bind to one box structurally — a bucket-scoped publish token works for one bucket only — so sharing one would break the box already using it. Create a separate secret for this box.",
  );

  await t.checkThrows(
    async () => (await setAndGrantSecret({
      name: "bucket-token/demo-box",
      value: "placeholder-value-6",
      slug: "demo-box",
      access: "server",
      owningBox: "third-box",
    })),
    "SecretNotShareableError",
  );

  // The owner rotating its own value is the case this call exists for.
  await setAndGrantSecret({
    name: "bucket-token/demo-box",
    value: "placeholder-value-7",
    slug: "demo-box",
    access: "server",
  });
  t.check((await listSecrets()).map((entry) => [entry.name, entry.owningBox, Object.keys(entry.grants)]), [["bucket-token/demo-box", "demo-box", ["demo-box"]]]);
});
