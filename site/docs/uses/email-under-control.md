---
description: "Name the threads worth watching, get replies drafted for your review, and teach the box where the rest of the mail belongs."
---
# Email under control

A few threads in your inbox matter and the rest is noise. You reread the same
thread to work out where it stands, and the decision you made in it lives nowhere
else. A **box** is one directory of your data, a **card** is one markdown file in
it, and **the agent** is the coding agent that reads the mail the box pulled in.

**What you do.** Say which threads matter, or write a rule that says it for you:
a Gmail search, a set of labels. Read the drafts the agent writes, edit them, and
send them yourself. When it asks where a kind of mail belongs, answer once.

**What the box does.** The Gmail connector keeps a deliberately small tracked
working set. A tracked thread becomes an email-thread card with one
email-message card per message, the untrusted body text in a separate file. A
named rule either tracks newly matching threads or hands them to a procedure,
under a rolling budget (25 threads in seven days by default) so a broad rule
cannot flood the box; a staged rule watches without acting. A reply becomes an
email-outbound card uploaded to Gmail as a draft for you to send, and the box
does not send mail itself. Triage files what arrives, raising a question card when unsure.

**What it needs.** Signing in with your Google account and a one-time setup you complete
yourself, called the hardest part of installing today.
[Gmail](../capabilities/gmail.md), [triage](../capabilities/triage.md),
[Google setup](../install/google.md), [Gmail setup](../install/gmail.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Untracked mail is absent from box search and the
agent's context; a command searches Gmail directly when a question needs it.
Sync happens on a wakeup rather than on a schedule, and on a fresh box scheduled
runs are off until you turn them on. Category rules do not rewrite themselves
from one answer. The whole Gmail path is verified in the code and has not been
watched working against a live Google account in the project's own checks.

**What makes it possible**

- **Triage** ([triage](../capabilities/triage.md)): each item is filed with a confidence level, and your answer is kept as a rule to apply next time rather than a one-off placement.
- **The questions loop** ([questions](../capabilities/questions.md)): when the rules do not cover a thread it asks instead of filing it wrong, and treats the rule you taught as the valuable half of your answer.
- **Procedures** ([procedures](../capabilities/procedures.md)): a rule can hand matching threads to a named process whose steps are prechecked, validated, and saved one at a time.

**Read next.** [Triage](../concepts/triage.md),
[questions](../concepts/questions.md),
[email-thread](../reference/cards/email-thread.md),
[email-message](../reference/cards/email-message.md),
[email-outbound](../reference/cards/email-outbound.md),
[procedure](../reference/cards/procedure.md).
