import { FEEDBACK_CLAUDE_MD } from "./templates.js";

/** The description advertises feedback; the body shares the local guide. */
export const AGENT_FEEDBACK_SKILL = `---
name: agent-feedback
description: Record an observation for Bee Box developers when you notice confusing tooling, an unclear error, a surprising CLI behavior, or an awkward workflow during another task. Use it even when the boxholder did not ask for feedback.
---

${FEEDBACK_CLAUDE_MD}`;
