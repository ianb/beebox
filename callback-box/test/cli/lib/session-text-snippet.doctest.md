# extractSnippet — a user message reduced to the words the user typed

`extractSnippet` feeds transcript listings and the starter title of a chat husk
(`core/chat/husk.ts` `readSnippetTitle`). The raw user text carries markup the
chat assembles around what was typed: the `<typed>`/`<speech>` shell, voice
keyword markers, `<unsure>` confidence marks, and — when the user attached a
selection from an open document — a `<user-selection>` element whose body is a
quote from that document. A title must show the question, not the quote.

```ts setup
import { extractSnippet } from "../../../src/cli/lib/session-text.js";
```

```ts
const raw = `<typed user="boxholder"><user-selection ref="/store/notes/Bread.doc.card" pos="body; heading: Proofing the dough (#proofing-the-dough); ~line 42">let it rise until doubled in size</user-selection>How long does that <unsure>usually</unsure> take?<send-message/></typed>`;
print(extractSnippet(raw, 80));
=>
How long does that usually take?
```

A message that is only a selection has no words of the user's own, so there is
no snippet — the husk stays untitled until the nightly review names it:

```ts
print(extractSnippet(`<typed user="boxholder"><user-selection ref="/a.doc.card" pos="body">quoted</user-selection></typed>`, 80));
=>
null
```
