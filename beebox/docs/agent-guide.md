# Agent guide

The always-loaded agent guide (`.beebox/agent-guide.md` in every box), the
ledger that records why each rule is in it, and how to change either. For
where an instruction belongs among all the files a box agent reads, see
[box guidance](box-guidance.md); this page covers the guide itself.

## What it is

The guide is the only text every box agent reads before its task arrives:
chat, reactor jobs, and procedure runs load it through the box's root
`CLAUDE.md`. Every word in it is paid on every turn, so each rule in it must
earn that place.

Two files hold it, both under `src/core/agent-guide/`:

- `ledger.yaml` holds the decisions: one **row** per rule, the **registry**
  of section handles, and the **budget**. Its schema is `ledger-schema.ts`.
- `guide.md` holds the text, written by hand as one document. Its header
  comment tells an editing agent the rules on this page in short.

The ledger holds what must be said and why. The text holds how it is said.
Nothing generates the text from the ledger. `lint.ts` checks what a machine
can check about the two together; whether a sentence serves its row is the
editing agent's judgment.

## How it works

### Rows

A row is the unit of decision. Its fields:

| Field | Meaning |
|---|---|
| `id` | `<section>.<slug>`, for example `laws.quoting` |
| `rule` | One sentence: the thing an agent must know or do |
| `handle` | The section that carries the rule, or the surface it moved to |
| `bin` | `law`, `core`, `indirect`, or `delete` |
| `reason` | Why that bin, in one or two sentences |
| `audits` | Ids in `src/dev/knowledge-audits.yaml` that guard the rule |
| `mechanics` | Where the how-to lives: a package doc, a card rule, a skill |

### Bins

Ask in order and stop at the first yes:

1. Would the system be unable to tolerate an agent breaking this? **`law`**.
   A law is added for a failure someone has seen, not one that could happen.
2. Would an agent on a task it cannot predict err without it? **`core`**.
3. Does it apply only when touching one thing (a field, a command, a card
   type)? **`indirect`**: it lives on that thing's surface (a package doc
   under `docs/box/`, a card rule, a skill), and the guide keeps at most a
   pointer.
4. Otherwise **`delete`**: the agent can see it by looking (a schema,
   `--help`, a listing), or it was written for a human. The reason says which
   and what the agent looks at instead. A `delete` row keeps no pointer; if a
   pointer is needed, the answer to 3 was yes.

