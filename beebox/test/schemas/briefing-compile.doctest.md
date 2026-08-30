# Briefing compile

`compileBriefing` produces the markdown that gets `@`-included into
CLAUDE.md: the body's Markdoc (`{% purpose %}`, `{% correction %}`, prose)
followed by the frontmatter records (`key-people:`, `properties:`,
`openers:`) as
`**Label:** …` lines. The structured records live in frontmatter; only the
free-text material stays in the body. (Outputs are `JSON.stringify`-ed to
pin exact whitespace.)

```ts setup
import { BriefingSchema, compileBriefing } from "../../src/schemas/briefing.js";

/** Does `openers` pass the schema? */
function opensOk(openers: string[]): boolean {
  return BriefingSchema.frontmatterSchema.safeParse({ type: "briefing", openers }).success;
}
```

## Body-only: the `{% purpose %}` tag compiles to a Purpose line

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "{% purpose %}\nRun the household.\n{% /purpose %}\n" }))
=> "## Box Briefing\n\n**Purpose:** Run the household.\n"
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

## `openers` compile to Opener lines

Openers are the suggestions a fresh chat offers; they compile into the
briefing slice so the agent sees what it is currently suggesting on every
turn (which is what lets it curate them).

```ts
const md = compileBriefing({
  type: "briefing",
  openers: ["Let me tell you what this box is for.", "What can you do?"],
  body: "",
});
JSON.stringify(md)
=> "## Box Briefing\n\n**Opener:** Let me tell you what this box is for.\n\n**Opener:** What can you do?\n"
```

## Blank openers are dropped, and each is trimmed

A stray empty list entry shouldn't emit a bare `**Opener:**` line.

```ts
JSON.stringify(compileBriefing({ type: "briefing", openers: ["  What can you do?  ", "", "   "], body: "" }))
=> "## Box Briefing\n\n**Opener:** What can you do?\n"
```

## An opener must be a single short non-blank line

An opener is agent-written text that compiles into CLAUDE.md and renders as a
button. A blank, multi-line, or essay-length entry is a card validation error
the boxholder sees, not something quietly normalized away at render time.

```ts
opensOk(["What can you do?"])
=> true

opensOk([""])
=> false

opensOk(["   "])
=> false

opensOk(["Tell me about the box.\nAnd the people in it."])
=> false

opensOk(["x".repeat(120)])
=> true

opensOk(["x".repeat(121)])
=> false
```

Surrounding whitespace doesn't make an otherwise-fine opener fail — the length
limit is measured on the trimmed text, and `compileBriefing` trims it too.

```ts
opensOk(["  What can you do?  "])
=> true
```

## An empty briefing is just the header

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "" }))
=> "## Box Briefing\n"
```

## A directory label changes the header

```ts
JSON.stringify(compileBriefing({ type: "briefing", body: "" }, "store/archive/financial"))
=> "## Briefing: store/archive/financial\n"
```
