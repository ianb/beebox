// # Resolving a secret: grants, access levels, refusals, and the access log
//
// `src/core/secrets/resolve.ts` is the one way a value leaves the store. Every
// outcome is a typed `Result` (callers branch on *why*) and every outcome is
// logged — refusals included, because a box repeatedly asking for a secret it was
// never granted is exactly what an access log is for. Design:
// `docs/implemented-plans/secret-custody.md`, Track 2.
//
// Values below are obvious placeholders.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { resolveSecret } from "../../../src/core/secrets/resolve.js";
import type { ResolveSecretOptions } from "../../../src/core/secrets/resolve.js";
import { invariant } from "../../../src/shared/invariant.js";
import { grantSecret, setSecret, declareSecret, removeSecret } from "../../../src/core/secrets/lifecycle.js";
import { accessLogSegmentPath } from "../../../src/core/secrets/access-log.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

function secretsFile(): string {
  const file = process.env.BBX_SECRETS_FILE;
  invariant(file, "useTempStore points BBX_SECRETS_FILE at a temp store");
  return file;
}

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** The refusal kind, or the resolved placeholder value on success. */
async function outcome(opts: ResolveSecretOptions) {
  const result = await resolveSecret(opts);
  return result.ok ? `ok:${result.value.value}${result.value.suspect ? " (suspect)" : ""}` : result.error.kind;
}

// ## A granted server secret resolves, and the resolve is logged
void test("A granted server secret resolves, and the resolve is logged", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L45
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "mistral", value: "placeholder-value-1" });
  await grantSecret({ slug, name: "mistral", access: "server" });
  t.check(await outcome({ boxRoot: box.root, name: "mistral", purpose: "transcription", access: "server" }), "ok:placeholder-value-1");

  // The log line names the box, the secret, and the purpose — never the value:

  // doctest:L57
  const line = JSON.parse((await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8")).trim());
  t.check(line, { ts: isoDate(), box: slug, secret: "mistral", purpose: "transcription", event: "resolve" });
});

// ## Access levels: `agent` includes server access, `server` does not include agent
//
// The level lives on the GRANT, not on the secret: the same secret can be
// server-only for one box and agent-resolvable for another.
void test("The level lives on the GRANT, not on the secret:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L82
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "serveronly", value: "placeholder-value-2" });
  await setSecret({ name: "agentok", value: "placeholder-value-3" });
  await grantSecret({ slug, name: "serveronly", access: "server" });
  await grantSecret({ slug, name: "agentok", access: "agent" });

  // doctest:L90
  t.check(await outcome({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "server" }), "ok:placeholder-value-2");
  t.check(await outcome({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "agent" }), "agent-access-not-granted");
  t.check(await outcome({ boxRoot: box.root, name: "agentok", purpose: "p", access: "server" }), "ok:placeholder-value-3");
  t.check(await outcome({ boxRoot: box.root, name: "agentok", purpose: "p", access: "agent" }), "ok:placeholder-value-3");

  // The `agent-access-not-granted` message is written for relay — the agent reads it
  // out and the boxholder knows exactly which action fixes it:

  // doctest:L105
  const refused = await resolveSecret({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "agent" });
  t.check(refused, {
    ok: false,
    error: {
      name: "SecretAgentAccessNotGrantedError",
      message: `The secret "serveronly" is granted to this box ("${slug}") for server use only, and box code asked for the value. Ask the boxholder to raise the grant to agent access.`,
      secretName: "serveronly",
      kind: "agent-access-not-granted",
      boxSlug: slug,
    },
  });
});

// ## Every other refusal kind
//
// Each condition is distinct because its remediation is: declare it, fill it,
// grant it, clean up a stale grant, or call the boxholder.
void test("Each condition is distinct because its remediation is:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L121
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);

  // doctest:L125
  t.check(await outcome({ boxRoot: box.root, name: "nothing", purpose: "p", access: "server" }), "unknown-secret");

  // doctest:L127
  await setSecret({ name: "ungranted", value: "placeholder-value-4" });
  t.check(await outcome({ boxRoot: box.root, name: "ungranted", purpose: "p", access: "server" }), "not-granted");

  // doctest:L130
  await declareSecret({ name: "declared", note: "awaiting a value" });
  await grantSecret({ slug, name: "declared", access: "server" });
  t.check(await outcome({ boxRoot: box.root, name: "declared", purpose: "p", access: "server" }), "empty-slot");

  // doctest:L134
  await setSecret({ name: "doomed", value: "placeholder-value-5" });
  await grantSecret({ slug, name: "doomed", access: "server" });
  await removeSecret("doomed");
  t.check(await outcome({ boxRoot: box.root, name: "doomed", purpose: "p", access: "server" }), "dangling-grant");

  // doctest:L139
  await writeFile(secretsFile(), "{ not json");
  t.check(await outcome({ boxRoot: box.root, name: "ungranted", purpose: "p", access: "server" }), "store-unreadable");

  // Refusals are logged too, each carrying its kind:

  // doctest:L152
  const kinds = (await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).refusal);
  t.check(kinds, ["unknown-secret", "not-granted", "empty-slot", "dangling-grant", "store-unreadable"]);
});

