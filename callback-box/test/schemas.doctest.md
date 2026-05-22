# Card Schemas

The schema system registers card types, provides template generators, and validates card XML. Each card type has a tag name, template generator, and optional instructions for agents.

```ts setup
import {
  MemoSchema,
  QuestionSchema,
  createMemoTemplate,
  createSelectQuestionTemplate,
  createSchemaRegistry,
  getCardTypes,
  getDefaultTemplate,
} from "../src/schemas/index.js";
import { createNewsJobTemplate } from "../src/schemas/news-job.js";
import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";
import { createCalendarReviewJobTemplate } from "../src/schemas/calendar-review-job.js";
import { parseCard } from "cardworks";
```

## Schema Registry

The registry tracks all known card types:

```
getCardTypes().includes("memo")
=> true

getCardTypes().includes("question")
=> true

getCardTypes().includes("news-job")
=> true

getCardTypes().includes("intake-job")
=> true

getCardTypes().includes("calendar-review-job")
=> true

```

XML schemas have a `tagName`; Phase 2 frontmatter schemas (memo,
email-thread, etc.) carry a `type` instead.

```
MemoSchema.type
=> memo

QuestionSchema.tagName
=> question

```

The full registry of XML schemas is available via `createSchemaRegistry()`:

```
const registry = await createSchemaRegistry();
registry.get("question")?.tagName
=> question
```

## Templates

Template generators produce XML card content for the core card types. All templates escape special characters and produce well-formed XML.

## Memo

A memo captures a piece of content, optionally with a source. The
content lives in the markdown body; created/source/etc. are in the
YAML frontmatter.

```
createMemoTemplate("Test content", "test-source")
=>
---
type: memo
status: new
created: «*»
source: test-source
---
Test content
```

Source is optional:

```
createMemoTemplate("Just content")
=>
---
type: memo
status: new
created: «*»
---
Just content
```

Special characters in content pass through verbatim — markdown bodies
don't need XML-style escaping:

```
createMemoTemplate("Test <content> & more")
=>
---
type: memo
status: new
created: «*»
---
Test <content> & more
```

## Question

A select question presents options to the user:

```
createSelectQuestionTemplate({
  memo: "Context here",
  prompt: "What do you want?",
  options: [
    { id: "a", label: "Choice A" },
    { id: "b", label: "Choice B" },
  ],
})
=>
<question status="pending">
<memo>Context here</memo>
<prompt>What do you want?</prompt>
<input type="select">
<option id="a">Choice A</option>
<option id="b">Choice B</option>
</input>
</question>
```

Special characters in questions are escaped:

```
createSelectQuestionTemplate({
  memo: "Context with <special> & chars",
  prompt: "What's \"this\"?",
  options: [{ id: "a", label: "Option <A>" }],
})
=>
<question status="pending">
<memo>Context with &lt;special&gt; &amp; chars</memo>
<prompt>What's "this"?</prompt>
<input type="select">
<option id="a">Option &lt;A&gt;</option>
</input>
</question>
```

## News Job

A news job groups incoming RSS items for the reactor agent to process:

```
createNewsJobTemplate({
  source: "rss-connector",
  description: "3 new items from RSS feeds",
  items: [
    "box/inbox/news/item1.news-item.card",
    "box/inbox/news/item2.news-item.card",
    "box/inbox/news/item3.news-item.card",
  ],
})
=>
<news-job created="«date»" source="rss-connector">
<description>3 new items from RSS feeds</description>
<item ref="box/inbox/news/item1.news-item.card" />
<item ref="box/inbox/news/item2.news-item.card" />
<item ref="box/inbox/news/item3.news-item.card" />
</news-job>
```

Special characters are XML-escaped:

```
createNewsJobTemplate({
  source: "test",
  description: "Items with <special> & chars",
  items: ['path/with"quotes.card'],
})
=>
<news-job created="«date»" source="test">
<description>Items with &lt;special&gt; &amp; chars</description>
<item ref="path/with&quot;quotes.card" />
</news-job>
```

A specific timestamp can be provided instead of auto-generating one:

```
createNewsJobTemplate({
  created: "2026-02-21T08:00:00Z",
  source: "test",
  description: "test",
  items: [],
}).includes('created="2026-02-21T08:00:00Z"')
=> true
```

## Intake Job

An intake job groups items for triage. It has a `status`, `priority`, and a list of item references:

```
createIntakeJobTemplate({
  source: "capture-connector",
  description: "Triage 2 new capture sessions",
  items: [
    "box/inbox/capture-1/session.capture-session.card",
    "box/inbox/capture-2/session.capture-session.card",
  ],
})
=>
<intake-job status="pending" created="«date»" source="capture-connector" priority="normal">
<description>Triage 2 new capture sessions</description>
<item ref="box/inbox/capture-1/session.capture-session.card" />
<item ref="box/inbox/capture-2/session.capture-session.card" />
</intake-job>
```

Supports `priority: "low"`:

```
createIntakeJobTemplate({
  source: "capture-connector",
  description: "Triage bookmarks",
  items: ["box/inbox/bookmark.bookmark.card"],
  priority: "low",
})
=>
<intake-job status="pending" created="«date»" source="capture-connector" priority="low">
<description>Triage bookmarks</description>
<item ref="box/inbox/bookmark.bookmark.card" />
</intake-job>
```

## Calendar Review Job

A calendar review job groups calendar changes (new, updated, deleted events):

```
createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "2 calendar changes to review",
  changes: [
    { action: "new", ref: "store/calendar/2026-02-25_abc.ics", summary: "Dentist appointment" },
    { action: "updated", ref: "store/calendar/2026-02-22_def.ics", summary: "Standup — time changed" },
  ],
})
=>
<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="normal">
<description>2 calendar changes to review</description>
<change action="new" ref="store/calendar/2026-02-25_abc.ics">Dentist appointment</change>
<change action="updated" ref="store/calendar/2026-02-22_def.ics">Standup — time changed</change>
</calendar-review-job>
```

Deleted events can include the original ICS content:

```
createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "1 deletion",
  changes: [
    { action: "deleted", summary: "Cancelled meeting", icsContent: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Cancelled\nEND:VEVENT\nEND:VCALENDAR" },
  ],
})
=>
<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="normal">
<description>1 deletion</description>
<change action="deleted">
Cancelled meeting
<ics>BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR</ics>
</change>
</calendar-review-job>
```

Supports custom priority:

```
createCalendarReviewJobTemplate({
  source: "google-calendar",
  description: "test",
  changes: [{ action: "new", summary: "test" }],
  priority: "low",
})
=>
<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="low">
<description>test</description>
<change action="new">test</change>
</calendar-review-job>
```
