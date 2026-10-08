---
title: "A starter declares what it needs and scripts its first turn"
workstream: unattached
area: beebox
needs: [design]
labels: [onboarding, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-imbue-studio-research — reading Imbue Studio's template manifests
---

The [target-specific-use-cases decision](../decisions/2026-10-05-target-specific-underserved-use-cases.md)
asks what "an easy way to start" is: a starter pack applied to an existing
box, a first-run choice, or a chat opener. Imbue Studio's templates
([research](../../research/imbue-studio/starter-templates.md)) are a worked
answer worth adapting, and they settle two things the decision leaves open.

**A starter is a manifest the agent acts on.** Studio's `template.toml`
declares, per starter: the permissions it needs (requested first, by the
agent, before any question), the secrets, which LLM path it uses, the packages,
and a short list of named adaptations each pointing at one file or variable.
Its "activate first, then ask how to adapt" rule and its done-when, "the user
can open it and see their OWN data", make the starter testable.

**The first turn is scripted.** A `welcome` skill forces the agent's first
message to name the starter, say what it needs in plain words, and end on
"connect your accounts now?". The generic welcome is forbidden.

## What Bee Box would do differently

- A starter is content and config inside an existing box (cards, views,
  schedules, a briefing with openers, connector prompts), not a bootable
  image. Box content templates (`beebox/src/core/box/templates.ts`) and
  openers (`beebox/docs/implemented-plans/first-run-openers.md`) are the
  mechanisms to extend.
- Required connector scopes and secrets are requested through the secret
  store's grants, not a gateway
  ([grant requests](2026-10-08-agent-files-a-grant-request.md)).
- One starter first, as the decision says; a catalog comes later if ever.

## Open

- Which starter first. The research argues for the
  [cross-tool to-do](2026-10-08-cross-tool-todo-as-a-target-use-case.md).
- Whether the journey for a starter is the test of its done-when.
- Where a starter's kick-off list lives:
  [landmarks carry starter messages](2026-10-08-landmarks-carry-starter-messages.md).
