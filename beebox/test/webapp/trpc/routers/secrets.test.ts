// # The admin Secrets procedures: owner-gated, with explicit audited reveal
//
// `src/webapp/trpc/routers/secrets.ts` is the boxholder's management surface for
// the machine store (`docs/implemented-plans/secret-custody.md`, Track 2's management-surface
// bullet, and Decision 8 for the machine-wide view).
//
// Ordinary procedures are metadata-only. `revealValue` is the sole exception: it
// returns one value after an explicit owner request and records the event without
// the value. The Admin UI separately refuses when `navigator.webdriver` is true.
//
// Placeholder values throughout.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not } from "@ianbicking/tap-check/check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { setAndGrantSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { accessLogSegmentPath } from "../../../../src/core/secrets/access-log.js";
import { getBoxTimeISO } from "../../../../src/lib/time.js";
import { mayRevealSecretInBrowser } from "../../../../src/shared/secret-reveal.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string, opts?: { isOwner?: boolean; isAuthenticatedOwner?: boolean }) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    user: { email: "owner@example.com", name: "Owner" },
    isOwner: opts?.isOwner ?? true,
    // These procedures gate on the STRICT flag (see the open-access section at
    // the end); an ordinary owner session carries both.
    isAuthenticatedOwner: opts?.isAuthenticatedOwner ?? opts?.isOwner ?? true,
  }));
}

type Caller = ReturnType<typeof caller>;

const OPENAI_USES = {
  builtin: [
    "embeddings for semantic and hybrid card search",
    "OpenAI API calls from box views, through the server-side adapter",
  ],
  declared: [],
  observed: [],
};

/** The boxStatus row for the openai secret granted at `access`. */
function openaiGranted(access: "agent" | "server") {
  return {
    name: "openai",
    access,
    hasValue: true,
    uses: OPENAI_USES,
    note: "embeddings",
    updated: isoDate(),
    verified: undefined,
    suspect: false,
    lastUsed: undefined,
    shareable: undefined,
    owningBox: undefined,
    probe: "lists OpenAI models",
  };
}

const OPENROUTER_GRANTED = {
  name: "openrouter",
  access: "server" as const,
  hasValue: true,
  uses: {
    builtin: [
      "chat and agent turns on OpenRouter models the owner added in admin (never without that step) — the full conversation, sent to hosts your OpenRouter privacy settings allow",
      "choosing a conversation for Quick chat with TypeSafe Jev",
      "embeddings for semantic and hybrid card search, when the box has no OpenAI key",
      "answering questions about recordings, and describing scanned images when the Gemini scan backend is selected, when the box has no Gemini key",
      "the Whisper high-quality transcription pass, when the box has no OpenAI key",
      "the MAI-Transcribe-2 high-quality transcription pass, which is reachable no other way",
      "OpenRouter API calls from box views, through the server-side adapter",
    ],
    declared: [],
    observed: [],
  },
  note: undefined,
  updated: isoDate(),
  verified: undefined,
  suspect: false,
  lastUsed: undefined,
  shareable: undefined,
  owningBox: undefined,
  probe: "reads the OpenRouter key's own limits",
};

const MISTRAL_USES = {
  builtin: [
    "audio transcription (Voxtral — recordings and live chat dictation)",
    "Mistral API calls from box views, through the server-side adapter",
  ],
  declared: [],
  observed: [],
};

const MISTRAL_GRANTED = {
  name: "mistral",
  access: "server" as const,
  hasValue: true,
  uses: MISTRAL_USES,
  note: undefined,
  updated: isoDate(),
  verified: undefined,
  suspect: false,
  lastUsed: undefined,
  shareable: undefined,
  owningBox: undefined,
  probe: "lists Mistral models",
};

const WEATHER_GRANTED = {
  name: "weatherapi",
  access: "agent" as const,
  hasValue: true,
  uses: { builtin: [], declared: ["forecasts in the morning brief"], observed: [] },
  note: undefined,
  updated: isoDate(),
  verified: undefined,
  suspect: false,
  lastUsed: undefined,
  shareable: undefined,
  owningBox: undefined,
  probe: null,
};

/** The machineView rows; every field not listed is absent. */
const NO_EXTRAS = {
  note: undefined,
  formatHint: undefined,
  verified: undefined,
  owningBox: undefined,
  shareable: undefined,
  declaredBy: undefined,
  lastUsed: undefined,
};

