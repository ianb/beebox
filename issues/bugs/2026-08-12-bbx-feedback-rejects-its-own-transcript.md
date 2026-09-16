---
title: "`bbx feedback` can fail on whitespace it introduced itself"
workstream: unattached
area: beebox
labels: [cli, feedback]
filed-by: agent
discovered-by: agent
discovered-in: main session — bbx feedback triage from a real box
priority: normal
next-action: discuss
---

> **Re-encountered 2026-09-16 — resolving feedback also fails.** Moving
> committed feedback files into `_config/feedback/resolved/` on a production box
> failed the pre-commit markdownlint (MD009) for 17 of 22 files. The session
> transcripts carry single trailing spaces. The same files were committed in
> `_config/feedback/` without error, so the lint applies to `resolved/` and not
> to its parent. `feedback-review/collect.ts` now undoes the move on a failed
> commit. The 17 items stay unresolved until this is fixed. Priority may be
> stale.

> **Checked 2026-08-18 — still live, nothing changed.** Tagged `reconfirm`;
> removed. `src/cli/commands/feedback.ts:173` still does
> `lines.push("", "## Session Context", "", context)` — the raw transcript,
> with no per-line normalization, exactly as filed. No commit has touched this
> file since. The one-line fix the issue asks for (trim trailing whitespace per
> line on the way in) is unimplemented, and so is the wider sweep for the same
> shape elsewhere.

`bbx feedback` failed on its first invocation because of a trailing space in the
message it was given. It appends the session transcript verbatim
(`src/cli/commands/feedback.ts:138` pushes the raw `context` string with no
per-line normalization), writes the file, and commits it — and the commit
tripped markdownlint MD009 (trailing whitespace). The caller had to strip the
space by hand and retry.

So the tool rejected its own output, over formatting it introduced rather than
anything the person meant.

## Be permissive about what a person typed

The principle, from the boxholder: **strip the whitespace, don't validate it.**
A capture tool should accept whatever it is handed and normalize on the way in —
not refuse input because of characters nobody chose. Trailing whitespace in a
dictated or pasted message carries no meaning; failing on it does.

Concretely: trim trailing whitespace per line when embedding the transcript,
leaving substantive text untouched. Then look for the same shape elsewhere —
anywhere a capture path validates input it could simply normalize.

This matters more than its size suggests: `bbx feedback` is the channel for
reporting friction, so friction *in it* costs the reports that would have come
next.
