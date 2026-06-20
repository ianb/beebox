# scanProcedures — procedure index for the agent guide

`scanProcedures` reads `config/procedures/*.procedure.card` and returns the
`name` + a one-line `description` for the procedures index in the generated
agent docs.

It reads each card's YAML **frontmatter** (`name`, `description`). This
regressed once: it parsed the cards with the XML `parseCard`, which throws on a
frontmatter card, so every procedure was indexed as `"(could not parse)"`.

```ts setup
import { scanProcedures } from "../src/core/generate-docs-compile.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Reads name + first-line description from frontmatter

```
const box = await makeTmpBox();
await box.write(
  "config/procedures/process-news.procedure.card",
  "---\nname: process-news\ndescription: Process news items from RSS feeds into a curated brief.\nsteps: []\n---\n",
);
await box.write(
  "config/procedures/triage.procedure.card",
  "---\nname: triage-inbox\ndescription: |-\n  Sort inbox items into destinations.\n  Second line is dropped from the compact index.\nsteps: []\n---\n",
);

const out = await scanProcedures(box.root);
JSON.stringify(out)
=> [{"name":"process-news","filename":"process-news.procedure.card","description":"Process news items from RSS feeds into a curated brief."},{"name":"triage-inbox","filename":"triage.procedure.card","description":"Sort inbox items into destinations."}]
```

## Missing name falls back to the filename; missing description is empty

```
const box = await makeTmpBox();
await box.write(
  "config/procedures/orphan.procedure.card",
  "---\nsteps: []\n---\n",
);

const out = await scanProcedures(box.root);
JSON.stringify(out)
=> [{"name":"orphan","filename":"orphan.procedure.card","description":""}]
```

## A card with no readable frontmatter is indexed with a placeholder, not dropped

```
const box = await makeTmpBox();
await box.write("config/procedures/bad.procedure.card", "not a frontmatter card\n");

const out = await scanProcedures(box.root);
JSON.stringify(out)
=> [{"name":"bad","filename":"bad.procedure.card","description":"(could not parse)"}]
```

## No procedures directory returns an empty list

```
const box = await makeTmpBox();
const out = await scanProcedures(box.root);
out.length
=> 0
```
