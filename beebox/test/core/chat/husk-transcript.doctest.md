# `huskTranscriptPath` — a husk's `context-dir` is contained to the box

A husk's `context-dir` records the SDK cwd the session ran in, and the
transcript path is derived by encoding that directory. It is a card field, so
it is hand-editable and arrives from whatever checkout wrote the husk — a value
naming a directory outside the box would otherwise send the encoder (and the
photo-serving route that resolves transcripts for HTTP requests) out of the
box entirely.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { huskTranscriptPath } from "../../../src/core/chat/husk-transcript.js";

const session = "0198f0b0-3333-7333-8333-333333333333";
function husk(contextDir) {
  return { path: "_content/chat/web/2026-08-26_0198f0b0.chat.card", session, ...(contextDir === undefined ? {} : { contextDir }) };
}
```

## A bound chat resolves under its own directory; an escaping one falls back to the box root

The escaping husk resolves exactly where an unbound husk does — the transcript
is then simply not found, which is the honest answer. It warns on the way
through (`containedSessionCwd`), so the bad field is visible rather than
silently reinterpreted.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");

huskTranscriptPath(box.root, husk("_content/recipes")) === huskTranscriptPath(box.root, husk(undefined))
=> false

huskTranscriptPath(box.root, husk("../../elsewhere")) === huskTranscriptPath(box.root, husk(undefined))
=> true

huskTranscriptPath(box.root, husk("")) === huskTranscriptPath(box.root, husk(undefined))
=> true
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
