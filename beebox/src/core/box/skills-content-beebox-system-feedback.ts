import { FEEDBACK_CLAUDE_MD } from "./templates.js";

/** The description advertises system feedback; the body shares the local guide. */
export const BEEBOX_SYSTEM_FEEDBACK_SKILL = `---
name: beebox-system-feedback
description: Report friction in the Bee Box system itself, such as a confusing command, unclear error, surprising interface, sync problem, or misleading agent guidance, even when the boxholder did not ask. Do not use for feedback about an individual card, project, or other content inside this box.
---

${FEEDBACK_CLAUDE_MD}`;
