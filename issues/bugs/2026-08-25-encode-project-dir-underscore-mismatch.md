---
title: "encodeProjectDir collapses `_` and `.`; Claude Code preserves them, so session discovery misses"
workstream: unattached
area: callback-box
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.239's resume-collision fix
labels: [sdk-update]
---

`encodeProjectDir` (`callback-box/src/core/chat/session/transcript-paths.ts`)
maps a cwd onto Claude Code's `~/.claude/projects/<dir>` key by collapsing every
non-alphanumeric character to `-`:

```ts
return cwd.replace(/[^\dA-Za-z]/g, "-");
```

Its comment asserts that "paths with `_`, `.`, spaces, etc. all collapse to the
same shape". Claude Code does not do that — it **preserves `_` and `.`**.
Re-verified on 2026-08-25 against the real store: the box path
`~/src/box-worktrees/tool_arg_preview/test1` has an on-disk project directory
`-Users-ianbicking-src-box-worktrees-tool_arg_preview-test1`, keeping the
underscores, while the name `encodeProjectDir` computes for that cwd does not
exist at all. The oldest affected directory dates to 2026-05-12, so this is
long-standing rather than a regression from any recent pin.

**Impact:** `getSessionLogPath` resolves to a directory that does not exist for
any box or worktree whose path contains `_` or `.`, and `history.ts` builds its
candidate enumeration from the same encoder — so chat history and session
discovery silently come back empty rather than failing loudly. Box slugs with
underscores or dots are ordinary, so this is reachable without anything unusual.

**Unsettled part:** the right fix is not just "preserve `_` and `.`". Claude Code
2.1.239 itself changed this encoding to stop `claude -c`/resume picking up
sessions from a path differing only by such characters, so the encoding is
upstream-owned and has moved at least once. Options worth weighing: mirror the
current upstream rule exactly and pin the assumption with a doctest that reads a
real directory; or stop reconstructing the name and instead resolve the project
directory by scanning `~/.claude/projects` for the entry whose transcripts carry
the expected `cwd`, which is immune to future encoding changes. The second is
slower but does not need re-verification on every SDK bump.

Related: [chat backend port hygiene](../code-quality/2026-07-18-chat-backend-port-hygiene.md).
