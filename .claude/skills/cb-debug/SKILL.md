---
name: cb-debug
description: Use when a bug is hard — you can't reliably reproduce it, it spans multiple components (frontend ↔ backend ↔ Agent SDK, the router/worktrees, SSE/WebSocket, connectors), a previous fix or two didn't hold, it's flaky/intermittent, or it's a performance regression. Triggers include "debug this", "why is X broken", "this is flaky", "I tried X and it still fails", "this is slow". Not needed for an obvious one-line bug.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, WebSearch, WebFetch
---

# cb-debug

A discipline for **hard** bugs in callback-box. For an obvious one-liner, just
fix it — winging the easy ones is fine. Reach for this when guessing has
started to thrash: you can't reproduce it, it crosses component boundaries, a
fix or two already bounced, it's flaky, or it's slow.

## The Iron Law

**No fix without a red-capable feedback loop first.** A symptom patch you can't
prove is a guess, and guesses create new bugs. If you catch yourself reading
code to build a theory before you have a loop, stop — that's the exact failure
this skill prevents.

## Phase 1 — Build a tight feedback loop (this *is* the skill)

Everything else is mechanical. With a **tight, red-capable** signal — one that
goes red on *this* bug — bisection, hypotheses, and instrumentation all just
consume it. Without one, no amount of staring at code saves you. Spend
disproportionate effort here; be aggressive and creative.

**The loop in callback-box** — pick the tightest that reaches the bug:

- **A doctest** — the default, and per `docs/testing.md` it's also your
  regression test (write it first). Pick the tier: pure-function
  (`.doctest.md`), route (`makeTestServer()`), or filesystem (`makeTmpBox()`).
  See `.claude/rules/doctest.md`, `src/test-lib/`.
- **`cb scenario run <name>`** — multi-step end-to-end (wakeup, connectors,
  agent runs), with checkpoints to re-run only the expensive tail. `--from`,
  `--dry-run`. See `docs/testing.md`.
- **curl the dev router** — `curl http://localhost:3210/<wt>/<box>/api/...` for a
  backend route, or Fastify `inject()` in a route doctest (no server spin-up).
- **`bin/browse`** — headless repro of a frontend bug: `snapshot`, `eval`,
  `click`, `screenshot`. Drives Chrome regardless of router state.
- **`client-debug.log`** — the browser forwards console errors to the server.
  `curl https://box.example.com/<box>/api/debug-log` or read
  `.callback-box/client-debug.log`. Often *is* the evidence for a frontend bug.
- **A knowledge audit / pressure scenario** — when the bug is the *box agent*
  doing the wrong thing (paraphrasing, forgetting a convention). `pnpm
  knowledge-audit run --box <box> --filter <id>`. 0 reads + wrong answer is a
  red loop.
- **git as history** — `git log -S '<symbol>'`, `git log -- <path>`, `git blame`
  to find *what changed*. Recent commits are the prime suspect.

**Tighten it.** Faster (cache setup, narrow scope), sharper (assert the *exact*
symptom, not "didn't crash"), more deterministic (pin time — note macOS timers
count sleep — seed RNG, isolate fs/network). A 2-second deterministic loop is a
superpower; a 30-second flaky one barely helps.

**Flaky/intermittent:** the goal isn't a clean repro, it's a *higher rate*. Loop
the trigger 100×, parallelise, add stress, narrow the timing window. 50% is
debuggable; 1% is not — raise it first. (The router/worktree generation churn we
chased is this shape: reproduce the cycle, don't theorize about it.)

**Completion criterion:** you can name **one command you've already run** (paste
the invocation + its output) that is red-capable (drives the real path, asserts
the user's exact symptom), deterministic, fast, and agent-runnable. No such
command → no Phase 2. If you genuinely can't build a loop, say so explicitly,
list what you tried, and ask for an artifact (the deployed box's debug log, a
HAR, a captured payload) — do **not** hypothesize without a loop.

## Phase 2 — Reproduce + minimise

Run the loop; watch it go red. Confirm it's the **user's** symptom, not a
nearby one (wrong bug = wrong fix). Then **minimise**: cut inputs, callers,
config, and steps **one at a time**, re-running after each cut, until every
remaining element is load-bearing (removing any makes it go green). A minimal
repro shrinks the hypothesis space and becomes the clean regression test.

## Phase 3 — Hypothesise

Generate **3–5 ranked, falsifiable hypotheses** *before* testing any — single
hypotheses anchor on the first plausible idea. Each states its prediction:
*"if X is the cause, changing Y makes it disappear."* No prediction = a vibe;
sharpen or discard. **Show the ranked list to the boxholder** before testing —
they often re-rank instantly ("we just changed #3"). Don't block if they're AFK.

## Search the web when the bug is in someone else's code

The move you reach for too rarely — do it more. When the bug surface is a
**third-party library** (Markdoc, Vite, tRPC, the Agent SDK, Fastify, React,
XState, yaml…) or a **platform/system quirk** (browser APIs, Node and its
ESM-vs-CJS resolution, a specific server or runtime), someone has almost
certainly hit it and written it down.

**Search for what your training data doesn't have.** Canonical reference (MDN,
caniuse, the happy-path README, the API docs) is mostly already in your weights
— re-deriving that from a search wastes the call. The payoff is the long tail
training lacks: recent, version-specific, and verbatim-symptom material.

