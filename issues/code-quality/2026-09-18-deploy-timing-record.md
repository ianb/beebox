---
title: "Deploys keep no timing record, so \"are deploys getting slower\" is unanswerable"
workstream: deploy-maintenance-page
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked whether deploys have been taking longer
---

The boxholder asked whether deploys have been getting slower and more
frequent. Answering it meant inferring each deploy's duration from the log
file's mtime minus the start time encoded in its filename
(`beebox/deploy/.deploy-logs/<UTC>-<sha>.log`). The logs themselves carry no
timestamps, so nothing inside a log says when a step began, when the services
stopped, or when they came back.

What a record should hold, per deploy: start, end, outcome, and the downtime
window (`systemctl stop` at `beebox/deploy/deploy.sh:507` to the restart at
`:798`) — that window is what a person actually experiences.

Per-line timestamps in the deploy log would also locate a slow step. The
2026-09-17 03:27 deploy took 8.0 minutes against a 3.8-minute median and
nothing in its log says which part was slow.

A record makes two other things possible: an honest estimate on the
[maintenance page](../features/2026-09-18-deploy-maintenance-page.md) rather
than a hardcoded "a few minutes", and a signal when a deploy overruns its
usual time instead of silence until it finishes or dies.
