---
title: "An @-include line in an instruction file renders as stray text; show it as an included-file link"
workstream: card-reading
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
resolution: implemented
---

**Closed:** Implemented on worktree-card-reading. Include lines render as link, missing or not-viewable rows in AGENTS.md/CLAUDE.md files the app can open (such as _content/AGENTS.md). The box's root AGENTS.md is not viewable in the app by design; that is accepted, not a gap.

Agent instruction files (`AGENTS.md`, `CLAUDE.md`) include other files with a
line that starts with `@` and a path. The stock test box's `AGENTS.md` opens
with:

```text
@.beebox/agent-guide.md
@_content/briefing.md
```

When a person opens such a file in the box, the markdown renderer treats these
lines as ordinary text. Adjacent lines join into one paragraph, and
underscores in paths such as `_content/` can be read as emphasis. The result
looks broken.

The fix is a small widget for an include line: say that the file includes
another file, and link to that file. Mostly a label and a link; it need not
show the included content.

## Open questions

- Which files get this treatment: only files named `AGENTS.md` or
  `CLAUDE.md`, or any markdown file whose line is only `@<path>`.
- Paths resolve relative to the including file's folder (the harness rule);
  a path that does not exist should still render, marked as missing.
