// # Briefing compile
//
// `compileBriefing` produces the markdown that gets `@`-included into
// AGENTS.md: the `purpose:` field as a `**Purpose:**` line, the body's markdown,
// then the frontmatter records (`key-people:`, `properties:`) as
// `**Label:** …` lines, then the root place's openers. The structured records
// live in frontmatter; only the free-text material stays in the body. (Outputs
// are `JSON.stringify`-ed to pin exact whitespace.)

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { compileBriefing } from "../src/schemas/briefing.js";
import { compileBriefings as compileBoxBriefings } from "../src/core/docs-gen/compile/core.js";
import { makeTmpBox } from "./helpers/test-helpers.js";
import { readFile } from "node:fs/promises";

// ## Frontmatter `key-people` compile to Key Person lines
//
// `called` supplies the display name; `ref` is preserved as a `[→ …]`
// citation, and `notes` trails after an em dash.
void test("called supplies the display name; ref is preserved as a [→ …] citation, and n...", async (t) => {
  const md = compileBriefing({
    type: "briefing",
    "key-people": [
      { ref: "people/Dana_Lee", called: "Dad", role: "Ledger subject", notes: "Primary account holder." },
      { called: "Priya" },
    ],
    body: "",
  });
  t.check(md, `## Box Briefing

**Key Person:** **Dad** — Ledger subject [→ people/Dana_Lee] — Primary account holder.

**Key Person:** **Priya**
`);
});

// ## A `ref` with no `called` derives the display name from the ref
void test("A `ref` with no `called` derives the display name from the ref", async (t) => {
  t.check(compileBriefing({ type: "briefing", "key-people": [{ ref: "people/Dana_Lee" }], body: "" }), `## Box Briefing

**Key Person:** **Dana Lee** [→ people/Dana_Lee]
`);
});

// ## `properties` compile to Property lines, honoring `address-uncertain`
void test("`properties` compile to Property lines, honoring `address-uncertain`", async (t) => {
  const md = compileBriefing({
    type: "briefing",
    properties: [{ name: "The lake house", address: "12 Shore Rd", "address-uncertain": true, notes: "In probate." }],
    body: "",
  });
  t.check(md, `## Box Briefing

**Property:** **The lake house** — 12 Shore Rd (uncertain) — In probate.
`);
});

// ## Body and records combine: body first, then records
void test("Body and records combine: body first, then records", async (t) => {
  const md = compileBriefing({
    type: "briefing",
    purpose: "Learn AI together.",
    "key-people": [{ called: "Priya" }],
    body: "",
  });
  t.check(md, `## Box Briefing

**Purpose:** Learn AI together.

**Key Person:** **Priya**
`);
});

// ## The root place's openers compile to Opener lines
//
// Openers live on the root landmark (`navigation.openers`), not on the briefing,
// but they still compile into the briefing slice so the agent sees what it is
// currently suggesting on every turn (which is what lets it curate them). The
// caller passes them in.
void test("Openers live on the root landmark (navigation.openers), not on the briefing,...", async (t) => {
  const md = compileBriefing({ type: "briefing", body: "" },
    { openers: ["Let me tell you what this box is for.", "What can you do?"] });
  t.check(md, `## Box Briefing

**Opener:** Let me tell you what this box is for.

**Opener:** What can you do?
`);
});

// Blank openers are dropped and each is trimmed, so a stray empty entry never
// emits a bare `**Opener:**` line.
void test("Blank openers are dropped and each is trimmed, so a stray empty entry never e...", async (t) => {
  t.check(compileBriefing({ type: "briefing", body: "" }, { openers: ["  What can you do?  ", "", "   "] }), `## Box Briefing

**Opener:** What can you do?
`);
});

// `compileBriefings` reads them from the root landmark under `_content/`, so
// the compiled `_content/briefing.md` names the openers the root chat shows.
void test("compileBriefings reads them from the root landmark under content/, so the com...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/briefing.briefing.card", "---\ntype: briefing\npurpose: Lend things.\n---\n");
  await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Lending\n  openers:\n    - Who has what right now?\n---\n");
  await compileBoxBriefings(box.root);
  t.check(await readFile(`${box.root}/_content/briefing.md`, "utf-8").then((md) => md.slice(md.indexOf("## Box Briefing"))), `## Box Briefing

**Purpose:** Lend things.

**Opener:** Who has what right now?
`);
});

// ## An empty briefing is just the header
void test("An empty briefing is just the header", async (t) => {
  t.check(compileBriefing({ type: "briefing", body: "" }), `## Box Briefing
`);
});

// ## A directory label changes the header
void test("A directory label changes the header", async (t) => {
  t.check(compileBriefing({ type: "briefing", body: "" }, { directoryLabel: "_bookkeeping/archive/financial" }), `## Briefing: _bookkeeping/archive/financial
`);
});

// ## The briefing instructions name the root's stock openers
//
// When the agent records the box's purpose it edits the briefing, and only the
// briefing's instructions load then. They tell it to retire the root landmark's
// stock onboarding openers, quoting them; the schemas cannot import each other,
// so this check keeps the quoted text equal to `STOCK_ROOT_OPENERS`.
void test("When the agent records the box's purpose it edits the briefing, and only the...", async (t) => {
  const { BriefingSchema } = await import("../src/schemas/briefing.js");
  const { STOCK_ROOT_OPENERS } = await import("../src/schemas/landmark.js");
  t.check(STOCK_ROOT_OPENERS.filter((opener) => !(BriefingSchema.instructions ?? "").includes(`"${opener}"`)), []);
});
