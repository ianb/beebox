# Field-test scenario format

A scenario is a directory the harness loads before it spends an Opus operator
on a run (`docs/implemented-plans/agent-field-tests.md`, Track 4). The happy path is
checked against the real `field-tests/spine/` scenario — the format's meaning
is what the checked-in scenario says, so a doctest that invented its own fixture
would keep passing while the real one rotted. The failure cases build throwaway
directories, since they are about shapes no scenario should ever be committed
in.

```ts setup
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  const dir = await mkdtemp(join(tmpdir(), "cb-field-scenario-"));
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
```

## The spine scenario loads

```ts
const spine = await loadFieldScenario(fieldScenarioDir("spine"));
[spine.name, spine.startTime, spine.checklist.length].join(" | ")
=> spine | 2026-08-10T09:15:00Z | 1
```

Its one item carries the check script, the extra debrief question, and the
default cleanup policy:

```ts continue
const item = spine.checklist[0]!;
[item.id, item.cleanup, item.checks.join(","), item.questions.length, item.pre.length].join(" | ")
=> save-recipe | keep | save-recipe-card-exists.sh | 1 | 0
```

The persona is read verbatim — the knowledge dial (what this person was told
the app is) is scenario content the harness never rewrites:

```ts continue
spine.persona.includes('"an AI chat and knowledge-base app for family and household management tasks."')
=> true
```

## The onboarding scenario loads

The real corpus scenario, checked here rather than discovered at minute forty of
a run: every check script, every asset a brief mentions, and every email fixture
a `pre` action names has to exist.

```ts
const onboarding = await loadFieldScenario(fieldScenarioDir("onboarding-first-days"));
[onboarding.name, onboarding.startTime, onboarding.checklist.length].join(" | ")
=> onboarding-first-days | 2026-08-10T08:40:00Z | 6

onboarding.checklist.map((i) => i.id).join(",")
=> first-contact,save-recipe,upload-photos,recall-recipe,dentist-email,whats-needed
```

Three simulated days, one arriving email, and a check on every item that claims
something happened:

```ts continue
onboarding.checklist.flatMap((i) => i.pre.map((p) => `${i.id}:${p.type}`)).join(" ")
=> recall-recipe:advance-days dentist-email:inject-email whats-needed:advance-days

onboarding.checklist.filter((i) => i.checks.length > 0).length
=> 5
```

## Models default to opus, in code

A scenario may omit `models:` entirely; both halves still come back pinned,
because a run that did not record what it tested is not comparable to the next
one.

```ts
const dir = await makeScenario(HEADER + [
  "  - id: only-item",
  "    brief: Do the thing.",
].join("\n") + "\n", {});
const scenario = await loadFieldScenario(dir);
[scenario.models.operator, scenario.models.chat, scenario.checklist[0]!.cleanup].join(" | ")
=> opus | opus | keep
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## Duplicate ids are rejected

Ids name checkpoint tags and report rows; two items sharing one would silently
overwrite each other's results.

```ts
const dupDir = await makeScenario(HEADER + [
  "  - id: same",
  "    brief: First.",
  "  - id: same",
  "    brief: Second.",
].join("\n") + "\n", {});

await loadFieldScenario(dupDir)
=> throws FieldScenarioInvalidError
```

```ts cleanup
await rm(dupDir, { recursive: true, force: true });
```

## A named check script must exist

The checks are the spine of the tier — a missing one would otherwise surface as
a mid-run harness error, after the operator work is already paid for.

```ts
const missingCheckDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Do the thing.",
  "    checks:",
  "      - present.sh",
  "      - absent.sh",
].join("\n") + "\n", { checks: ["present.sh"] });

const error = await loadFieldScenario(missingCheckDir).catch((e: unknown) => e);
String(error).includes("checks/absent.sh does not exist")
=> true
```

So is an email fixture a `pre` action names — the fixture's *shape* is Track 1's
business, but a run must not discover a misspelled fixture name on day two:

```ts continue
const missingEmailDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Do the thing.",
  "    pre:",
  "      - inject-email: dentist",
].join("\n") + "\n", {});

const emailError = await loadFieldScenario(missingEmailDir).catch((e: unknown) => e);
String(emailError).includes("emails/dentist.yaml, which does not exist")
=> true
```

An asset a brief points at is held to the same rule:

```ts continue
const missingAssetDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: The file is at `assets/nope.txt`, go find it.",
].join("\n") + "\n", {});

const assetError = await loadFieldScenario(missingAssetDir).catch((e: unknown) => e);
String(assetError).includes("brief references assets/nope.txt")
=> true
```

A reference that leaves the corpus is rejected even though the file it lands on
exists — the operator is told `assets/` is everything it has:

```ts continue
const escapingDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: The file is at `assets/../persona.md`.",
].join("\n") + "\n", {});

const escapeError = await loadFieldScenario(escapingDir).catch((e: unknown) => e);
String(escapeError).includes("escapes assets/")
=> true
```

A word merely *ending* in `assets/` is not a reference:

```ts continue
const notARefDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Look in myassets/nope.txt on your old laptop.",
].join("\n") + "\n", {});

(await loadFieldScenario(notARefDir)).checklist.length
=> 1
```

```ts cleanup
await rm(missingCheckDir, { recursive: true, force: true });
await rm(missingAssetDir, { recursive: true, force: true });
await rm(missingEmailDir, { recursive: true, force: true });
await rm(escapingDir, { recursive: true, force: true });
await rm(notARefDir, { recursive: true, force: true });
```

## Valid `pre` actions normalize to a tagged union

The single-key YAML mappings the plan specifies become a discriminated union the
harness can dispatch on, and a fixture that exists passes:

```ts
const preDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Read `assets/note.txt` and do the thing.",
  "    pre:",
  "      - advance-days: 2",
  "      - inject-email: dentist",
].join("\n") + "\n", { assets: ["note.txt"], emails: ["dentist.yaml"] });

const preScenario = await loadFieldScenario(preDir);
JSON.stringify(preScenario.checklist[0]!.pre)
=> [{"type":"advance-days","days":2},{"type":"inject-email","fixture":"dentist"}]
```

```ts cleanup
await rm(preDir, { recursive: true, force: true });
```

## Unknown fields and unknown `pre` actions are rejected

Strict schemas throughout: a misspelled key is a typo the author wants told
about, never a silently ignored instruction.

```ts
const unknownFieldDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Do the thing.",
  "    cleanupPolicy: reset",
].join("\n") + "\n", {});

await loadFieldScenario(unknownFieldDir)
=> throws FieldScenarioParseError

const unknownPreDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Do the thing.",
  "    pre:",
  "      - restart-server: true",
].join("\n") + "\n", {});

await loadFieldScenario(unknownPreDir)
=> throws FieldScenarioParseError
```

```ts cleanup
await rm(unknownFieldDir, { recursive: true, force: true });
await rm(unknownPreDir, { recursive: true, force: true });
```

## Malformed YAML and a missing persona fail closed

```ts
const badYamlDir = await makeScenario("name: [unclosed\n", {});

await loadFieldScenario(badYamlDir)
=> throws FieldScenarioParseError

const noPersonaDir = await makeScenario(HEADER + [
  "  - id: item",
  "    brief: Do the thing.",
].join("\n") + "\n", { persona: false });

await loadFieldScenario(noPersonaDir)
=> throws FieldScenarioInvalidError
```

```ts cleanup
await rm(badYamlDir, { recursive: true, force: true });
await rm(noPersonaDir, { recursive: true, force: true });
```
