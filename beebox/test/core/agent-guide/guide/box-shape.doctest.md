# Agent guide — box-shape section

The BOX_CODE section teaches the operating agent where box-authored code
(schemas/views/tricks) actually lives, for a shapeVersion 3 (one-root) box:
the code lives at `src/...`, right at the box root the agent is already
sitting in — no climb needed.

```ts setup
import { generateAgentGuide } from "../../../../src/core/agent-guide/guide/core.js";
import type { BoxShape } from "../../../../src/lib/box-shape.js";

const v3Shape: BoxShape = {
  shapeVersion: 3,
  boxRoot: "/tmp/my-box",
};
```

## A shapeVersion-3 box gets the BOX_CODE section

```ts
const full = generateAgentGuide({ procedures: [], shape: v3Shape, instructionFile: "AGENTS.md" });
const text = full.slice(full.indexOf("## BOX_CODE"), full.indexOf("\n## ", full.indexOf("## BOX_CODE")));
text.split("\n")[0]
=> ## BOX_CODE — Box-Owned Code
```

## A box's full generated guide includes the section, positioned after the directory layout

```ts
const guide3 = generateAgentGuide({ procedures: [], shape: v3Shape, instructionFile: "AGENTS.md" });
const guideLines = guide3.split("\n");
guideLines.findIndex((l) => l === "## DIRECTORY_LAYOUT — Directory Layout") < guideLines.findIndex((l) => l === "## BOX_CODE — Box-Owned Code")
=> true
```

## The section names the box's instruction file

The nested guides under `src/` are `AGENTS.md` in a converted box and
`CLAUDE.md` in one not yet converted; `generateDocs` passes
`instructionFileName(boxRoot)`, and the sentence names it.

```ts
const sentence = (instructionFile: string): string => {
  const guide = generateAgentGuide({ procedures: [], shape: v3Shape, instructionFile });
  const start = guide.indexOf("Each has its own");
  return guide.slice(start, guide.indexOf("before writing there.", start) + "before writing there.".length);
};
sentence("CLAUDE.md")
=> Each has its own `CLAUDE.md` that says what to read before writing there.

sentence("AGENTS.md")
=> Each has its own `AGENTS.md` that says what to read before writing there.
```
