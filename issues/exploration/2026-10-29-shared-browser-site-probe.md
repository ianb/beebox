---
title: "Shared browser: which real sites challenge or block the server IP"
workstream: shared-browser
area: beebox
labels: [shared-browser]
filed-by: agent
discovered-by: agent
discovered-in: worktree-shared-browser — embedded browser research
---

A shared browser on the server egresses from the one datacenter IP that all
boxes share. No published test measures how bot-protection vendors treat that
IP compared with a residential one
([site-reality.md](../../research/embedded-browser/site-reality.md)). The
choice between running the browser on the server and on the person's own
network (the Mac app VM or a home relay) depends on the answer.

Probe: open 10 to 15 sites the boxholder actually uses (email, bank, shops,
ticketing, a social network, Google sign-in) in a headless=new Chromium from
the server IP and from a residential IP. For each, record the challenge type
(none, click-through, captcha, block, login refused). The person clicks
through; nothing logs in with real credentials without the boxholder present.

Needs the boxholder's yes: it touches the production host or a paid VM, and
the site list is personal. Keep the per-site results in the private issue
repository; put only counts by challenge type in the public corpus.
