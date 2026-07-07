---
area: callback-box
needs: [design]
---

# Reference callback-box docs from node_modules instead of copying docs/generated/ into every box

Now that callback-box is a **library** (v2 boxes are packages that depend on it —
`callback-box/{cards,schema,view-widgets}` public specifiers, resolved through
node_modules / the workspace), the identical `docs/generated/` copy in every box
looks like redundant duplication we no longer need.

## What happens today

`generateDocs(boxRoot)` / `cb init` write a `docs/generated/` tree into each box,
and it's **the same contents for every box** — see
[docs-generated-map](2026-05-21-docs-generated-map.md), which notes "the per-box
`docs/generated/` tree is fully templated from this repo… every box gets the same
contents." `generateDocs` re-syncs it on events (e.g. chat-session start,
`core/chat/session/index.ts:175`), so it's a recurring write into box files.
Several places special-case this subtree because it's cb-owned, not box-owned:
`install-validation-hooks.ts` (skips it in validation), `validation-ignore.ts`,
`list-cards.ts:42`, and the MAP generator hides it.

## The idea

Since the box already resolves `callback-box` from node_modules, the identical
docs could **live once in the package and be referenced**, not copied per box:
`node_modules/callback-box/docs/generated/…` (or wherever the package ships
them). The box's CLAUDE.md already `@`-includes the agent guide by path
(`docs-gen/claude-md.ts:22`, `@.callback-box/<AGENT_GUIDE_FILE>`) — that include
could point into the resolved package instead.

Benefits: no per-box copy or re-sync churn, one source of truth (no template
rollout drift for these docs — which parks silently on un-tracked boxes), smaller
box repos, and the special-case "skip cb's generated docs" logic largely goes
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
  `node_modules/callback-box/…` from a box's CLAUDE.md (relative path across the
  package boundary) and that validation/MAP/`list-cards` special-casing updates to
  match the new location.
- **Version skew.** A copied doc matches whatever `cb init` last ran; a referenced
  doc matches the installed package version. The latter is arguably *more* correct
  (docs track the code the box actually runs), but worth stating.

This likely subsumes or reshapes [docs-generated-map](2026-05-21-docs-generated-map.md):
if the docs move to node_modules, "index the copied subtree" becomes "point at the
package's own index" instead.
