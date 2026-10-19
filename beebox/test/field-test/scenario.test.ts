// # Field-test scenario format
//
// A scenario is a directory the harness loads before it spends an Opus operator
// on a run (`docs/implemented-plans/agent-field-tests.md`, Track 4). The happy path is
// checked against the real `field-tests/spine/` scenario — the format's meaning
// is what the checked-in scenario says, so a doctest that invented its own fixture
// would keep passing while the real one rotted. The failure cases build throwaway
// directories, since they are about shapes no scenario should ever be committed
// in.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MODEL_ID } from "../../src/shared/model-ids.js";
import {
  loadFieldScenario,
  fieldScenarioDir,
} from "../../src/field-test/scenario.js";

/** Write a throwaway scenario directory: the given YAML, a persona unless
 *  suppressed, and any named check scripts, assets and email fixtures. */
async function makeScenario(
  yaml: string,
  extras: { persona?: boolean; checks?: string[]; assets?: string[]; emails?: string[] },
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bbx-field-scenario-"));
  await writeFile(join(dir, "scenario.yaml"), yaml);
  if (extras.persona !== false) await writeFile(join(dir, "persona.md"), "You are a person.\n");
  for (const [subdir, names] of [
    ["checks", extras.checks],
    ["assets", extras.assets],
    ["emails", extras.emails],
  ] as const) {
    if (!names) continue;
    await mkdir(join(dir, subdir), { recursive: true });
    for (const name of names) await writeFile(join(dir, subdir, name), "placeholder\n");
  }
  return dir;
}

const HEADER = [
  "name: temp",
  "description: A temporary scenario.",
  'startTime: "2026-08-10T09:15:00Z"',
  "checklist:",
].join("\n") + "\n";

/** The error `loadFieldScenario` throws for a scenario that parses but does not hang together. */
function invalid(dir: string, problem: string) {
  return {
    name: "FieldScenarioInvalidError",
    message: `Field scenario ${dir}:\n  - ${problem}`,
    problems: [problem],
  };
}

/** What `makeScenario` loads as: the default models, and the persona it writes. */
function tempScenario(dir: string, checklist: { id: string; brief: string }[]) {
  return {
    dir,
    name: "temp",
    description: "A temporary scenario.",
    startTime: "2026-08-10T09:15:00Z",
    models: { operator: "opus" as const, chat: MODEL_ID.opus },
    persona: "You are a person.\n",
    assetsDir: join(dir, "assets"),
    checksDir: join(dir, "checks"),
    emailsDir: join(dir, "emails"),
    checklist: checklist.map((item) => ({ ...item, pre: [], cleanup: "keep" as const, checks: [], questions: [] })),
  };
}

/** A checklist item of the checked-in corpus. Brief and question wording is
 *  authored prose, so it stays a wildcard; the structure is what the loader owns. */
function corpusItem(item: { id: string; pre: ({ type: "advance-days"; days: number } | { type: "inject-email"; fixture: string })[]; checks: string[]; questions: number }) {
  return {
    id: item.id,
    brief: any(String),
    pre: item.pre,
    cleanup: "keep" as const,
    checks: item.checks,
    questions: Array.from({ length: item.questions }, () => any(String)),
  };
}

/** The scenario fields every corpus scenario shares, for the directory it loads from. */
function corpusScenario(name: string) {
  const dir = fieldScenarioDir(name);
  return {
    dir,
    name,
    description: any(String),
    models: { operator: "opus" as const, chat: MODEL_ID.opus },
    // The knowledge dial (what this person was told the app is) is persona content
    // the harness never rewrites, so the persona must reach the scenario verbatim.
    persona: any(String).includes('"an AI chat and knowledge-base app for family and household management tasks."'),
    assetsDir: join(dir, "assets"),
    checksDir: join(dir, "checks"),
    emailsDir: join(dir, "emails"),
  };
}

// ## The spine scenario loads
void test("The spine scenario loads", async (t) => {
  const spine = await loadFieldScenario(fieldScenarioDir("spine"));
  // Its one item carries the check script, the extra debrief question, and the
  // default cleanup policy.
  t.check(spine, {
    ...corpusScenario("spine"),
    startTime: "2026-08-10T09:15:00Z",
    checklist: [corpusItem({ id: "save-recipe", pre: [], checks: ["save-recipe-card-exists.sh"], questions: 1 })],
  });
});

