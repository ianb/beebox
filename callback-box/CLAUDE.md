# Callback Box

A file-based processing system where the filesystem is state, Git is history, and the CLI is the interface. **Claude Code runs this system**—this is the infrastructure that makes Claude Code into a personal assistant.

## The Big Picture

Callback Box is not an app you use. It's a system that Claude Code operates on your behalf. You give it inputs (voice memos, emails, messages), it processes them, and it takes actions or asks you questions when it needs guidance.

Claude Code is the agent. The filesystem is the workspace. Git is the memory. The `cb` CLI is how Claude Code interacts with everything. You're teaching Claude Code how to handle your life by setting up rules, answering questions, and correcting mistakes—and all of that teaching is captured in files and commits.

---

## Guiding Principles

### 1. All State in the Filesystem

There is no hidden state. No in-memory caches that matter. No databases. The filesystem *is* the state of the system.

When designing any feature, ask: "Where does this live on disk?" If the answer is "it doesn't," redesign. If something needs to be remembered, it's a file. If something needs to be computed, the inputs and outputs are files.

This means:
- **Inspection is trivial**: `ls`, `cat`, `find` show you the system state
- **Modification is direct**: Edit a file, the state changes
- **Backup is copying**: The directory *is* the system
- **Claude Code sees what you see**: No privileged internal state

### 2. All History in Git

Git is the state engine. A change hasn't "happened" until it's committed. The git log is the complete history of everything the system has ever done.

This enables **true time travel**:
- Checkout any commit and the system is in that exact state
- Replay any sequence of operations from any point
- Diff any two moments to see exactly what changed
- Bisect to find when something went wrong

Don't fight git—embrace it. Commits are atomic state transitions. Branches are parallel explorations. Merges are conflict resolution. The `cb` CLI wraps git to add validation and semantics, but git's model rules.

**Git trailers** extend commit metadata when needed. Use trailers to record structured information that doesn't belong in the commit message body:
```
Process inbox items

Triggered-By: schedule
Agent: triage
Session: abc123
Items-Processed: 3
```

### 3. Determinism Around Non-Determinism

Claude Code is non-deterministic. We can't control what it decides. So everything *else* must be as transparent and deterministic as possible:

- **Same state + same command = same result** (for non-agent operations)
- **No hidden randomness**: Seeds are explicit if randomness is needed
- **Timestamps come from cards**: Not from system clock during processing
- **External state is snapshotted**: Connectors pull into files, then processing works on files

Claude Code's decisions may vary, but the *consequences* of those decisions are recorded precisely in git. You can always see what Claude Code did and what state it was working from.

### 4. Strict Schemas, No Drift

Cards validate against schemas or they're invalid. No "best effort" parsing. No silent degradation.

- Schemas are defined with Zod via cardworks
- Validation happens on load and before commit
- Invalid cards block operations—Claude Code must fix them
- Schema evolution happens through explicit migration

Claude Code can migrate cards when schemas change—that's fine. But the schema at any moment is strict. This prevents gradual corruption and makes the card format a reliable contract.

### 5. CLI as the Universal Interface

The `cb` command is how everything happens. Humans use it. Claude Code uses it. Tests use it.

- **Every operation is a command**: No UI-only functionality
- **Exit codes are meaningful**: Scripts can check success/failure
- **Output is parseable**: Structured when needed, readable always
- **Dry runs exist**: `--dry-run` on anything that mutates
- **Help is complete**: `cb <command> --help` documents everything

If you're building something that can't be expressed as a `cb` command, step back and redesign. The CLI is the contract.

### 6. Claude Code Is the Operator

This system is designed for Claude Code to run. Design for that reality:

- **State is discoverable**: `cb status`, `cb context` tell Claude Code what's happening
- **Errors are actionable**: Say what to fix, not just what failed
- **Operations are reversible**: Or at least inspectable before commitment
- **Claude Code can probe**: Read files, run commands, check results, iterate

Claude Code should be able to: understand the system state, decide what to do, do it, and verify it worked—all through the CLI and filesystem. The human provides goals and answers questions; Claude Code does the work.

### 7. Idle by Default

The system is not a daemon. It's not watching. It's not polling. It wakes up when triggered, processes what needs processing, and returns to idle.

Triggers come from outside:
- Scheduled timers (set by the tailing phase)
- Webhooks from external services
- Manual `cb wakeup` invocation

This means no background resource usage, no mysterious processes, and clear boundaries around when the system is "doing something."

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
| `cb wakeup` | Process pending items |
| `cb status` | Show current state |
| `cb context` | Show what Claude Code would see |
| `cb commit` | Commit with validation |
| `cb validate` | Check cards against schemas |
| `cb wakeup` | Sync with connectors and create jobs |
| `cb reactor` | Process pending jobs |
| `cb finish` | Complete a job |

---

## Dependencies

### cardworks (~/src/cardworks)

XML parsing, schema validation, and reference handling. Key exports:

```typescript
import {
  CardLoader,        // Load/save/validate cards
  MemoryCardLoader,  // In-memory loader for tests
  element,           // Define Zod schemas for XML elements
  parseRef,          // Parse card references
  lintAll,           // Validate all cards
} from "cardworks";
```

Edit cardworks as needed—it's part of this project's ecosystem.

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

### Adding Documentation

When you create a new document in `docs/`:
1. Add it to the Doc Map table above
2. Write a clear one-line purpose
3. Link it from relevant sections of other docs if appropriate

Keep docs focused. One topic per document. Cross-reference rather than duplicate.

## Testing

`npm test` runs tap. Two kinds of tests in `test/`:

- **`.doctest.md`** — Executable docs for pure functions. Syntax in `.claude/rules/doctest.md`.
- **`.test.ts`** — Traditional tests for anything needing server/filesystem/complex setup.

Use `t.check(actual, expected)` for string comparisons with wildcards (`«date»`, `«*»`, etc.). Ref: `src/test-lib/docs/check-reference.md`.

@THINKING_CLAUDE.md

@CONVENTIONS.md
