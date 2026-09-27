# Agent guide — reaching the boxholder

REACHING_THE_BOXHOLDER is the guide's section on notifying, reminding, and
watching. The policy lives in the root briefing's "Reaching me" section; a box
whose briefing predates it gets the default text, quoted into the guide from
the same constant the briefing template uses, so the two cannot drift. The
worked examples live in `card-scheduled-script.md` and the `bbx notify` entry
of `bbx-commands.md`.

```ts setup
import { generateAgentGuide } from "../../src/core/agent-guide/index.js";
import { reachingDefaultQuote } from "../../src/core/agent-guide/reaching.js";
import { createBriefingTemplate, REACHING_ME_DEFAULT } from "../../src/schemas/briefing.js";
import { generateBbxCommands } from "../../src/core/docs-gen/bbx-commands.js";

const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/b" } });
const start = guide.indexOf("## REACHING_THE_BOXHOLDER");
const section = guide.slice(start, guide.indexOf("\n## ", start + 1));
/** Line-wrapped prose, compared as one line. */
const flat = section.replace(/\s+/g, " ");
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

## The rules a reader acts on are stated, and the mechanics are pointed at

```ts
[
  "bbx notify --check",
  "Check what changed before you judge, and judge before you run an agent",
  "propose adding the section",
  "Do not notify about health",
  "card-scheduled-script.md",
].map((phrase) => `${phrase}: ${flat.includes(phrase)}`).join("\n")
=>
bbx notify --check: true
Check what changed before you judge, and judge before you run an agent: true
propose adding the section: true
Do not notify about health: true
card-scheduled-script.md: true

const commands = generateBbxCommands();
commands.includes("## bbx notify") && commands.includes("--target chat:<that sessionId>")
=> true
```
