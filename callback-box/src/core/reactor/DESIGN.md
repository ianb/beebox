# Reactor Design

The reactor is the main orchestration loop that turns pending job cards into completed work. It coordinates syncing external sources, discovering jobs, dispatching them to agents or the procedure engine, and flushing results outbound.

## Flow

```
  ┌─────────────────────────────────────────────────┐
  │                  runReactor()                    │
  │                                                  │
  │  1. Acquire PID lock                             │
  │  2. Optionally reset chat sessions               │
  │  3. Loop (up to maxCycles):                      │
  │     ┌──────────────────────────────────────────┐ │
  │     │           runOneCycle()                   │ │
  │     │                                          │ │
  │     │  a. cb wakeup (sync external sources)    │ │
  │     │  b. generateDocs (refresh agent docs)    │ │
  │     │  c. findJobCards (scan box/jobs/)         │ │
  │     │  d. Read cards, detect procedure jobs    │ │
  │     │  e. Procedure trampoline (if any)        │ │
  │     │  f. Agent processing (batch or chat)     │ │
  │     │  g. Count remaining → loop or stop       │ │
  │     └──────────────────────────────────────────┘ │
  │  4. cb finalize (flush outbound)                 │
  │  5. Release lock                                 │
  │  6. Optionally poll (sleep → recurse)            │
  └─────────────────────────────────────────────────┘
```

## Two Processing Paths

### Batch jobs (default)

All pending non-chat jobs are described in a single prompt and processed by one agent session. The agent works through them sequentially, calling `cb finish` after each. This is efficient for small, independent jobs — one session startup cost amortized across many jobs.

**File:** `batch-jobs.ts`

### Chat jobs (type="chat")

Each chat job gets its own agent invocation with session reuse across reactor cycles. This enables conversational context: the agent "remembers" prior messages in the same thread via Claude Code's `--resume` flag.

Sessions are keyed by thread ref (extracted from `<thread ref="...">` in the job XML) and stored in `.callback-box/chat-sessions.json`. If a session fails, it's reset so the next message starts fresh rather than resuming a broken context.

**File:** `chat-jobs.ts`

### Why two paths?

Batch processing is natural for jobs that are independent tasks (e.g., "write a summary", "process this email"). But chat requires per-thread continuity — batching multiple chat messages into one prompt would lose the session history that makes multi-turn conversation work. The `type` filter on the reactor command selects which path to use.

## Job Lifecycle

1. **Creation:** Jobs appear in `box/jobs/` via connectors (sync phase), intake, or manual placement. They're XML files with the `.job.card` suffix. Each root element carries a `source="..."` attribute naming the connector that owns it (e.g. `gmail`, `telegram`, `calendar`) or a cross-cutting bucket (`wakeup`, `feedback-sync`, `question-answer`).
2. **Discovery:** `findJobCards()` scans the directory, extracts priority and source from the XML, and sorts normal-priority first.
3. **Partitioning:** Jobs containing `<procedure ref="...">` are separated for the procedure trampoline. The rest go to agent processing.
4. **Processing:** The agent (or procedure engine) does the work, commits changes, and calls `cb finish <path>` to delete the job file.
5. **Finalize:** After all cycles, `cb finalize` flushes any outbound cards created during processing.

## Source Filter

`runReactor` accepts a `sourceFilter` option. When set, jobs whose root `source` attribute does not match are skipped — left in `box/jobs/` for a later run that does match them. This is how `cb wakeup --connector X` keeps a partial sync from draining unrelated work: the gmail tick processes only `source="gmail"` jobs, even if telegram or feedback jobs are also pending.

Cross-cutting jobs (e.g. `feedback-sync` for guide revisions, `question-answer` for question follow-ups) carry sources that no connector matches, so they only run when the reactor is invoked with no filter (a full `cb wakeup`, or `cb reactor` directly).

## Procedure Trampoline

Some jobs don't need an agent at all — they just need to run a procedure (a scripted sequence of steps). The reactor detects these by looking for `<procedure ref="...">` in the job XML, then runs the procedure engine directly. This avoids wasting an agent session on what is essentially a function call.

The procedure engine itself may invoke agents for individual steps, but the job dispatching is handled without one.

**File:** `procedure-trampoline.ts`

## Prompt Construction

The reactor builds two prompts for the agent:

- **System prompt** tells the agent what context it already has (job XML, referenced files, schema instructions, rules files) so it doesn't waste turns re-reading things. This is important because Claude Code auto-loads CLAUDE.md and rules files — the agent needs to know it already has this information.

- **User prompt** lists the actual jobs to process with their XML content, inlined referenced files (threads, items), and schema-specific processing instructions.

Job descriptions inline referenced files (from `<thread ref="...">` and `<item ref="...">` attributes) and look up schema-defined processing instructions for the job's root tag. This gives the agent everything it needs in the initial prompt.

**File:** `prompts.ts`

## Session Management

Chat sessions are persisted in `.callback-box/chat-sessions.json` and managed by `chat-reactor-sessions.ts` (outside this directory — it's a general utility). Sessions rotate by message count and age to prevent context windows from growing unbounded.

The `--reset-sessions` flag clears all sessions, useful when the system prompt changes or sessions get into a bad state.

## Locking

The reactor uses a PID-based lock file (`.cb-reactor.lock`) to prevent concurrent runs. Stale locks from dead processes are automatically detected and cleaned up via `process.kill(pid, 0)`.

This is simple and sufficient — the reactor is the only process that needs exclusive access to job processing. More sophisticated locking (e.g., flock) isn't needed because the lock is advisory and short-lived.

## Polling Mode

With `--poll N`, the reactor sleeps N seconds after completing a cycle, then recurses. This enables continuous operation for development or long-running boxes. The lock is released during the sleep interval so other tools can interact with the box.

## `ensureAgentCommitted`

After each agent invocation, `ensureAgentCommitted()` checks whether the agent left uncommitted changes. If so, it first asks the agent to commit (giving it a chance to write a meaningful message), then falls back to a generic commit if that doesn't work. This prevents half-finished work from being lost if the agent runs out of turns or hits an error.

## Subprocess Calls (cb wakeup, cb finalize)

Sync and finalize are delegated to `cb wakeup` and `cb finalize` as subprocesses rather than calling the functions directly. This ensures they run with the same CLI setup (config loading, connector registration) that manual invocation gets. Their stdout/stderr is streamed to the reactor's log callback.

On boxes with no connectors configured (like test boxes), both commands gracefully no-op.

**File:** `subprocess.ts`

## Caveats and Future Work

- **generateDocs runs every cycle** even if nothing changed. It's fast due to mtime caching, but it's still unnecessary work in most cycles. A future optimization could skip it if no files were modified since the last run.

- **Finalize runs unconditionally** after all cycles, even if no outbound items were created. This is cheap (just scans `box/output/`) but could be skipped if no agent work happened.

- **Job priority** is limited to "normal" and "low". The `--skip-low-priority` flag lets scheduled runs skip low-priority jobs (e.g., digest summaries) while still processing urgent items.

- **Error handling** is optimistic — a failed agent invocation doesn't prevent subsequent jobs from being processed in the next cycle. Failed chat sessions are reset so the next message starts fresh.
