# Cards as Markdown

**Status:** Implemented (2026-05). Cards are YAML frontmatter + a markdown body. The legacy XML card format, its loader, and the `cardworks` package have been removed.

This is the living reference for the card *file format* — filenames, frontmatter/body split, attachments, and refs. For the full design record (why markdown over XML, alternatives considered, per-schema migration notes, phased rollout) see `docs/implemented-plans/cards-as-markdown-rfc.md`. For a worked example of adding a new card type, see `docs/adding-schemas.md`. For the on-disk box layout, see `docs/box-layout.md`.

## Format

```
---
status: new
created: 2026-05-22T10:00:00Z
source: dropbox
---
Body content as plain markdown, if the schema declares a body field.
```

A `.card` file is a YAML frontmatter block (`---` fences) optionally followed by a markdown body. `src/cards/frontmatter.ts` `splitCardContent()` locates the block (pure string split, no YAML parsing); `src/core/card-io.ts` parses the frontmatter with the `yaml` package and validates it against the card type's registered `CardSchema`.

**Naming and type discrimination.** `Name.type.card` — the type segment is the canonical discriminator, not a `type:` frontmatter field. `src/core/card-io.ts` `typeFromFilename()` reads it off the filename; `serializeCardText()` never writes a `type:` key back out. (A YAML `type:` field is tolerated on read for backward compatibility, but must match the filename's type or it's a format error.) Any file matching `<basename>.<type>.card` where `<type>` isn't registered in `cardSchemas` is an error; anything not matching that pattern is just not a card (e.g. `README.md`).

**Schemas** are declared with `cardSchema(type, config)` from `src/cards/` (or the `callback-box/cards` public specifier for box-local schemas under `config/schemas/`). `config.fields` is a flat map of Zod validators — one of which may be wrapped in `body(zodSchema)` to mark it as the file's markdown body instead of a frontmatter key. At most one field may be body-wrapped, and it must be named `body`; a schema that declares none is frontmatter-only, and any non-whitespace body content on such a card is a load error. Every schema also gets optional `title` and `contains` frontmatter fields for free (`GLOBAL_CARD_FIELDS` in `src/cards/schema.ts`) unless it declares its own. See `docs/adding-schemas.md` for the full authoring walkthrough, including the per-schema `validate` hook for cross-field rules Zod can't express.

**Body content and Markdoc.** Where a schema declares a body, it's plain markdown text rendered through a shared Markdoc configuration (`src/shared/markdoc-config.ts`) rather than plain CommonMark — this is the same config the frontend renderer and `cb validate`'s body-ref walker both use. It defines a shared vocabulary of inline/block tags (`{% quote %}`, `{% source %}`, `{% ingredient %}`, `{% task %}`, `{% todo %}`, `{% see-also %}`, etc.) available across card bodies; a card type doesn't declare its own tag set, it just uses whichever shared tags make sense in its body prose.

## `{% todo %}` and `{% see-also %}`

`todo` is a universal capture-in-place annotation — it marks a span of body
prose (or, via the frontmatter `todos:` key below, an intention that doesn't
belong to any particular sentence) as an open item. It's a wrapper tag,
inline or block depending on whether its content has a blank line in it
(same `node.inline` split as `{% quote %}`):

```markdoc
{% todo id="vet-refill" assigned="Dana" created="2026-07-28" due="2026-08-01" start="-3d" %}
Call the vet about Biscuit's prescription refill
{% see-also ref="people/Dana_Whitfield.person.card" %}Dana offered to pick it up{% /see-also %}
{% /todo %}
```

All attributes are optional — a bare `{% todo %}…{% /todo %}` is a valid open
todo. Full vocabulary:

- `id` — a short, human-scale slug for cross-reference (unique box-wide,
  enforced by the collector, not per-card lint). Never a UUID.
- `status` — one of `open` (absence = `open`), `done`, `dropped`, `parked`.
  `done`/`dropped` render struck; `parked` is deliberately off the plate
  (excluded from default surfaces, present in the full list).
- `assigned` — plain string; absence = the boxholder. `"agent"` marks work
  the agent itself is chasing.
- `by` — provenance: absence = boxholder-authored, `"agent"` = agent-authored.
- `created` — ISO date (`YYYY-MM-DD`). **Required when `by="agent"`**;
  optional for humans.
- `due` — ISO date; past due escalates the todo (the "oh shit" line).
- `start` — ISO date, or a relative interval (`-3d`, `-2w`) meaning
  due-minus-that-interval (an error if relative with no `due`). This is the
  primary surfacing trigger: the todo is "on the plate" from `start`
  onward, quiet before it. An undated todo (no `start`, no `due`) is on the
  plate immediately — quiet states are always explicit, never an accident
  of missing metadata.

