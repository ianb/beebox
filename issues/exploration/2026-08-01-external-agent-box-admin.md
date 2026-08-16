---
title: "A meta-assistant: teach the user's own external agent to manage the box + connectors + local setup"
workstream: unknown
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder's idea, riffing off the Every tools
labels: [soft-launch]
---

> **⭐ First-release candidate** — boxholder flagged this to look into for the
> first release (2026-08-01). Evaluate what (if anything) ships in v1; not yet a
> committed gate.

Give the boxholder a way to hand box administration to **the general-purpose agent
they already use** — their personal ChatGPT, Claude.ai, or Claude Desktop — rather
than doing the fiddly setup themselves or asking the box's own internal agent (which
cannot reach the user's laptop or external services). callback-box would ship
something that **teaches an external agent how to manage a box**: set up the
uploader (WIP), configure a connector, stand up Tailscale, SSH into the box and fix
something, or install computer-local pieces. The comparison is the **Every tools** —
a product shipping agent-facing tooling for itself.

The key distinction: this is the **user's own agent, acting from outside**, not the
box's internal agent. It runs where the user is (their laptop / their chat app) and
can do local-machine and external-service work the in-box agent structurally cannot.

## Job to be done

When the boxholder is setting up or repairing their box and hits a fiddly
admin/local task — connect a connector, get the bulk uploader working, make
Tailscale reach the box, SSH in to fix a wedged service — they want to hand it to
the assistant they already have open, so it gets done without them becoming a
callback-box operator who memorizes CLI flags. Situate it: they are at their
laptop, mid-setup, low patience for arcana, and their ChatGPT / Claude is one tab
away. The win is delegating operator work to an agent that is already in the room.

A second situation: something breaks on the deployed box and the boxholder is not
at a terminal with the repo. "Tell my assistant to SSH in and restart the wedged
box" is a very different capability from "open the repo and run the deploy script."

## The open question: what is the delivery mechanism? (a spectrum)

Unsettled, and the boxholder floated the whole range — from heavy to light:

1. **An admin MCP server.** callback-box ships an MCP server exposing box-management
   tools (setup-uploader, configure-connector, tailscale-setup, health, ssh-and-fix)
   that any MCP-capable host (Claude Desktop, ChatGPT-with-MCP) loads. Most capable,
   most infrastructure, sharpest security questions.
2. **Skills / plugins.** Packaged skill(s) that teach an agent the procedures — the
   model already used for `canvas-loop-sketch` and Claude Code skills. Lighter;
   works wherever skills/plugins are supported.
3. **A prompt copied from the box.** The lightest: the box surfaces a
   prompt/instructions the user pastes into their assistant — "to set up X, follow
   these steps / initiate this skill." Zero infrastructure; just words the box hands
   out. A good MVP that proves the job before building an MCP server.

These are not exclusive. A copied prompt (3) could bootstrap a skill (2); an MCP
server (1) is the eventual heavy end. Start by proving the job with the lightest
thing that works.

## The crux: security, and where the agent runs

Two hard constraints shape every option:

- **Handing admin capability to an external agent is the real risk.** An agent that
  can SSH into the box, hold credentials, or reconfigure connectors is a large trust
  grant to something running inside ChatGPT / Claude.ai. Scoping (what it may do),
  credential custody (whose keys, stored where), and a clear boundary between
  "read/setup" and "destructive/admin" are the design core — the same tension as the
  connector-auth work (device tokens, Nango). Do not let a convenience prompt smuggle
  in unscoped SSH-as-root.
- **Local tasks need a local execution context.** Installing an uploader, running
  `cb tailscale setup`, or SSHing in requires an agent host that can execute on the
  user's machine (Claude Desktop, Claude Code, a local MCP server) — a pure cloud
  ChatGPT cannot reach the laptop or the box. So the mechanism's reach depends on the
  host's capabilities; a cloud chat is limited to guidance, a local agent can act.
  The design should be explicit about which host does which job.

## Overlaps with existing work (the meta-assistant would orchestrate these)

- [pub-access setup via API not dashboard](../features/2026-07-19-pub-access-setup-via-api-not-dashboard.md)
  — a setup flow already being made scriptable; a natural thing to hand off.
- [BYO Google OAuth / self-host story](../decisions/2026-07-28-byo-google-oauth-self-host-story.md)
  — connector auth is the hardest admin task and the sharpest security case.
- [cb tailscale operational polish](../features/2026-07-22-cb-tailscale-dev-router-operational-polish.md)
  — the Tailscale setup an external agent would drive.
- The WIP bulk uploader (chat-photo-batch-upload / bulk-file-upload) — the boxholder
  named "set up an uploader" as a first example task.

## Research (incomplete)

- What do the Every tools actually ship for external agents (MCP, skills, a plugin,
  a pasteable prompt)? Model the lightest thing that delivers a real job.
- Which hosts can execute locally (Claude Desktop / Claude Code / ChatGPT MCP) and
  what each can and cannot reach, so the mechanism matches the host.
</content>
