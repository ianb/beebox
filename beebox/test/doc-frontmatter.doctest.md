# Plan and issue frontmatter validation

The documentation schema is enforced independently of the filesystem; tests
inject the set of paths that resolve.

```ts setup
import { frontmatterProblems } from "../src/dev/doc-frontmatter.js";
const files = new Set(["issues/features/x.md", "beebox/docs/plans/next.md"]);
const check = (rel, source) => frontmatterProblems({ rel, source, exists: (target) => files.has(target) });
```

## A complete plan validates

```ts
check("beebox/docs/plans/current.md", `---
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
check("beebox/docs/implemented-plans/current.md", `---
title: Current
status: active
workstream: current
issues: [missing.md]
---
# Current`).join("\n")
=> beebox/docs/implemented-plans/current.md: status active is not allowed in implemented-plans; implemented-plans requires implemented
beebox/docs/implemented-plans/current.md: frontmatter issues does not resolve: missing.md
```

Every plan directory accepts only its lifecycle states. README files and
companion review documents remain exempt.

```ts
check("beebox/docs/plans/done.md", `---
title: Done
status: implemented
workstream: done
issues: []
---`).join("\n")
=> beebox/docs/plans/done.md: status implemented is not allowed in plans; plans requires draft, active, partial

check("beebox/docs/unimplemented-plans/later.md", `---
title: Later
status: parked
workstream: later
issues: []
---`).length
=> 0

check("beebox/docs/plans/README.md", "No frontmatter").length
=> 0

check("beebox/docs/implemented-plans/current.review.md", "No frontmatter").length
=> 0

check("beebox/docs/implemented-plans/current.gap-analysis.md", `---
title: Historical review
---`).length
=> 0

check("beebox/docs/plans/missing.md", "# Missing").join("\n")
=> beebox/docs/plans/missing.md: YAML frontmatter is required

check("beebox/docs/plans/malformed.md", `---
title: [
---`).join("\n").startsWith("beebox/docs/plans/malformed.md: invalid YAML frontmatter:")
=> true
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

## Deferred issues require their activation metadata

```ts
check("issues/deferred/x.md", `---
title: X
workstream: unattached
activate-on: 2026-09-07
category: code-quality
---
Body`).length
=> 0

check("issues/deferred/x.md", `---
title: X
workstream: unattached
activate-on: 2026-02-30
category: someday
---
Body`).join("\n")
=> issues/deferred/x.md: deferred issues require activate-on as a valid YYYY-MM-DD date
issues/deferred/x.md: deferred issues require a valid category
```

The fields do not survive the move into the active queue.

```ts
check("issues/features/x.md", `---
title: X
workstream: unattached
activate-on: 2026-09-07
category: features
---
Body`).join("\n")
=> issues/features/x.md: activate-on is allowed only on deferred issues
issues/features/x.md: category is allowed only on deferred issues
```
