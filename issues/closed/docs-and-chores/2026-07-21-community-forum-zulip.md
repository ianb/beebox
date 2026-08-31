---
title: "Make the community forum (Zulip) findable across the project's surfaces"
workstream: unknown
area: docs
filed-by: agent
discovered-in: main session — boxholder created the forum during soft-launch prep
labels: [soft-launch]
resolution: implemented
---

> **Superseded 2026-08-31.** The community moved to the
> [Bee Box Discord server](https://discord.gg/FQYn6zyv); current public surfaces
> link there.
>
> **Originally done 2026-08-06.** The Zulip forum was live at https://callback-box.zulipchat.com/
> and linked in the root README under Community — the soft-launch discussion-channel
> gate is satisfied. Any further cross-surface links fold into the README front-door
> gate.

The project's discussion forum was live on Zulip:
[callback-box.zulipchat.com](https://callback-box.zulipchat.com/). It was listed in
the root `README.md` under Community. This is a small **findability** chore, not a
build.

## Settled posture (2026-07-21, boxholder) — keep it light

- **Monitoring:** the boxholder hangs around and monitors it manually, under his
  own name. No connector, no box-agent participation, no automated triage. This
  is deliberate — don't propose wiring it to a box.
- **Weight:** no code of conduct, no moderation apparatus, no stream taxonomy up
  front. It's a small forum for people in his network; keep it that way.

So the earlier open questions (who monitors, does the agent post, CoC, and
platform choice) were **closed by decision** — the operating posture remains
light and human, while the platform is now Discord.

## What's left: just make it findable

The one real need — *"it needs to be noted so people can find it."* The README is
done; the rest is the other places a newcomer looks:

- **A Zulip invite link** rather than the bare org URL, so joining is one click —
  see [invite-links](../features/2026-07-20-invite-links.md). Swap it into the
  README once it exists.
- **The [GitHub Pages site](../../features/2026-07-20-public-site.md)** should
  link it when that lands.
- **The GitHub repo's About/description** (the sidebar link field) — a one-time
  setting, easy to forget.
- **`docs/`** where a new user first arrives (the install docs are the likely
  entry point).

Close this once the forum is reachable in one step from the places a soft-launch
visitor actually starts.
