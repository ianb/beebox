// # Why a secret exists: built-in, declared, and observed uses
//
// `src/core/secrets/uses.ts` answers "what breaks if I revoke this?" from three
// sources: the server-owned registry of what the engine's own readers do, the
// reasons a boxholder or agent declared on the entry, and the `purpose` labels
// real resolves actually passed. Reference: `docs/secrets.md`, "Why a secret
// exists".
//
// Values below are obvious placeholders.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxSecretStatus, declareSecret, grantSecret, listSecrets, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { resolveSecret } from "../../../src/core/secrets/resolve.js";
import { loadSecretStore } from "../../../src/core/secrets/store.js";
import { builtinSecretUses, describeSecret, formatSecretUsesLines, secretUsesFor } from "../../../src/core/secrets/uses.js";
import { invariant } from "../../../src/shared/invariant.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secret-uses-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## The built-in registry
//
// Each line is derived from a real `resolveSecret` call site, so the boxholder can
// see what the engine will spend a key on before granting it. Lookup is the same
// one the probe and format registries use — exact name first, then the longest
// matching `family/` prefix.
void test("Each line is derived from a real resolveSecret call site, so the boxholder ca...", async (t) => {
  t.check(builtinSecretUses("openai-thinking"), [
    "speech generation for chat (text-to-speech)",
    "audio transcription (Whisper)",
    "minting short-lived realtime-transcription keys for the browser",
  ]);

  // A name the engine does not read has no built-in reasons — a guess would be
  // worse than silence:

  t.check(builtinSecretUses("weatherapi"), []);
});

// ## Declared reasons are additive
//
// An agent that adds a trick spending an already-granted key appends why; it never
// replaces what is already there. Declaring the same reason twice is a no-op
// rather than a duplicate line, so a setup step can be re-run.
void test("An agent that adds a trick spending an already-granted key appends why; it ne...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  await declareSecret({ name: "weatherapi", note: "from weatherapi.com", uses: ["forecasts in the morning brief"] });
  await declareSecret({ name: "weatherapi", uses: ["the umbrella reminder trick", "forecasts in the morning brief"] });
  const store = await loadSecretStore();
  t.check(store.ok ? store.value.secrets["weatherapi"]?.uses : null, ["forecasts in the morning brief", "the umbrella reminder trick"]);

  // `bbx secrets describe` is the same append, after the fact. Removing one names it
  // exactly; a reason the entry does not carry is an error rather than a silent
  // no-op, since the caller believes it just deleted something.

  t.check((await describeSecret({ name: "weatherapi", addUses: ["severe-weather alerts"] })).uses, ["forecasts in the morning brief", "the umbrella reminder trick", "severe-weather alerts"]);
  t.check((await describeSecret({ name: "weatherapi", removeUses: ["the umbrella reminder trick"] })).uses, ["forecasts in the morning brief", "severe-weather alerts"]);

  await t.checkThrows(async () => (await describeSecret({ name: "weatherapi", removeUses: ["something nobody said"] })), "SecretUseNotFoundError");

  await t.checkThrows(async () => (await describeSecret({ name: "nonexistent", addUses: ["anything"] })), "SecretNotFoundError");

  // A reason is free prose, but it must stay one readable line — the store and the
  // admin page both show it as one:

  await t.checkThrows(async () => (await describeSecret({ name: "weatherapi", addUses: ["two\nlines"] })), "InvalidSecretUseError");

  await t.checkThrows(async () => (await describeSecret({ name: "weatherapi", addUses: ["   "] })), "InvalidSecretUseError");

  // Rotating a value never erases the reasons — the whole point of recording them is
  // that they outlive the key:

  await setSecret({ name: "weatherapi", value: "placeholder-value-1", uses: ["tide times"] });
  t.check((await listSecrets())[0]?.uses.declared, ["forecasts in the morning brief", "severe-weather alerts", "tide times"]);
});

// ## Observed purposes are recorded by real resolves
//
// `lastUsed` is stamped at most hourly, but a `purpose` label is written the first
// time it is seen — a trick that runs once would otherwise never show up. Seeing
// it again costs one lock-free read and no write.
void test("lastUsed is stamped at most hourly, but a purpose label is written the first...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
      await rm(boxDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  const boxDir = await mkdtemp(join(tmpdir(), "demo-box-"));
  await setSecret({ name: "weatherapi", value: "placeholder-value-2" });
  await grantSecret({ slug: "demo-box", name: "weatherapi", access: "agent" });

  await resolveSecret({ boxRoot: boxDir, slug: "demo-box", name: "weatherapi", purpose: "forecast-trick", access: "agent" });
  await resolveSecret({ boxRoot: boxDir, slug: "demo-box", name: "weatherapi", purpose: "forecast-trick", access: "agent" });
  await resolveSecret({ boxRoot: boxDir, slug: "demo-box", name: "weatherapi", purpose: "umbrella-reminder", access: "agent" });
  const store = await loadSecretStore();
  t.check(store.ok ? store.value.secrets["weatherapi"]?.purposes : null, ["forecast-trick", "umbrella-reminder"]);

  // A refusal records nothing — only a real disclosure is a use:

  await resolveSecret({ boxRoot: boxDir, slug: "other-box", name: "weatherapi", purpose: "snooping", access: "agent" });
  const afterRefusal = await loadSecretStore();
  t.check(afterRefusal.ok ? afterRefusal.value.secrets["weatherapi"]?.purposes : null, ["forecast-trick", "umbrella-reminder"]);

  // The three sources reach a display side by side, labelled — observed is the one
  // that can contradict the other two, which is why it is never merged into them:

  await describeSecret({ name: "weatherapi", addUses: ["forecasts in the morning brief"] });
  const status = await boxSecretStatus("demo-box");
  const [granted] = status.granted;
  invariant(granted, "the box holds a grant");
  t.check(formatSecretUsesLines(granted.uses), ["also declared: forecasts in the morning brief", "observed: forecast-trick, umbrella-reminder"]);
});

// ## A declared reason that repeats a built-in one is not shown twice
//
// The registry already says `mistral` transcribes audio; an agent restating it
// adds a line to the entry but not to the display.
void test("The registry already says mistral transcribes audio; an agent restating it ad...", async (t) => {
  t.check(
    secretUsesFor({
      name: "mistral",
      uses: ["audio transcription (Voxtral — recordings and live chat dictation)", "captions for the photo wall"],
      purposes: ["transcription"],
    }),
    {
    builtin: [
      "audio transcription (Voxtral — recordings and live chat dictation)",
      "Mistral API calls from box views, through the server-side adapter",
    ],
    declared: [
      "captions for the photo wall",
    ],
    observed: [
      "transcription",
    ],
  },
  );
});
