---
description: "Put one page from your box on the public web from material you already keep, with an explicit go-live and an explicit takedown."
---
# Publishing from your cards

There is something in your box other people should see: a page about a project, a
recipe for friends, a reference someone keeps asking you for. You do not want a
content system, another account, or a copy that drifts from the version you
maintain. A **box** is one directory of your data, a **card** is one markdown file
in it, and **the agent** is the coding agent that renders one of those cards into
a page.

**What you do.** Ask the box to draft a page from a document you already keep.
Read the draft. Say to go live. Later, say to take it down. Choose whether the
page is open to anyone or restricted to named accounts.

**What the box does.** Drafting renders one box document into a single
self-contained page and scans it for secrets and for references pointing outside
the published bundle, refusing to commit a draft that fails the scan. Going live
and revoking are separate explicit commands, so nothing reaches the public web as
a side effect of editing. A page can be fully public or gated to accounts you
name, with visitor logging on the gated kind. Taking a publication down is a
supported operation.

**What it needs.** Publishing infrastructure provisioned once by whoever runs the
box, through a single command against a Cloudflare account.
[Publishing](../capabilities/publishing.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Reply forms are half a feature and you should not
plan on them. The receiving half is built and live: submissions are validated as they
arrive, under size and rate limits, pulled into the box on its next wakeup as
pub-submission cards, and handled as untrusted outside text that can become a note
or a question but can never authorize an action. The producing half does not
exist: no path in the software renders a page carrying a form, so a reader cannot
currently encounter one. A form could not go on a fully public page in any case,
to stop it being flooded.

**What makes it possible**

- **Publishing with an explicit go-live and takedown** ([publishing](../capabilities/publishing.md)): going live and revoking are separate commands, so nothing reaches the public web as a side effect of editing a card.
- **Typed cards with validated fields** ([cards](../concepts/cards.md)): a reply arrives as a pub-submission card, validated as it lands and handled as outside text that can become a note or a question but never authorize an action.

**Read next.** [Your data and safety](../10-your-data-and-safety.md),
[pub-submission](../reference/cards/pub-submission.md),
[doc](../reference/cards/doc.md).
