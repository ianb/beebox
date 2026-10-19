// # Registries
//
// `defineRegistry` is the one way a set directory's members are enumerated.
// The call declares the set for the layout check and keys the members at
// construction, so a duplicate key fails on the first import.
//
// Every call below writes `<M>` explicitly. Omitting it is a compile error
// (`defineRegistry({...})` with no type argument fails to typecheck, since `M`
// defaults to `never`), which a test cannot express — verified by hand with
// `pnpm exec tsc --noEmit -p tsconfig.json` in `beebox/`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { defineRegistry } from "../../src/shared/registry.js";

interface Verb { name(): string; }
const verb = (name: string): Verb => ({ name: () => name });

// ## A list with a key function
//
// Unordered registries sort by key, so a reorder in the file is not a
// behaviour change.
void test("Unordered registries sort by key, so a reorder in the file is not a behaviour...", async (t) => {
  const verbs = defineRegistry<Verb>({
    directory: "./commands",
    entry: "command",
    ordered: false,
    key: (v) => v.name(),
    members: [verb("wakeup"), verb("init"), verb("migrate")],
  });
  t.check(verbs.keys(), [
    "init",
    "migrate",
    "wakeup",
  ]);

  t.check(verbs.get("init")?.name(), "init");

  t.check(verbs.get("nope"), undefined);

  t.check(verbs.list.map((v) => v.name()), [
    "init",
    "migrate",
    "wakeup",
  ]);

  t.check(Object.isFrozen(verbs) && Object.isFrozen(verbs.list), true);
});

// ## Order as semantics
void test("Order as semantics", async (t) => {
  const steps = defineRegistry<string>({
    directory: "./migrations",
    ordered: true,
    key: (s) => s,
    members: ["b", "a"],
  });
  t.check(steps.keys(), [
    "b",
    "a",
  ]);
});

// ## A record gives keys literally
//
// The layout check verifies each literal key is the member's file or directory
// name; the helper only enforces uniqueness (a record cannot repeat a key, so
// the check is the only guard for this form).
void test("The layout check verifies each literal key is the member's file or directory...", async (t) => {
  const surfaces = defineRegistry<string>({
    directory: "./exports",
    ordered: false,
    members: { schema: "schema.ts", cards: "cards.ts" },
  });
  t.check(surfaces.keys(), [
    "cards",
    "schema",
  ]);
});

// ## Duplicate keys throw at construction
void test("Duplicate keys throw at construction", async (t) => {
  await t.checkThrows(
    async () => (defineRegistry<Verb>({
      directory: "./commands",
      ordered: false,
      key: (v) => v.name(),
      members: [verb("init"), verb("init")],
    })),
    "DuplicateRegistryKeyError: registry ./commands: duplicate key \"init\"",
  );
});
