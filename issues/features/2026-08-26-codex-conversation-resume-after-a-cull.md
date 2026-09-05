---
title: "Codex conversation resume stops at the worktree boundary"
workstream: unattached
area: router
filed-by: agent
discovered-in: worktree-resume-continues-session — while making `resume` continue Claude conversations
priority: normal
---

`bin/workstreams resume` now continues a Claude conversation whenever the recorded
`sessionId` still has a transcript, including after the worktree was culled and
recreated at the same path. Codex has no equivalent reach: `LS_CODEX_RESUME=1` is set
only when `resume_state` is `existing` (`bin/workstreams`), so a culled Codex workstream
always comes back with a fresh thread.

Whether that is a real limitation is unverified. `codex resume --last` resumes the newest
session recorded for the current directory from `~/.codex/sessions`; if that store is
keyed by cwd the way Claude's `~/.claude/projects/` is, a recreated worktree at the same
path would find its own thread and the `existing`-only guard is just conservative. If it
is keyed by something the cull destroys, the answer is that Codex genuinely cannot do
this and the asymmetry should be written down rather than left looking like an oversight.

Deliberately out of scope of the change that raised it: one agent's session mechanism at
a time, and Codex already had partial coverage. The Claude half of the story, including
why the earlier "resume loses worktree isolation" finding was wrong, is in
[workstreams.md](../../beebox/docs/implemented-plans/workstreams.md) (Track B, the
B2 note).
