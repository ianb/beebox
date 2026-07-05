# Card Schemas

The schema system registers card types, provides template generators, and validates cards. Each card type has a type name, template generator, and optional instructions for agents.

```ts setup
import {
  MemoSchema,
  QuestionSchema,
  createMemoTemplate,
  createSelectQuestionTemplate,
  getCardTypes,
  getDefaultTemplate,
} from "../../src/schemas/index.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { WebpageSchema, createWebpageTemplate } from "../../src/schemas/webpage.js";
import { FigureSchema, createFigureTemplate, figureStarterSketch } from "../../src/schemas/figure.js";
import { ConceptMapSchema, createConceptMapTemplate } from "../../src/schemas/concept-map.js";
import { CourseSchema, createCourseTemplate } from "../../src/schemas/course.js";
import { ExpositionPlanSchema, createExpositionPlanTemplate } from "../../src/schemas/exposition-plan.js";
import { LessonPlanSchema, createLessonPlanTemplate } from "../../src/schemas/lesson-plan.js";
import { ProgressSchema, createProgressTemplate } from "../../src/schemas/progress.js";
import { extractRefs } from "../../src/cards/index.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";
```

## Schema Registry

The registry tracks all known card types:

```ts
getCardTypes().includes("memo")
=> true

getCardTypes().includes("question")
=> true

getCardTypes().includes("intake-job")
=> true

getCardTypes().includes("webpage")
=> true

getCardTypes().includes("figure")
=> true

getCardTypes().includes("concept-map")
=> true

getCardTypes().includes("course")
=> true

getCardTypes().includes("exposition-plan")
=> true

getCardTypes().includes("lesson-plan")
=> true

getCardTypes().includes("progress")
=> true

```

Each frontmatter schema (memo, email-thread, etc.) carries a `type`:

```ts
MemoSchema.type
=> memo

QuestionSchema.type
=> question

WebpageSchema.type
=> webpage

```

## Templates

Template generators produce frontmatter card content for the core card types.

## Memo

A memo captures a piece of content, optionally with a source. The
content lives in the markdown body; created/source/etc. are in the
YAML frontmatter.

```ts
createMemoTemplate("Test content", "test-source")
=>
---
status: new
created: «*»
source: test-source
---
Test content
```

Source is optional:

```ts
createMemoTemplate("Just content")
=>
---
status: new
created: «*»
---
Just content
```

Special characters in content pass through verbatim — markdown bodies
don't need XML-style escaping:

```ts
createMemoTemplate("Test <content> & more")
=>
---
status: new
created: «*»
---
Test <content> & more
```

## Question

A select question presents options to the user:

```ts
createSelectQuestionTemplate({
  memo: "Context here",
  prompt: "What do you want?",
  options: [
    { id: "a", label: "Choice A" },
    { id: "b", label: "Choice B" },
  ],
})
=>
---
status: pending
memo: Context here
prompt: What do you want?
input:
  type: select
  options:
    - id: a
      label: Choice A
    - id: b
      label: Choice B
---

```

Special characters in content pass through YAML verbatim:

```ts
createSelectQuestionTemplate({
  memo: "Context with <special> & chars",
  prompt: "What's \"this\"?",
  options: [{ id: "a", label: "Option <A>" }],
})
=>
---
status: pending
memo: Context with <special> & chars
prompt: What's "this"?
input:
  type: select
  options:
    - id: a
      label: Option <A>
---

```


## Intake Job

An intake job groups items for triage. It has a `status`, `priority`, and a list of item references:

```ts
createIntakeJobTemplate({
  source: "capture-connector",
  description: "Triage 2 new capture sessions",
  items: [
    "box/inbox/capture-1/session.capture-session.card",
    "box/inbox/capture-2/session.capture-session.card",
  ],
})
=>
---
status: pending
source: capture-connector
priority: normal
description: Triage 2 new capture sessions
items:
  - ref: box/inbox/capture-1/session.capture-session.card
  - ref: box/inbox/capture-2/session.capture-session.card
---
```

Supports `priority: "low"`:

```ts
createIntakeJobTemplate({
  source: "capture-connector",
  description: "Triage bookmarks",
  items: ["box/inbox/bookmark.bookmark.card"],
  priority: "low",
})
=>
---
status: pending
source: capture-connector
priority: low
description: Triage bookmarks
items:
  - ref: box/inbox/bookmark.bookmark.card
---
```

## Webpage

A webpage card is a captured external page: provenance in frontmatter, the
readable rendering inline as the body.

```ts
createWebpageTemplate({
  title: "Example Page",
  source: "https://example.com/article",
  capturedAt: "2026-06-15T12:00:00Z",
  content: "The readable page body.",
})
=>
---
title: Example Page
source: https://example.com/article
captured: 2026-06-15T12:00:00Z
---
The readable page body.
```

Optional capture metadata and the frozen-snapshot ref are included only when
set:

```ts
createWebpageTemplate({
  title: "Example Page",
  source: "https://example.com/article",
  capturedAt: "2026-06-15T12:00:00Z",
  content: "Body.",
  siteName: "Example",
  frozenRef: "attach/page.frozen",
})
=>
---
title: Example Page
source: https://example.com/article
captured: 2026-06-15T12:00:00Z
siteName: Example
frozen:
  ref: attach/page.frozen
---
Body.
```

## Figure

A figure card is an embeddable interactive graphic. Its body describes the
figure; the runnable source lives in the attach scope, pointed to by `entry`.

```ts
FigureSchema.type
=> figure
```

The frontmatter validates a runtime plus the required `entry` source pointer:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "p5js",
  entry: "attach/sketch.ts",
}).success
=> true
```

`entry` is required — a figure with no source pointer fails validation:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "p5js",
}).success
=> false
```

`runtime` must be one of the supported runtimes:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "vega",
  entry: "attach/sketch.ts",
}).success
=> false
```

Optional `params` (declared embed parameters) and `data` (free-form author
config) validate when present:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "d3",
  entry: "attach/chart.ts",
  params: [{ name: "molecule", type: "string", default: "H2O2" }],
  data: { palette: ["#fff", "#000"] },
}).success
=> true
```

The figure template scaffolds a valid card pointing at `attach/sketch.ts`, with
a `size` param declared so it's parameterizable out of the box:

```ts
createFigureTemplate({ runtime: "p5js", title: "Spinner" })
=>
---
runtime: p5js
entry: attach/sketch.ts
params:
  - name: size
    type: number
    default: 300
title: Spinner
---
A p5.js sketch figure. Describe what it demonstrates here; the runnable code lives in `attach/sketch.ts`.
```

The generated card validates against the schema:

```ts
const text = createFigureTemplate({ runtime: "three" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "X.figure.card", schemas });
parsed.fields.runtime
=> three
```

Each runtime has a runnable starter sketch that exports the
`(lib, { mount, figure })` factory and returns a teardown:

```ts
const sketch = figureStarterSketch("p5js");
sketch.includes("export default function") && sketch.includes("instance.remove()")
=> true
```

## Concept-Map

A concept-map card is a module-scale knowledge graph: concepts are in-card nodes
(each with an `id`, `name`, and `kind`), related by typed edges that reference
other nodes by `id`.

```ts
ConceptMapSchema.type
=> concept-map
```

A valid map — unique node ids, each node typed, each edge carrying a `kind` —
parses:

```ts
ConceptMapSchema.frontmatterSchema.safeParse({
  type: "concept-map",
  concepts: [
    { id: "a", name: "A", kind: "concept", related: [{ to: "b", kind: "complements" }] },
    { id: "b", name: "B", kind: "fact" },
  ],
}).success
=> true
```

Each node requires a `kind` (one of the four KC types) — a node without one
fails:

```ts
ConceptMapSchema.frontmatterSchema.safeParse({
  type: "concept-map",
  concepts: [{ id: "a", name: "A" }],
}).success
=> false
```

Every edge must carry a `kind` from the closed set — no unlabeled edge, and no
"other":

```ts
ConceptMapSchema.frontmatterSchema.safeParse({
  type: "concept-map",
  concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "b" }] }, { id: "b", name: "B", kind: "fact" }],
}).success
=> false

ConceptMapSchema.frontmatterSchema.safeParse({
  type: "concept-map",
  concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "b", kind: "related-to" }] }, { id: "b", name: "B", kind: "fact" }],
}).success
=> false
```