A generated list (the card types, this box's procedures) is one row, bin
`core`, whose reason is the decision to list it; the per-box entries need no
rows of their own.

Considered and not adopted as laws, for lack of an observed failure: honesty,
authority, keys, and keeping. Keys and keeping are stated strongly in their
sections.

### The document and its rendering

`guide.md` is the guide's prose in section order. The parts that vary per box
are placeholders, each filled by a function in the section files beside it
(`index.ts` maps them):

| Placeholder | Filled with | Filler |
|---|---|---|
| `{{engine_source_note}}` | the engine-source sentence, when the source ships | `where-docs.ts` |
| `{{create_examples}}` | one `bbx create` line per template | `cards.ts` |
| `{{card_types}}` | the card-type catalogue and box-local templates | `cards.ts` |
| `{{directory_layout}}` | the directory table's rows | `box-shape.ts` |
| `{{box_code_dirs}}` | the box-code table's rows | `box-shape.ts` |
| `{{procedures}}` | this box's procedures | `extensibility.ts` |
| `{{guides}}` | this box's guide cards | `extensibility.ts` |
| `{{personality}}` | the compiled personality card | `index.ts` |

A placeholder alone on its line takes any number of lines; an empty result
removes the line, and a list filler returns nothing when its list is empty,
which omits the whole section. `render.ts` fills placeholders and strips the
header comment and every citation in one pass; `generateDocs`
(`src/core/docs-gen/index.ts`) then writes the result through `withDocId`,
which adds the DOCID marker line.

### Citations

A citation is an HTML comment on the line before a passage:

```
<!-- rules: laws.quoting, laws.quoting-data -->
```

It names every row the passage carries and covers the text up to the next
blank line, so a paragraph, a list, a table, or a fenced example is one
passage. Citations are many to many: a passage may carry several rows, and a
row may be cited by several passages. A placeholder line carries its own
citation (`<!-- rules: card-types.list -->`), which covers everything it
expands to, so per-box content needs no rows of its own.

### Handles and the registry

Each section has a **handle**, an ALL_CAPS name that appears in its heading
(`## PROVENANCE — ...`) and in every pointer to it (`**PROVENANCE**`). The
ledger's `registry:` lists every handle in guide order, with one line on what
it governs and its `referrers`: the other sections and the files that name
it. `section()` and `xref()` in `sections.ts` read the registry and throw on a
handle it does not list, so a prompt that names a retired section fails when
it is built.

### The skeleton

The shape a section tends toward, not a template: one line saying what the
handle governs, the rules as short paragraphs or a list, one line saying
where the mechanics live. Prose that carries several rows at once is better
than one paragraph per row. Bulletproofing (naming the excuse and rebutting
it) belongs only on a law or on a rule whose audits have shown it slipping;
the row's reason says which.

### The budget

The ledger header holds two ceilings, `guide_words` (the rendered guide,
counted by `wc -w`) and `always_loaded_words` (the `pnpm agent-context chat`
total), and `uncited_words_per_section`, the allowance for framing text. The
ceilings started at the numbers measured on the test1 clone on 2026-09-26 and
come down as sections are binned.

## Changing it

### Adding a rule

1. Add the row first: the rule in one sentence, the bin by the ordered test,
   and the reason. A rule that fails test 2 goes to its surface, not the
   guide.
2. Write the text in the section the row names, in `guide.md`, with a
   citation naming the row.
3. Name or write the knowledge audit that guards it, and run it on a clone
   box. A row moved out of `core` needs at least one audit whose
   `should_read_any` names its new home.

Keep the budget: a rule that pushes the guide over it displaces another, or
makes the case in its reason for raising the ceiling.

### Adding or renaming a section

Add the handle to the registry in guide order, and give the section heading
`## HANDLE — Plain Title`. A rename is a registry change with a sweep of the
entry's `referrers`.

### Reading and checking it

`pnpm agent-context guide --box <box>` prints the guide as that box would get
it, rendered from the box's current inputs without writing to the box;
`--annotated` keeps the comments, to read each passage beside the rows it
cites.

`pnpm lint:guide` renders the guide for a fresh bare box and checks it
(`--box <box>` checks an existing box instead, read-only; `--report` prints
the word counts). It prints nothing when the guide passes. The checks:

- every cited id is a row in the ledger;
- in each section listed in the ledger's `lint.covered_sections`, every `law`
  and `core` row is cited at least once, and the words outside any citation
  (headings and blank lines aside) stay within `uncited_words_per_section`;
- no comment from `guide.md` survives into the stripped render (a filler's
  own output, such as the personality card's source comment, is the filler's);
- the DOCID marker is the rendered file's first line;
- the rendered guide is within `guide_words` and the always-loaded total
  within `always_loaded_words`.

A failure names the section and its uncited word count against the
allowance with the first line of the largest uncited passage, the row that is
missing or unknown, or the leaked line. Coverage is switched on per section,
as each section is binned; until then the section's text is unchecked.

`test/core/agent-guide-lint.doctest.md` runs the linter on a bare box (budget
asserted) and on a box with a box-local schema, a guide card, a procedure,
and an edited personality card (budget reported). `test/core/agent-guide-ledger.doctest.md`
fails when the ledger does not parse, when a row names an audit that does not
exist, when the registry, the rendered headings, and `section()` disagree, or
when a listed referrer no longer names its handle.
