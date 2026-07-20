---
title: "Per-box secret management"
needs: [decision]
area: callback-box
---

API keys (Mistral, etc.) are configured per-box in `config/connectors/*.secret.json`. When a new box is created, it has no secrets — features like transcription silently fail with "API key not configured." There's no mechanism to provision secrets automatically or inherit them from a shared location.

Options to consider:
- A global/server-level secrets file that boxes inherit from by default
- `add-box.sh` could copy common secrets (mistral, etc.) from an existing box or a template
- A `cb secrets` command to list which secrets each box has/is missing
- Fall back to env vars more aggressively (the env var `CALLBACK_MISTRAL_API_KEY` exists but is commented out by default in setup)

For now: manually copy secret files to new boxes. See `docs/adding-a-box.md`'s "Connector secrets" section.

**2026-07-19 — a divergent pattern appeared.** The publish-pages feature stores its
Cloudflare credentials in a machine-level `~/.cb-publish.env` that the user must
`source` by hand, rather than in `config/connectors/*.secret.json`. So there are now
three answers in the codebase (per-box secret files, env vars, and a sourced dotfile),
and the publish connector — which runs on every `cb wakeup`, including on the
server — has no credential path in prod at all. Details and the coupled token-scope
question:
[pub Access setup via API](../features/2026-07-19-pub-access-setup-via-api-not-dashboard.md).
Worth deciding this alongside that item rather than separately.