The `validate` hook checks intra-card graph integrity. A dangling edge (a `to`
that names no node) and a duplicate id are both errors; a `complements` cycle is
deliberately **not** an error (spirals are valid), and a clean map reports
nothing:

```ts
const v = ConceptMapSchema.validate;

(v ? v({ fields: { concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "ghost", kind: "prerequisite" }] }] } }) : []).length
=> 1

(v ? v({ fields: { concepts: [{ id: "a", name: "A", kind: "fact" }, { id: "a", name: "B", kind: "fact" }] } }) : []).length
=> 1

(v ? v({ fields: { concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "b", kind: "complements" }] }, { id: "b", name: "B", kind: "concept", related: [{ to: "a", kind: "complements" }] }] } }) : []).length
=> 0

(v ? v({ fields: { concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "b", kind: "prerequisite" }] }, { id: "b", name: "B", kind: "fact" }] } }) : []).length
=> 0
```

The dangling-edge error names the offending node id:

```ts
const issues = ConceptMapSchema.validate ? ConceptMapSchema.validate({ fields: { concepts: [{ id: "a", name: "A", kind: "concept", related: [{ to: "ghost", kind: "prerequisite" }] }] } }) : [];
issues[0].message.includes("unknown node id")
=> true
```

The template scaffolds a valid starter map that parses against the registry:

```ts
const text = createConceptMapTemplate({ title: "Acids and Bases" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "Acids.concept-map.card", schemas });
parsed.schema.type
=> concept-map
```

## Course

A course card is the manifest that binds a learning experience's components by
reference.

```ts
CourseSchema.type
=> course
```

A course with goals, success-criteria, and component refs parses; everything but
the body is optional, so a bare course still loads too:

```ts
CourseSchema.frontmatterSchema.safeParse({
  type: "course",
  goals: ["Understand acids and bases"],
  "success-criteria": ["Can predict whether a reaction fizzes and explain why"],
  "concept-map": { ref: "attach/Acids_Bases_Concept_Map.concept-map.card" },
  "exposition-plan": { ref: "attach/Acids_Bases_Exposition_Plan.exposition-plan.card" },
  "lesson-plan": { ref: "attach/Acids_Bases_Lesson_Plan.lesson-plan.card" },
  material: "attach/material",
  progress: { ref: "/people/learner/Acids_Bases_Progress.progress.card" },
}).success
=> true

CourseSchema.frontmatterSchema.safeParse({ type: "course" }).success
=> true
```

Component refs are extracted as cross-card edges, so card-lint checks they
resolve:

```ts
const parsed = CourseSchema.frontmatterSchema.parse({
  type: "course",
  "concept-map": { ref: "attach/Acids_Bases_Concept_Map.concept-map.card" },
  "exposition-plan": { ref: "attach/Acids_Bases_Exposition_Plan.exposition-plan.card" },
  "lesson-plan": { ref: "attach/Acids_Bases_Lesson_Plan.lesson-plan.card" },
});
extractRefs(parsed).map((r) => r.ref).sort()
=> [
  "attach/Acids_Bases_Concept_Map.concept-map.card",
  "attach/Acids_Bases_Exposition_Plan.exposition-plan.card",
  "attach/Acids_Bases_Lesson_Plan.lesson-plan.card"
]
```

The template scaffolds a course that parses against the registry:

```ts
const text = createCourseTemplate({ title: "Acids and Bases" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "Acids.course.card", schemas });
parsed.schema.type
=> course
```

## Lesson-Plan

A lesson-plan card is the ordered delivery flow: a sequence of segments, each
tagged `interactive` (live in chat) or `material` (uses a pre-made card).

```ts
LessonPlanSchema.type
=> lesson-plan
```

A plan whose segments carry a `do` and a `mode` parses; everything but the body
is optional, so a bare lesson-plan still loads:

```ts
LessonPlanSchema.frontmatterSchema.safeParse({
  type: "lesson-plan",
  segments: [
    { do: "Elicit their model of what's moving in a reaction", mode: "interactive", concepts: ["proton-transfer"] },
    { do: "Walk the proton-transfer figure", mode: "material", status: "ready", material: { ref: "material/Proton_Transfer.figure.card" } },
  ],
}).success
=> true

LessonPlanSchema.frontmatterSchema.safeParse({ type: "lesson-plan" }).success
=> true
```

