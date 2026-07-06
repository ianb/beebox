# Agent guide — box-shape section

`boxCodeLocationSection` teaches the operating agent where box-authored code
(schemas/views/tricks) actually lives, for a box using the package layout
(shapeVersion 2+). A legacy (shapeVersion 1) box keeps its code inside the
box root itself, so there's nothing new to say — the function returns an
empty string, which the guide assembler in `agent-guide/index.ts` drops just
like any other omitted section. That's what keeps a legacy box's generated
guide byte-identical to before shape-awareness existed: the new section
contributes nothing to its output.

```ts setup
import { boxCodeLocationSection } from "../../src/core/agent-guide/box-shape.js";
import { generateAgentGuide } from "../../src/core/agent-guide/index.js";
import type { BoxShape } from "../../src/lib/box-shape.js";

const legacyShape: BoxShape = { shapeVersion: 1, boxRoot: "/tmp/my-box", packageRoot: "/tmp/my-box" };
const v2Shape: BoxShape = {
  shapeVersion: 2,
  boxRoot: "/tmp/my-box-pkg/content",
  packageRoot: "/tmp/my-box-pkg",
};
```

## A legacy (shapeVersion 1) box gets no box-code-location section

```ts
boxCodeLocationSection(legacyShape) === ""
=> true
```

## A legacy box's full generated guide never mentions the package layout

```ts
const guide = generateAgentGuide({ procedures: [], shape: legacyShape });
guide.includes("Box-Owned Code")
=> false
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
text.includes("`callback-box/cards`")
=> true

text.includes("`callback-box/schema`")
=> true

text.includes("`callback-box/view-widgets`")
=> true
```

## A package box's full generated guide includes the section, positioned after the directory layout

```ts
const guide2 = generateAgentGuide({ procedures: [], shape: v2Shape });
const guideLines = guide2.split("\n");
guideLines.findIndex((l) => l === "## Directory Layout") < guideLines.findIndex((l) => l === "## Box-Owned Code")
=> true
```
