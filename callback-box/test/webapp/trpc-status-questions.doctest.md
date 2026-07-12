# tRPC `status.questions` — malformed cards stay visible

`status.questions` parses each card in `box/questions/` against
`QuestionSchema` to attach the typed fields (`prompt`, `input`, `answer`,
…) on top of the lightweight `CardInfo` the state scan already found. A
card that fails that parse (bad frontmatter, a lifecycle-coherence
violation, …) must not vanish from the list — it comes back marked
`invalid: true` so the frontend can still surface it (as its own small
section, pointing at the raw file) instead of silently dropping it.

```ts setup
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function contextFor(box) {
  const ctx = { boxRoot: box.root, boxSlug: "t", user: null, authed: true, isOwner: true };
  return statusRouter.createCaller(ctx);
}

// makeTmpBox writes a shapeVersion-2 marker with no version/created;
// status.questions calls getSystemState → getBoxMetadata, which parses those,
// so seed a marker carrying both (keeping shapeVersion 2 for getBoxShape).
const MARKER = JSON.stringify({ shapeVersion: 2, version: "1.0.0", created: "2026-01-01T00:00:00Z" });

const VALID = `---
status: pending
prompt: Where does this receipt go?
input:
  type: text
directive: File the receipt
---
`;

// Missing the required \`prompt\` field — parses as frontmatter fine (the
// state scan only reads a card's status/type), but fails QuestionSchema
// validation when status.questions loads and re-parses it.
const MALFORMED = `---
status: pending
input:
  type: text
---
`;
```

```ts
const box = await makeTmpBox({ git: true });
await box.seed(".cb-box", MARKER);
await box.write("box/questions/Receipt.question.card", VALID);
await box.write("box/questions/Broken.question.card", MALFORMED);

const caller = contextFor(box);
const { items } = await caller.questions();

items.length
=> 2

const good = items.find((i) => i.name === "Receipt");
good.invalid
=> undefined

good.prompt
=> Where does this receipt go?

const broken = items.find((i) => i.name === "Broken");
broken.invalid
=> true

broken.prompt
=> undefined
```

The malformed card keeps its `CardInfo` fields (path, name, type) — enough
for a caller to link to it — even though none of the typed question fields
resolved:

```ts continue
broken.relativePath
=> box/questions/Broken.question.card
```

```ts cleanup
await box.cleanup();
```
