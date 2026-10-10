# The comment panel's decisions (src/frontend/exhibits/boot/comment-requests.ts)

The panel on an exhibit page is a textarea, a Speak button, and two `fetch`
calls; what it decides is kept here, pure, so it can be checked without a
browser (`docs/implemented-plans/exhibit-comments.md`). The reader that matters is the
agent running `bin/comments list`, so what reaches the wire is what matters.

```ts setup
import {
  appendTranscript,
  commentRequest,
  responseProblem,
  savedMessage,
} from "../../../src/frontend/exhibits/boot/comment-requests.js";
```

## What goes on the wire

A selection carries its quoted text and the heading above it; the whole-exhibit
case carries neither. Absent fields are absent — `undefined` would serialize
away, but an explicit key is what a strict parser sees.

```ts
const anchored = commentRequest({
  anchor: { quoted: "A1 shows the old frame", section: "Figures", fragment: ":~:text=A1%20shows" },
  body: "  The caption is wrong.  ",
  origin: "voice",
});
const whole = commentRequest({ anchor: null, body: "Looks right.", origin: "typed" });
JSON.stringify({ anchored, whole, wholeKeys: Object.keys(whole) })
=> {"anchored":{"body":"The caption is wrong.","origin":"voice","quoted":"A1 shows the old frame","section":"Figures","fragment":":~:text=A1%20shows"},"whole":{"body":"Looks right.","origin":"typed"},"wholeKeys":["body","origin"]}
```

## What a failure says

The exhibits API refuses with `{ message, detail }` — the detail is
`bin/comments`'s own sentence — or `{ error }`. Both are shown as they are;
anything else is reported by status rather than as a blank.

```ts
JSON.stringify([
  responseProblem({ status: 409, body: { message: "The comment was not saved.", detail: "comments: store is missing its marker" } }),
  responseProblem({ status: 412, body: { error: "BBX_OPENAI_API_KEY is not set, so spoken comments cannot be transcribed — type it instead." } }),
  responseProblem({ status: 502, body: "<html>bad gateway</html>" }),
  responseProblem({ status: 404, body: null }),
])
=> ["The comment was not saved. comments: store is missing its marker","BBX_OPENAI_API_KEY is not set, so spoken comments cannot be transcribed — type it instead.","The exhibits server answered HTTP 502.","The exhibits server answered HTTP 404."]
```

## A second take adds to the first

Speech is appended to what is typed, so a correction already made is not
thrown away by recording again; an empty transcript changes nothing.

```ts
JSON.stringify([
  appendTranscript("", " the caption is wrong "),
  appendTranscript("The caption ", "is wrong."),
  appendTranscript("Typed first.", "   "),
])
=> ["the caption is wrong","The caption is wrong.","Typed first."]
```

## What the person is told after a save

Where it went, and the exact call that reads it.

```ts
savedMessage("exhibits-rethink")
=> Saved for exhibits-rethink. The agent reads it with bin/comments list --workstream exhibits-rethink at its next pickup.
```
