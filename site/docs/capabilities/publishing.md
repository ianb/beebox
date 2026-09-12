---
description: "Turns a box document into a shareable external web page, at whatever access level you choose, as a deliberate and reversible act."
---
# Publishing

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Publishing takes a document out of the box and serves it on the open web,
under your control.

**What it does for you**

- Turns a box document into a self-contained web page that needs nothing
  outside itself to render.
- Lets you choose who can reach it: fully public, a secret unguessable link,
  or restricted to named accounts you allow.
- Keeps publishing a two-step, reversible act: draft and review before it
  goes live, revoke later to take the page and everything backing it down
  together.
- Serves every page marked out of search indexes and caches, under a policy
  that blocks it from calling out elsewhere.
- Records who opened an account-gated page, delivered back as a memo.

**What it needs**

Publishing infrastructure provisioned once by whoever runs the box (a
Cloudflare account, set up through a single command). See
[../install/index.md](../install/index.md).

**How it works, briefly**

Drafting a page renders a box
document into one self-contained page and scans it for secrets or references
that would leak outside the box before it can be saved. Going live and
revoking are separate, explicit steps. A page with a reply form holds
submissions on the publishing service; the box pulls them in as ordinary
cards the next time it wakes up, rather than the page writing into the box
directly.

**Limits**

A reply form only works on pages set up with a submit block; a fully public
page cannot carry one, to prevent it being flooded with unwanted
submissions. The documentation flags the reply-form authoring path itself
(the interface to add a submit block when drafting) as not yet built, even
though the receiving side is complete. Check before relying on it.

**Go deeper**

[../reference/cards/pub-submission.md](../reference/cards/pub-submission.md),
[../reference/bbx-commands.md](../reference/bbx-commands.md)
