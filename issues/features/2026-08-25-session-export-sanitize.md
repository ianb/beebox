---
title: "bbx session export --sanitize: structure-preserving redacted transcript"
workstream: research-opencode
area: beebox
---

A chat or wakeup bug on a real box can't be shown to anyone: the boxholder rule is that
nothing from a live box reaches the public repo unvetted, and `bin/path-leak-check.ts`
only guards commits. There is no redacted transcript form.

OpenCode's `export --sanitize` (`packages/opencode/src/cli/cmd/export.ts`) replaces every
content field — text, tool input/output, reasoning, paths, titles, subtask prompts — with
`[redacted:<kind>:<id>]` while keeping message/part structure, ids, timing, token counts
and tool states verbatim. Ordering, retries, compaction and error shapes survive; the
words don't.

For beebox: a flag on the existing session rendering (`src/cli/lib/session-*.ts`)
that emits the same structure with contents replaced, so a bug report can carry the
shape of a broken session. Both engines' transcripts should go through it (Claude JSONL
and Codex `thread/read` via `load-history.ts`).

Source: [research/opencode/inspiration.md](../../research/opencode/inspiration.md).
