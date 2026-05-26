## Code Map

A single git monorepo containing four projects:

- **callback-box/** — Main system. CLI (`cb`), web server, connectors, procedure engine. The `cb` CLI is the universal interface for humans, agents, and tests.
  - `src/cli/` — CLI commands (wakeup, validate, execute-commands, etc.)
  - `src/core/` — Wakeup cycle, agent invocation, state, procedure engine
  - `src/connectors/` — External integrations (rss, gmail, etc.)
  - `src/webapp/` — Fastify server, API routes, SSE
  - `src/frontend/` — React UI
  - `src/schemas/` — Card type definitions
  - `plugins/` — Codex plugins (card-validator hook)
- **callback-clerk/** — Chrome extension. Talks directly to the hosted callback-box instance (auth via base URL + login).
  - `src/background/` — Service worker, message polling
  - `src/popup/` — Extension popup UI
- **cardworks/** — XML card library. Parsing, serialization, validation, JSX support. Consumed by callback-box via `file:../cardworks`.
- **agent-doctest/** — Doctest framework extracted from callback-box.
Boxes live outside this repo at `~/src/boxes/` so agents running inside them don't inherit the monorepo's AGENTS.md. `~/src/boxes/test1/` is the primary test environment. Boxes are git repos with a standard directory layout: `box/inbox/`, `box/commands/`, `box/output/`, `store/archive/`, `config/`
