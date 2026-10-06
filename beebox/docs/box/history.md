---
read-when: Reconstructing what happened in the box from `git log`, reading a commit's trailers (`Created-By`, `Procedure:`, `Phase:`, and the rest), or filtering the log by one.
---

# Git history

The box's commits and the trailers on them. That history is the record to read
first is in the agent guide's HISTORY section; this doc is what the trailers
say and how to filter by them.

## Trailers and filtering

Commits carry structured trailers (key: value metadata after the message body).
Most are provenance in `<Verb>-By:` form naming what touched the content —
`Created-By`, `Moved-By`, `Pulled-By`, `Pushed-By`, `Fetched-By`, `Sent-By`,
`Tracked-By`, `Trashed-By`, `Expired-By`, `Triggered-By` (a connector, a wakeup, or another `bbx` command) — plus a few
pipeline markers: `Procedure:` and `Step:` (a `bbx procedure` run and the step
within it), `Run-By:` (a trick run, as `trick/<name>`), `Phase:` (which stage
of a pipeline), `Session:` (the agent session),
and `Commit-Source:` / `Fallback:` (a system fallback commit rather than the
agent's own). Older boxes carry `Workflow:` where `Procedure:` is written now;
the browse history view groups these into two filter axes, the connector that
touched the content (the `-By` keys) and what triggered the commit
(`Triggered-By`, `Procedure`, `Workflow`, `Run-By`). You don't need these
memorized — read them off the log, and filter by one when you want a slice:

- `git log --oneline -20` — recent activity overview
- `git log --all --grep='Phase: brief'` — every brief-creation commit
- `git log --all --grep='^Procedure: refresh-maps'` — every commit one procedure made
- `git log -- _content/inbox/` — history of one directory
- `git show <hash>` — the full diff of a change
