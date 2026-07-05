# Briefing compile

`compileBriefing` produces the markdown that gets `@`-included into
CLAUDE.md: the body's Markdoc (`{% purpose %}`, `{% correction %}`, prose)
followed by the frontmatter records (`key-people:`, `properties:`) as
`**Label:** …` lines. The structured records live in frontmatter; only the
free-text material stays in the body. (Outputs are `JSON.stringify`-ed to
pin exact whitespace.)

```ts setup
import { compileBriefing } from "../../src/schemas/briefing.js";
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
