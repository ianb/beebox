---
title: "box docs reference node modules"
workstream: unknown
area: beebox
needs: [design]
---

Now that beebox is a **library** (v2 boxes are packages that depend on it —
`beebox/{cards,schema,view-widgets}` public specifiers, resolved through
node_modules / the workspace), the identical `docs/generated/` copy in every box
looks like redundant duplication we no longer need.

## What happens today

`generateDocs(boxRoot)` / `bbx init` write a `docs/generated/` tree into each box,
and it's **the same contents for every box** — see
[docs-generated-map](2026-05-21-docs-generated-map.md), which notes "the per-box
`docs/generated/` tree is fully templated from this repo… every box gets the same
contents." `generateDocs` re-syncs it on events (e.g. chat-session start,
`core/chat/session/index.ts:175`), so it's a recurring write into box files.
Several places special-case this subtree because it's bbx-owned, not box-owned:
`install-validation-hooks.ts` (skips it in validation), `validation-ignore.ts`,
`list-cards.ts:42`, and the MAP generator hides it.

## The idea

Since the box already resolves `beebox` from node_modules, the identical
docs could **live once in the package and be referenced**, not copied per box:
`node_modules/beebox/docs/generated/…` (or wherever the package ships
them). The box's CLAUDE.md already `@`-includes the agent guide by path
(`docs-gen/claude-md.ts:22`, `@.beebox/<AGENT_GUIDE_FILE>`) — that include
could point into the resolved package instead.

Benefits: no per-box copy or re-sync churn, one source of truth (no template
rollout drift for these docs — which parks silently on un-tracked boxes), smaller
box repos, and the special-case "skip bbx's generated docs" logic largely goes
away.

## Tensions to settle (why it's `needs: design`, not a drive-by)

- **Self-contained box vs. dedup.** A box is a git repo meant to be portable; docs
  under `node_modules` are gitignored and not in the box's own history — a box
  checked out without `pnpm install` would have no docs. Is that acceptable, or is
  "the box carries its own docs" a property worth keeping?
- **Not all of `docs/generated/` is identical.** Some is genuinely per-box —
  the calendar skill and examples are "generated per-box so the example carries
  the box's real timezone" (`box/skills-content.ts:246`, `box/skills.ts:39`). The
  split is: reference the box-invariant docs from the package, still generate the
  box-specific ones. The issue is deciding that boundary cleanly.
- **`@`-include resolution.** Confirm Claude Code's `@path` include can point into
  `node_modules/beebox/…` from a box's CLAUDE.md (relative path across the
  package boundary) and that validation/MAP/`list-cards` special-casing updates to
  match the new location.
- **Version skew.** A copied doc matches whatever `bbx init` last ran; a referenced
  doc matches the installed package version. The latter is arguably *more* correct
  (docs track the code the box actually runs), but worth stating.

This likely subsumes or reshapes [docs-generated-map](2026-05-21-docs-generated-map.md):
if the docs move to node_modules, "index the copied subtree" becomes "point at the
package's own index" instead.
