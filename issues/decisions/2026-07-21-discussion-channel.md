---
title: "Pick a discussion channel for the soft launch"
needs: [decision]
area: docs
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
---

Boxholder (2026-07-21): "Before release I need to decide on some discussion
channel. Like Discord but I dislike Discord." A pre-release decision — where
the friendly network asks questions and talks, beyond formal
[bug reports](../features/2026-07-20-inline-bug-submission.md) (which go to
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

**Agent recommendation:** start with **GitHub Discussions only**. Lowest
effort, honest, already where the repo lives, matches "not promoting hard."
Add Zulip later *only if* the group wants real-time — don't run two channels
at launch (a quiet second channel reads worse than none). Interacts with the
contribution stance (bug reports invited, PRs not) and the personal register
— the channel should feel like a small door next to the code, not a product
community.
