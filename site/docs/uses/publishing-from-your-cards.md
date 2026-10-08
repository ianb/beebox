---
description: "Put a page or small site from your box on the public web from material you already keep, with your approval to go live and a one-step takedown."
---
# Publishing from your cards

There is something in your box other people should see: a page about a project, a
recipe for friends, a reference someone keeps asking you for. You do not want a
content system, another account, or a copy that drifts from the version you
maintain. A **box** is one directory of your data, a **card** is one markdown file
in it, and **the agent** is the coding agent that renders one of those cards into
a page.

**What you do.** Ask the box to build a page or a small site from material you
already keep. The agent prepares it and gives you a link into the app. Open it,
read what is about to go out (the address, who it is for, the list of files, and
a scan for likely secrets), and enable it, or not. Later, disable it from the
same screen. Choose whether it is a public page at a name you pick or a secret
link you give only to the people meant to have it.

**What the box does.** The agent writes the site into the attached folder of a
publication card in the box and asks the box server to prepare it: build it if it
needs building, turn Markdown pages into web pages, scan the result, and upload
it. A new site stays off until a signed-in member of the box enables it. After
that the agent can refresh the content on its own, but any change to who can see
it, or to its address, waits for another approval. A failed build or scan leaves
the live version as it was, and disabling a site makes its address answer that it
is gone.

**What it needs.** A Cloudflare account and one web address for the box, set up
once by whoever runs the machine through the Admin page.
[Publishing](../capabilities/publishing.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** The documentation says this flow has not yet been
run against a real Cloudflare account, only against stand-ins, so expect first-use
problems. Sites restricted to named accounts are blocked in it. All of one box's
sites share a web address and so can reach each other's scripts and stored data;
the scan looks for secrets, and cannot judge whether a page is fit to show.
Published pages cannot collect replies.

**What makes it possible**

- **Publishing with an explicit approval and takedown** ([publishing](../capabilities/publishing.md)): a person enables a site in the app and disables it there, so nothing reaches the public web as a side effect of the agent editing.

**Read next.** [Your data and safety](../10-your-data-and-safety.md),
[doc](../reference/cards/doc.md).
