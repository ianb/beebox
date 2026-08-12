---
title: "Encryption at rest — decide what it would actually mean here"
workstream: unknown
area: callback-box
needs: [design, decision]
labels: [security, soft-launch]
---

"Encrypt at rest" sounds obviously good, and the boxholder's instinct is that
it might be — but neither the threat it defends against nor the scope is
settled. *Encrypt with what? How much resting?* Those are the right questions,
and this issue exists to answer them before anything is built.

## What's already encrypted, and what isn't

`docs/security-report.md` §2 shows the credential layer is handled: invite and
password-reset capabilities and mobile device tokens are **SHA-256 hashed at
rest**, 0600, atomic + locked. Those are one-way hashes of secrets — the right
treatment for credentials, and not what this issue is about.

**Nothing covers box content.** The report has no data-at-rest section for the
substance: card files, git history, transcripts, annexed media, `events.db` /
`usage.db`, connector caches. On the server those sit as ordinary files under
the box directory.

## The question that decides everything: against whom?

"At rest" only means something relative to an attacker. The plausible ones here
want very different mechanisms, and some are already covered:

- **A stolen or decommissioned disk / the hosting provider's storage layer.**
  Full-disk or volume encryption answers this and nothing else needs to change.
  Cheapest by far; likely already partly true depending on what Hetzner does
  with volumes — *check before building anything.*
- **A compromised host, or anyone with a shell.** Full-disk encryption does
  **nothing** here: the volume is mounted and the app is reading it. Defending
  this means keys the running server doesn't hold, which collides with the next
  section.
- **Backups and anything that leaves the machine.** Probably the best
  value-per-effort, and it interlocks with
  [no automated backup story](../decisions/2026-08-07-server-backup-story.md)
  — if a backup mechanism is being designed anyway, "encrypted in transit and at
  the destination" is far cheaper to build in now than to retrofit.
- **The boxholder's own laptop.** FileVault likely already covers local boxes;
  worth confirming rather than assuming.

## The tension that makes this hard

**The agent has to read the box to do anything.** A box exists so an agent can
process its cards, search it, summarize it, and act on it — so the running
system needs plaintext, continuously, for essentially all of it. That rules out
end-to-end encryption in the usual sense without redefining the product.

Which means the honest ceiling for content encryption is roughly: *protect the
bytes when the process isn't running or when they're somewhere other than the
live server.* That's real value — disk theft, provider access, leaked backups,
a decommissioned volume — but it is not "your host can't read your data," and
the issue should not be written up as if it were.

Anything stronger needs a specific carve-out: a subset of cards the agent never
needs to read, or a key the boxholder supplies per session, with the box
degraded while it's absent. Both are plausible; both are a different product
decision, not a deployment change.

## Open questions

- Does the provider already encrypt the volume? If so, what does that actually
  defend against, and is the marginal gain of anything further worth it?
- Is there a category of box content that deserves stronger treatment than the
  rest — connector credentials on disk, `~/.cb-auth.json`, `.env` — where the
  agent-needs-plaintext argument doesn't apply?
- Does `git-annex` change the picture for media, given annexed files are
  content-addressed blobs?
- What would this cost operationally — key custody, recovery when a key is lost,
  and what happens to `cb` running unattended on a scheduler?

## Related

- [no automated backup story](../decisions/2026-08-07-server-backup-story.md)
  — decide these together; encrypted backups are likely the concrete win here.
- [Cloudflare Flexible SSL leaves edge-to-origin plaintext](../bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md)
  — encryption *in transit*, and a live gap. Worth fixing before spending
  effort on at-rest: today the bytes cross the public internet unencrypted on
  one leg, which is a strictly larger exposure than a powered-down disk.