`see-also` nests inside a `todo` (zero or more) and points at supporting
context: exactly one of `ref` (an in-box card, tracked by `cb mv`) or `href`
(an external URL) — a target-less `see-also` is meaningless. Its body is the
reason. Renders footnote-style, not as a block interruption.

**Frontmatter `todos:`** — for intentions that don't attach to any particular
sentence of the body, every card also accepts a `todos:` list, one entry per
todo, same attribute names as above (`text` replaces the tag's body):

```yaml
todos:
  - text: "Renew the parking permit"
    due: 2026-08-15
  - text: "Ask Marcus about the quote"
    assigned: agent
    status: parked
```

**Querying and surfacing.** `cb todos` is the read/query path (deterministic,
locator-carrying, grouped by plate-state — escalated / on-plate / quiet /
parked); it's designed for agent consumption, not human browsing directly.
Mutating a todo is an ordinary card edit — there is no `cb todos` write
subcommand. A `todo-view` card (see `src/schemas/todo-view.ts`) is the
human-facing display surface: it's a live query (a `glob` plus optional
`status`/`assigned` filters) rendered as plate-state groups, and — per "views
attach to cards" — dropping one in a directory gives that subtree its own
plate. `store/plate.todo-view.card` is the box-wide instance. Full design
record: `docs/implemented-plans/todo-annotation.md`.

## Attachments

**`Name.attach/`** — a sibling directory holding files that belong to `Name.type.card`. No reserved top-level attachment directory; every card gets its own scope next to it:

```
Voice_Memo.memo.card
Voice_Memo.attach/
  voice-memo-001.webm
```

Two lint rules make this unambiguous (`src/lib/attach-lint.ts`):
- **No two cards in the same directory may share a basename** — otherwise `Name.attach/` would have no single owner.
- **A literal directory or file named `attach` is forbidden** outside an existing `<basename>.attach/` scope — it would collide with the `attach/` virtual ref prefix below. Names like `attachments/` are fine; only the bare `attach` is reserved.

Inside a ref value, the prefix `attach/` means "this card's own attach scope" — `attach/photo-002.jpg` resolves to `<basename>.attach/photo-002.jpg` (`src/shared/attach-path.ts`). Elsewhere, a path with no leading `/` is relative to the card's directory; a leading `/` is box-root absolute.

## Refs

Refs are found **by convention**, not by per-field schema declaration: any key literally named `ref` whose value is a string, or `refs` whose value is a string array, at any depth in the parsed frontmatter (`extractRefs()` in `src/cards/schema.ts`). The same convention is walked in the Markdoc body (`extractBodyRefs`, `src/core/body-refs.ts`) for tags carrying a `ref` attribute (e.g. `{% source ref="..." %}`). `cb validate` resolves every ref it finds against the box and warns (not errors, so a legitimate pending move doesn't block a commit) when a target doesn't exist.

```yaml
participants:
  - { ref: people/Alice.person.card }
sources:
  - ref: store/archive/articles/Article.record.card
    usage: primary
```

## Validation

Cards validate on load (a Zod parse failure is a hard error — the card can't be used) and again at commit time via the per-box pre-commit hook (`cb validate --staged`, installed by `cb init`; see `docs/card-validation.md` for the hook mechanics). Beyond the Zod frontmatter shape, `cb validate` also runs: the schema's own `validate` hook (self-contained, cross-field checks), box-aware ref-existence resolution, and the `.attach/` layout lint above.

## Why markdown over XML

The prior format was XML validated by Zod schemas via a bespoke library (`cardworks`). The case for markdown + YAML frontmatter came down to familiarity, not raw legibility — agents and humans have seen vastly more Markdown/YAML/JSON-Schema-shaped documents than the project's own XML dialect, and that familiarity reduces the "no, write it like this" correction loop during agent authoring. Attachment-directory ownership (`.attach/`) and prose living in the body without a wrapper element were secondary, real benefits that arrived alongside the format change. The full case for, case against, format alternatives considered (Markdoc vs. MDX vs. directives), and the per-schema migration audit are in the RFC record.

## Full design history

`docs/implemented-plans/cards-as-markdown-rfc.md` is the frozen original RFC: the case for/against, the format-choice survey (why Markdoc over MDX/directives/plain HTML-in-Markdown), the per-schema feasibility audit, the ref-design exploration, and the phased migration plan as originally proposed. Treat it as historical reasoning — where it disagrees with this file or with the code in `src/cards/` and `src/core/card-io.ts`, this file and the code win.
