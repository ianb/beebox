# card-lint: validating frontmatter cards

`lintCardsDispatch` is the validate-time counterpart to
`loadCardFile`: it picks the right validator for each file based on
its frontmatter, then merges results into a single LintSummary.

```ts setup
import { z } from "zod";
import {
  body,
  cardSchema,
  formatLintResults,
  type CardSchema,
} from "../../src/cards/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { lintCardsDispatch } from "../../src/core/card-lint.js";
import type { LoadCardContext } from "../../src/core/card-io.js";
import { CommentarySchema } from "../../src/schemas/commentary.js";
import { ExtfileSchema } from "../../src/schemas/extfile.js";
import { ProgressSchema } from "../../src/schemas/progress.js";
import { LessonPlanSchema } from "../../src/schemas/lesson-plan.js";
import { ConceptMapSchema } from "../../src/schemas/concept-map.js";
import { LandmarkSchema } from "../../src/schemas/landmark.js";
import { FigureSchema } from "../../src/schemas/figure.js";
import { ChatSchema } from "../../src/schemas/chat.js";

const threadSchema: CardSchema = cardSchema("email-thread", {
  fields: {
    "thread-id": z.string(),
    subject: z.string(),
    participants: z.array(z.string()),
    "date-range": z.object({
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
    }),
    messages: z.array(z.object({ ref: z.string() })),
  },
});

const docSchema: CardSchema = cardSchema("doc", {
  fields: {
    title: z.string(),
    body: body(z.string()),
  },
});

// A throwaway type whose only special rule lives in a self-contained `validate`
// hook on its schema — proves card-lint's dispatch invokes whatever `validate`
// a schema declares, generically, without knowing the type name. The hook sees
// only the card's own parsed fields (no loader / box access).
const gadgetSchema: CardSchema = cardSchema("gadget", {
  fields: { mode: z.string() },
  validate: ({ fields }) =>
    fields["mode"] === "forbidden"
      ? [{ type: "validation", severity: "error", message: "gadget mode must not be \"forbidden\"" }]
      : [],
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([
    ["email-thread", threadSchema],
    ["doc", docSchema],
    ["commentary", CommentarySchema],
    ["extfile", ExtfileSchema],
    ["gadget", gadgetSchema],
    ["progress", ProgressSchema],
    ["lesson-plan", LessonPlanSchema],
    ["concept-map", ConceptMapSchema],
    ["landmark", LandmarkSchema],
    ["figure", FigureSchema],
    ["chat", ChatSchema],
  ]),
};
```

