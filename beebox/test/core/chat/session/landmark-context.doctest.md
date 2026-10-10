# Box context for a landmark chat

A landmark chat starts in the landmark's directory. Claude Code loads the box
root's `AGENTS.md` from there but does not expand its `@` includes, so the agent
guide and the briefing would be missing. `buildLandmarkBoxContext` expands the
root file the way the harness does at the box root, for the system prompt.

```ts setup
import { rm } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { buildLandmarkBoxContext } from "../../../../src/core/chat/session/landmark-context.js";
```

Each include arrives. The root file's own text does not: Claude Code loads it
natively from the landmark directory.

```ts
const box = await makeTmpBox();
await box.write("AGENTS.md", "@guide.md\n@_content/brief.md\n\nHouse rule: be brief.\n");
await box.write("guide.md", "Guide text.\n");
await box.write("_content/brief.md", "Briefing text.\n");
const context = await buildLandmarkBoxContext(box.root);
JSON.stringify({
  framed: context.startsWith("\n\nBOX CONTEXT:\n"),
  rootTextDuplicated: context.includes("House rule: be brief."),
  guide: context.includes("Guide text."),
  briefing: context.includes("Briefing text."),
  includeLines: /^@/m.test(context),
})
=> {"framed":true,"rootTextDuplicated":false,"guide":true,"briefing":true,"includeLines":false}

await box.cleanup();
```

A box with no root instruction file, or one with no includes, adds nothing.

```ts
const bare = await makeTmpBox();
await rm(bare.path("AGENTS.md"), { force: true });
(await buildLandmarkBoxContext(bare.root)).length
=> 0

await bare.cleanup();
```

An include that escapes the box throws. The chat start path catches it, logs
it, and starts the chat without box context, as chats started before box
context existed (`chat/session/run/start.ts`).

```ts
const escaping = await makeTmpBox();
await escaping.write("AGENTS.md", "@../outside.md\n");
await buildLandmarkBoxContext(escaping.root).then(() => "ok", (e: unknown) => e instanceof Error ? e.name : "?")
=> UnsafeAgentContextIncludeError

await escaping.cleanup();
```
