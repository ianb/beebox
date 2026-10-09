---
title: "The agent files a grant request; the boxholder approves it on the admin page or in chat"
workstream: unattached
area: beebox
needs: [design]
labels: [secrets, connectors, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-imbue-studio-research — Studio's latchkey permission requests
---

Today a box agent that needs a secret it is not granted, or a connector scope
the box has not authorized, can only tell the person what to run
(`bbx secrets set`, `bbx secrets grant`, the admin page). In Imbue Studio the
agent POSTs a permission request with a rationale and ends its turn; a hook
blocks any chained or piped form of that call so the chat can render an
approval card; the desktop app shows "Approving will let the agent…" with a
switch per permission; revocation is a toggle in the app, never chat
([research](../../research/imbue-studio/permissions-models-integrations.md), section 1).

The request-and-approve flow is worth adapting. The enforcement is not: Bee
Box keeps grants on the machine-level store at `server` or `agent` level
(`beebox/docs/secrets.md`) and OAuth scopes on the connector, and does not add
an HTTP gateway with a rule catalog. Studio's catalog cannot express its own
marketing example ("label emails but not send"), and plain outbound `curl`
bypasses it.

## Shape

- A request names the secret or connector scope, the declared use (the
  store's `uses` list already exists for this), and why now.
- It renders as a card the boxholder can approve on the admin page's Secrets
  section or in chat; the secrets plan already names a chat capture widget as
  a later chunk, and this is the grant half of it.
- A request is a standalone call that ends the turn, the shape the questions
  subsystem (`beebox/docs/questions.md`) already has.
- Approving writes the grant exactly as `bbx secrets grant` would; nothing
  about what code can do changes.

Tension: an agent that can ask for grants will ask often. The declared use
and the one-request-per-turn rule are the limits; the review of observed
purposes (`docs/secrets.md`, "Why a secret exists") is how over-asking shows.