// ## The onboarding scenario loads
//
// The real corpus scenario, checked here rather than discovered at minute forty of
// a run: every check script, every asset a brief mentions, and every email fixture
// a `pre` action names has to exist.
void test("The real corpus scenario, checked here rather than discovered at minute forty...", async (t) => {
  const onboarding = await loadFieldScenario(fieldScenarioDir("onboarding-first-days"));
  // Three simulated days, one arriving email, and a check on every item that claims
  // something happened.
  t.check(onboarding, {
    ...corpusScenario("onboarding-first-days"),
    startTime: "2026-08-10T08:40:00Z",
    checklist: [
      corpusItem({ id: "first-contact", pre: [], checks: [], questions: 2 }),
      corpusItem({ id: "save-recipe", pre: [], checks: ["save-recipe-card-exists.sh"], questions: 1 }),
      corpusItem({ id: "upload-photos", pre: [], checks: ["uploaded-photos-present.sh"], questions: 1 }),
      corpusItem({ id: "recall-recipe", pre: [{ type: "advance-days", days: 1 }], checks: ["save-recipe-card-exists.sh"], questions: 1 }),
      corpusItem({ id: "dentist-email", pre: [{ type: "inject-email", fixture: "dentist-reminder" }], checks: ["email-thread-card-exists.sh"], questions: 2 }),
      corpusItem({ id: "whats-needed", pre: [{ type: "advance-days", days: 1 }], checks: ["dentist-followup-exists.sh"], questions: 2 }),
    ],
  });
});

// ## Models default to opus, in code
//
// A scenario may omit `models:` entirely; both halves still come back pinned,
// because a run that did not record what it tested is not comparable to the next
// one.
//
// `models.chat` comes back as a concrete model **id**, not the tier the scenario
// wrote. It is written into the box's model policy, which holds ids — a tier name
// there is rejected on read, so the run would go unpinned while the report claimed
// a model (`docs/model-policy.md`). `models.operator` keeps the alias: it goes
// straight to the operator's own SDK call, which accepts one.
void test("A scenario may omit models: entirely; both halves still come back pinned, bec...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await makeScenario(HEADER + [
    "  - id: only-item",
    "    brief: Do the thing.",
  ].join("\n") + "\n", {});
  const scenario = await loadFieldScenario(dir);
  t.check(scenario, tempScenario(dir, [{ id: "only-item", brief: "Do the thing." }]));
});

// ## A model name no engine knows is rejected
//
// `models.chat` is validated at load, not at seed time: an unknown name would
// otherwise leave the box unpinned and the report claiming otherwise.
void test("models.chat is validated at load, not at seed time:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(badModelDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const badModelDir = await makeScenario(HEADER.replace("checklist:", "models:\n  chat: turbo\nchecklist:") + [
    "  - id: only-item",
    "    brief: Do the thing.",
  ].join("\n") + "\n", {});
  t.check(
    await loadFieldScenario(badModelDir).catch((e: unknown) => e),
    invalid(badModelDir, 'models.chat: "turbo" is not a model tier or a known model id'),
  );
});

// ## Duplicate ids are rejected
//
// Ids name checkpoint tags and report rows; two items sharing one would silently
// overwrite each other's results.
void test("Ids name checkpoint tags and report rows; two items sharing one would silentl...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dupDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dupDir = await makeScenario(HEADER + [
    "  - id: same",
    "    brief: First.",
    "  - id: same",
    "    brief: Second.",
  ].join("\n") + "\n", {});

  await t.checkThrows(async () => (await loadFieldScenario(dupDir)), "FieldScenarioInvalidError");
});