- **Recent GitHub issues** (open *and* closed) — especially regressions filed
  *after* your knowledge cutoff and anything against versions newer than you
  know. An exact error string in an issue title is gold.
- **Changelogs / release notes for the version actually installed** — behavior
  may have changed since the version you "remember." Check `package.json` / the
  lockfile for the real version, then read *its* notes, not your recollection.
- **The exact error string or symptom, verbatim**, in a general web search —
  niche Stack Overflow answers, forum threads, blog write-ups of the same quirk.

Still build the loop and reproduce locally — but don't reinvent a documented
workaround, and don't trust your memory of a library over its *current*
version's reality. This session's bugs were exactly this shape: `canvas.toBlob`
produces only *lossy* WebP/AVIF, macOS timers advance during sleep (Node ≥20.3),
and named value imports fail under Node's ESM loader for CJS modules — "someone
already solved this" searches, not first-principles fights. (For a deep,
multi-source dig, hand off to `deep-research`; for a quick known-issue check, a
couple of `WebSearch`/`WebFetch` calls is enough.)

## Phase 4 — Instrument

Each probe maps to one Phase-3 prediction. **One variable at a time.** Prefer a
debugger/REPL breakpoint over logs; if logging, target the boundaries that
distinguish hypotheses — never "log everything and grep." **Tag every debug log
with a unique prefix** (`[DEBUG-a4f2]`) so cleanup is one grep.

**Multi-component bugs** (frontend → backend → Agent SDK; router → vite/fastify
generations; SSE/WebSocket): instrument *each boundary* — what data enters, what
exits — run once, and read off *where* it breaks before investigating that
component. (This is how the chat-send / generation-churn classes get pinned.)

**Performance:** logs are usually wrong. Establish a baseline measurement
(`performance.now()`, a timing harness, a profiler) and bisect. Measure first,
fix second.

## Phase 5 — Fix + regression test

Per our test-first posture, write the regression test **before** the fix — but
only at a **correct seam**: one where the test exercises the *real* bug pattern
at its call site. A too-shallow seam (a unit test that can't replicate the chain
that triggered it) gives false confidence. **If no correct seam exists, that
itself is the finding** — note it; the architecture is preventing the bug from
being locked down. With a seam: turn the minimised repro into a failing doctest,
watch it fail, apply the **single** root-cause fix (no "while I'm here"
refactors), watch it pass, then re-run the original (un-minimised) loop.

## Phase 6 — Cleanup + post-mortem

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop).
- [ ] Regression doctest passes (or the absent seam is documented).
- [ ] Every `[DEBUG-...]` probe removed (`grep` the prefix); throwaway harnesses deleted.
- [ ] The hypothesis that turned out correct is stated in the commit message — the next debugger learns from it.
- [ ] Ask: **what would have prevented this?** If the answer is architectural (no good seam, tangled callers, hidden coupling), raise it with the boxholder *after* the fix lands — you know more now than you did at the start.

## The 3-fix circuit-breaker

If a fix doesn't work, count your attempts. **At 3 failed fixes, STOP — do not
attempt #4.** When each fix reveals a new problem somewhere else, or requires
"massive refactoring," that's not a failed hypothesis, it's the **wrong
architecture**. Question the fundamentals with the boxholder instead of patching
again.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "It's simple, I don't need a loop." | Simple bugs have root causes too, and a loop for a simple bug is cheap. If it's *truly* one line, you're not in this skill. |
| "Emergency, no time for the process." | Systematic is *faster* than guess-and-check thrashing. The loop is the shortcut. |
| "I'll just try this change and see." | The first move sets the pattern. A red loop first, always. |
| "I'll write the test after I confirm the fix." | Untested fixes don't stick, and you lose the proof the fix addressed *this* bug. Test (loop) first. |
| "Let me fix a few things at once." | You can't tell which one worked, and you've added new bugs. One variable at a time. |
| "I see the problem, let me fix it." | Seeing a symptom ≠ understanding the root cause. Trace to the source. |
| "One more fix attempt." (after 2+) | 3+ failures = architecture, not another patch. Hit the circuit-breaker. |
| "I'll work out the workaround myself." | If the bug is a library or platform quirk, someone already hit it and wrote the fix down. Search first — that's the move you under-reach for. |

## Red flags — stop and return to Phase 1

Catching yourself thinking any of these means you've skipped the loop:
"quick fix now, investigate later" · "just change X and see" · "it's probably X"
· "skip the test, I'll verify by hand" · proposing fixes before you can name the
red command · "one more fix" after two failures · each fix breaking something new.
