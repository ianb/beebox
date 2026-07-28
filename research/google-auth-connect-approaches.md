# How comparable systems connect Google (OAuth) to a personal agent

*2026-07-28. Prompted by the boxholder's Google-OAuth friction (unverified-app
screen, restricted-scope verification) — "what do OpenClaw / Hermes / others
do?" A focused scan of how self-hosted agents and the surrounding tooling handle
Google account connection, with dispositions for callback-box. Flat top-level
note (cross-cuts beyond the openclaw-hermes corpus).*

## Three models in the field

| Model | Who | Who sets up the OAuth app | Who holds tokens | Verification burden |
|---|---|---|---|---|
| **BYO credentials** | callback-box, OpenClaw, most self-hosted MCP servers | the operator (own Google Cloud project) | the operator's box | operator's own, personal-scale → usually skip |
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
callback-box defect.**

**Managed auth brokers — the middle path.** Composio / Arcade / Nango / Pipedream
host **pre-verified** OAuth apps and **vault + refresh** tokens, giving the agent
scoped per-user access **without the user creating a Google Cloud project or
facing verification** ([Arcade roundup](https://www.arcade.dev/blog/best-ai-agent-authentication-platforms/)).
Cost: a **third party custodies your Google tokens** — the direct opposite of
"your data, your box." **Nango is open-source and self-hostable**, so the broker
machinery can run on your own infra with credentials staying local
([Nango self-host](https://nango.dev/blog/best-self-hosted-api-integration-platforms-for-ai-agents/)) —
a genuine hybrid.

## Where callback-box sits + dispositions

callback-box is squarely in the **BYO** camp with OpenClaw and the MCP servers —
env-var client creds, operator's own domain/consent screen, tokens on the box.
This **validates the bet**; the friction is the price everyone in this camp pays.

- **confirm** — BYO is the right default for a "your data, your box" tool; don't
  become a hosted-verified custodian (that's what forces CASA). See
  [byo-google-oauth-self-host-story](../issues/decisions/2026-07-28-byo-google-oauth-self-host-story.md).
- **adapt** — OpenClaw's **one-plugin/one-OAuth-for-all-Google-services** + its
  **chat-driven grant**. callback-box already has a shared server-wide Google
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
- **reject** — a callback-box-hosted shared OAuth app (forces mandatory CASA +
  100-user cap + makes us everyone's token custodian).

## Net

The honest answer to "what do others do": **the self-hosted ones do exactly what
we do (BYO), and they eat the same warning.** The only way to make it
*frictionless* is to let a broker (or a hosted vendor) own the OAuth app and the
tokens — which trades away the local-data property. So the real menu is: keep BYO
(smooth the setup), or add an **opt-in broker** path (ideally self-hostable
Nango) for people who value convenience over local token custody.
