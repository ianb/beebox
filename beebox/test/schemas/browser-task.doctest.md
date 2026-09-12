# Browser-task card schema

A `browser-task` card is a prompt for someone with a logged-in browser, and
the inbox for what they bring back. It is the first schema to declare
`submissions`: the generic route and form ask the schema whether the card is
accepting and whether a batch is valid.

```ts setup
import { BrowserTaskSchema, createBrowserTaskTemplate } from "../../src/schemas/browser-task.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";
import { getTemplate } from "../../src/schemas/templates.js";

const schemas = await createCardSchemaMap();
const recordSchema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["permalink"],
  properties: { permalink: { type: "string" }, poster: { type: "string", format: "attachment" } },
});
const coverage = { scanned: 3, stoppedAt: "x", reason: "end-of-feed" };
const attachments = (files: Record<string, string>) => async (name: string) => files[name] ?? null;
```

## Registered, authored, with a template

```ts
BrowserTaskSchema.type
=> browser-task

BrowserTaskSchema.category
=> authored

schemas.has("browser-task")
=> true

JSON.stringify(getTemplate("browser-task")?.defaultForTypes)
=> ["browser-task"]
```

The template emits an open task with the prompt as the body:

```ts
const text = createBrowserTaskTemplate({ title: "Pottery shows", source: "https://example.test/feed", prompt: "Find show announcements." });
const parsed = parseCardText(text, { source: "Pottery.browser-task.card", schemas });
JSON.stringify([parsed.fields["status"], parsed.fields["source"], String(parsed.fields["body"]).trim()])
=> ["open","https://example.test/feed","Find show announcements."]
```

`source` must be a URL and `last-upload` an instant:

```ts
parseCardText("---\ntype: browser-task\nsource: not a url\n---\nx\n", { source: "T.browser-task.card", schemas })
=> throws CardIOError
```

## The prompt must not lean on the box

The reader has a browser and no box. A link to a card, a box path, the
briefing, or a `bbx` command is a warning at validate time, one per kind:

```ts
const warn = (bodyText: string) => (BrowserTaskSchema.validate ? BrowserTaskSchema.validate({ fields: { status: "open", source: "https://x.test", body: bodyText } }) : []).map((i) => `${i.severity}: ${i.message}`);
JSON.stringify(warn("Scan the page and record each show. See https://example.test/about for context."))
=> []

JSON.stringify(warn("Use the rule in the briefing; file into _content/events/ as Show.record.card via bbx create."))
=> ["warning: the prompt refers to a card file; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)","warning: the prompt refers to a box path; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)","warning: the prompt refers to the briefing; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)","warning: the prompt refers to a bbx command; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)"]
```

## The submission contract

The card refuses when closed and accepts when open:

```ts
const sub = BrowserTaskSchema.submissions!;
JSON.stringify([sub.dir, sub.refusal({ status: "open" }), sub.refusal({ status: "closed" })])
=> ["inbox",null,"this task is closed and no longer accepts submissions"]
```

Validation reads `schema.json` from the attach scope through the injected reader:

```ts continue
const good = await sub.validate({ fields: { status: "open" }, manifest: { coverage, records: [{ permalink: "p", poster: "a.jpg" }] }, fileNames: ["a.jpg"], readAttachment: attachments({ "schema.json": recordSchema }) });
JSON.stringify(good)
=> {"ok":true,"count":1,"manifest":{"coverage":{"scanned":3,"stoppedAt":"x","reason":"end-of-feed"},"records":[{"permalink":"p","poster":"a.jpg"}]}}

const noSchema = await sub.validate({ fields: { status: "open" }, manifest: { coverage, records: [] }, fileNames: [], readAttachment: attachments({}) });
JSON.stringify(noSchema)
=> {"ok":false,"issues":[{"path":"schema","message":"attach/schema.json is missing; the task has no record schema yet"}]}

const badJson = await sub.validate({ fields: { status: "open" }, manifest: { coverage, records: [] }, fileNames: [], readAttachment: attachments({ "schema.json": "{oops" }) });
JSON.stringify(badJson.ok ? [] : badJson.issues.map((i) => i.path))
=> ["schema"]

const missing = await sub.validate({ fields: { status: "open" }, manifest: { coverage, records: [{ permalink: "p", poster: "a.jpg" }] }, fileNames: [], readAttachment: attachments({ "schema.json": recordSchema }) });
JSON.stringify(missing.ok ? [] : missing.issues)
=> [{"path":"records[0].poster","message":"references \"a.jpg\", which was not uploaded"}]
```
