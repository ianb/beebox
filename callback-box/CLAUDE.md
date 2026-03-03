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

When adding a doc to `docs/`, add it to the Doc Map above. One topic per document.

## Testing

`npm test` runs tap. Two kinds of tests in `test/`:

- **`.doctest.md`** — Executable docs for pure functions. Syntax in `.claude/rules/doctest.md`.
- **`.test.ts`** — Traditional tests for anything needing server/filesystem/complex setup.

Use `t.check(actual, expected)` for string comparisons with wildcards (`«date»`, `«*»`, etc.). Ref: `src/test-lib/docs/check-reference.md`.

@THINKING_CLAUDE.md

@CONVENTIONS.md