## Frontmatter cards that satisfy their schema lint clean

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/email/thread-x.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread-x.attach/msg-001.email-message.card\n---\n",
);
await box.write(
  "_content/inbox/email/thread-x.attach/msg-001.email-message.card",
  "---\nmessage-id: m1\nthread-id: t1\nfrom: a@x\ndate: 2026-02-15T10:00:00Z\nsubject: hi\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/email/thread-x.email-thread.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.filesChecked
=> 1
```

## Schema violations in frontmatter cards surface as lint errors

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/email/broken.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/email/broken.email-thread.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 1

result.results[0]!.errors[0]!.message.includes("invalid email-thread frontmatter")
=> true
```

## Unknown frontmatter keys are reported as warnings

A key the schema doesn't declare is stripped on load, so the card still loads,
renders, and indexes. Lint surfaces it as a warning (not an error) so it gets
cleaned off disk eventually without blocking commits.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/notes/drift.doc.card",
  "---\ntype: doc\ntitle: Drift\nbogus-field: oops\n---\nBody.\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/notes/drift.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.results[0]!.warnings.some(w => w.message.includes('Unknown frontmatter key "bogus-field"'))
=> true
```

## Broken refs in frontmatter cards are reported as warnings

Each entry in a ref-declared field is resolved against the box; missing
targets surface as lint warnings (not errors) carrying the field path. Broken
refs are warnings because they commonly arise from legitimate operations
(referents being moved, archived, trashed, or hand-deleted), and treating
each as a hard error would block commits on any box with accumulated drift.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/email/thread-x/thread.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/email/thread-x/thread.email-thread.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Broken reference at messages[0].ref: thread.attach/missing.email-message.card does not exist
```

## A ref's `#fragment` addresses a spot inside the target, not another file

`feedback.target.ref` is documented as `path#fragment`. The fragment (and a
`?query`) is split off before the existence check — the file either exists or
it doesn't, regardless of which spot inside it the ref points at. Handing the
whole string to the filesystem used to report these documented refs as broken.

```ts
const box = await makeTmpBox();
await box.write("box/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nBody.\n");
await box.write(
  "box/notes/Meeting.doc.card",
  "---\ntype: doc\ntitle: Meeting Notes\n---\nSee {% source ref=\"/box/notes/Plan.doc.card#risks\" usage=\"verbatim\" %}{% /source %}\n",
);
const result = await lintCardsDispatch(
  [box.path("box/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx },
);
JSON.stringify([result.totalErrors, result.totalWarnings])
=> [0,0]
```

## `bbx validate`'s summary line calls out broken refs separately

Broken-reference warnings accumulate silently across renames/deletes and can
run into the thousands on a drifted box — easy to lose inside a generic
"N warnings" count. `formatLintResults` breaks them out as their own
"N broken ref(s)" clause on the aggregate summary line, so they can't hide in
the noise. Zero broken refs (even alongside other warnings) means no such
clause is added at all — a clean box gets no new output.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/email/thread-x/thread.email-thread.card",
  "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/email/thread-x/thread.email-thread.card")],
  { boxRoot: box.root, ctx },
);
const summary = formatLintResults(result, { colors: false }).split("\n").at(-1);
summary
=> 1 file checked, 1 warning in 0 files (1 broken ref)
```

A warning that isn't a broken ref (e.g. an unknown frontmatter key) leaves
the summary's broken-ref clause off entirely:

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/notes/drift.doc.card",
  "---\ntype: doc\ntitle: Drift\nbogus-field: oops\n---\nBody.\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/notes/drift.doc.card")],
  { boxRoot: box.root, ctx },
);
formatLintResults(result, { colors: false }).split("\n").at(-1)
=> 1 file checked, 1 warning in 0 files
```

## An over-budget `contains:` field warns (never blocks)

`contains` is one concise sentence stating what can be found in the card;
past 200 characters the writer is summarizing instead. Warning-level so the
nudge reaches agents (the PostToolUse hook surfaces warnings) without
blocking commits.

```ts
const box = await makeTmpBox();
const longContains = "x".repeat(220);
await box.write(
  "store/notes/Wordy.doc.card",
  "---\ntitle: Wordy\ncontains: " + longContains + "\n---\nbody\n",
);
const result = await lintCardsDispatch(
  [box.path("store/notes/Wordy.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> contains: is 220 chars (budget 200) — tighten it to one sentence stating what can be found in this card
```

## Broken refs in Markdoc body tags surface as warnings too

Refs carried by Markdoc tag attributes inside a card body (e.g.
`{% source ref="..." %}`, `{% subrecipe ref="..." %}`) get the same
broken-ref treatment as frontmatter refs — resolved against the box,
missing targets reported as warnings. The path field on the warning
points at `body:<line>:<tagName>.<attr>` so the human can locate it.
Ref paths follow the same convention as frontmatter refs: leading `/`
is box-root-absolute (the convention recommended by `record.tsx`'s
instructions); bare paths are resolved relative to the source card.

```ts
const box = await makeTmpBox();
await box.write(
  "box/notes/Meeting.doc.card",
  "---\ntype: doc\ntitle: Meeting Notes\n---\nDana made the call: {% source ref=\"/box/people/missing.person.card\" usage=\"verbatim\" %}{% /source %}\n",
);
const result = await lintCardsDispatch(
  [box.path("box/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Broken reference at body:1:source.ref: /box/people/missing.person.card does not exist
```

