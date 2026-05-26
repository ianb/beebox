---
name: feedback-resilience-before-bug-fix
description: "When a bug causes downstream damage (UI freeze, data loss, lost message), fix the resilience gap first, then fix the bug"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80cb-1b6a986f9034
---

When a bug has caused damage that the user actually cares about — UI freeze, data loss, lost in-progress message, lost work, corrupted state, anything where the failure mode of the bug spilled into real user-visible harm — treat it as **two** problems, not one:

1. The bug itself (the wrong logic)
2. The **resilience gap** that allowed the bug to cause that damage (no autosave, no retry, no recovery path, no graceful degradation, no transaction boundary)

**Fix the resilience gap first or separately, then fix the bug.** Use the bug as the discovery moment for the fragility it exposed. Don't just patch the symptom and move on — the next bug in the same category will hit the same resilience gap and cause the same damage.

**Why:** Bugs happen. Software is imperfect. A well-designed system tolerates bugs by limiting their blast radius. When a bug causes outsized damage, the system's tolerance for failure is itself broken, and that's the deeper issue. Fixing only the bug leaves the fragility in place for the next failure to exploit. The bug is doing you a favor by revealing the gap; don't waste the signal.

**How to apply:**
- Trigger: bug report or observed bug where the consequence includes lost work, lost data, frozen UI, lost in-flight message, corrupted state, broken session, or similar cascading harm.
- Before writing the bug fix, identify and name the resilience gap. Example: *"this bug crashed the message handler, but the real issue is that an in-progress message has no checkpoint, so any crash loses it. Fix the checkpointing first, then fix the handler bug."*
- The two fixes are usually independent commits. The resilience fix should also benefit the next, unrelated bug in the same area.
- Compatible with the Iron Law (root cause before fix) and the >5-file blast-radius alert — those address the *cause* and the *fix size*; this addresses the *cost*.

This principle is especially central for callback (long-running tasks, in-progress messages, user-facing state), and should be quoted in any callback-specific debugging guide.
