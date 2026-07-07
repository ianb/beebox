---
area: callback-box
filed-by: agent
discovered-in: prod (one personal box) — an intermittent chat-turn "error_during_execution (no detail)" couldn't be diagnosed because the box child's error log went nowhere findable
---

# Box children's stderr isn't surfaced, so chat-turn failures are undiagnosable

The hub spawns each box's `cb serve` child with `stdio: ["ignore", "pipe",
"pipe"]` (`src/hub/supervisor.ts:55`) — stdout/stderr are piped to the hub but
**never forwarded to journald or a per-box log file** (execa buffers them; they
surface only if the child exits). A long-running box child's diagnostics
therefore vanish.

Concretely: a chat turn that ends `is_error=true` calls `warnErroredTurn`
(`core/chat/session/messages.ts:346`), which logs the SDK's own result text +
subtype + timing — exactly the detail needed to tell "unavailable model" from
"unresumable session" from "server error." That `console.warn` goes to the
child's stderr → into the void. So the user sees "the run reported an error with
no detail (subtype: error_during_execution)" and there's no server-side
breadcrumb to diagnose it after the fact.

This bit us on a real intermittent failure: a chat turn **with an image
attachment** failed once, then the same input succeeded on retry — the kind of
flaky, image-path-specific bug you can only catch from a log, not a repro.

Fix: forward box-child stdout/stderr to journald (prefixed with the slug) or to a
rolling per-box log the hub owns, so `warnErroredTurn` and any other child
diagnostics are recoverable. Consider also surfacing more of the agent error to
the client than "no detail" — `warnErroredTurn` already has the result text; the
turn-failed UI could carry a truncated form of it.

Until then, intermittent chat errors (especially on image turns) are effectively
un-debuggable. This is the enabling fix that makes the *other* chat bugs findable.
