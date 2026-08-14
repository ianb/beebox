---
title: "`cb feedback` can fail on whitespace it introduced itself"
workstream: unattached
area: callback-box
labels: [cli, feedback]
filed-by: agent
discovered-by: agent
discovered-in: main session — cb feedback triage from a real box
next-action: reconfirm
---

`cb feedback` failed on its first invocation because of a trailing space in the
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

This matters more than its size suggests: `cb feedback` is the channel for
reporting friction, so friction *in it* costs the reports that would have come
next.
