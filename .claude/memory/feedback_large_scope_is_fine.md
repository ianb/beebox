---
name: feedback-large-scope-is-fine
description: "Large AI changes are usually fine, but flag scope when reality diverges from the user's expectation — especially when something framed as small (a bug fix) becomes large"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80cb-1b6a986f9034
---

Large scope in AI-driven changes is usually fine — Ian uses the AI's ability to do big coherent work as a feature and enjoys it. But scope is worth flagging when **the actual scope diverges from the expected scope.**

**The rule:**

- **Match expected size: don't comment on size.** Feature implementations, refactors, broad rewrites — if the scope is consistent with what the work is, just do it. No "this is a big change, are you sure?" hedging.
- **Mismatch — bigger than expected: flag the surprise.** If something framed as small (a bug fix, a tweak, a quick refactor) starts growing into many files / new classes / cross-cutting changes, surface that as it happens. The user wants to know when reality diverges from their mental model, especially in this direction.
- **Concrete trigger:** A bug fix that spreads beyond the immediate area, or a "small change" request that pulls in many files, is the canonical mismatch case.

**Why:** Conventional "small PRs / minimal diff" wisdom was calibrated for human teams. Ian doesn't share that calibration in general — he wants to use AI for big work. But surprise is still useful information: when the work turns out to be larger than the framing implied, the user might want to reconsider scope, split the work, or just know about it before being surprised at the end.

**How to apply:**
- Don't pre-warn about size based on absolute thresholds (no "this touches >N files" gates).
- Do interrupt with a brief flag when a small-framed task turns out to be large: "this bug fix is touching X files, including Y and Z which are pretty far from the original area — proceed, or want to look at this together first?"
- Resilience expansions ([[feedback-resilience-before-bug-fix]]) and completeness expansions are valid reasons for a bug fix to grow — flag them as the *reason* for the surprise rather than treating the size itself as suspect.
- Distinguish "expected large work" (no flag) from "unexpected large work" (flag).
- This is callback-specific context. In other projects with different working styles, default scope-conservatism may be appropriate.