## Resolved body refs lint clean

A body Markdoc tag whose `ref` resolves to an existing target produces
no warning, same as a resolved frontmatter ref.

```ts
const box = await makeTmpBox();
await box.write(
  "box/people/dana.person.card",
  "---\ntype: person\nname: Dana\n---\n",
);
await box.write(
  "box/notes/Meeting.doc.card",
  "---\ntype: doc\ntitle: Meeting Notes\n---\nDana said: {% source ref=\"/box/people/dana.person.card\" usage=\"verbatim\" %}ship Friday{% /source %}\n",
);
const result = await lintCardsDispatch(
  [box.path("box/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 0
```

## Inline markdown links in a card body are checked too

`bbx mv` has always rewritten `[text](path)` / `![alt](path)` inside card
bodies; validate never looked at them, so a link broken by a hand-edit or a
delete stayed silent until someone clicked it. They are now walked like any
other ref — `type: "reference"` warnings that land in the broken-ref count.

```ts
const box = await makeTmpBox();
await box.write(
  "box/notes/Plan.doc.card",
  "---\ntype: doc\ntitle: Plan\n---\nSee [the brief](/box/notes/missing.doc.card).\n",
);
const result = await lintCardsDispatch(
  [box.path("box/notes/Plan.doc.card")],
  { boxRoot: box.root, ctx },
);
JSON.stringify([result.totalErrors, result.totalWarnings])
=> [0,1]

result.results[0]!.warnings[0]!.type
=> reference

result.results[0]!.warnings[0]!.message
=> Broken reference at body:1:link: /box/notes/missing.doc.card does not exist
```

It counts as a broken ref on the summary line, alongside frontmatter and
Markdoc-tag refs:

```ts continue
formatLintResults(result, { colors: false }).split("\n").at(-1)
=> 1 file checked, 1 warning in 0 files (1 broken ref)
```

Links that resolve are clean, and links that name nothing in the box —
a URL scheme, a protocol-relative `//host`, or a bare `#anchor` — are skipped
rather than resolved as paths:

```ts
const box = await makeTmpBox();
await box.write("box/notes/Brief.doc.card", "---\ntype: doc\ntitle: Brief\n---\nx\n");
await box.write("box/notes/Plan.attach/chart.png", "PNG");
await box.write(
  "box/notes/Plan.doc.card",
  "---\ntype: doc\ntitle: Plan\n---\n" +
    "Rel [brief](Brief.doc.card), abs [brief again](/box/notes/Brief.doc.card), " +
    "attached ![chart](attach/chart.png).\n" +
    "Off-box: [site](https://example.com/x), [cdn](//cdn.example.com/x), " +
    "[mail](mailto:dana@example.com), [top](#summary).\n",
);
const result = await lintCardsDispatch(
  [box.path("box/notes/Plan.doc.card")],
  { boxRoot: box.root, ctx },
);
JSON.stringify([result.totalErrors, result.totalWarnings])
=> [0,0]
```

## Ref existence honors `attach/` scope

The broken-ref walk resolves an `attach/`-prefixed ref into the referring
card's `<basename>.attach/` scope. An `attach/` ref resolving into the card's
attach scope is clean; a missing one in the same scope warns:

```ts
const box = await makeTmpBox();
await box.write(
  "box/notes/Note.doc.card",
  "---\ntype: doc\ntitle: N\n---\nok {% source ref=\"attach/photo.jpg\" usage=\"a\" %}{% /source %} bad {% source ref=\"attach/missing.jpg\" usage=\"b\" %}{% /source %}\n",
);
await box.write("box/notes/Note.attach/photo.jpg", "JPG");
const result = await lintCardsDispatch(
  [box.path("box/notes/Note.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message.includes("attach/missing.jpg does not exist")
=> true
```

