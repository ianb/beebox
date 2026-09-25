---
title: "Agent containment: an allowed-directories control plane (box escapes)"
workstream: open-source-readiness
needs: [design]
area: beebox
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
priority: normal
---

> **Deprioritized 2026-09-15 (boxholder).** "We can lower the priority on this
> one, as we're looking at containerization as the better restriction."
> Containers, not a permission control plane, are the primary containment
> story; this stays open as the bare-metal fallback. Priority lowered
> `important` → `normal`; `needs: [design]` stands. See
> [cross-box filesystem isolation](2026-09-04-cross-box-filesystem-isolation.md),
> which wants the same wall for a different reason.
>
> Two findings from that discussion, so the next session does not re-derive
> them. **The framing below sets up a tension that is not real**: a *deny* rule
> in Claude Code's permission config refuses non-interactively and never
> prompts, so "headless" and "contained" are compatible — only the undecided
> middle prompts. **What actually blocks any such control plane is one line**,
> `permissionMode: "bypassPermissions"` (`src/services/claude-chat.ts:103`),
> which skips the permission system including deny rules. The grant half is
> already plumbed end to end: `additionalDirectories` runs through
> `AgentInvocation` (`core/agent/types.ts:60`), the Claude path, the Codex
> path, and `codex-sdk-session.ts`. The refusal half does not exist because
> nothing refuses anything.
>
> The risk on the day `bypassPermissions` comes off is a tool call landing in
> the undecided middle and *prompting*, which for a headless wakeup is a hang
> rather than a refusal — discoverable only by running real wakeups with the
> mode off. A shadow pass (log what would have been denied or prompted, deny
> nothing) is the way to find that before flipping.

Today the box agent runs with the full Claude Code toolset and no
mechanical floor — it can read/write anywhere the OS user can. The
openclaw-hermes research triage already flagged this as the gap a
security-literate audience will probe first (both competitors gate
tools; we don't), and it's the substance behind the category's default
critique (blast radius, per the OpenClaw reception history).

Boxholder position (2026-07-20): "We are super open. I don't think we
can do permission dialogs, but shouldn't be open to absolutely
everything. So a control plane of allowed directories. Docker to be
stronger, but running without it is still good to support."

So the shape is:

- **No interactive permission dialogs** — box agents run headless
  (wakeups, reactors, schedules); a dialog nobody sees is a hang or an
  auto-approve.
- **A control plane of allowed directories** — the box's own directory
  plus operator-configured extras; everything else refused.
- **Scope constraint (boxholder, 2026-07-20): "Containment doesn't have
  to be perfect… setting boundaries and expectations using Claude
  Code's own features for that. Nothing that can't be expressed with
  existing config."** So: no custom enforcement engine. The control
  plane is beebox generating/managing the box's Claude Code
  permission configuration — settings `permissions` rules (deny/allow
  on file tools and Bash patterns), additional-directories grants, and
  whatever the SDK's existing settings surface expresses. Known
  bypass routes that existing config can't fully close (Bash
  indirection, symlinks) are accepted and *documented as expectations*
  in the security report rather than chased with custom code.
- **Docker as the stronger tier** — the container is a real wall and
  the blessed deploy path already has it; the hook floor is what makes
  bare-metal running honest rather than "trust the prompt."

Interlocks: the
[agent-maintained security report](../closed/features/2026-07-20-agent-maintained-security-report.md)
should *state* the containment model per tier (Docker vs bare) — this
feature is what makes that section say something real. The
[git-push-confirmation](../decisions/2026-07-20-git-push-confirmation.md)
question is the network-egress sibling of the same tension. Not a
launch gate per the
[posture](../decisions/2026-07-20-soft-launch-posture.md) — launch
honesty means security-overview.md describes what IS true today — but it's the
highest-value post-launch security build.