function openaiRow(slug: string) {
  return {
    name: "openai",
    hasValue: true,
    ...NO_EXTRAS,
    note: "embeddings",
    updated: isoDate(),
    grants: { [slug]: "server" as const },
    uses: OPENAI_USES,
    probe: "lists OpenAI models",
  };
}

function mistralRow(slug: string) {
  return { name: "mistral", hasValue: true, ...NO_EXTRAS, updated: isoDate(), grants: { [slug]: "server" as const }, uses: MISTRAL_USES, probe: "lists Mistral models" };
}

function weatherRow(slug: string) {
  return {
    name: "weatherapi",
    hasValue: true,
    ...NO_EXTRAS,
    updated: isoDate(),
    grants: { [slug]: "agent" as const },
    uses: { builtin: [], declared: ["forecasts in the morning brief", "tide times"], observed: [] },
    probe: null,
  };
}

const OTHERBOX_ROW = {
  name: "publish-token/otherbox",
  hasValue: true,
  ...NO_EXTRAS,
  updated: isoDate(),
  owningBox: "otherbox",
  shareable: false,
  grants: { otherbox: "server" as const },
  uses: { builtin: [], declared: [], observed: [] },
  probe: null,
};

const UNCHECKED = { status: "unchecked" as const, reason: "verification is turned off on this machine", at: isoDate() };

/** The refusal code, or "allowed" — how the gating checks below read. */
async function attempt(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "allowed";
  } catch (e) {
    return e instanceof TRPCError ? e.code : e instanceof Error ? e.message : String(e);
  }
}

