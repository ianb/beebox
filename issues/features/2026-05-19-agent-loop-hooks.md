---
title: "agent loop hooks"
workstream: unknown
needs: [design]
area: beebox
---

beebox already uses hook-shaped mechanisms at the system level: pre-commit card validation, post-commit auto-deploy, the wakeup cycle as a scheduled trigger. What it doesn't currently expose is *agent-loop* hooks — runtime events that fire before/after specific agent actions, executed deterministically by the runtime rather than relying on the agent to remember.

The principle: if a behavior must happen reliably every time, it's a hook, not an instruction. Memory and prompts *recommend*; hooks *enforce*. Anything currently encoded as "the agent should always..." is a candidate.

Candidates from ideas already in this file:

- **Reflexive person-profile loading** ([Reflexive person-profile loading + person-as-directory promotion](2026-05-19-reflexive-person-profile-loading.md)). Currently framed as a rule. A hook that runs before any draft-message operation and injects the recipient's profile makes this enforced, not optional.
- **Session-end compaction triggering** ([Overnight session compaction with custom compaction message](../closed/features/2026-05-19-overnight-session-compaction.md)). A session-end hook fires the compaction deterministically.
- **Health-check surfacing at session start** ([Scheduled-task health surfacing](../closed/features/2026-05-19-scheduled-task-health-surfacing.md)). Session-start hook reads task health and prepends to the agent's context if anything's overdue.
- **Pre-irreversible-action gates** ([Declared per-box autonomy matrix with encounter queue](../exploration/2026-05-19-autonomy-matrix.md)). A hook on irreversible operations triggers confirmation, rather than relying on the agent to check.
- **Link enforcement** (*Link, don't name* in [prompt-audits.md](../../beebox/docs/prompt-audits.md#link-dont-name) audit). A post-output hook could detect bare resource names and either reject the output or rewrite to link form.

Open questions:
- **Where does the hook live?** In `bbx` (the CLI) for operations going through it. In the chat runtime for chat-context hooks. Probably both, with a shared definition format.
- **What's the right event vocabulary?** `pre-tool-use`, `post-tool-use`, `session-start`, `session-end` map well from Claude Code. beebox has additional candidates: `pre-card-create`, `post-card-create`, `pre-external-send`, etc. Worth defining the set explicitly.
- **Where do hooks get configured?** Per-box in `config/hooks.json`? At the system level? Both, with precedence?
- **Failure behavior.** What happens if a hook fails? Block the operation, log and continue, ask the boxholder? Probably depends on hook type (validation hooks block, observation hooks log).

The bigger framing question: this is the same insight as "use hooks instead of memory" at the personal-config layer, applied to the agent-loop layer. beebox has hooks at the git layer (pre-commit/post-commit) and at the scheduler layer (wakeup). Adding them at the agent-loop layer would be a third tier.
