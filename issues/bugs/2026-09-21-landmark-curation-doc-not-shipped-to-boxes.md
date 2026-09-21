---
title: "docs/landmark-curation.md, which the agent guide requires reading before editing a landmark, is never shipped into an initialized box"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

The generated agent-guide landmarks section tells every box agent: "Read
`docs/landmark-curation.md` before suggesting or editing one"
(`beebox/src/core/agent-guide/landmarks.ts:18`). The plan doc
`beebox/docs/implemented-plans/box-docs-in-package.md:154` lists
`landmark-curation` among the docs meant to ship as box package docs
(`node_modules/beebox/box-docs/...`).

The file that referenced path expects does not exist in an initialized box.
Tracing why: package prose docs are shipped only from `docs/box/`
(`beebox/src/core/docs-gen/package-docs.ts:66-75`, `proseDocs()`, which reads
`join(packageRoot, "docs", "box")`), and `beebox/docs/box/` currently contains
only 4 files (`card-themes.md`, `interface-cards.md`, `quick-chat.md`,
`what-you-could-do.md`). `landmark-curation.md` lives at `beebox/docs/`
(package root docs, not `docs/box/`), so `proseDocs()` never picks it up, and
it is absent from the generated `box-docs/` directory
(confirmed: `ls beebox/box-docs | grep -i landmark` finds only
`card-landmark.md`/`card-landmarks.md`, the schema docs — not the curation
guide).

An agent following the guide's instruction to read
`docs/landmark-curation.md` before touching a landmark therefore always fails
to find it. Work can continue from the generated card-landmark schema rules
alone, but the mandatory reference the guide names is unreachable.

## Why resolution is not obvious

Either `landmark-curation.md` needs to move into `docs/box/` (with the
`read-when:` frontmatter `proseDocs()` requires,
`package-docs.ts:71-73`), or it needs its own `STATIC_DOCS`/generator entry,
or the agent-guide text needs to point at wherever it's actually meant to
live. Checking whether other docs referenced the same way (by a bare
`docs/<name>.md` path in generated guide text) have the same gap is worth
doing before picking one fix, since this may not be an isolated case.
