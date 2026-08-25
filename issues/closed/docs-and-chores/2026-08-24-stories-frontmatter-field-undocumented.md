---
title: "`stories:` frontmatter field is undocumented and unparsed"
workstream: unattached
area: monorepo
filed-by: agent
discovered-by: agent
discovered-in: worktree-issue-selection — frontmatter census while building bin/issues
labels: [issues-queue]
---

Ten issues (six open, four closed, all filed 2026-08-21/23 by the user-story
verification work) carry a `stories:` list, e.g.
`stories: [connectors/configure-which-gmail-calendar-and-drive-content]`,
pointing at slugs in `callback-box/user-stories/catalog/2026-08-21.md`.

The field appears nowhere in `issues/CLAUDE.md`'s frontmatter schema, and
`workstreams-app/src/server/issue-domain.ts` (the one parser, shared by the
issue browser and `bin/issues`) ignores unknown keys, so it is invisible to
every tool: not a filter, not a facet, not in `--json`.

Decide one of:

- **Adopt it** — document it in `issues/CLAUDE.md` (a list of catalog story
  slugs the issue blocks or realises), parse it in `issue-domain.ts`, expose it
  as `--stories` in `bin/issues` and a facet in the browser. Useful if the
  story catalog keeps being the source of filed issues.
- **Drop it** — move the slugs into a body line ("Stories: …") on the ten
  files and leave the schema closed.

Either way the parser should stop swallowing unknown keys silently; surfacing
them (a warning in `bin/issues list`, or a `unknownKeys` field) is what would
have caught this at filing time.
