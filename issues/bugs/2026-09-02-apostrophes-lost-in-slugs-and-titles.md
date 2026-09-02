---
title: "Apostrophes are lost in slugged filenames and the titles derived from them"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-vocab-sweep — split out of 2026-08-08-markdown-not-rendering-in-agent-output while sweeping vocabulary issues
---

"Wren's" renders as "Wrens" and "Nana Odette's" as "Nana Odettes" in tabs,
menus, and citations. First collected in the onboarding field-test run
(dentist-email activity): a citation read `[→ thread Reminder Wrens check up
Thursday 14 Augu reminder: …]` — apostrophe gone (and that one also truncated
mid-word, "Augu").

The likely mechanism: filenames are slugged without apostrophes
(`Wrens_Checkup.…`), and display titles are then *derived from the filename*
(humanize: underscores to spaces) instead of from stored display text, so the
apostrophe cannot come back. If so, the fix is at the derivation layer — keep
a true `title:` where one exists and only humanize as a fallback — or make the
slugger preserve a marker. Not yet traced to the responsible code; that is the
first step.

This is a slugging/derivation bug, not a vocabulary problem — split out of
[markdown-not-rendering](2026-08-08-markdown-not-rendering-in-agent-output.md)
(which the vocab-sweep workstream is resolving) so it doesn't close with that
issue while unexamined.
