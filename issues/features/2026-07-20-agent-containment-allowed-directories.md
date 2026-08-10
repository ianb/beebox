---
title: "Agent containment: an allowed-directories control plane (box escapes)"
workstream: open-source-readiness
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
---

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
  plane is callback-box generating/managing the box's Claude Code
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
[agent-maintained security report](2026-07-20-agent-maintained-security-report.md)
should *state* the containment model per tier (Docker vs bare) — this
feature is what makes that section say something real. The
[git-push-confirmation](../decisions/2026-07-20-git-push-confirmation.md)
question is the network-egress sibling of the same tension. Not a
launch gate per the
[posture](../decisions/2026-07-20-soft-launch-posture.md) — launch
honesty means SECURITY.md describes what IS true today — but it's the
highest-value post-launch security build.
