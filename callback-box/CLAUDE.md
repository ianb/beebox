# Callback Box

A file-based processing system where the filesystem is state, Git is history, and the CLI is the interface. **Claude Code runs this system**—this is the infrastructure that makes Claude Code into a personal assistant.

## The Big Picture

Callback Box is not an app you use. It's a system that Claude Code operates on your behalf. You give it inputs (voice memos, emails, messages), it processes them, and it takes actions or asks you questions when it needs guidance.

Claude Code is the agent. The filesystem is the workspace. Git is the memory. The `cb` CLI is how Claude Code interacts with everything. You're teaching Claude Code how to handle your life by setting up rules, answering questions, and correcting mistakes—and all of that teaching is captured in files and commits.

---

## Guiding Principles

See `docs/DESIGN.md` for detailed rationale. Summary:

1. **Filesystem is state** — No databases, no hidden state. If it needs to be remembered, it's a file.
2. **Git is history** — A change hasn't "happened" until it's committed. Use git trailers for structured metadata.
3. **Determinism around non-determinism** — Agent decisions vary, but everything else (timestamps, state, commands) is deterministic and recorded.
4. **Strict schemas** — Cards validate via Zod/cardworks on load and before commit. No best-effort parsing.
5. **CLI is the interface** — `cb` is the universal interface. Every operation is a command with `--help` and `--dry-run`.
6. **Claude Code is the operator** — State is discoverable (`cb status`/`cb context`), errors are actionable, operations are reversible.
7. **Idle by default** — Not a daemon. Wakes on triggers (schedules, webhooks, `cb wakeup`), processes, returns to idle.

---

## Technical Map

### Directory Structure

```
/box/                    # Working state
  inbox/                 # Incoming items awaiting processing
  jobs/                  # Pending job cards for reactor
  questions/             # Pending questions for user
  resources/             # Synced external state (calendar, contacts)

/store/                  # Archives
  archive/               # Processed items
  trash/                 # Soft-deleted items

/config/                 # Configuration
  connectors/            # Connector settings and credentials
  schemas/               # Card type definitions

/.claude/                # Agent configuration
  rules/                 # Context-triggered instructions
  agents.json            # Subagent definitions
```

### Card Naming

Cards use the pattern `Name.type.card`:
- `Meeting_Tomorrow.email-thread.card`
- `Reply_To_Alice.email-reply.card`
- `Voice_Memo_2024-01-15.memo.card`

Attachments share the basename: `Voice_Memo_2024-01-15.m4a`

### Core Flow

```
External event → Connector pulls → Commits to repo → cb wakeup
    → Claude Code processes → Creates/modifies cards → Commits
    → Execute ready commands → Archive results → Tail phase
    → Schedule next wakeup → Idle
```

### Key CLI Commands

| Command | Purpose |
|---------|---------|
| `cb init` | Initialize a new callback box |
| `cb wakeup` | Sync connectors, process pending items |
| `cb status` | Show current state |
| `cb context` | Show what Claude Code would see |
| `cb commit` | Commit with validation |
| `cb validate` | Check cards against schemas |
| `cb reactor` | Process pending jobs |
| `cb finish` | Complete a job |

---

## Dependencies

### cardworks (~/src/cardworks)

XML parsing, schema validation, and reference handling. Exports `CardLoader`, `MemoryCardLoader`, `element` (Zod schemas), `parseRef`, `lintAll`. Edit cardworks as needed—it's part of this project's ecosystem.

---

## Documentation

All detailed documentation lives in `docs/`. **When you add a new doc, update the map below.**

### Doc Map

| Document | Purpose |
|----------|---------|
| docs/DESIGN.md | Goals, concepts, rationale—*what* we're building and *why* |
| docs/IMPLEMENTATION.md | Technical implementation guide—*how* to build it |
| docs/EXAMPLE_FILES.md | Concrete examples of cards, schemas, CLI usage |
| docs/procedure-implementation.md | Procedure engine: definitions, runs, steps, validation, CLI usage |
| docs/testing.md | Testing philosophy, doctests, scenarios, knowledge audits, service fakes |
| docs/testing-gaps.md | Working document: coverage status, what's tested, what's not |
| docs/connectors.md | Connector architecture, inventory, service injection, writing new connectors |
| docs/scheduler.md | Background tick daemon: launchd/systemd setup, multi-box scheduling |
| docs/adding-schemas.md | How to add a new card type with Zod schema |
| docs/agent-knowledge.md | Knowledge taxonomy and audit test design |
| docs/stack-decisions.md | Technology choices and rationale |
| docs/state-management-comparison.md | Frontend state management options analysis |
| docs/design-card-views.md | Card view plugin system: pluggable renderers, directory browsing, validated patches |
| docs/prompt-logging.md | Capturing and debugging agent API traffic (system prompts, loaded context) |
| docs/telegram-setup.md | Telegram bot setup guide |
| docs/gmail-setup.md | Gmail IMAP setup guide |
| docs/google-setup.md | Google OAuth/API setup guide |
| docs/ideas.md | Feature ideas and backlog |
| docs/adding-api-endpoints.md | How to add new tRPC API endpoints |
| docs/TESTING-NEWS-PROCEDURE.md | Step-by-step walkthrough: testing news processing end-to-end |
| docs/doc-graph.md | Auto-generated documentation cross-reference report |

When adding a doc to `docs/`, add it to the Doc Map above. One topic per document.

## Services

Every external dependency (API, library, CLI tool) is wrapped in a typed service interface with three parts: an interface (the subset we use), a real factory (thin wrapper), and a fake factory (domain-specific in-memory implementation for tests). The `Services` container groups all services and is threaded through the server to routes and connectors. Full docs: `src/services/CLAUDE.md`.

Key pattern: fakes have observable state (`.sent[]`, `.bookmarks[]`, `.connected`) and domain-specific constructors (`createFakeTelegram({ username: "bot" })`). Call logging via `withCallLog(service)` records method calls for test assertions.

## Connectors

Connectors sync external services with the box filesystem. Each implements `Connector.sync()` — pull data in, optionally push data out, commit changes. Service-injected connectors accept an optional service parameter for testing. See `docs/connectors.md` for the full inventory and architecture, `src/connectors/CLAUDE.md` for quick reference.

## Testing

`npm test` runs tap. Tests in `test/` include doctests (`.doctest.md`), traditional tests (`.test.ts`), plus scenario tests and knowledge audits for integration/agent testing. Full guide: `docs/testing.md`. Doctest syntax: `.claude/rules/doctest.md`.

Three testing tiers:
- **Pure function doctests** — import and call directly
- **Route doctests** — `makeTestServer({ services: { ... } })` with Fastify `inject()`
- **Connector/filesystem doctests** — `makeTmpBox({ git: true })` with service fakes

Use `t.check(actual, expected)` for string comparisons with wildcards (`«date»`, `«*»`, etc.). Start with `src/test-lib/docs/getting-started.md`, full reference: `src/test-lib/docs/check-reference.md`.

@CONVENTIONS.md
