---
title: "investigate composio tool layer"
workstream: unknown
area: callback-box

---

> **Update (2026-07-28) — for the auth-broker / token-custody angle, resolved
> toward self-hosted Nango, not Composio.** After the Google-OAuth thread
> ([research](../../research/google-auth-connect-approaches.md)): Composio is
> cloud-only custody (+ a documented breach) with per-tool-call pricing and
> catalog lock-in — wrong for our "your data, your box" posture. **Nango's free
> self-hosted Auth+Proxy** keeps tokens local and can carry Tier-1 of the
> [policy proxy](../features/2026-07-28-google-auth-policy-proxy.md). This item's
> broader "Composio as a general tool layer" question still stands, but the
> auth/custody sub-question is answered: prefer Nango self-hosted.

Surfaced from the Rowboat review (`research/rowboat-review.md`): Rowboat leans on
**Composio** (`@composio/core`, ~125 refs) as its integration layer instead of
hand-building connectors.

**What Composio is:** a "tools-as-a-service" platform for AI agents — a catalog of
250+ pre-built app integrations (Gmail, Slack, GitHub, Notion, Linear, calendars,
CRMs…) with **managed OAuth**, exposed to an agent as callable function-tools or via
MCP. You add "send_email" / "create_issue" tools without building or hosting each
integration or its auth.

**The bet vs. ours:** we hand-roll **typed connectors** (`src/connectors/`, each with
real + fake implementations, `Connector.sync()`), which gives us ownership,
type-safety, testable fakes, and full control of the sync semantics — but every new
integration is real work. Composio trades that for breadth-fast + managed auth.

**Questions to answer:**
- **Self-hosted / source-available fit.** Composio is a hosted SaaS (their auth +
  their servers proxy the calls). That cuts against our local-first / own-your-data /
  fail-closed-key posture and the source-available release. Is there a self-hostable
  path, or is it inherently a cloud dependency (the same "local-first but…" trap
  Rowboat took heat for — see [release-cloud-provider-honesty](../closed/decisions/2026-07-08-release-cloud-provider-honesty.md), resolved: disclose plainly)?
- **Additive vs. replacement.** We already speak MCP. Composio exposes tools via MCP,
  so it could be a *breadth* add-on (long-tail apps we'll never hand-write) *without*
  replacing the core typed connectors (gmail, telegram, rss) we care about
  controlling. Where's the line — which integrations are worth owning vs. renting?
- **Sync model mismatch.** Our connectors do stateful `sync()` into the box
  filesystem (job cards, git history); Composio tools are request/response actions.
  Does that compose, or is it a different shape (actions the agent takes) than our
  pull-into-the-box connectors?
- **Auth custody.** Managed OAuth means tokens live with Composio, not in the box.
  For a personal box holding a family's accounts, is that acceptable?

**Disposition:** investigate — likely "adopt for long-tail *actions* via MCP, keep
hand-rolled typed connectors for the core *syncs* we own," but the self-hosted/auth
custody question gates whether it fits the source-available story at all.
