---
title: "An empty `claude auth status` probe fails a run as \"not logged in\""
workstream: refresh-maps-throughput
filed-by: agent
discovered-in: refresh-maps tier comparison (worktree-refresh-maps-throughput)
area: callback-box
---

`createClaudeCliService().authStatus()` in `src/services/claude-cli.ts` shells
out to `claude auth status` and parses stdout as JSON. When the output is empty
it logs a warning and resolves `{ loggedIn: false }` — and `auth-preflight.ts`
turns that into a `ClaudeAuthError`, killing the whole procedure run with:

```
claude auth status output was not JSON, falling back to raw/error: SyntaxError: Unexpected end of JSON input
✗ Agent failed: Claude Code is not logged in — run `claude auth login` on this machine
✗ Procedure failed: refresh-maps
```

The login was fine in every case. Run the same probe by hand, or through
`execFile` from the same cwd, and it returns valid JSON with `loggedIn: true`.
The probe intermittently comes back empty, and an empty answer is currently
indistinguishable from a negative one.

Observed twice in roughly eight local procedure invocations, so it is frequent
enough to matter for anything that runs procedures in a batch — and the
diagnostic actively misdirects, since it names a remedy (`claude auth login`)
that is not the problem and would send someone to re-authenticate for nothing.

The distinction to draw is the one the codebase already draws for the validate
judge in `engine-validate-model.ts`: a probe that produced **no answer** is not
the same as an answer of **no**. `InstructionEvaluation` separates
`inconclusive` from a real verdict for exactly this reason. The auth preflight
collapses the two. Options, not yet chosen: retry the probe before believing an
empty result; treat an empty-but-successful probe as "unknown" and let the run
proceed (the SDK call itself fails informatively if auth really is missing); or
carry an explicit `unknown` state the way the judge now does.

Worth checking whether the same collapse affects the `cb health` auth probe in
`webapp/trpc/routers/health.ts`, which uses the same service.
