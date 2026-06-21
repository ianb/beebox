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
import { createCalendarReviewJobTemplate } from "../../src/schemas/calendar-review-job.js";
import { WebpageSchema, createWebpageTemplate } from "../../src/schemas/webpage.js";
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

getCardTypes().includes("calendar-review-job")
=> true

getCardTypes().includes("webpage")
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
created: «*»
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
created: «*»
source: capture-connector
priority: low
description: Triage bookmarks
items:
  - ref: box/inbox/bookmark.bookmark.card
---
```

## Calendar Review Job

A calendar review job groups calendar changes (new, updated, deleted events):

```ts
createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "2 calendar changes to review",
  changes: [
    { action: "new", ref: "store/calendar/2026-02-25_abc.ics", summary: "Dentist appointment" },
    { action: "updated", ref: "store/calendar/2026-02-22_def.ics", summary: "Standup — time changed" },
  ],
})
=>
---
status: pending
created: «*»
source: google-calendar
priority: normal
description: 2 calendar changes to review
changes:
  - action: new
    summary: Dentist appointment
    ref: store/calendar/2026-02-25_abc.ics
  - action: updated
    summary: Standup — time changed
    ref: store/calendar/2026-02-22_def.ics
---
```

Deleted events can include the original ICS content under `ics:`:

```ts
const out = createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "1 deletion",
  changes: [
    { action: "deleted", summary: "Cancelled meeting", icsContent: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Cancelled\nEND:VEVENT\nEND:VCALENDAR" },
  ],
});
out.includes("action: deleted") && out.includes("BEGIN:VCALENDAR")
=> true
```

Supports custom priority:

```ts
const out = createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "test",
  changes: [{ action: "new", summary: "test" }],
  priority: "low",
});
out.includes("priority: low")
=> true
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
frozen: attach/page.frozen
---
Body.
```
