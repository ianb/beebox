---
name: bbx-debug
description: "Use for hard bugs: unreliable reproduction, cross-component failures, failed prior fixes, flakiness, or performance regressions. Not needed for an obvious one-line bug."
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, WebSearch, WebFetch
---

# bbx-debug

A discipline for **hard** bugs in beebox. For an obvious one-liner, just
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

**The loop in beebox** — pick the tightest that reaches the bug:

- **A doctest** — the default, and per `docs/testing.md` it's also your
  regression test (write it first). Pick the tier: pure-function
  (`.doctest.md`), route (`makeTestServer()`), or filesystem (`makeTmpBox()`).
  See `agent-doctest/docs/syntax.md`, `beebox/test/helpers/` (monorepo-relative).
- **`bbx scenario run <name>`** — multi-step end-to-end (wakeup, connectors,
  agent runs). Runs from the beginning every time (no checkpoint-resume);
  `--dry-run` only parses the card — it proves nothing about runtime behavior.
  See `docs/testing.md`.
- **curl the dev router** — `curl http://localhost:3210/<wt>/<box>/api/...` for a
  backend route, or Fastify `inject()` in a route doctest (no server spin-up).
- **`bin/browse`** — headless repro of a frontend bug: `snapshot`, `eval`,
  `click`, `screenshot`. Drives Chrome regardless of router state.
- **`client-debug.log`** — the browser forwards console errors to the server.
  `curl https://box.example.com/<box>/api/debug-log` or read
  `.beebox/client-debug.log`. Often *is* the evidence for a frontend bug.
- **A knowledge audit / pressure scenario** — when the bug is the *box agent*
  doing the wrong thing (paraphrasing, forgetting a convention). `pnpm
  knowledge-audit run --box <box> --filter <id>`. A wrong answer is a red loop;
  set the expected knowledge level to the intended loading path.
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
HAR, a captured payload) — do **not** hypothesize without a loop. When the bug
only manifests on the boxholder's device or in prod, the artifact-gathering
loop has its own protocol: the **field-probe** skill (deploy gated
instrumentation, hand the boxholder a headlined script, read the trace back).

## Phase 2 — Reproduce + minimise

Run the loop; watch it go red. Confirm it's the **user's** symptom, not a
nearby one (wrong bug = wrong fix). Then **minimise until the repro is cheap and
diagnostic**: cut inputs, callers, config, and steps one at a time. Re-run after
each cut; revert any cut that changes or clears the symptom. Stop when further
reduction costs more than it
teaches. The result should shrink the hypothesis space and be suitable for a
regression test.

## Phase 3 — Hypothesise

When evidence is ambiguous, generate plausible alternative hypotheses and rank
them before testing. Each states a falsifiable prediction: *"if X is the cause,
changing Y makes it disappear."* No prediction means sharpen or discard it.
Show the ranked alternatives to the boxholder; don't block if they're AFK. When
the evidence already isolates one cause, test it directly instead of inventing
a quota of alternatives.

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
multi-source dig, spawn a research subagent to sweep issues/changelogs/forums;
for a quick known-issue check, a couple of `WebSearch`/`WebFetch` calls is
enough.)

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
