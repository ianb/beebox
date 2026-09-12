---
description: "Where box data lives, what leaves the machine, what the agent is allowed to do, and the prompt-injection risk."
---
# Your data and safety

Your data lives in the **box**: one directory on your machine, also a git
repository. There is no cloud service holding it. If you configure a git
remote, each wakeup pass pushes the box's full history there. Credentials are
kept in a machine-level store outside every box, and a box holds a grant to
the ones you allow it to use.

**What the agent may do.** The box agent runs Claude Code or Codex with
permissions bypassed and no tool allowlist. It can execute arbitrary shell
commands as the user the box runs as and read or write any file in the box.
Its working scope is the box directory by convention rather than by sandbox.
Treat "what can the agent do" and "what can Bee Box do" as one question.

**Prompt injection is the risk the project asks you to understand.** The
agent reads your private data, ingests untrusted external content such as
email bodies, web clippings, and calendar invites, and acts without a tool
allowlist. Text written by someone else can try to steer it. The security
documentation states plainly that there is no injection filter and no
containment sandbox today. What reduces the risk is how you run it: a
single-operator box, scheduled processing off until you enable it, and a few
actions that refuse to proceed without a human present.

**What leaves the machine.** Every agent turn sends its context to the model
provider; there is no opt-out, because that is the product. Voice goes to a
transcription vendor you configure. Google services, Telegram, web push, and
publishing send data only if you connect them. Gmail access requests read
and draft scopes and no send scope, so the system cannot send mail on its
own. The documentation states that the running system sends no telemetry,
analytics, crash reports, or update checks.

**Authentication is always on.** Every route sits behind a login wall, with
no flag that disables it. A box with no member list is owner-only.

Read [security/overview.md](security/overview.md) for the threat model,
accepted risks, and known limitations, including that boxes on one host share
an OS user and a browser origin.
