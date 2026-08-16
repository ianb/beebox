# Plan and issue frontmatter validation

The documentation schema is enforced independently of the filesystem; tests
inject the set of paths that resolve.

```ts setup
import { frontmatterProblems } from "../src/dev/doc-frontmatter.js";
const files = new Set(["issues/features/x.md", "callback-box/docs/plans/next.md"]);
const check = (rel, source) => frontmatterProblems({ rel, source, exists: (target) => files.has(target) });
```

## A complete plan validates

```ts
check("callback-box/docs/plans/current.md", `---
title: Current
status: active
workstream: current
issues:
  - ../../../issues/features/x.md
---
# Current`).length
=> 0
```

## Directory status and paths are enforced

```ts
check("callback-box/docs/implemented-plans/current.md", `---
title: Current
status: active
workstream: current
issues: [missing.md]
---
# Current`).join("\n")
=> callback-box/docs/implemented-plans/current.md: frontmatter issues does not resolve: missing.md
callback-box/docs/implemented-plans/current.md: implemented-plans requires status implemented
```

## Closed issues require a resolution

```ts
check("issues/closed/bugs/x.md", `---
title: X
workstream: unknown
---
Body`).join("\n")
=> issues/closed/bugs/x.md: closed issues require a valid resolution
```

## Manual-testing flags require an addressable procedure section

```ts
check("issues/bugs/x.md", `---
title: X
workstream: x
needs: [manual-testing]
---
Try it.`).join("\n")
=> issues/bugs/x.md: needs manual-testing requires a ## Manual testing section
```

## Issue priority uses the documented vocabulary

Omission means normal, while an authored value must be exact.

```ts
check("issues/features/x.md", `---
title: X
workstream: unattached
---
Body`).length
=> 0

check("issues/features/x.md", `---
title: X
workstream: unattached
priority: urgent
---
Body`).join("\n")
=> issues/features/x.md: priority must be important, normal, or backlog
```
