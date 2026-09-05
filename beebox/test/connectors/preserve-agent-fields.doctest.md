# preserve-agent-fields: connector rebuilds keep agent-owned fields

Connector sync rebuilds cards from templates; `preserveAgentFields`
re-injects the agent-owned `contains:` from the existing on-disk card so
it survives the rebuild.

```ts setup
import { preserveAgentFields } from "../../src/connectors/preserve-agent-fields.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const TEMPLATED = "---\nthread-id: t1\nsubject: Pricing\nstatus: new\n---\n";
```

## contains carries over from the existing card

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/email/t.email-thread.card", "---\nthread-id: t1\nsubject: Pricing\ncontains: Metricly demo offer; no action needed.\n---\n");
const preserved = await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/t.email-thread.card") });
preserved.includes("contains: Metricly demo offer; no action needed.")
=> true

preserved.includes("status: new")
=> true
```

## No existing card (first sync): template passes through untouched

```ts continue
await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/new.email-thread.card") })
=> ---
thread-id: t1
subject: Pricing
status: new
---

```

## The template wins when it carries its own value

```ts continue
const withOwn = "---\nthread-id: t1\ncontains: from-template\n---\n";
const result = await preserveAgentFields(withOwn, { existingPath: box.path("_content/inbox/email/t.email-thread.card") });
result.includes("contains: from-template")
=> true
```

## A hand-mangled existing card contributes nothing (sync never breaks)

```ts continue
await box.write("_content/inbox/email/broken.email-thread.card", "no frontmatter here");
await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/broken.email-thread.card") }) === TEMPLATED
=> true
```

```ts cleanup
await box.cleanup();
```
