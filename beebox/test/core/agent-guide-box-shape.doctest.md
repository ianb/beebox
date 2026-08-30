# Agent guide — box-shape section

`boxCodeLocationSection` teaches the operating agent where box-authored code
(schemas/views/tricks) actually lives, for a box using the package layout
(shapeVersion 2+): the code lives at the package root, reached from the box
root via `../src/...`.

```ts setup
import { boxCodeLocationSection } from "../../src/core/agent-guide/box-shape.js";
import { generateAgentGuide } from "../../src/core/agent-guide/index.js";
import type { BoxShape } from "../../src/lib/box-shape.js";

const v2Shape: BoxShape = {
  shapeVersion: 2,
  boxRoot: "/tmp/my-box-pkg/content",
  packageRoot: "/tmp/my-box-pkg",
};
```

## The directory layout names the one general temp-file location

```ts
const layout = generateAgentGuide({ procedures: [], shape: v2Shape });
layout.includes("| `tmp/` | General scratch space for temporary files. Use this box-root directory, never the host `/tmp`; it is uncommitted and may be swept, so never rely on persistence. |")
=> true
```

## A package (shapeVersion 2) box is told code lives at the package root, reached via `../src/...`

```ts
const text = boxCodeLocationSection(v2Shape);
const lines = text.split("\n");
lines[0]
=> ## Box-Owned Code

lines.some((l) => l.includes("`../src/schemas/`"))
=> true

lines.some((l) => l.includes("`../src/views/`"))
=> true

lines.some((l) => l.includes("`../src/tricks/`"))
=> true
```

## The v2 section states the hot-reload contract and the off-limits package files

```ts continue
text.includes("Editable, hot-reloaded — no restart needed")
=> true

text.includes("package.json")
=> true

text.includes("boxholder")
=> true
```

## The v2 section names exactly the three real library import specifiers

```ts continue
text.includes("`beebox/cards`")
=> true

text.includes("`beebox/schema`")
=> true

text.includes("`beebox/view-widgets`")
=> true
```

## A package box's full generated guide includes the section, positioned after the directory layout

```ts
const guide2 = generateAgentGuide({ procedures: [], shape: v2Shape });
const guideLines = guide2.split("\n");
guideLines.findIndex((l) => l === "## Directory Layout") < guideLines.findIndex((l) => l === "## Box-Owned Code")
=> true
```