## A card whose type has no registered schema warns, never errors

There's no XML loader fallback anymore: a `.card` with frontmatter whose
filename type isn't a registered schema (a typo, or a box-local type the test
ctx doesn't include) is surfaced as a non-blocking warning rather than failing.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/inbox/Note.unknowntype.card",
  "---\nstatus: new\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/inbox/Note.unknowntype.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.results[0]!.warnings[0]!.message
=> no schema registered for card type "unknowntype" — card not validated
```

A `.card` with no frontmatter block at all is malformed (every card is
frontmatter now). It's surfaced as a warning — visible, but non-blocking so one
stray card doesn't brick a box's pre-commit/automation:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Broken.memo.card", "this is not a frontmatter card\n");
const result = await lintCardsDispatch(
  [box.path("_content/inbox/Broken.memo.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> card has no frontmatter block
```

## An attach-only commentary card with valid anchors lints clean

Commentary is attach-only — it carries no target field; bare `{% source %}`
anchors point at the containing host card.

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/Plan.attach/Plan.commentary.card",
  "---\ntype: commentary\n---\n{% source pos=\"body; ~line 4\" version=\"sha256:9f3a1c2b\" %}{% quote %}a span{% /quote %}{% /source %}\n\nThis reads well.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/Plan.attach/Plan.commentary.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0
```

## A leftover target field on a commentary card is a warning, not an error

Commentary no longer has `defaultHref`/`defaultRef`/`targets`. A card still
carrying one (pre-attach drift) loads fine — the key is stripped — and surfaces
as an unknown-key warning so it gets cleaned off disk.

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/Stale.commentary.card",
  "---\ntype: commentary\ndefaultHref: \"file:/Users/x/doc.md\"\n---\nbody\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/Stale.commentary.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.results[0]!.warnings.some(w => w.message.includes('Unknown frontmatter key "defaultHref"'))
=> true
```

## A ref-free `{% source %}` in a commentary body is valid — it targets the host

Markdoc validation runs on commentary bodies (it does not run elsewhere). A
`{% source %}` with neither `ref` nor `href` points at the containing host card
and is allowed.

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/RefFree.commentary.card",
  "---\ntype: commentary\n---\n{% source pos=\"body\" %}a span anchored to this page{% /source %}\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/RefFree.commentary.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0
```

## Extfile cards validate their href and stamped version

An extfile card's `href` must be a `file:` URL, and a present `version` must
carry a `sha256:<hex>` marker (it is compared against the live file's hash). A
well-formed card lints clean; a non-`file:` href or a malformed `version` is an
error. Whether the href resolves on this machine is *not* checked here.

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/Good.extfile.card",
  "---\ntype: extfile\nhref: file:/Users/me/src/project/src/foo.ts\nversion: \"sha256:9f3a1c2b git:7ffeae4\"\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/Good.extfile.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0
```

