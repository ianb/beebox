// # Personality boxholder identity
//
// Who the boxholder is lives on `people/*.person.card` files flagged
// `boxholder: true` — the single, plural-capable source of truth. The
// personality card carries only the relational notes (`boxholder.relationships`).
// `loadBoxholders` reads the flagged person cards; `compilePersonality` bakes the
// resulting "Your boxholder is …" line into the agent guide.

import { test } from "tap";
import "agent-doctest/tap";
import { compilePersonality } from "../src/schemas/personality/schema.js";
import { loadBoxholders } from "../src/core/docs-gen/config-cards/boxholder-cards.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const base = { type: "personality", version: "1.0.0", body: "" } as const;

// ## One boxholder — name and called
void test("One boxholder — name and called", async (t) => {
  // doctest:L20
  const md = compilePersonality({ ...base }, { boxholders: [{ name: "Priya Marlowe", called: "Priya" }] });
  await t.checkText(md.includes("Your boxholder is **Priya Marlowe** (Priya)."), "true");
});

// ## A boxholder with no alias omits the parenthetical
void test("A boxholder with no alias omits the parenthetical", async (t) => {
  // doctest:L28
  const md = compilePersonality({ ...base }, { boxholders: [{ name: "Priya Marlowe" }] });
  await t.checkText(md.includes("Your boxholder is **Priya Marlowe**."), "true");
});

// ## Several boxholders — an oxford-joined sentence
void test("Several boxholders — an oxford-joined sentence", async (t) => {
  // doctest:L36
  const md = compilePersonality({ ...base }, {
    boxholders: [{ name: "Priya", called: "A" }, { name: "Juniper" }, { name: "Odette" }],
  });
  await t.checkText(md.includes("Your boxholders are **Priya** (A), **Juniper**, and **Odette**."), "true");
});

// ## No boxholders — no identity line, relationships still emit
void test("No boxholders — no identity line, relationships still emit", async (t) => {
  // doctest:L46
  const md = compilePersonality(
    { ...base, boxholder: { relationships: [{ text: "Prefers terse replies", confidence: "confirmed", basis: "user-stated" }] } },
    { boxholders: [] },
  );
  t.check([md.includes("Your boxholder"), md.includes("Prefers terse replies")], [
    false,
    true,
  ]);
});

// ## `loadBoxholders` reads flagged, active person cards only
void test("`loadBoxholders` reads flagged, active person cards only", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L57
  const box = await makeTmpBox();
  await box.write("people/Priya_Marlowe.person.card", "---\nname: Priya Marlowe\naliases:\n  - Priya\nboxholder: true\n---\n");
  await box.write("people/Jo_Smith.person.card", "---\nname: Jo Smith\nboxholder: true\narchived: true\n---\n");
  await box.write("people/Pat_Lee.person.card", "---\nname: Pat Lee\n---\n");
  t.check(await loadBoxholders(box.root), [
    {
      name: "Priya Marlowe",
      called: "Priya",
    },
  ]);
});
