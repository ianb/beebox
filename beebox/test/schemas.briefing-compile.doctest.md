# Briefing compile

`compileBriefing` produces the markdown that gets `@`-included into
CLAUDE.md: the body's Markdoc (`{% purpose %}`, `{% correction %}`, prose)
followed by the frontmatter records (`key-people:`, `properties:`) as
`**Label:** …` lines, then the root place's openers. The structured records
live in frontmatter; only the free-text material stays in the body. (Outputs
are `JSON.stringify`-ed to pin exact whitespace.)

```ts setup
import { compileBriefing } from "../src/schemas/briefing.js";
import { compileBriefings as compileBoxBriefings } from "../src/core/docs-gen/compile/core.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { readFile } from "node:fs/promises";
```

## Frontmatter `key-people` compile to Key Person lines

`called` supplies the display name; `ref` is preserved as a `[→ …]`
citation, and `notes` trails after an em dash.

```ts
const md = compileBriefing({
  type: "briefing",
  "key-people": [
    { ref: "people/Dana_Lee", called: "Dad", role: "Ledger subject", notes: "Primary account holder." },
    { called: "Priya" },
  ],
  body: "",
});
JSON.stringify(md)
=> "## Box Briefing\n\n**Key Person:** **Dad** — Ledger subject [→ people/Dana_Lee] — Primary account holder.\n\n**Key Person:** **Priya**\n"
```

## A `ref` with no `called` derives the display name from the ref

```ts
JSON.stringify(compileBriefing({ type: "briefing", "key-people": [{ ref: "people/Dana_Lee" }], body: "" }))
=> "## Box Briefing\n\n**Key Person:** **Dana Lee** [→ people/Dana_Lee]\n"
```

## `properties` compile to Property lines, honoring `address-uncertain`

```ts
const md = compileBriefing({
  type: "briefing",
  properties: [{ name: "The lake house", address: "12 Shore Rd", "address-uncertain": true, notes: "In probate." }],
  body: "",
});
JSON.stringify(md)
=> "## Box Briefing\n\n**Property:** **The lake house** — 12 Shore Rd (uncertain) — In probate.\n"
```

## Body and records combine: body first, then records

```ts
const md = compileBriefing({
  type: "briefing",
  "key-people": [{ called: "Priya" }],
  body: "{% purpose %}\nLearn AI together.\n{% /purpose %}\n",
});
JSON.stringify(md)
=> "## Box Briefing\n\n**Purpose:** Learn AI together.\n\n**Key Person:** **Priya**\n"
```

## The root place's openers compile to Opener lines

Openers live on the root landmark (`navigation.openers`), not on the briefing,
but they still compile into the briefing slice so the agent sees what it is
currently suggesting on every turn (which is what lets it curate them). The
caller passes them in.

```ts
const md = compileBriefing({ type: "briefing", body: "" },
  { openers: ["Let me tell you what this box is for.", "What can you do?"] });
JSON.stringify(md)
=> "## Box Briefing\n\n**Opener:** Let me tell you what this box is for.\n\n**Opener:** What can you do?\n"
```

Blank openers are dropped and each is trimmed, so a stray empty entry never
emits a bare `**Opener:**` line.

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "" }, { openers: ["  What can you do?  ", "", "   "] }))
=> "## Box Briefing\n\n**Opener:** What can you do?\n"
```

`compileBriefings` reads them from the root landmark under `_content/`, so
the compiled `_content/briefing.md` names the openers the root chat shows.

```ts
const box = await makeTmpBox();
await box.write("_content/briefing.briefing.card", "---\ntype: briefing\n---\n{% purpose %}\nLend things.\n{% /purpose %}\n");
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Lending\n  openers:\n    - Who has what right now?\n---\n");
await compileBoxBriefings(box.root);
JSON.stringify(await readFile(`${box.root}/_content/briefing.md`, "utf-8").then((t) => t.slice(t.indexOf("## Box Briefing"))))
=> "## Box Briefing\n\n**Purpose:** Lend things.\n\n**Opener:** Who has what right now?\n"
```

## An empty briefing is just the header

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "" }))
=> "## Box Briefing\n"
```

## A directory label changes the header

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "" }, { directoryLabel: "_bookkeeping/archive/financial" }))
=> "## Briefing: _bookkeeping/archive/financial\n"
```
