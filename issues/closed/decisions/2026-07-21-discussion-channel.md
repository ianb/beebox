---
title: "Pick a discussion channel for the soft launch"
workstream: open-source-readiness
resolution: implemented
area: docs
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

**Closed (decided) 2026-07-31 — Zulip.** Boxholder chose Zulip: live chat with
real threading (topics), the strongest anti-Discord on organization, free hosted
OSS tier and self-hostable (on-thesis). The forum is live at
[beebox.zulipchat.com](https://beebox.zulipchat.com/). GitHub
Discussions remains available as a secondary async record if wanted, but Zulip is
the primary channel.

Boxholder (2026-07-21): "Before release I need to decide on some discussion
channel. Like Discord but I dislike Discord." A pre-release decision — where
the friendly network asks questions and talks, beyond formal
[bug reports](../../features/2026-07-20-inline-bug-submission.md) (which go to
GitHub issues).

The choice follows from *what* about Discord grates:

- **No threading / firehose** → **Zulip**: threaded chat (message → topic),
  developer-loved, free hosted tier for OSS, self-hostable (on-thesis for an
  own-your-data project). The "chatty but organized" option.
- **Walled garden / not indexed / not yours** → **GitHub Discussions**: no
  new infra, co-located with the code + issue queue, async (fits
  low-attention friendly people), Google-indexed so answers accrue. Needs a
  GitHub account — fine for this audience.
- **Values / federation** → **Matrix/Element**: loudest own-your-data
  statement, but more setup + moderation burden.
- Rejected implicitly: Discord (disliked).

**Requirement (boxholder, 2026-07-21): live discussion, not async.** So a
forum (GitHub Discussions) is out as the primary — it's the wrong shape.
Live-but-not-Discord candidates:

- **Zulip** — live chat with real threading (topics), the strongest
  anti-Discord on organization; free hosted OSS tier, self-hostable
  (on-thesis). Lead candidate.
- **Matrix/Element** — live, federated, loudest own-your-data statement;
  more setup + moderation burden.
- Discord — disliked, out.

Decision deferred by the boxholder ("just file it, we can decide later").
GitHub Discussions may still make sense as a *secondary* async record (it's
where bug reports live), but the primary is live chat. Interacts with the
personal register — the channel should feel like a small room, not a product
community.
