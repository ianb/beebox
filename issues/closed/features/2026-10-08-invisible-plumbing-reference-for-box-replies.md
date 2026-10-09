---
title: "One user-facing-language reference for everything the box agent says: invisible plumbing, lay translations, and when to switch registers"
workstream: user-facing-language
resolution: implemented
area: beebox
needs: [design]
labels: [prompts, ui-sensibility, competitive-research]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-imbue-studio-research — reading Studio's `user-facing-language.md`
---

The boxholder (2026-10-08): this deserves an issue.

Imbue Studio keeps one 96-line reference,
`.agents/shared/references/user-facing-language.md`, that every reply, progress
title, skill "report to the user" step, and notification is held to. The
output style and the agent instructions both defer to it, "so a rule about
what the user hears lives in this file and nowhere else"
([research](../../../research/imbue-studio/chat-app.md), section 6). Its shape:

- **Who is reading.** A non-technical person who asked for an outcome and
  "does not run commands, read code, or know the tools you use". Every
  technical noun is a word they skip to find the outcome.
- **Invisible plumbing, as a table.** Version control, tests and checks, code
  locations, build tools, commands, agent machinery, where it runs, error
  text. For each: the words the user does not hear, and the lay translation
  for when the outcome depends on it ("your work is saved and I can undo it",
  "checked that it works", "one check still fails: what it means for them").
- **Bad/good pairs** for the common leaks ("Ran pytest: 47 passed" becomes
  "Checked it all works"; a `KeyError` becomes "Some of the contacts had no
  email address, and it choked on those. Handled now").
- **When to switch registers,** three triggers only: the user used the
  technical term first, the user asked for the detail, or the user must act
  on it themselves. "Print a literal command only when the user must run it
  themselves. Never print one you will run."
- Enforcement where it can be enforced: a build check fails on retired
  vocabulary in the shell's prose ("application", "web service").

Bee Box has the pieces in three places and no single reference: the
glossary's user-facing register (`beebox/docs/glossary.md`), the agent
guide's "Speak the User's Language" section from the
[vocab leak fix](../bugs/2026-08-08-implementation-vocab-leaks-into-ui.md),
and the STE rules the briefing and chat prompts carry. None has the plumbing
table or the register-switch triggers, and the box agent's replies still name
commits, paths, and `bbx` commands when the person did not.

## Shape

- One box-side reference the agent guide loads (bbx-context territory), with
  the plumbing table translated to Bee Box's own machinery: git and wakeup
  commits, `bbx` commands, procedures and schedules, cards and paths,
  connectors, the secret store, validation and doc checks.
- The glossary stays the term-by-term authority; this file is the rule for
  everything that is not a term.
- The same reference governs chat replies, Telegram, notifications, and
  schedule run summaries, since the person reads all four.
- A knowledge audit scenario per register trigger, on the
  `speak-users-language` audit's pattern.

Tension: the boxholder is technical and often does want the command. The
three triggers are the answer, not a per-box setting; the reference must say
so plainly so the agent does not swing to vagueness.

## Resolution (user-facing-language, 2026-10-09)

Closed by the user-facing-language merge to main.

- The reference is a box doc, `beebox/docs/box/speaking-to-the-person.md`
  (shipped as `box-docs/speaking-to-the-person.md`): who is reading, the
  surfaces it governs, the plumbing table in Bee Box terms, bad/good pairs,
  and the three triggers. Imbue Studio is credited.
- The always-loaded rule is one passage in the guide's SPEAKING section
  (rows `speaking.invisible-plumbing`, `speaking.register-triggers`), which
  points at the doc. The chat prompt defers to SPEAKING.
- Audits: `speak-outcome-not-mechanics`, `speak-register-trigger-asked`,
  `speak-you-on-cards`.
