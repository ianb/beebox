# Structured-output parsing

`src/frontend/src/lib/structured-output-parsing.ts` parses the two
new agent output tags — `<ack>` (transient indications) and
`<callout>` (durable, self-contained content) — and the related
strip helper that pulls them (plus `<chat-app>`) out of the prose
markdown stream before rendering.

```ts setup
import {
  ACK_KINDS,
  getAckKind,
  parseAcks,
  parseCallouts,
  stripStructuredOutputTags,
} from "../src/frontend/src/lib/structured-output-parsing.js";

// Several assertions feed deliberately malformed tags to exercise the
// warn-and-skip paths. Silence console.warn so the warnings don't pollute
// test output.
console.warn = () => {};
```

## Ack kinds registry

The closed set of recognized kinds.

```
ACK_KINDS.map((k) => k.kind).join(",")
=> created,appended,edited,todo-added,todo-completed,no-response

getAckKind("appended")?.defaultPhrase
=> Added to it

getAckKind("nope")
=> null
```

## parseAcks — valid kinds

Self-closing form, no inner text.

```
JSON.stringify(parseAcks("<ack kind=\"appended\" ref=\"a.card\"/>"))
=> [{"kind":"appended","ref":"a.card"}]
```

Paired form with inner text.

```
JSON.stringify(parseAcks("<ack kind=\"edited\" ref=\"a.md\">Reworked the intro</ack>"))
=> [{"kind":"edited","ref":"a.md","text":"Reworked the intro"}]
```

Empty text is dropped, ref is optional.

```
JSON.stringify(parseAcks("<ack kind=\"noted\"></ack>"))
=> []

JSON.stringify(parseAcks("<ack kind=\"created\"></ack>"))
=> [{"kind":"created"}]
```

(`noted` is not in the registry, so it gets dropped — see next section.)

## parseAcks — unknowns are dropped

Unknown kinds are silently dropped (with a console warning the caller
can ignore). Acks with no `kind` attribute are also dropped.

```
JSON.stringify(parseAcks("<ack kind=\"frob\"/>"))
=> []

JSON.stringify(parseAcks("<ack ref=\"x.card\"/>"))
=> []
```

Mixed valid and invalid in one response — valids survive.

```
JSON.stringify(parseAcks(
  "prose <ack kind=\"created\" ref=\"a.card\"/> more <ack kind=\"frob\"/> end"
))
=> [{"kind":"created","ref":"a.card"}]
```

## parseCallouts

Single callout with a context label.

```
JSON.stringify(parseCallouts(
  "<callout context=\"weather Sat\">Saturday: sunny, 72.</callout>"
))
=> [{"context":"weather Sat","body":"Saturday: sunny, 72."}]
```

Multiple callouts stack in document order.

```
const r = parseCallouts(
  "<callout context=\"a\">first</callout> middle <callout context=\"b\">second</callout>"
);
r.length
=> 2

r.map((c) => c.context).join(",")
=> a,b
```

Missing context → dropped. Empty body → dropped.

```
JSON.stringify(parseCallouts("<callout>no context</callout>"))
=> []

JSON.stringify(parseCallouts("<callout context=\"x\"></callout>"))
=> []
```

## stripStructuredOutputTags

Removes `<ack>`, `<callout>`, and `<chat-app>` tags so the prose
renderer doesn't show the raw XML. Self-closing and paired forms
both strip.

```
stripStructuredOutputTags("hello <ack kind=\"created\"/> world")
=> hello  world

stripStructuredOutputTags("<callout context=\"x\">body</callout>after")
=> after

stripStructuredOutputTags("before <chat-app narration=\"on\"/> after")
=> before  after

stripStructuredOutputTags("plain text only")
=> plain text only
```

The paired `<chat-app>` form with `<card-activity>` children (the
companion-pane snapshot) strips whole, body included — otherwise the
snapshot leaks into the displayed message.

```
stripStructuredOutputTags("<chat-app prose=\"on\" open-card=\"x\">\n<card-activity kind=\"explored\">king -> chief</card-activity>\n</chat-app>kept")
=> kept
```
