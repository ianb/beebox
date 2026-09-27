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

The `<attachments>` block that resolves `[file#N]` and `[image#N]` tokens to
`_tmp/` paths is machine text, not the user's words, and so are the tokens
themselves; a title built from them read "[file#1] …<attachments> [image#1]:
_tmp/2026-…png".

```ts
print(extractSnippet(`<typed user="boxholder">[file#1] file this receipt [image#1]</typed>\n<attachments>\n[file#1]: _tmp/chat/m1abcd-x9y8z7w6/notes.txt\n[image#1]: _tmp/chat/m1abcd-x9y8z7w6/IMG_0001.jpg\n</attachments>`, 80));
=>
file this receipt
```

A message that is only a selection has no words of the user's own, so there is
no snippet — the husk stays untitled until the nightly review names it:

```ts
print(extractSnippet(`<typed user="boxholder"><user-selection ref="/a.doc.card" pos="body">quoted</user-selection></typed>`, 80));
=>
null
```
