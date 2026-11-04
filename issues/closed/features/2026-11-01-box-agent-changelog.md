---
title: "Keep a changelog for the box agent: what changed in its own behavior and tools"
workstream: agent-changelog
design: ../../../beebox/docs/implemented-plans/agent-changes.md
area: beebox
labels: [agent, agent-guide, updates]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder conversation, 2026-11-01"
resolution: implemented
---

**Closed (implemented, 2026-11-01):** Landed on worktree-agent-changelog: box doc, doc-check limits, guide pointer, curator schedule. The curator has not run a real session; its first tick records a baseline.

After a deploy, a box agent reads the regenerated agent guide
(`beebox/src/core/agent-guide/`, written into the box by `bbx docs refresh`).
The guide describes the current system, but nothing tells the agent what is
different from last time. So the agent keeps habits that no longer apply: it
uses a workaround after the fix lands, misses a new command, or tells a person
that something is impossible when it now works. Nothing records which version
a box last saw.

The boxholder's ask: maintain a changelog written for the box agent. It covers
behavior changes the agent would see, such as new or changed `bbx` commands,
card types and fields, tools, prompt and guide rules, removed features, and
fixed limitations it may have learned to work around. It leaves out internal
refactors and dev tooling.

Questions to settle:

- **Who writes entries.** One option is to write an entry in the same commit
  as the change, as a step the finish skill checks. The other is a
  scheduled agent that summarizes shipped commits since the last entry. Prod
  deploys every commit to main, so the entries cannot wait for a release.
- **How the agent sees it.** Whether the agent sees recent entries in the
  guide, sees entries newer than this box's last-seen marker (which needs a
  per-box marker), or looks them up with `bbx` on demand. The entries must not
  grow the always-loaded context without bound.
- **Format.** Dated entries, each with the commit that shipped it, so a box
  can say "since <date>".
- **Person-facing use.** The same entries could later feed a "What's new"
  list for people. That is a separate audience and wording; keep it out of
  scope unless it falls out cheaply.

Neighbor: `issues/decisions/2026-07-20-release-discipline-and-update-story.md`
(release notes and how an operator learns of an update). This issue is the
agent-facing half.
