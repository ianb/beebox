# How comparable systems connect Google (OAuth) to a personal agent

*2026-07-28. Prompted by the boxholder's Google-OAuth friction (unverified-app
screen, restricted-scope verification) — "what do OpenClaw / Hermes / others
do?" A focused scan of how self-hosted agents and the surrounding tooling handle
Google account connection, with dispositions for beebox. Flat top-level
note (cross-cuts beyond the openclaw-hermes corpus).*

## Three models in the field

| Model | Who | Who sets up the OAuth app | Who holds tokens | Verification burden |
|---|---|---|---|---|
| **BYO credentials** | beebox, OpenClaw, most self-hosted MCP servers | the operator (own Google Cloud project) | the operator's box | operator's own, personal-scale → usually skip |
| **Managed auth broker** | Composio, Arcade, Nango, Pipedream, Paragon | the broker (pre-verified apps) | the broker's vault (Nango self-host = your infra) | none for the user — broker carries it |
| **Hosted verified app** | Anthropic Claude connectors, ChatGPT, Zapier | the vendor | the vendor | vendor passed CASA |

## What the named comparables do

**OpenClaw — BYO, same as us, with two nicer touches.** Its all-in-one Google
Workspace plugin ([`tensorfold/openclaw-google-workspace`](https://github.com/tensorfold/openclaw-google-workspace))
is **one plugin + one OAuth flow for six services** (Gmail, Calendar, Drive,
Contacts, Tasks, Sheets), and you still **bring your own** Google Cloud project +
OAuth client ([setup guide](https://fast.io/resources/openclaw-google-workspace-integration/)).
Two techniques worth noting:
- **"Desktop app" OAuth client type** (loopback redirect) rather than a Web
  client — sidesteps per-host redirect_uri registration.
- **Chat-driven OAuth** — you complete the grant in chat instead of pasting
  tokens into config. Both personal `@gmail` and Workspace accounts supported.
- Also reachable via **MCP** (Composio ships Gmail/Calendar toolkits "for
  OpenClaw").

**Hermes — MCP-mediated, BYO (inferred).** Direct docs on Hermes's Google auth
were thin; it's an MCP-first agent, so Google access rides whatever Google MCP
server the operator wires up — i.e. BYO creds, same as the MCP ecosystem below.
(Flagging the weaker evidence honestly.)

**The self-hosted MCP-server ecosystem — BYO, and it hits the *identical* pain.**
The popular Google Workspace / Calendar MCP servers
([taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp),
[nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp))
all use BYO OAuth creds via a `credentials.json` / env path, tokens never leave
the machine, ~25–40 min setup — and their docs literally warn that **"OAuth
tokens expire every 7 days unless you verify your consent screen"** ([roundup](https://calendarmcp.ai/blog/best-calendar-mcp-servers-2026)).
So the unverified-app friction we hit is a **universal BYO condition, not a
beebox defect.**

**Managed auth brokers — the middle path.** Composio / Arcade / Nango / Pipedream
host **pre-verified** OAuth apps and **vault + refresh** tokens, giving the agent
scoped per-user access **without the user creating a Google Cloud project or
facing verification** ([Arcade roundup](https://www.arcade.dev/blog/best-ai-agent-authentication-platforms/)).
Cost: a **third party custodies your Google tokens** — the direct opposite of
"your data, your box." **Nango is open-source and self-hostable**, so the broker
machinery can run on your own infra with credentials staying local
([Nango self-host](https://nango.dev/blog/best-self-hosted-api-integration-platforms-for-ai-agents/)) —
a genuine hybrid.

## Where beebox sits + dispositions

beebox is squarely in the **BYO** camp with OpenClaw and the MCP servers —
env-var client creds, operator's own domain/consent screen, tokens on the box.
This **validates the bet**; the friction is the price everyone in this camp pays.

- **confirm** — BYO is the right default for a "your data, your box" tool; don't
  become a hosted-verified custodian (that's what forces CASA). See
  [byo-google-oauth-self-host-story](../issues/decisions/2026-07-28-byo-google-oauth-self-host-story.md).
- **adapt** — OpenClaw's **one-plugin/one-OAuth-for-all-Google-services** + its
  **chat-driven grant**. beebox already has a shared server-wide Google
  connection + per-box service toggles and a web admin grant, so we're close;
  the transferable bit is presenting it as *one* connect action, and possibly a
  chat-initiated flow.
- **investigate** — **"Desktop app" OAuth client / loopback redirect** as a way
  to kill redirect_uri-registration friction for BYO operators (relates to the
  canonical-redirect_uri cleanup). Does it interact badly with our
  server-hosted (non-loopback) model? Open question.
- **investigate / later** — a **managed broker as an OPTIONAL** connect path for
  operators who won't do Google Cloud setup, with **Nango self-hosted** as the
  privacy-preserving variant. Ties directly to
  [investigate-composio-tool-layer](../issues/exploration/2026-07-09-investigate-composio-tool-layer.md).
  Default stays BYO; broker is opt-in convenience.
- **reject** — a beebox-hosted shared OAuth app (forces mandatory CASA +
  100-user cap + makes us everyone's token custodian).

## Downsides of the broker options (Composio vs Nango, 2026)

At personal/family scale the **dollar** cost is a near-non-issue (both free tiers
cover a handful of connections) — the real axes are **custody/security** and
**lock-in**.

**Composio — poor fit for our posture:**
- **Cloud-only token custody, and they were breached.** Composio holds tokens on
  their cloud (they've since added a customer-key "Zero Trust Proxy KMS"), but
  there is a documented **[Composio breach](https://www.scalekit.com/blog/composio-breach-agent-security)** —
  a concrete proof point that handing a SaaS your Google tokens carries real tail
  risk. Disqualifying for a "your data, your box" tool.
- **Per-tool-call pricing** ([pricing](https://aisotools.com/pricing/composio)):
  free 20K calls/mo, $29 → 200K, $229 → 2M, then **$0.299/1K overage**. Agentic
  multi-step workflows burn calls unpredictably; fine at family scale, ugly at
  volume.
- **Lock-in / flexibility** ([alternatives](https://www.arcade.dev/blog/composio-alternatives/)):
  you adopt Composio's action catalog and **can't connect external MCP servers**;
  no real self-hosting. Their action abstraction replaces our connectors.

**Nango — the plausible adopt, with one caveat:**
- **Free self-hosted gives exactly Auth + Proxy** ([self-host docs](https://nango.dev/docs/guides/platform/self-hosting)) —
  which is *precisely* the commodity primitive we'd want (token vault + refresh +
  a proxy) with **tokens staying on our infra**. Inspectable, customizable (MIT
  core).
- **Caveat: the sync engine + managed features are enterprise-gated** — "prod
  data syncs on self-hosted need an enterprise license"; the free self-hosted
  edition is deliberately Auth+Proxy-only (the community has asked them to
  clarify: [issue #5536](https://github.com/NangoHQ/nango/issues/5536)). **This
  is fine for us** — beebox has its own connectors/sync; we'd use Nango
  only for the auth/proxy layer, not its sync product.
- **Ops burden** is real but trivial at our scale (~1 Google integration); the
  "maintenance grows past 20–30 integrations" warning doesn't apply.
- Cloud pricing (if ever): free 10 connections/100k proxy req; paid tiers
  ~$50–$249/mo ([review](https://makerstack.co/reviews/nango-review/)) — but
  self-hosted-free is the relevant path.

**Bottom line for beebox:** Composio is the wrong shape (cloud custody +
breach + lock-in + per-call billing). **Nango's free self-hosted Auth+Proxy is
the one worth a spike** — it keeps tokens local and hands us the commodity
plumbing, leaving only our differentiated policy/filtering/advertisement layer to
build. The enterprise-gated sync engine is irrelevant since we don't use it.

## What Nango provides — and the slice beebox would actually use

Nango's full surface (900+ APIs): **Auth/OAuth** (flows, token refresh, scopes,
provider quirks, encrypted credential storage) · **Proxy** (automatic credential
injection + rate-limit backoff + retries) · **Syncs** (keep external data current,
2-way, RAG) · **Actions** (read/write ops) · **Webhooks** (receive/forward) ·
**Unified models** (normalize across APIs) · **Observability** (logs/metrics/
alerts per connection) · **Connect UI** (drop-in account-linking) · **agent
tool/MCP schemas** · multi-tenant isolation ([docs](https://nango.dev/docs/introduction)).

**We'd use only Auth + Proxy.** Syncs / unified models / webhooks / RAG are
Nango's headline value but **beebox already does that itself** (connectors →
card materialization), and they're the enterprise-gated part of self-hosted
anyway. So most of Nango is irrelevant to us — which is fine; the two we want are
in the free self-hosted tier.

### Benefits of Nango's Auth+Proxy over our direct access (today)

Direct access today = our own `google-auth.ts` OAuth + refresh, tokens stored per
box, each box calling `googleapis.com` directly. Adopting Nango's auth+proxy buys:

1. **No OAuth/refresh plumbing to own.** Nango runs the token refresh/expiry/
   provider-quirk loop — retiring most of `google-auth.ts` and shrinking the
   [reauth-health feature](../issues/features/2026-07-28-google-auth-expiry-health-and-notify.md)
   (Nango exposes connection status we can read instead of detecting `invalid_grant`
   ourselves).
2. **Tokens live in the proxy, not the box** — the box calls Nango's proxy, which
   injects the credential and forwards. This **is Tier-1 of the policy-proxy**
   ([google-auth-policy-proxy](../issues/features/2026-07-28-google-auth-policy-proxy.md)):
   the escape boundary + central custody, for free, self-hosted, tokens on our infra.
3. **Rate-limit backoff, retries, observability** per connection — for free vs.
   hand-rolled.
4. **Multi-provider runway** — 900+ APIs, so a future Microsoft/Notion/GitHub
   integration reuses the same auth+proxy instead of a new bespoke OAuth each time.

### What Nango does NOT give us (still our layer to build)

- **Escape-proof per-client content filtering** (label filtering as a boundary) —
  Nango's proxy is pass-through credential injection, not content policy.
- **Capability advertisement** (the box introspects its constrained view).
- **Per-client capability policy** (draft-not-send per box) — Nango's scoped
  action functions get *partway* (which actions a connection may call) but not
  general content filtering + advertisement.

**Upshot:** Nango can carry **Tier 1** (custody + proxy + refresh) of the
policy-proxy for free/self-hosted, halving that project; **Tier 2** (filtering,
capability advertisement, per-client policy) is the differentiated part we'd
still build on top.

## Net

The honest answer to "what do others do": **the self-hosted ones do exactly what
we do (BYO), and they eat the same warning.** The only way to make it
*frictionless* is to let a broker (or a hosted vendor) own the OAuth app and the
tokens — which trades away the local-data property. So the real menu is: keep BYO
(smooth the setup), or add an **opt-in broker** path (ideally self-hostable
Nango) for people who value convenience over local token custody.
