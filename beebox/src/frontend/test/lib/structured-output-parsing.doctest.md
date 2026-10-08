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
  isNoResponseOnly,
} from "../../src/lib/structured-output-parsing.js";

// Several assertions feed deliberately malformed tags to exercise the
// warn-and-skip paths. Silence console.warn so the warnings don't pollute
// test output.
console.warn = () => {};
```

## Ack kinds registry

The closed set of recognized kinds.

```ts
ACK_KINDS.map((k) => k.kind).join(",")
=> created,appended,edited,todo-added,todo-completed,no-response

getAckKind("appended")?.defaultPhrase
=> Added to it

getAckKind("nope")
=> null
```

## parseAcks — valid kinds

Self-closing form, no inner text.

```ts
JSON.stringify(parseAcks("<ack kind=\"appended\" ref=\"a.card\"/>"))
=> [{"kind":"appended","ref":"a.card"}]
```

Paired form with inner text.

```ts
JSON.stringify(parseAcks("<ack kind=\"edited\" ref=\"a.md\">Reworked the intro</ack>"))
=> [{"kind":"edited","ref":"a.md","text":"Reworked the intro"}]
```

Empty text is dropped, ref is optional.

```ts
JSON.stringify(parseAcks("<ack kind=\"noted\"></ack>"))
=> []

JSON.stringify(parseAcks("<ack kind=\"created\"></ack>"))
=> [{"kind":"created"}]
```

(`noted` is not in the registry, so it gets dropped — see next section.)

## parseAcks — unknowns are dropped

Unknown kinds are silently dropped (with a console warning the caller
can ignore). Acks with no `kind` attribute are also dropped.

```ts
JSON.stringify(parseAcks("<ack kind=\"frob\"/>"))
=> []

JSON.stringify(parseAcks("<ack ref=\"x.card\"/>"))
=> []
```

Mixed valid and invalid in one response — valids survive.

```ts
JSON.stringify(parseAcks(
  "prose <ack kind=\"created\" ref=\"a.card\"/> more <ack kind=\"frob\"/> end"
))
=> [{"kind":"created","ref":"a.card"}]
```

## Bare `<no-response/>` alias

The agent sometimes writes the bare `<no-response/>` shorthand instead of the
canonical `<ack kind="no-response"/>`. It's normalized everywhere — parsed as a
no-response ack, stripped from prose, and recognized by `isNoResponseOnly` —
so it never leaks into the render.

```ts
JSON.stringify(parseAcks("<no-response/>"))
=> [{"kind":"no-response"}]

stripStructuredOutputTags("ok<no-response/>")
=> ok

isNoResponseOnly("<no-response/>")
=> true
```

The paired form (`<no-response></no-response>`) normalizes the same way.

```ts
isNoResponseOnly("<no-response></no-response>")
=> true
```

## Bare kind aliases for every ack kind

The same slip happens with the other kinds: a journey walk saw a reply whose
prose read a literal `<todo-added>` because the agent wrote the kind as the tag
name. Every registered kind normalizes like `<no-response/>`: self-closing,
paired (inner text becomes the ack's text), or a lone opening tag.
Attributes such as `ref` carry over.

```ts
parseAcks("Saved it.<todo-added>")
=> [{ kind: "todo-added" }]

stripStructuredOutputTags("Saved it.<todo-added>")
=> Saved it.

parseAcks("<created ref=\"a.card\"/> and <edited ref=\"b.md\">the intro</edited>")
=> [{ kind: "created", ref: "a.card" }, { kind: "edited", ref: "b.md", text: "the intro" }]

stripStructuredOutputTags("a<todo-completed/>b<appended>x</appended>c")
=> abc
```

The alias pattern lists the kinds by hand. Every registered kind must
normalize, so a kind added to `ACK_KINDS` without the pattern fails here.

```ts
ACK_KINDS.filter((k) => parseAcks(`<${k.kind}/>`).length !== 1).map((k) => k.kind)
=> []
```

Only exact kind names are aliases. A longer tag that starts with a kind name
is left alone.

```ts
parseAcks("<created-at>")
=> []
```

## Aliases inside Markdown code stay literal

A reply that explains the tags shows them as code. Normalizing there would
replace the example with an ack: the prose would lose the example and gain a
false indication. Inline code spans and fenced blocks are left as written.

```ts
stripStructuredOutputTags("Write `<created>` here")
=> Write `<created>` here

parseAcks("Write `<created>` here")
=> []
```

A fenced block is left alone as well. (The example uses a `~~~` fence so it
can sit inside this file's own code fence; backtick fences match the same way.)

```ts
const fenced = "Example:\n~~~\n<todo-added>\n~~~\nDone.";
stripStructuredOutputTags(fenced).split("\n")
=> ["Example:", "~~~", "<todo-added>", "~~~", "Done."]

parseAcks(fenced)
=> []

parseAcks("Example:\n" + "`".repeat(3) + "\n<todo-added>\n" + "`".repeat(3))
=> []
```

A bare tag outside the code still normalizes in the same reply.

```ts
stripStructuredOutputTags("Use `<created>` for files.<todo-added>")
=> Use `<created>` for files.
```

## parseCallouts

Single callout with a context label.

```ts
JSON.stringify(parseCallouts(
  "<callout context=\"weather Sat\">Saturday: sunny, 72.</callout>"
))
=> [{"context":"weather Sat","body":"Saturday: sunny, 72."}]
```

Multiple callouts stack in document order.

```ts
const r = parseCallouts(
  "<callout context=\"a\">first</callout> middle <callout context=\"b\">second</callout>"
);
r.length
=> 2

r.map((c) => c.context).join(",")
=> a,b
```

Missing context → dropped. Empty body → dropped.

```ts
JSON.stringify(parseCallouts("<callout>no context</callout>"))
=> []

JSON.stringify(parseCallouts("<callout context=\"x\"></callout>"))
=> []
```

## stripStructuredOutputTags

Removes `<ack>`, `<callout>`, and `<chat-app>` tags so the prose
renderer doesn't show the raw XML. Self-closing and paired forms
both strip.

```ts
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

```ts
stripStructuredOutputTags("<chat-app prose=\"on\" open-card=\"x\">\n<card-activity kind=\"explored\">king -> chief</card-activity>\n</chat-app>kept")
=> kept
```
