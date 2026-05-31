# Selection serialization

`applySelections(body, { selections })` folds composer selections into a
message body. The single serializer every send path shares: `[selectionN]`
tokens are replaced inline, and any selection whose token is absent is
appended. Typed messages carry tokens (inline dominates); spoken messages
carry none (everything appends). Results are `JSON.stringify`'d so newlines
and quotes are explicit.

```ts setup
import { applySelections } from "../src/frontend/src/lib/selection-serialize.js";
```

## Inline replacement at the token (typed message)

```
JSON.stringify(applySelections("Compare [selection1] with the intro", { selections: [
  { id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" },
] }))
=>
"Compare <user-selection ref=\"/store/notes/Bread.doc.card\" position=\"body; heading: Proofing (#proofing)\">let it rise</user-selection> with the intro"
```

## No token in the body — appended (spoken message)

```
JSON.stringify(applySelections("look at what I selected", { selections: [
  { id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body" },
] }))
=>
"look at what I selected\n<user-selection ref=\"/store/notes/Bread.doc.card\" position=\"body\">let it rise</user-selection>"
```

## Mixed: one referenced inline, one orphan appended; empty position omits the attribute

```
JSON.stringify(applySelections("see [selection1]", { selections: [
  { id: 1, ref: "/a.card", text: "alpha", position: "body" },
  { id: 2, ref: "/b.card", text: "beta", position: "" },
] }))
=>
"see <user-selection ref=\"/a.card\" position=\"body\">alpha</user-selection>\n<user-selection ref=\"/b.card\">beta</user-selection>"
```

## XML-escaping of ref, position, and text

```
JSON.stringify(applySelections("[selection1]", { selections: [
  { id: 1, ref: "/a&b.card", text: "x < y & z", position: "p\"q" },
] }))
=>
"<user-selection ref=\"/a&amp;b.card\" position=\"p&quot;q\">x &lt; y &amp; z</user-selection>"
```

## No selections — body unchanged

```
applySelections("hello world", { selections: [] })
=>
hello world
```

## Unknown token is left as literal text

```
JSON.stringify(applySelections("[selection1] and [selection9]", { selections: [
  { id: 1, ref: "/a.card", text: "alpha", position: "" },
] }))
=>
"<user-selection ref=\"/a.card\">alpha</user-selection> and [selection9]"
```

## Voice anchor: inserted after the anchored phrase (not appended)

```
JSON.stringify(applySelections("let me look at this part and continue", { selections: [
  { id: 1, ref: "/a.card", text: "X", position: "", anchor: "look at this part" },
] }))
=>
"let me look at this part <user-selection ref=\"/a.card\">X</user-selection> and continue"
```

## Voice anchor: case/punctuation-insensitive (survives the HQ pass)

```
JSON.stringify(applySelections("So, what does THIS part mean?", { selections: [
  { id: 1, ref: "/a.card", text: "X", position: "", anchor: "this part" },
] }))
=>
"So, what does THIS part <user-selection ref=\"/a.card\">X</user-selection> mean?"
```

## Voice anchor: empty anchor places the selection at the start

```
JSON.stringify(applySelections("the rest of it", { selections: [
  { id: 1, ref: "/a.card", text: "X", position: "", anchor: "" },
] }))
=>
"<user-selection ref=\"/a.card\">X</user-selection> the rest of it"
```

## Voice anchor: phrase not found falls back to appending

```
JSON.stringify(applySelections("hello world", { selections: [
  { id: 1, ref: "/a.card", text: "X", position: "", anchor: "goodbye moon" },
] }))
=>
"hello world\n<user-selection ref=\"/a.card\">X</user-selection>"
```
