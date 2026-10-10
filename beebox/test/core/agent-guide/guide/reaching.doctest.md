# Agent guide — reaching the boxholder

REACHING_THE_BOXHOLDER is the guide's section on notifying, reminding, and
watching. The policy lives in the root briefing's "Reaching me" section; a box
whose briefing predates it gets the default text, quoted into the guide from
the same constant the briefing template uses, so the two cannot drift.

```ts setup
import { generateAgentGuide } from "../../../../src/core/agent-guide/guide/core.js";
import { reachingDefaultQuote } from "../../../../src/core/agent-guide/guide/reaching.js";
import { createBriefingTemplate, REACHING_ME_DEFAULT } from "../../../../src/schemas/briefing.js";

const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/b" }, instructionFile: "AGENTS.md" });
const start = guide.indexOf("## REACHING_THE_BOXHOLDER");
const section = guide.slice(start, guide.indexOf("\n## ", start + 1));
```

## The section is in the guide, after the commands

```ts
start > guide.indexOf("## COMMANDS")
=> true

section.split("\n")[0]
=> ## REACHING_THE_BOXHOLDER — Notifications, reminders, and watches
```

## The default briefing text is the template's, quoted

```ts
createBriefingTemplate().includes(`{% /purpose %}\n\n${REACHING_ME_DEFAULT}\n`)
=> true

const bodyLines = REACHING_ME_DEFAULT.split("\n").slice(2);
bodyLines.every((line) => section.includes(line === "" ? ">" : `> ${line}`))
=> true

section.includes("> **Reaching me.**") && section.includes(reachingDefaultQuote())
=> true
```