/** The refusal's relay-ready message — what the boxholder actually reads. */
async function explain(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "allowed";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ## Owner-gated, every procedure
//
// A box member who is not the owner gets nothing, not even the list of names,
// which is why the plan can accept that names are owner-visible across boxes.
//
// Open access is not an owner here. Every other owner surface in the app treats an
// open-access box (one whose boxholder deliberately opted out of the auth wall) as
// the owner: `ctx.isOwner` folds `identity.source === "open"` in, and those
// surfaces are box-scoped, so that is the right answer for them. This store is
// not box-scoped. It spans every box on the machine, so these procedures gate on
// `isAuthenticatedOwner` instead: a real signed-in owner identity, never an
// opt-out. Otherwise a single box served openly would become a grant surface for
// its neighbours' credentials.
void test("A box member who is not the owner gets nothing, not even the list of names, w...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const box = await makeTmpBox({ git: true });
  const member = caller(box.root, { isOwner: false });
  const open = caller(box.root, { isOwner: true, isAuthenticatedOwner: false });

  const gated: Record<string, { who: Caller; calls: Record<string, (c: Caller) => Promise<unknown>> }> = {
    member: {
      who: member,
      calls: {
        boxStatus: (c) => c.secrets.boxStatus(),
        machineView: (c) => c.secrets.machineView(),
        setValue: (c) => c.secrets.setValue({ name: "mistral", value: "x" }),
        grant: (c) => c.secrets.grant({ box: "any", name: "mistral", access: "server" }),
        remove: (c) => c.secrets.remove({ name: "mistral" }),
      },
    },
    open: {
      who: open,
      calls: {
        boxStatus: (c) => c.secrets.boxStatus(),
        machineView: (c) => c.secrets.machineView(),
        revealValue: (c) => c.secrets.revealValue({ name: "mistral" }),
        formatHints: (c) => c.secrets.formatHints(),
        setValue: (c) => c.secrets.setValue({ name: "mistral", value: "x" }),
        grant: (c) => c.secrets.grant({ box: "any", name: "mistral", access: "server" }),
        setAccess: (c) => c.secrets.setAccess({ box: "any", name: "mistral", access: "agent" }),
        revoke: (c) => c.secrets.revoke({ box: "any", name: "mistral" }),
        remove: (c) => c.secrets.remove({ name: "mistral" }),
      },
    },
  };
  const refusals: Record<string, Record<string, string>> = {};
  for (const [kind, { who, calls }] of Object.entries(gated)) {
    refusals[kind] = {};
    for (const [procedure, call] of Object.entries(calls)) {
      refusals[kind][procedure] = await attempt(call(who));
    }
  }
  t.check(refusals, {
    member: {
      boxStatus: "FORBIDDEN",
      machineView: "FORBIDDEN",
      setValue: "FORBIDDEN",
      grant: "FORBIDDEN",
      remove: "FORBIDDEN",
    },
    open: {
      boxStatus: "FORBIDDEN",
      machineView: "FORBIDDEN",
      revealValue: "FORBIDDEN",
      formatHints: "FORBIDDEN",
      setValue: "FORBIDDEN",
      grant: "FORBIDDEN",
      setAccess: "FORBIDDEN",
      revoke: "FORBIDDEN",
      remove: "FORBIDDEN",
    },
  });

  // ## Setting a value: warnings advise, they never block
  //
  // The format registry warns and the save still happens — provider key formats
  // drift, and a hard gate would brick key entry the day a prefix changes. The
  // response carries the verification verdict and no value.

  const owner = caller(box.root);
  const slug = await boxSlug(box.root);

  const saved = await owner.secrets.setValue({ name: "openai", value: "placeholder-openai-key", note: "embeddings" });
  t.check(saved, {
    warnings: ["Keys for this service usually start with \"sk-\"."],
    verified: UNCHECKED,
    granted: null,
  });

  // Adding is not granting: the name exists machine-wide and this box still cannot
  // resolve it until the boxholder says so.

  const beforeGrant = await owner.secrets.boxStatus();
  t.check(beforeGrant.granted, []);

  await owner.secrets.grant({ box: slug, name: "openai", access: "server" });
  const afterGrant = await owner.secrets.boxStatus();
  t.check(afterGrant, {
    slug,
    granted: [openaiGranted("server")],
    emptySlots: [],
    danglingGrants: [],
    declaredHere: [],
  });

  // ## Raising and lowering access
  //
  // The level lives on the grant, so the same secret can be server-only for one box
  // and agent-resolvable for another. `setAccess` refuses when there is no grant to
  // change — creating one silently would be the wrong kind of surprise.

  await owner.secrets.setAccess({ box: slug, name: "openai", access: "agent" });
  t.check((await owner.secrets.boxStatus()).granted, [openaiGranted("agent")]);
  await owner.secrets.setAccess({ box: slug, name: "openai", access: "server" });
  t.check((await owner.secrets.boxStatus()).granted, [openaiGranted("server")]);
  t.check(await attempt(owner.secrets.setAccess({ box: slug, name: "mistral", access: "agent" })), "BAD_REQUEST");

  // ## The machine-wide view, and the single-box refusal
  //
  // `machineView` is every name with its grants across every box — reachable from
  // any box's page, since there is no separate hub UI. A structurally single-box
  // secret refuses a second grant with the store's own explanation rather than a
  // bare "Bad Request".

  await setAndGrantSecret({
    name: "publish-token/otherbox",
    value: "placeholder-bucket-token",
    slug: "otherbox",
    access: "server",
    owningBox: "otherbox",
    shareable: false,
  });

  const machine = await owner.secrets.machineView();
  t.check(machine, { thisBox: slug, boxes: [slug, "otherbox"], secrets: [openaiRow(slug), OTHERBOX_ROW], scope: "machine" });

  t.check(await attempt(owner.secrets.grant({ box: slug, name: "publish-token/otherbox", access: "server" })), "BAD_REQUEST");
  t.checkText(await explain(owner.secrets.grant({ box: slug, name: "publish-token/otherbox", access: "server" })), "The secret \"publish-token/otherbox\" is marked single-box (it belongs to \"otherbox\") and cannot also be granted to \"«*»\". Some credentials bind to one box structurally — a bucket-scoped publish token works for one bucket only — so sharing one would break the box already using it. Create a separate secret for this box.");

  // ## Revoking, and removing machine-wide
  //
  // Removing an entry deliberately leaves grants naming it behind, as *stale*
  // grants: the remediation differs from "never granted", and every view says so.

  await owner.secrets.remove({ name: "openai" });
  const stale = await owner.secrets.boxStatus();
  t.check({ granted: stale.granted, danglingGrants: stale.danglingGrants }, { granted: [], danglingGrants: ["openai"] });

  await owner.secrets.revoke({ box: slug, name: "openai" });
  t.check((await owner.secrets.boxStatus()).danglingGrants, []);
  t.check(await attempt(owner.secrets.revoke({ box: slug, name: "openai" })), "BAD_REQUEST");

  // ## Every view carries what a secret is used for
  //
  // The admin page is where a boxholder decides whether a grant still earns its
  // keep, so both views answer "what breaks if I revoke this?" — the built-in
  // registry's reasons where the engine reads the name itself, plus whatever a save
  // declared, plus (once resolves happen) the purposes actually observed. Still no
  // value, on either view.

  const withUse = await owner.secrets.setValue({
    name: "weatherapi",
    value: "placeholder-weather-key",
    uses: ["forecasts in the morning brief"],
  });
  await owner.secrets.setValue({ name: "mistral", value: "placeholder-mistral-key" });
  await owner.secrets.grant({ box: slug, name: "weatherapi", access: "agent" });
  await owner.secrets.grant({ box: slug, name: "mistral", access: "server" });
  const granted = (await owner.secrets.boxStatus()).granted;
  t.check(granted, [MISTRAL_GRANTED, WEATHER_GRANTED]);
  t.check(withUse, { warnings: [], verified: UNCHECKED, granted: null });

  // A rotation appends rather than replaces — the reasons outlive the key, which is
  // the point of writing them down:

  await owner.secrets.setValue({ name: "weatherapi", value: "placeholder-weather-key-2", uses: ["tide times"] });
  const machine2 = await owner.secrets.machineView();
  t.check(machine2, { thisBox: slug, boxes: [slug, "otherbox"], secrets: [mistralRow(slug), OTHERBOX_ROW, weatherRow(slug)], scope: "machine" });

  // ## Open access: the refusal and the surfaces it still reaches
  //
  // The refusal says which session it wants, so the boxholder is not left guessing
  // why an admin page they can reach refuses one section of itself:

  t.checkText(await explain(open.secrets.boxStatus()), "secrets management requires an authenticated owner session — open-access does not qualify (the store is machine-level, spanning every box on this host)");

  // Other owner surfaces are unchanged — the same open-access context still reaches
  // them:

  const account = await open.admin.localAccountStatus({ email: "nobody@example.com" });
  t.check(account, { exists: false });
});

