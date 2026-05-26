---
name: feedback-transparency
description: "Callback values transparency — errors and unexpected states must be visibly surfaced, never silently caught; the developer-user must be able to see and interact with what went wrong"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80cb-1b6a986f9034
---

Transparency is a core principle for callback. Concretely:

1. **No silent error capture.** Don't wrap code in try/catch that swallows the error and returns a fallback value without surfacing what happened. Silent catches hide code paths from anyone trying to understand or debug the system. If an error is caught, the catch must do something visible — log loudly, surface to the UI, throw a wrapped error with context, etc. — never just "return null and move on."

2. **UI surfaces unexpected states clearly.** When something happens in the user interface that wasn't the intentional behavior, it must be visible to the user, and visibly marked as unintentional (vs. just looking like a normal-but-weird outcome). The user shouldn't have to guess whether what they're seeing is by design or a bug.

3. **The user is often a developer.** Callback is open source, and the typical user is technical enough to inspect / interact with / report on the surfaced state. Design error surfaces with that in mind — give them something they can act on (stack trace, raw error, repro steps, copyable state).

4. **Open source = transparency to contributors.** Code paths, decisions, and error modes should be inspectable by future readers, not buried in opaque abstractions.

**Why:** Three reinforcing reasons.
- **Debuggability:** silent errors compound — the system keeps running in a broken state, and the eventual symptom is far from the cause. Visible errors are easier to fix.
- **Trust:** when the user can see what went wrong, they can decide whether it's worth caring about, working around, or reporting. Hidden errors leave them confused and powerless.
- **Open source contract:** anyone reading the code should be able to follow the actual control flow, including failure paths.

**How to apply:**
- When writing error handling: ask "if this catch fires, can a developer-user tell?" If no, the catch is wrong — at minimum log loudly, ideally surface to the UI.
- When designing UI states: ask "if this state happens unexpectedly, will the user know it's unexpected?" If no, add a clear visual marker for unintentional/error states.
- When abstracting: prefer abstractions that preserve traceability over ones that hide internal mechanism. *Explicit > clever* is a downstream consequence of transparency.
- Resilience ([[feedback-resilience-before-bug-fix]]) and transparency are complementary: resilience prevents damage from failure, transparency makes failure visible. Both, not either.

This is foundational for callback specifically; in other projects with non-developer end-users, the surfacing strategy would be different (friendlier messages, less raw detail) but the no-silent-catch principle still holds.
