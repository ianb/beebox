# Agent guide — box-shape section

The BOX_CODE section teaches the operating agent where box-authored code
(schemas/views/tricks) actually lives, for a shapeVersion 3 (one-root) box:
the code lives at `src/...`, right at the box root the agent is already
sitting in — no climb needed.

```ts setup
import { generateAgentGuide } from "../../src/core/agent-guide/index.js";
import type { BoxShape } from "../../src/lib/box-shape.js";

const v3Shape: BoxShape = {
  shapeVersion: 3,
  boxRoot: "/tmp/my-box",
};
```

## The directory layout names the one general temp-file location

```ts
const layout = generateAgentGuide({ procedures: [], shape: v3Shape });
layout.includes("| `_tmp/` | General scratch space for temporary files. Use this box-root directory, never the host `/tmp`; it is uncommitted and may be swept, so never rely on persistence. |")
=> true
```

## A shapeVersion-3 box is told code lives right here, under `src/...`

```ts
const full = generateAgentGuide({ procedures: [], shape: v3Shape });
const text = full.slice(full.indexOf("## BOX_CODE"), full.indexOf("\n## ", full.indexOf("## BOX_CODE")));
const lines = text.split("\n");
lines[0]
=> ## BOX_CODE — Box-Owned Code

lines.some((l) => l.includes("`src/schemas/`"))
=> true

lines.some((l) => l.includes("`src/views/`"))
=> true

lines.some((l) => l.includes("`src/tricks/`"))
=> true
```

## The section states the hot-reload contract and the off-limits package files

```ts continue
text.includes("Editable, hot-reloaded — no restart needed")
=> true

text.includes("package.json")
=> true

text.includes("boxholder")
=> true
```

## The section names exactly the three real library import specifiers

```ts continue
text.includes("`beebox/cards`")
=> true

text.includes("`beebox/schema`")
=> true

text.includes("`beebox/view-widgets`")
=> true
```

## A box's full generated guide includes the section, positioned after the directory layout

```ts
const guide3 = generateAgentGuide({ procedures: [], shape: v3Shape });
const guideLines = guide3.split("\n");
guideLines.findIndex((l) => l === "## DIRECTORY_LAYOUT — Directory Layout") < guideLines.findIndex((l) => l === "## BOX_CODE — Box-Owned Code")
=> true
```
