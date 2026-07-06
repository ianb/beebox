# Reactor

See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.

## Files

| File | Purpose |
|------|---------|
| `engine.ts` | Main loop: `runReactor()`, cycle management, locking, polling |
| `cycle.ts` | One cycle as named stages: `runOneCycle()` → sync/refresh/discover/process |
| `batch-jobs.ts` | Batch processing: all jobs in one agent session |
| `chat-jobs.ts` | Chat processing: per-thread sessions with resume |
| `job-discovery.ts` | Scan `box/jobs/` for pending job cards |
| `prompts.ts` | System and user prompt builders |
| `subprocess.ts` | `cb wakeup` and `cb finalize` subprocess wrappers |
| `types.ts` | Shared internal types |
| `index.ts` | Public API re-exports |

## Testing

The reactor accepts a `createAgent` factory in `ReactorOptions` for test injection. Use `createFakeAgent()` from `test/helpers/fake-agent.ts` to simulate agent behavior without spawning Claude Code.

Subprocess calls (`cb wakeup`, `cb finalize`) run the real CLI — they gracefully no-op on test boxes with no connectors configured.