`mode` is a required closed enum — a segment with no `mode`, or an out-of-set
`mode`, fails to parse:

```ts
LessonPlanSchema.frontmatterSchema.safeParse({
  type: "lesson-plan",
  segments: [{ do: "Some activity" }],
}).success
=> false

LessonPlanSchema.frontmatterSchema.safeParse({
  type: "lesson-plan",
  segments: [{ do: "Some activity", mode: "lecture" }],
}).success
=> false
```

A material segment's `material.ref` is extracted as a cross-card edge, so
card-lint checks it resolves:

```ts
const parsed = LessonPlanSchema.frontmatterSchema.parse({
  type: "lesson-plan",
  segments: [
    { do: "Read the recap", mode: "material", status: "ready", material: { ref: "material/Recap.doc.card" } },
  ],
});
extractRefs(parsed).map((r) => r.ref)
=> [
  "material/Recap.doc.card"
]
```

The template scaffolds a lesson-plan that parses against the registry:

```ts
const text = createLessonPlanTemplate({ title: "Acids and Bases" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "Acids.lesson-plan.card", schemas });
parsed.schema.type
=> lesson-plan
```

## Exposition-Plan

An exposition-plan card is a worked process for presenting a subject: the learner
translation first, then rated approaches, then the compiled rules.

```ts
ExpositionPlanSchema.type
=> exposition-plan
```

A plan with a `learner-translation`, rated `approaches`, and `rules` parses;
everything but the body is optional:

```ts
ExpositionPlanSchema.frontmatterSchema.safeParse({
  type: "exposition-plan",
  "learner-translation": ["Reasons out loud; lead with their phenomena"],
  approaches: [{ approach: "socratic dialog", rating: "primary", why: "Surfaces their model" }],
  rules: ["Open each concept from a familiar phenomenon"],
}).success
=> true

ExpositionPlanSchema.frontmatterSchema.safeParse({ type: "exposition-plan" }).success
=> true
```

Each `approach` must carry an `approach` and a `rating` (the rating is what makes
the consideration honest) — an approach without a rating fails:

```ts
ExpositionPlanSchema.frontmatterSchema.safeParse({
  type: "exposition-plan",
  approaches: [{ approach: "plain prose" }],
}).success
=> false
```

The template scaffolds a plan that parses against the registry:

```ts
const text = createExpositionPlanTemplate({ title: "Acids and Bases" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "Acids.exposition-plan.card", schemas });
parsed.schema.type
=> exposition-plan
```

## Progress

A progress card is a per-learner, evidence-backed record of understanding. Each
entry is a qualitative status for one concept-map node.

```ts
ProgressSchema.type
=> progress
```

An entry with a `status`, a `basis`, and at least one `evidence` item parses:

```ts
ProgressSchema.frontmatterSchema.safeParse({
  type: "progress",
  course: { ref: "../Acids.course.card" },
  entries: [
    { node: "electron-transfer", status: "partial", basis: "observed", evidence: ["Said acids 'give away' something but couldn't say what"] },
  ],
}).success
=> true
```

The evidence contract is enforced — a status with no `evidence`, an empty
`evidence` array, or no `basis` all fail to parse (no anonymous rating):

```ts
ProgressSchema.frontmatterSchema.safeParse({
  type: "progress",
  entries: [{ node: "n", status: "solid", basis: "observed" }],
}).success
=> false

ProgressSchema.frontmatterSchema.safeParse({
  type: "progress",
  entries: [{ node: "n", status: "solid", basis: "observed", evidence: [] }],
}).success
=> false

ProgressSchema.frontmatterSchema.safeParse({
  type: "progress",
  entries: [{ node: "n", status: "solid", evidence: ["heard them explain it"] }],
}).success
=> false
```

The template scaffolds a progress card (with a valid example entry) that parses:

```ts
const text = createProgressTemplate({ title: "Acids — learner" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "Acids.progress.card", schemas });
parsed.schema.type
=> progress
```
