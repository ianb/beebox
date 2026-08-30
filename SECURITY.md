# Security policy

## Reporting a vulnerability

Email **ianbicking@gmail.com**. Please don't open a public issue for anything
exploitable.

Everything else about security is welcome in the open queue (`issues/`) — design
questions, hardening ideas, "is this really safe?", and anything already
described in the documents below.

Expect a reply within a week. This is a personal project maintained by one
person, so there is no bounty program and no formal SLA.

## Supported versions

`main` only. There are no release branches and no backported fixes — a security
fix lands on `main` and is picked up by updating.

## Before you report

beebox is an agent that runs with real power on your own machine, and
several sharp edges are **known, documented, and deliberate** rather than
undiscovered. It runs Claude Code with no tool allowlist, so it can execute
arbitrary shell commands as the user running the box, and prompt injection from
untrusted content it ingests is an accepted, unmitigated risk today.

The [security overview](beebox/docs/security-overview.md) states these
plainly. Reading it first will tell you whether what you found is a genuine
vulnerability or one of the documented properties — both are worth raising, but
knowing which saves everyone time.

## The security documents

- **[Security overview](beebox/docs/security-overview.md)** — the
  readable account: threat model, what the agent can do, prompt injection, what
  leaves your machine, the authentication surface, accepted risks.
- **[Security report](beebox/docs/security-report.md)** — the structured
  accounting behind it: every endpoint and its auth, every credential and its
  blast radius, every egress point.
- **[`.claude/skills/security-report/SKILL.md`](.claude/skills/security-report/SKILL.md)**
  — the committed rubric that generates both. The documents are maintained by an
  agent and reviewed by a human; the process is auditable even where the
  artifact can't be.
