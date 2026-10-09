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
const full = generateAgentGuide({ procedures: [], shape: v3Shape });
const text = full.slice(full.indexOf("## BOX_CODE"), full.indexOf("\n## ", full.indexOf("## BOX_CODE")));
text.split("\n")[0]
=> ## BOX_CODE — Box-Owned Code
```

## A box's full generated guide includes the section, positioned after the directory layout

```ts
const guide3 = generateAgentGuide({ procedures: [], shape: v3Shape });
const guideLines = guide3.split("\n");
guideLines.findIndex((l) => l === "## DIRECTORY_LAYOUT — Directory Layout") < guideLines.findIndex((l) => l === "## BOX_CODE — Box-Owned Code")
=> true
```
