---
title: "A deploy blacks the site out with a bare 502; serve a maintenance page instead"
workstream: deploy-maintenance-page
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder hit a deploy window and could not tell an outage from a restart
---

While a deploy runs, nginx answers every request with its default 502 page.
Nothing says whether the site is restarting or broken, so the boxholder cannot
tell a four-minute deploy from a two-hour outage.

## Measurements (2026-09-18, 21 deploy logs on disk)

- Completed deploys: median **3.8 minutes**, minimum 3.5, maximum 8.0.
- The site is down for nearly all of it. Services stop at
  `beebox/deploy/deploy.sh:507` (`systemctl stop beebox-hub beebox-scheduler`)
  and restart at `:798`, with per-box migrations in between.
- **21 deploys in about two days**, in clusters. Every commit to `main` that
  touches a shipped path deploys, so hitting a window is common.

## What to build

The deploy writes a marker before stopping the services and removes it after
the restart. nginx serves that marker's page for 502s
(`error_page 502` in the one `location /` block written by
`beebox/deploy/hetzner/setup-server.sh:371-397`; note the block is created
at provisioning, so an existing server needs the same drop-in treatment
`deploy.sh` already uses for systemd units).

The page says the site is updating, when the deploy started, and that it
usually takes a few minutes. It should be honest when a deploy has overrun:
past roughly ten minutes the wording should stop promising a quick return.

## Privacy constraint (boxholder, 2026-09-18)

The 502 page is unauthenticated: anyone who hits the host sees it. The
boxholder: "I think a commit message is more public than we'd want on a 502
page. Maybe even ref..."

So the page carries the **start time only** — no commit subject, no ref, no
branch, no workstream. The identifying detail belongs where it is already
available to the boxholder alone: the desktop notification (`deploy.sh:1005`),
the deploy log, and any authenticated status surface.

Open question: if a marker is left behind by a deploy that died (see the
exit-code bug below), the page would claim "updating" forever. The marker
needs a timestamp the page can age out, and the next deploy must clear a stale
one.

Related: [deploys have no timing record](../code-quality/2026-09-18-deploy-timing-record.md).
Also relevant: `deploy.sh:80` treats any exit code ≥ 128 as a signal, so an
ssh failure (255) reports "interrupted, not a failure" and skips the queued
deploy — which is how a deploy can stop without finishing.
