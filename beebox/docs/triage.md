# Triage

**Status:** current operational guide. The earlier design exploration, including
superseded artifact shapes and unbuilt proposals, is preserved as
[triage design history](reports/triage-design-2026-09-13.md).

The intake → triage → handle pipeline sorts items arriving in
`_content/inbox/`. Each stage is observable in the filesystem and can be run
independently.

## Pipeline

1. `bbx intake` prepares top-level inbox items, including filename
   normalization, then moves ready items through `_content/inbox/intake/` to
   `_content/inbox/staged/`.
2. `bbx triage` classifies each staged item from the box's triage destinations
   and moves it into `_content/inbox/triaged/<category>/`.
3. `bbx handle` runs each category's procedure over that category's bucket. The
   procedure decides the item's final location or action.

These commands are not automatically chained by wakeup. Run the stage required
for the work at hand; an item left between stages remains available to the next
run.

## Define a category

A triage category is a landmark card whose `destinations` frontmatter contains
an entry with `for: [triage]`. That entry supplies the category rules and its
handler procedure. Triage discovers these landmark entries across the box; it
does not use a separate central registry.

```yaml
destinations:
  - for: [triage]
    rules: Receipts and purchase confirmations.
    procedure:
      ref: /_config/procedures/file-receipts.procedure.card
```

The holding-bucket category name is derived from the landmark directory's last
path segment, sanitized to safe filename characters. The box root uses `root`;
later collisions gain a parent-directory prefix. It is not derived from the
destination's card type. The older `<triage-destination>` and `<navigation>`
XML shapes are not current.

## Confidence and review

The triage agent assigns exactly one confidence level:

- `confident` routes the item to its category bucket with no review marker.
- `probable` routes the item to the bucket and writes a `.probable.txt` marker
  beside it for spot-checking.
- `guess` leaves the category unset, moves the item to
  `_content/inbox/triaged/_unsure/`, and creates a question card. The question
  carries both the immediate placement directive and, when known, the durable
  learning proposal.

There is no numeric confidence score and no `wrong` level. Question batching,
a generated decision tree, and automatic updates to category rules are not
implemented.

## Handler contract

`bbx handle` invokes a category's procedure once for its bucket. The current
implementation attempts to put the box-relative item paths in the
`TRIAGE_ITEMS` environment variable separated by NUL bytes. Environment
variables cannot transport embedded NUL bytes, so this contract is currently
broken for a live multi-item procedure invocation. Do not write a handler that
depends on parsing this value until the runtime transport is fixed. This guide
records the defect rather than presenting the intended shell recipe as usable.

A handler moves or removes every item it successfully finishes. Leaving an item
in the bucket keeps it visible for a later run.

The command reports its worst bucket outcome:

- exit `1` when a handler procedure fails;
- exit `3` when work completed but review reached no verdict, with an
  `Inconclusive: handle <category> — …` line on stderr;
- exit `0` only when every bucket that ran was judged.

## Implementation owners

- `src/core/intake.ts` — intake paths and advancement
- `src/core/triage/index.ts` and `src/core/triage/routing.ts` — category
  discovery, classification, routing, markers, and guess questions
- `src/core/handle.ts` — handler invocation and exit semantics
- `src/core/docs-gen/triage.ts` — the corresponding guide shipped to box agents
