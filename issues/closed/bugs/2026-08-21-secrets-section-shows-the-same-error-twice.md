---
title: "The admin Secrets section shows the same error message twice"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — reading the admin page's secrets surface
resolution: implemented
---

The Secrets section runs two queries, `secrets.boxStatus` and
`secrets.machineView`, and renders one alert per failure
(`beebox/src/frontend/src/components/admin/SecretsSection.tsx:94-95`).
Both queries fail for the same reasons — no owner session, an unreadable store —
and both report the same sentence, so the panel prints the identical alert
twice.

Observed on `/admin`: "secrets management requires an authenticated owner
session — open-access does not qualify (the store is machine-level, spanning
every box on this host)" rendered once for each query, one under the other.