// ## A failed probe makes a successful resolve `suspect`
//
// The probe machinery itself is a later chunk; the resolver only reads the field
// and passes "this key may be expired" along with the value.
void test("The probe machinery itself is a later chunk; the resolver only reads the fiel...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L172
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "stale", value: "placeholder-value-6" });
  await grantSecret({ slug, name: "stale", access: "server" });
  const store = JSON.parse(await readFile(secretsFile(), "utf-8"));
  store.secrets.stale.verified = { status: "failed", at: "2026-08-17T00:00:00.000Z", reason: "401" };
  await writeFile(secretsFile(), JSON.stringify(store));
  t.check(await outcome({ boxRoot: box.root, name: "stale", purpose: "p", access: "server" }), "ok:placeholder-value-6 (suspect)");
});

// ## `lastUsed` is stamped for the box that resolved
//
// Summarized into the entry (hourly at most) so deleting an old log segment never
// loses "is this still in use".
void test("Summarized into the entry (hourly at most) so deleting an old log segment nev...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L195
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "used", value: "placeholder-value-7" });
  await grantSecret({ slug, name: "used", access: "server" });
  await resolveSecret({ boxRoot: box.root, name: "used", purpose: "p", access: "server" });
  const stamped = JSON.parse(await readFile(secretsFile(), "utf-8"));
  t.check(stamped.secrets.used.lastUsed, { [slug]: isoDate() });
});

// ## A status-only probe is logged, but is not a USE
//
// `observe: false` splits the two records apart. A health check resolving the key
// to answer "is this configured?" really did read the value, so the access log
// keeps its line — attribution stays complete. What it must not do is move
// `lastUsed` and `purposes`, which answer "is this grant still earning its keep":
// a dashboard polling health every minute would otherwise pin a dead key's
// last-use to now forever.
void test("observe:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L224
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "probed", value: "placeholder-value-8" });
  await grantSecret({ slug, name: "probed", access: "server" });
  await resolveSecret({ boxRoot: box.root, name: "probed", purpose: "health-check", access: "server", observe: false });
  const probed = JSON.parse(await readFile(secretsFile(), "utf-8")).secrets.probed;
  const logged = JSON.parse((await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8")).trim());
  t.check(logged, { ts: isoDate(), box: slug, secret: "probed", purpose: "health-check", event: "resolve" });
  t.check(probed.lastUsed, undefined);
  t.check(probed.purposes, undefined);

  // A real resolve — `observe` omitted — stamps both, and the probe's label is
  // nowhere in the observed list:

  // doctest:L245
  await resolveSecret({ boxRoot: box.root, name: "probed", purpose: "real-work", access: "server" });
  const used = JSON.parse(await readFile(secretsFile(), "utf-8")).secrets.probed;
  t.check(used.lastUsed, { [slug]: isoDate() });
  t.check(used.purposes, ["real-work"]);
});

// ## `purpose` is a label, not free text
//
// It is written verbatim into the access log the boxholder reads, so the resolver
// holds callers to `^[a-z0-9][a-z0-9-]{0,39}$`. In-process callers are our own
// code, so a violation is a broken invariant rather than a refusal — the route
// that takes one from agent-authored code (`webapp/routes/secrets.ts`) rejects it
// with `bad-request` first.
void test("It is written verbatim into the access log the boxholder reads, so the resolv...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L268
  const dir = await useTempStore();
  const box = await makeTmpBox();
  await t.checkThrows(async () => (await resolveSecret({ boxRoot: box.root, name: "anything", purpose: "Not A Label", access: "server" })), "InvariantError");

  // doctest:L275
  await t.checkThrows(async () => (await resolveSecret({ boxRoot: box.root, name: "anything", purpose: "with\nnewline", access: "server" })), "InvariantError");

  // doctest:L278
  t.check(await outcome({ boxRoot: box.root, name: "anything", purpose: "google-oauth", access: "server" }), "unknown-secret");
});
