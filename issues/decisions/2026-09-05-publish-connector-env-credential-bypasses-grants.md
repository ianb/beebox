---
title: "The publish-submissions connector can spend a Cloudflare credential with no store grant"
workstream: unattached
area: beebox
labels: [secrets, publish]
filed-by: agent
discovered-by: cross-model review
discovered-in: worktree-transition-cleanup — closing the secret-store transition window
priority: important
---

Every connector credential now resolves from the machine secret store under a
per-box grant, and `bbx secrets revoke` is final
(`docs/implemented-plans/secret-custody.md`). One path is outside that model.

`PublishSubmissionsConnector.resolveStore()`
(`src/connectors/publish-submissions.ts:104`) reads the box's `publish/<slug>`
store entry, and when there is none falls back to `r2ConfigFromEnv()`
(`src/services/publish-remote-store.ts:115`), which takes `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_R2_BUCKET` straight from the process
environment. A box with no grant — or one whose grant was revoked — can still
spend that token.

This is not a leftover of the transition window. `r2ConfigFromEnv` is documented
as the deliberate escape hatch that mirrors wrangler's own `CLOUDFLARE_API_TOKEN`
precedence, and `src/publish/lifecycle.ts:102` uses it for the laptop CLI, where
it is the right thing.

**How reachable it is today.** Low. The three names are in neither env allowlist,
so a hub-spawned box child and every spawned agent, `bbx wakeup`, and scheduled
`runs:` command are already denied them; they are absent from the production
`.env`. Reaching this path takes an operator deliberately exporting Cloudflare
credentials into the server's own environment.

**The decision.** Whether the connector path should keep the wrangler-convention
override at all. Dropping `?? r2ConfigFromEnv()` from
`publish-submissions.ts` alone would leave the laptop CLI's use intact and put
every server-side connector credential behind a grant. The cost is that an
operator who does configure R2 by environment today would find submissions
silently unconfigured. Either answer is defensible; the current state is the one
that is not written down anywhere.
