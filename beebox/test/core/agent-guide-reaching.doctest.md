# Agent guide — reaching the boxholder

`reachingSection` is the mechanics of notifying, reminding, and watching. The
policy lives in the root briefing's "Reaching me" section; a box whose
briefing predates it gets the default text from this section, the same text a
new box's briefing template carries.

```ts setup
import { reachingSection } from "../../src/core/agent-guide/reaching.js";
import { generateAgentGuide } from "../../src/core/agent-guide/index.js";
import { createBriefingTemplate, REACHING_ME_DEFAULT } from "../../src/schemas/briefing.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";

const section = reachingSection();
const schemas = await createCardSchemaMap();

/** Each fenced yaml example: its `# <path>` first line and the card text after it. */
function yamlExamples(text) {
  const fence = "\x60\x60\x60";
  const pattern = new RegExp(`${fence}yaml\\n# (\\S+)[^\\n]*\\n([\\s\\S]*?)${fence}`, "g");
  return [...text.matchAll(pattern)].map(([, path, yaml]) => ({ path, yaml }));
}

/** Parse one example against its schema (throws when invalid); returns its path. */
function parseExample({ path, yaml }) {
  parseCardText(`---\n${yaml}---\n`, { source: path, schemas });
  return path;
}
```

## The section is in the guide, after the key commands

```ts
const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/b" } });
guide.indexOf("## REACHING_THE_BOXHOLDER") > guide.indexOf("## Key Commands")
=> true

section.split("\n")[0]
=> ## REACHING_THE_BOXHOLDER
```

## The default briefing text is the template's, quoted

A new box's briefing carries the section as a heading; the guide quotes the
same lines, so the two cannot drift.

```ts
createBriefingTemplate().includes(`{% /purpose %}\n\n${REACHING_ME_DEFAULT}\n`)
=> true

const bodyLines = REACHING_ME_DEFAULT.split("\n").slice(2);
bodyLines.every((line) => section.includes(line === "" ? ">" : `> ${line}`))
=> true

section.includes("> **Reaching me.**")
=> true
```

## Every example card is a valid card

An agent copies these, so each parses against its schema.

```ts
yamlExamples(section).map(parseExample).join("\n")
=>
_config/schedules/remind-vet.scheduled-script.card
_config/schedules/watch-field-trip.scheduled-script.card
_config/procedures/watch-field-trip.procedure.card
```

## The rules a reader acts on are stated

```ts
[
  "bbx notify --check",
  "Check what changed before you judge, and judge before you run an agent",
  "propose adding the section",
  "Do not notify about health",
].map((phrase) => `${phrase}: ${section.includes(phrase)}`).join("\n")
=>
bbx notify --check: true
Check what changed before you judge, and judge before you run an agent: true
propose adding the section: true
Do not notify about health: true
```