// ## A named check script must exist
//
// The checks are the spine of the tier — a missing one would otherwise surface as
// a mid-run harness error, after the operator work is already paid for.
void test("The checks are the spine of the tier — a missing one would otherwise surface...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(missingCheckDir, { recursive: true, force: true });
      await rm(missingAssetDir, { recursive: true, force: true });
      await rm(missingEmailDir, { recursive: true, force: true });
      await rm(escapingDir, { recursive: true, force: true });
      await rm(notARefDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const missingCheckDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Do the thing.",
    "    checks:",
    "      - present.sh",
    "      - absent.sh",
  ].join("\n") + "\n", { checks: ["present.sh"] });

  const error = await loadFieldScenario(missingCheckDir).catch((e: unknown) => e);
  t.check(error, invalid(missingCheckDir, "item: check script checks/absent.sh does not exist"));

  // So is an email fixture a `pre` action names — the fixture's *shape* is Track 1's
  // business, but a run must not discover a misspelled fixture name on day two:

  const missingEmailDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Do the thing.",
    "    pre:",
    "      - inject-email: dentist",
  ].join("\n") + "\n", {});

  const emailError = await loadFieldScenario(missingEmailDir).catch((e: unknown) => e);
  t.check(emailError, invalid(missingEmailDir, "item: pre inject-email names emails/dentist.yaml, which does not exist"));

  // An asset a brief points at is held to the same rule:

  const missingAssetDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: The file is at `assets/nope.txt`, go find it.",
  ].join("\n") + "\n", {});

  const assetError = await loadFieldScenario(missingAssetDir).catch((e: unknown) => e);
  t.check(assetError, invalid(missingAssetDir, "item: brief references assets/nope.txt, which does not exist"));

  // A reference that leaves the corpus is rejected even though the file it lands on
  // exists — the operator is told `assets/` is everything it has:

  const escapingDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: The file is at `assets/../persona.md`.",
  ].join("\n") + "\n", {});

  const escapeError = await loadFieldScenario(escapingDir).catch((e: unknown) => e);
  t.check(escapeError, invalid(escapingDir, "item: brief references assets/../persona.md, which escapes assets/"));

  // A word merely *ending* in `assets/` is not a reference:

  const notARefDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Look in myassets/nope.txt on your old laptop.",
  ].join("\n") + "\n", {});

  t.check(await loadFieldScenario(notARefDir), tempScenario(notARefDir, [{ id: "item", brief: "Look in myassets/nope.txt on your old laptop." }]));
});

// ## Valid `pre` actions normalize to a tagged union
//
// The single-key YAML mappings the plan specifies become a discriminated union the
// harness can dispatch on, and a fixture that exists passes:
void test("The single-key YAML mappings the plan specifies become a discriminated union...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(preDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const preDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Read `assets/note.txt` and do the thing.",
    "    pre:",
    "      - advance-days: 2",
    "      - inject-email: dentist",
  ].join("\n") + "\n", { assets: ["note.txt"], emails: ["dentist.yaml"] });

  const preScenario = await loadFieldScenario(preDir);
  t.check(preScenario.checklist[0]!.pre, [
    {
      type: "advance-days",
      days: 2,
    },
    {
      type: "inject-email",
      fixture: "dentist",
    },
  ]);
});

// ## Unknown fields and unknown `pre` actions are rejected
//
// Strict schemas throughout: a misspelled key is a typo the author wants told
// about, never a silently ignored instruction.
void test("Strict schemas throughout:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(unknownFieldDir, { recursive: true, force: true });
      await rm(unknownPreDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const unknownFieldDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Do the thing.",
    "    cleanupPolicy: reset",
  ].join("\n") + "\n", {});

  await t.checkThrows(async () => (await loadFieldScenario(unknownFieldDir)), "FieldScenarioParseError");

  const unknownPreDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Do the thing.",
    "    pre:",
    "      - restart-server: true",
  ].join("\n") + "\n", {});

  await t.checkThrows(async () => (await loadFieldScenario(unknownPreDir)), "FieldScenarioParseError");
});

// ## Malformed YAML and a missing persona fail closed
void test("Malformed YAML and a missing persona fail closed", async (t) => {
  t.teardown(async () => {
    try {
      await rm(badYamlDir, { recursive: true, force: true });
      await rm(noPersonaDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const badYamlDir = await makeScenario("name: [unclosed\n", {});

  await t.checkThrows(async () => (await loadFieldScenario(badYamlDir)), "FieldScenarioParseError");

  const noPersonaDir = await makeScenario(HEADER + [
    "  - id: item",
    "    brief: Do the thing.",
  ].join("\n") + "\n", { persona: false });

  await t.checkThrows(async () => (await loadFieldScenario(noPersonaDir)), "FieldScenarioInvalidError");
});
