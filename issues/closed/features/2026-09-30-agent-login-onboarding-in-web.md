---
title: "Agent sign-in onboarding: route \"not logged in\" to Admin → Agents, and offer Claude Code and Codex as peers at first run"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-installable-app — first chat in the Mac spike app
resolution: implemented
---

> **Closed 2026-10-05: implemented, in the shape the boxholder chose.**
> `agents.readiness` (`beebox/src/core/agent/readiness.ts`) reports whether
> a Claude Code login, a Codex login, or an OpenRouter key with an added
> model can run. While none can, the composer is replaced by a notice and an
> owner opening the box lands on Admin → Agents (OpenRouter now last there).
> A default that cannot run moves to one that can. The boxholder's direction
> replaced the first-run "pick an agent" step proposed below.


Job: a new boxholder who installed a packaged box (container, Mac app, NAS)
sends a first chat message and needs an agent account connected. They have
no terminal into the machine that runs the box.

Today the first message fails with a banner: "Claude Code is not logged in
— run `claude auth login` on this machine"
(`beebox/src/core/agent/auth-preflight.ts:34`; the Codex message at `:45`
says to run `codex login --device-auth` as the service user). Both are
instructions for a shell the boxholder of a packaged install does not have.

The web flows already exist: Admin → Agents holds the engine choice and the
Claude Code and Codex sign-in sections
(`beebox/src/frontend/src/components/admin/ClaudeCodeSection.tsx`,
`CodexSection.tsx`, tab list in `components/admin/sections.ts:75`).

What is missing:

- The not-logged-in error links to Admin → Agents for someone who can act
  there, and says who can for someone who cannot. The CLI command stays as
  secondary text for operators.
- First-run setup ends with a "connect an agent" step that offers Claude
  Code and Codex as equal choices and sets the engine from the choice. The
  boxholder raised this: neither should read as the default.
- The container image has no `codex` on PATH
  ([docker-image-missing-qpdf-and-docling](../bugs/2026-09-29-docker-image-missing-qpdf-and-docling.md));
  check that the Codex section works in the container before relying on it.