// ## Adding from a box's own page makes it that box's in the same write
//
// The boxholder's failure on 2026-09-09 was a verified key granted to nothing,
// reported as saved. From a box's admin page, adding means "and use it here", so
// `setValue` takes an optional `grant` and does both under one store lock
// (`setAndGrantSecret`) — there is no moment in which the value exists ungranted,
// and the response's `granted` comes from the committed write. Its own store, so
// the enumerations above stay exact.
void test("The boxholder's failure on 2026-09-09 was a verified key granted to nothing,...", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
      await rm(dir2, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir2 = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir2, "secrets.json");
  const box2 = await makeTmpBox({ git: true });
  const owner2 = caller(box2.root);
  const slug2 = await boxSlug(box2.root);

  const addInput = { name: "openrouter", value: "sk-or-v1-placeholder-placeholder-placeholder-placeholder-key", grant: { box: slug2, access: "server" as const } };
  const added = await owner2.secrets.setValue(addInput);
  t.check(added, { warnings: [], verified: UNCHECKED, granted: { box: slug2, access: "server" } });
  t.check((await owner2.secrets.boxStatus()).granted, [OPENROUTER_GRANTED]);

  // Without `grant` — the machine-wide view — nothing changes about who may use
  // it, and the response says so plainly.

  const machineOnly = await owner2.secrets.setValue({ name: "replicate", value: "placeholder-replicate-token" });
  t.check(machineOnly, { warnings: [], verified: UNCHECKED, granted: null });
  t.check((await owner2.secrets.boxStatus()).granted, [OPENROUTER_GRANTED]);
});