A non-`file:` href is an error:

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/BadHref.extfile.card",
  "---\ntype: extfile\nhref: https://example.com/foo.ts\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/BadHref.extfile.card")],
  { boxRoot: box.root, ctx },
);
result.results[0]!.errors[0]!.message.includes("must be a file: URL")
=> true
```

A malformed `version` (no `sha256:` marker) is an error:

```ts
const box = await makeTmpBox();
await box.write(
  "store/review/BadVer.extfile.card",
  "---\ntype: extfile\nhref: file:/Users/me/src/project/src/foo.ts\nversion: not-a-hash\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/BadVer.extfile.card")],
  { boxRoot: box.root, ctx },
);
result.results[0]!.errors[0]!.message.includes("sha256:<hex> marker")
=> true
```

## A schema's `validate` hook is dispatched generically by type

card-lint no longer hardcodes which types get extra validation — it calls
`schema.validate` for whatever type the card declares. The `gadget` schema
(setup) errors when `mode: forbidden`; a card that trips it surfaces the hook's
message, and a card that doesn't lints clean.

```ts
const box = await makeTmpBox();
await box.write(
  "store/Bad.gadget.card",
  "---\ntype: gadget\nmode: forbidden\n---\n",
);
await box.write(
  "store/Ok.gadget.card",
  "---\ntype: gadget\nmode: allowed\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Bad.gadget.card"), box.path("store/Ok.gadget.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 1

result.results[0]!.errors[0]!.message
=> gadget mode must not be "forbidden"

result.results[1]!.errors.length
=> 0
```

## Progress cards: entries must name real concept-map nodes

A progress card's `entries` reference concept-map nodes by `id`. This is checked
box-aware (progress → its `course` → the course's embedded `concept-map`): a
`node` that the map doesn't define is a **warning** (a stale node id, not a hard
error). A valid node id is silent.

```ts
const box = await makeTmpBox();
await box.write(
  "store/Acids.course.card",
  "---\nconcept-map: { ref: attach/Map.concept-map.card }\n---\nCourse.\n",
);
await box.write(
  "store/Acids.attach/Map.concept-map.card",
  "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n  - id: bases\n    name: Bases\n    kind: concept\n---\nMap.\n",
);
await box.write(
  "store/Learner.progress.card",
  "---\ncourse: { ref: Acids.course.card }\nentries:\n  - node: acids\n    status: partial\n    basis: observed\n    evidence: [heard them explain it]\n  - node: ghost\n    status: solid\n    basis: observed\n    evidence: [refers to a node the map lacks]\n---\nProgress.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Learner.progress.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message.includes("ghost")
=> true
```

## Lesson-plans: segments must name real concept-map nodes, and defer visibly

A lesson-plan's `segments[].concepts[]` reference concept-map nodes by `id`. The
lesson-plan is co-located with the map in the course attach scope, so the check
resolves the **sibling `*.concept-map.card`** (no course back-ref). A `concepts`
id the map doesn't define is a **warning** naming the segment that holds it:

```ts
const box = await makeTmpBox();
await box.write(
  "store/Acids.attach/Acids_Concept_Map.concept-map.card",
  "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n  - id: bases\n    name: Bases\n    kind: concept\n---\nMap.\n",
);
await box.write(
  "store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Elicit their model\n    mode: interactive\n    concepts: [acids]\n  - do: Name a node the map lacks\n    mode: interactive\n    concepts: [ghost]\n---\nFlow.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message.includes("segments[1].concepts[0]")
=> true

result.results[0]!.warnings[0]!.message.includes("ghost")
=> true
```

A `material` segment that has neither a `material` ref nor `status: planned` is a
**deferral warning** — "incomplete material" is stated, never silent:

```ts
const box = await makeTmpBox();
await box.write(
  "store/Acids.attach/Acids_Concept_Map.concept-map.card",
  "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n---\nMap.\n",
);
await box.write(
  "store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Hand them a doc\n    mode: material\n---\nFlow.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message.includes("no material card")
=> true
```

A valid plan — every `concepts` id real, every material segment either `ready`
with a resolvable ref or explicitly `planned` — is silent:

```ts
const box = await makeTmpBox();
await box.write(
  "store/Acids.attach/Acids_Concept_Map.concept-map.card",
  "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n  - id: bases\n    name: Bases\n    kind: concept\n---\nMap.\n",
);
await box.write("store/Acids.attach/Recap.doc.card", "---\ntitle: Recap\n---\nRecap.\n");
await box.write(
  "store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Elicit their model\n    mode: interactive\n    concepts: [acids]\n  - do: Read the recap\n    mode: material\n    status: ready\n    concepts: [bases]\n    material: { ref: Recap.doc.card }\n  - do: A future figure, not built yet\n    mode: material\n    status: planned\n---\nFlow.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 0
```

## Concept-maps: an orphan node (no edge in or out) warns

A concept-map node with no edges — nothing it depends on, nothing depending on it
— is a modeling smell, surfaced as a **warning** naming the node. A map where
every node connects is silent; a 0–1 node map is never flagged (edges aren't
possible).

```ts
const box = await makeTmpBox();
await box.write(
  "store/Bonds.concept-map.card",
  "---\nconcepts:\n  - id: ionic\n    name: Ionic Bonds\n    kind: concept\n  - id: covalent\n    name: Covalent Bonds\n    kind: concept\n    related:\n      - { to: ionic, kind: contrasts-with }\n  - id: trivia\n    name: A Floating Aside\n    kind: fact\n---\nMap.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Bonds.concept-map.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message.includes("trivia")
=> true

result.results[0]!.warnings[0]!.message.includes("orphan")
=> true
```

A fully connected map warns about nothing:

```ts
const box = await makeTmpBox();
await box.write(
  "store/Bonds2.concept-map.card",
  "---\nconcepts:\n  - id: ionic\n    name: Ionic Bonds\n    kind: concept\n  - id: covalent\n    name: Covalent Bonds\n    kind: concept\n    related:\n      - { to: ionic, kind: contrasts-with }\n---\nMap.\n",
);
const result = await lintCardsDispatch(
  [box.path("store/Bonds2.concept-map.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 0
```

## Universal Markdoc body validation: an invalid `{% todo %}` status warns

Every card with a markdown body is now parsed and run through
`Markdoc.validate` against the shared vocabulary (`docs/plans/
todo-annotation.md`, Track 1 chunk 2) — not just commentary. A `status`
value outside the enum is a **warning** (this new pass is warning-first
until an existing-box survey justifies flipping it to error), naming the
line, the tag, and the Markdoc message:

```ts
const box = await makeTmpBox();
await box.write(
  "store/notes/Plan.doc.card",
  "---\ntype: doc\ntitle: Plan\n---\n{% todo status=\"Done\" %}Ship the thing{% /todo %}\n",
);
const result = await lintCardsDispatch(
  [box.path("store/notes/Plan.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Markdoc body issue at line 1 (todo): Attribute 'status' must match one of ["open","done","dropped","parked"]. Got 'Done' instead.
```

The same attribution holds for a **multi-line block** `{% todo %}` (opening
tag, body text, closing tag on separate lines) — Markdoc's `ValidateError.lines`
for a block tag is a 4-element span (`[open, ..., ..., close]`), whose LAST
element must match a tag span's end line, not its second element (a
regression: `collectTagSpans` used to record `lines[1]` as the end, which is
only correct for a one-line span, so a multi-line block tag's error fell back
to attribution `(body)` and the collector below never flagged the card):

```ts
const box = await makeTmpBox();
await box.write(
  "store/notes/Multiline.doc.card",
  '---\ntype: doc\ntitle: Plan\n---\n{% todo status="Done" %}\nShip the thing\n{% /todo %}\n',
);
const result = await lintCardsDispatch(
  [box.path("store/notes/Multiline.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 1

result.results[0]!.warnings[0]!.message
=> Markdoc body issue at line 1 (todo): Attribute 'status' must match one of ["open","done","dropped","parked"]. Got 'Done' instead.
```

A body with a valid `{% todo %}` (or no tags at all) lints clean:

```ts
const box = await makeTmpBox();
await box.write(
  "store/notes/Plan2.doc.card",
  "---\ntype: doc\ntitle: Plan\n---\n{% todo id=\"ship-it\" due=\"2026-08-01\" %}Ship the thing{% /todo %}\n",
);
const result = await lintCardsDispatch(
  [box.path("store/notes/Plan2.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalWarnings
=> 0
```

## Universal Markdoc body validation: a body that fails to parse warns, not silently

Malformed tag syntax (an unquoted attribute value that breaks Markdoc's own
tag grammar) doesn't hide the card's todos — it's reported as a warning
naming the parse failure, never swallowed (the opposite posture from
`body-refs.ts`'s ref walker, which is fine losing a few ref warnings to a
rare parse failure precisely because this pass is the backstop that still
reports it):

```ts
const box = await makeTmpBox();
await box.write(
  "store/notes/Broken.doc.card",
  "---\ntype: doc\ntitle: Broken\n---\n{% todo status=oops %}Ship the thing{%/todo%}\n",
);
const result = await lintCardsDispatch(
  [box.path("store/notes/Broken.doc.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 0

result.totalWarnings > 0
=> true

result.results[0]!.warnings.some(w => w.message.includes("Markdoc body issue"))
=> true
```

## Commentary cards don't double-report Markdoc violations

Commentary already runs `Markdoc.validate` on its body at **error**
severity, via its own schema `validate` hook (`ownMarkdocValidation: true`
tells the generic pass to skip it). A commentary body that violates the
shared vocabulary (here, `{% source %}`'s ref-xor-href rule) is reported
exactly once — as the schema's own error — not again as a generic warning:

```ts
const box = await makeTmpBox();
await box.write("store/review/a.doc.card", "---\ntype: doc\ntitle: A\n---\nA.\n");
await box.write(
  "store/review/Dup.attach/Dup.commentary.card",
  "---\ntype: commentary\n---\n{% source ref=\"../a.doc.card\" href=\"https://example.com\" %}both{% /source %}\n",
);
const result = await lintCardsDispatch(
  [box.path("store/review/Dup.attach/Dup.commentary.card")],
  { boxRoot: box.root, ctx },
);
result.totalErrors
=> 1

result.totalWarnings
=> 0

result.results[0]!.errors[0]!.message
=> {% source %} takes at most one of `ref` or `href`, not both
```

## Path fields not named `ref` are checked too (`symbol.src`, `entry`)

The generic broken-ref walk keys on frontmatter keys literally named
`ref`/`refs`, which left two real path fields unvalidated: a landmark's
`navigation.symbol.src` (its icon image) and a figure's `entry` (the sketch
source in the card's attach scope). Both are now resolved through the same
3-form semantics and reported as `type: "reference"` warnings when they name
nothing — a missing icon or an uncompilable figure is visible at validate
time instead of at render time.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/images/portrait.webp", "WEBP");
await box.write(
  "_content/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol:\n    src: /_content/recipes/images/portrait.webp\n---\n",
);
await box.write(
  "_content/recipes/Gone.landmark.card",
  "---\nnavigation:\n  label: Gone\n  symbol:\n    src: images/vanished.webp\n---\n",
);
const result = await lintCardsDispatch(
  [box.path("_content/recipes/Recipes.landmark.card"), box.path("_content/recipes/Gone.landmark.card")],
  { boxRoot: box.root, ctx },
);
JSON.stringify([result.totalErrors, result.totalWarnings])
=> [0,1]

result.results[1]!.warnings[0]!.type
=> reference

result.results[1]!.warnings[0]!.message
=> Broken reference at navigation.symbol.src: images/vanished.webp does not exist
```

A text/emoji symbol has no path to check, and a figure's `entry` resolves in
the card's own attach scope:

```ts continue
await box.write("store/figures/Orbit.attach/sketch.ts", "export default () => {};\n");
await box.write(
  "store/figures/Orbit.figure.card",
  "---\nruntime: p5js\nentry: attach/sketch.ts\n---\nAn orbit.\n",
);
await box.write(
  "store/figures/Dangling.figure.card",
  "---\nruntime: p5js\nentry: attach/missing.ts\n---\nNothing behind it.\n",
);
await box.write(
  "_content/recipes/Emoji.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: 🍳\n---\n",
);
const figures = await lintCardsDispatch(
  [
    box.path("store/figures/Orbit.figure.card"),
    box.path("store/figures/Dangling.figure.card"),
    box.path("_content/recipes/Emoji.landmark.card"),
  ],
  { boxRoot: box.root, ctx },
);
JSON.stringify([figures.totalErrors, figures.totalWarnings])
=> [0,1]

figures.results[1]!.warnings[0]!.message
=> Broken reference at entry: attach/missing.ts does not exist
```

```ts cleanup
await box.cleanup();
```

## Chat husks: `session` must be a real engine session id

A husk's `session` field is the *only* thing that identifies which chat the
card is about — the filename is a naming convention, and renaming a husk is
encouraged (`docs/implemented-plans/chat-session-identity.md`). So it is validated as a
UUID before anything keys on it or joins it into a path: Claude Agent SDK ids
are UUIDv4, Codex thread ids UUIDv7, and one check covers both.

```ts
const box = await makeTmpBox();
await box.write("_content/chat/web/2026-08-26_ok.chat.card",
  "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
await box.write("_content/chat/web/2026-08-26_bad.chat.card",
  "---\nsession: sess1234\n---\n");
const result = await lintCardsDispatch(
  [box.path("_content/chat/web/2026-08-26_ok.chat.card"), box.path("_content/chat/web/2026-08-26_bad.chat.card")],
  { boxRoot: box.root, ctx },
);
JSON.stringify({
  ok: result.results[0]!.errors.length,
  bad: result.results[1]!.errors.length,
  says: result.results[1]!.errors[0]!.message.includes("session"),
})
=> {"ok":0,"bad":1,"says":true}
```

## Chat husks: two cards must never claim one chat

The `session` field is the husk's identity, so a second card carrying it means
two husks for one conversation — both appear in the picker, and chat review
would extend two separate accounts from the same transcript. This is card-lint's
only cross-file rule: the `_content/chat/**` index is built once per
`lintCardsDispatch` run and memoized on that run's options, not rescanned per
card. Repair is editorial — which title and body do you keep? — so the rule
names both paths and stops there.

```ts
const box = await makeTmpBox();
await box.write("_content/chat/web/2026-08-26_59fc20dd.chat.card",
  "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\ntitle: The Acme mess\n---\n");
await box.write("_content/chat/web/Copied.chat.card",
  "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
await box.write("_content/chat/web/2026-08-26_aaaa9999.chat.card",
  "---\nsession: aaaa9999-fe6d-45cb-8f37-f1508a5a0869\n---\n");
const result = await lintCardsDispatch(
  [
    box.path("_content/chat/web/2026-08-26_59fc20dd.chat.card"),
    box.path("_content/chat/web/Copied.chat.card"),
    box.path("_content/chat/web/2026-08-26_aaaa9999.chat.card"),
  ],
  { boxRoot: box.root, ctx },
);
JSON.stringify({ errors: result.totalErrors, unique: result.results[2]!.errors.length })
=> {"errors":2,"unique":0}

result.results[0]!.errors[0]!.message
=> Duplicate chat session 59fc20dd-fe6d-45cb-8f37-f1508a5a0869: _content/chat/web/2026-08-26_59fc20dd.chat.card and _content/chat/web/Copied.chat.card are husks for one chat. Keep whichever card you want the chat to be, and `bbx trash` the other.
```

A husk filed outside `_content/chat/web/` counts too — the index walks the whole
`_content/chat/**` tree, so moving one of the pair out of the picker's directory
doesn't make the collision go away.

```ts continue
const box2 = await makeTmpBox();
await box2.write("_content/chat/web/2026-08-26_59fc20dd.chat.card",
  "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
await box2.write("_content/chat/archive/2026-01-01_59fc20dd.chat.card",
  "---\nsession: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869\n---\n");
const moved = await lintCardsDispatch(
  [box2.path("_content/chat/web/2026-08-26_59fc20dd.chat.card")],
  { boxRoot: box2.root, ctx },
);
moved.results[0]!.errors[0]!.message.includes("_content/chat/archive/2026-01-01_59fc20dd.chat.card")
=> true
```
