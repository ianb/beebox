---
title: "Community discussion forum (Zulip) — set up, monitor, and integrate"
area: docs
filed-by: agent
discovered-in: main session — boxholder created the forum during soft-launch prep
labels: [soft-launch]
---

A public discussion forum for the project now exists on Zulip:
[callback-box.zulipchat.com](https://callback-box.zulipchat.com/). It's listed in
the root `README.md` under Community. This issue tracks turning "a Zulip org
exists" into "a forum that works for a soft launch."

## Listing (partly done)

The README links the **org home** (`callback-box.zulipchat.com`), not the
per-user DM-narrow URL the boxholder first had. The right long-term listing is a
**Zulip invite link** (org-configurable), which ties into
[invite-links](2026-07-20-invite-links.md) — use a real join URL once one exists,
and mirror it wherever else the project points newcomers (the planned
[GitHub Pages site](2026-07-20-github-pages-site.md), `docs/`, the repo About).

## Open questions

- **Who monitors it, and how?** A forum nobody watches is worse than none — a
  first question that sits unanswered during a soft launch reads as abandonment.
  Is this a manual "check Zulip" habit, or does it get wired to a box? Zulip has
  an API and webhooks; a connector that lands new-topic notifications as cards is
  plausible, but decide before building — this is exactly the
  "arrange context, don't automate judgment" line: the box could surface threads,
  a human still answers.
- **Does the box agent participate at all?** Tempting and risky. An agent posting
  to a public forum under the project's name is an outward-facing action with
  real failure modes (wrong answer stated confidently, tone, hallucinated
  features). If ever, it's draft-for-human-review, never autonomous posting.
- **Stream/topic structure.** A soft launch needs little — a general stream, a
  help stream, maybe show-and-tell. Don't over-structure before there are people.
- **Moderation + code of conduct.** Even a soft launch to one's network wants a
  one-paragraph CoC and a spam plan before the invite goes wide. Cheap now,
  expensive to retrofit after an incident.
- **Zulip vs. the alternatives — is this decided?** Zulip's threading model fits
  a technical project well, but GitHub Discussions would sit next to the code and
  need no second account. If Zulip is settled, note why; if not, this is a
  `decision` worth making before promoting the link.

## Why it's soft-launch scope

The forum is the place a "showing it to people in my network" launch sends people
to react. It should be **ready before the launch, not after** — an invite that
lands someone in an empty, unmonitored org undercuts the whole soft-launch goal.
Coordinate with the [soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)
decision and the curation running in `worktree-open-source-readiness`.