// ## Explicit reveal is owner-gated and audited
void test("Explicit reveal is owner-gated and audited", async (t) => {
  t.teardown(async () => {
    try {
      await revealBox.cleanup();
      await rm(revealDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const revealDir = await mkdtemp(join(tmpdir(), "bbx-secrets-reveal-"));
  process.env.BBX_SECRETS_FILE = join(revealDir, "secrets.json");
  const revealBox = await makeTmpBox({ git: true });
  const ownerForReveal = caller(revealBox.root);
  await ownerForReveal.secrets.setValue({ name: "z-reveal-test", value: "reveal-value-fixture" });
  t.check(await attempt(caller(revealBox.root, { isOwner: false }).secrets.revealValue({ name: "z-reveal-test" })), "FORBIDDEN");
  // A named variable skips the excess-property check: the unknown `webdriver` key is the point.
  const legacyClaim = { name: "z-reveal-test", webdriver: true };
  t.check(await attempt(ownerForReveal.secrets.revealValue(legacyClaim)), "BAD_REQUEST");
  const shown = await ownerForReveal.secrets.revealValue({ name: "z-reveal-test" });
  const log = await (await import("node:fs/promises")).readFile(accessLogSegmentPath(getBoxTimeISO(revealBox.root)), "utf8");
  const event = JSON.parse(log.trim().split("\n").at(-1) ?? "");
  t.check(shown, { value: "reveal-value-fixture" });
  t.check(event, { ts: isoDate(), box: "test", secret: "z-reveal-test", purpose: "owner revealed value in Admin", event: "owner-read" });
  t.check(log, not(any(String).includes("reveal-value-fixture")));
  t.check([mayRevealSecretInBrowser(true), mayRevealSecretInBrowser(false)], [false, true]);
  const logPath = join(revealDir, "secrets-log");
  await rm(logPath, { recursive: true, force: true });
  await writeFile(logPath, "not a directory");
  t.check(await attempt(ownerForReveal.secrets.revealValue({ name: "z-reveal-test" })), "INTERNAL_SERVER_ERROR");
});

// ## A unit host: the page reaches only this box's copy of the store
//
// There each box reads its own export of the operator's master store
// (docs/plans/per-box-units.md, question 9), so a grant to another box made
// from this box's Admin page would report success and change nothing that box
// reads. The router refuses with the operator's command and tells the page
// which scope it is showing.
void test("on a unit host the secrets surface is box-scoped", async (t) => {
  const box = await makeTmpBox();
  const previous = process.env.BBX_UNIT_HOST;
  t.teardown(async () => {
    await box.cleanup();
    if (previous === undefined) delete process.env.BBX_UNIT_HOST; else process.env.BBX_UNIT_HOST = previous;
  });
  process.env.BBX_UNIT_HOST = "1";
  const owner = caller(box.root);
  const slug = await boxSlug(box.root);
  await owner.secrets.setValue({ name: "mistral", value: "placeholder-mistral-key" });

  // This box's own grants work as before.
  await owner.secrets.grant({ box: slug, name: "mistral", access: "server" });
  t.check((await owner.secrets.boxStatus()).granted.map((grant) => grant.name), ["mistral"]);
  t.check((await owner.secrets.machineView()).scope, "box");

  const refused: Record<string, () => Promise<unknown>> = {
    grant: () => owner.secrets.grant({ box: "otherbox", name: "mistral", access: "server" }),
    setAccess: () => owner.secrets.setAccess({ box: "otherbox", name: "mistral", access: "agent" }),
    revoke: () => owner.secrets.revoke({ box: "otherbox", name: "mistral" }),
    setValueGranting: () => owner.secrets.setValue({ name: "openai", value: "x", grant: { box: "otherbox", access: "server" } }),
    remove: () => owner.secrets.remove({ name: "mistral" }),
  };
  const codes: Record<string, string> = {};
  for (const [name, call] of Object.entries(refused)) codes[name] = await attempt(call());
  t.check(codes, { grant: "BAD_REQUEST", setAccess: "BAD_REQUEST", revoke: "BAD_REQUEST", setValueGranting: "BAD_REQUEST", remove: "BAD_REQUEST" });
  t.checkText(
    await explain(owner.secrets.grant({ box: "otherbox", name: "mistral", access: "server" })),
    `On this host each box holds its own copy of the secret store, so this page reaches only "${slug}". Grant to "otherbox" on the host instead: bbx engine secrets grant otherbox <name>, then bbx engine secrets export-box otherbox.`,
  );
  // Nothing was written by the refused calls: the other box has no grant and the value is still here.
  t.check((await owner.secrets.machineView()).boxes, [slug]);
});
