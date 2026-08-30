---
title: "needs: [manual-testing] is being over-applied — recalibrate when agents add it"
workstream: unknown
area: process
design: ../../beebox/docs/implemented-plans/workstreams.md
filed-by: agent
discovered-in: finish-skill-audit worktree — boxholder remark while reviewing /finish changes
needs: [decision]
---

While approving the /finish edits (2026-07-29), Ian noted that
`needs: [manual-testing]` "is probably being overused right now — I don't want
to do that much manual testing." The flag is load-bearing: the finish agent
now explicitly refuses to close any issue carrying it (only Ian clears it, per
`issues/CLAUDE.md`), so every over-applied flag converts into a standing
human-verification chore that no agent can retire.

The tension: the flag exists precisely because some fixes genuinely can only
be confirmed by a human (on a phone, against live credentials, over a real
network). But if agents reach for it whenever they merely _didn't_ verify
something in the running app — rather than when a human is the only possible
verifier — the queue grows past what Ian will actually work through, and the
flag stops meaning anything.

The call to make: tighten the criteria for adding the flag (e.g. "only when no
agent-reachable verification path exists, and say in the issue exactly what
the human should do and expect to see"), and/or sweep the currently-flagged
items to unflag ones an agent could in fact verify (with `bin/browse`, a
doctest, or prod-curl impersonation of ianbicking@gmail.com where permitted).
