---
title: "Apostrophes are lost in slugged filenames and the titles derived from them"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-vocab-sweep — split out of 2026-08-08-markdown-not-rendering-in-agent-output while sweeping vocabulary issues
priority: normal
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
[markdown-not-rendering](../closed/bugs/2026-08-08-markdown-not-rendering-in-agent-output.md)
(which the vocab-sweep workstream is resolving) so it doesn't close with that
issue while unexamined.

## Traced 2026-09-12 — two layers, and the display layer is the fixable one

The mechanism guessed above is right. Both halves confirmed:

**Slugging.** `safeDirectoryName` (`beebox/src/connectors/gmail-mime.ts:36`)
builds a thread's filename with `.replace(/[^\d\sA-Za-z-]/g, "")`, which drops
the apostrophe, then `.slice(0, 40)`, which is the mid-word "14 Augu"
truncation in the same citation. Both are reasonable for a *filename* and are
not worth changing: the card keeps the real text in its `subject:` field.

**Derivation.** The citation chip is `{% source %}`
(`beebox/src/frontend/src/components/Source.tsx:67`), whose label comes from
`refLabel` (`beebox/src/frontend/src/lib/ref-label.ts`). It is handed a ref
STRING and nothing else, so it derives the label from the basename —
`_`/`-` to spaces, drop `.<type>.card`. It has no access to the target card, so
the apostrophe cannot come back no matter how the humanizer is written. The same
derivation exists twice more: `displayFromRef`
(`beebox/src/core/markdoc/emit-tags.ts:41`) for backend markdown emission, and
`displayName` (`beebox/src/frontend/src/lib/display-name.ts`), whose docstring
already states the intended rule — "Where a card's frontmatter `title:` is
available it wins over this".

So the fix is not a regex change, which is what makes this bigger than it looks:
the citation renderer needs a way to resolve a ref to its target's stored
display text (`title:`, or `subject:` for an email thread) and fall back to
humanizing only when there is none. That means a lookup the chip does not have
today — the shape of it (batch resolve in the page's data, a tRPC call, or
carrying titles on the refs the body already parsed) is the real decision here,
and it also determines whether the three derivation sites converge on one
helper.

No code changed. Filed traces only, so whoever picks this up starts from the
owners rather than the symptom.
