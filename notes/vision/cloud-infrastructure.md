# Bee Box — Cloud Infrastructure Plan

## What is Bee Box?

A personal assistant/automation platform built on Claude Code. A composable, self-extending workflow system where:

- Workflows are represented as files committed to git (introspectable, auditable, version-controlled)
- Building blocks include agentic workflows, dynamically-generated scripts, and connectors
- Components serve the user's personal goals — email processing, calendar intake, etc. are utilities, not endpoints
- The system can recognize existing primitives and compose/extend new workflows from them
- Uses git + LFS for state management and history

## Architecture: Hybrid Local + Cloud

**Local (laptop):** Primary development environment. Low friction, fast iteration. Pushes all changes to git constantly. Runs interactive/responsive workflows when laptop is open.

**Cloud (small DigitalOcean droplet):** Always-on for scheduled tasks and background processing. Pulls from git regularly before each scheduled run. Handles fetching, processing, and notifications to mobile. Treated as disposable — all real state lives in git.

**Coordination:** Git is the coordination layer between devices. Droplet pulls fresh code before running scheduled tasks.

## What the Droplet Runs

- `bbx wakeup` on cron (scheduled tasks, connector sync, triage)
- Web server (Telegram webhook endpoint, mobile chat UI)
- Persistent chat sessions (ChatSessionPool — one active Claude process at a time per box)
- Git pull before each scheduled run, push after

## Latency Update (2026-02-27)

Original assumption was ~30s minimum Claude Code response time, making infra latency irrelevant. Persistent per-thread sessions (stream-json protocol, `<chat-response>` tag interception) brought chat response time down significantly. This means:

- Cloud server can handle responsive Telegram chat even when laptop is closed
- Chat sessions survive across messages (parked/resumed via session ID)
- First message on a new session is slower (process startup); subsequent messages are fast

## Multi-User & Group Boxes — Top Priority

The system needs to support multiple boxes for different people and groups:

- Family boxes, group boxes (e.g., one shared with Mateo)
- Each box is its own git repo with its own config, connectors, and store
- One droplet can run multiple boxes (each with its own web server port / route prefix)
- Each box may have its own Telegram bot, its own connectors, its own personality

### Open questions for multi-box:

- **Routing:** One reverse proxy (Nginx) routing to per-box web servers? Or one server process handling all boxes?
- **Resource limits:** Each box can spawn Claude processes. Need to manage how many are active at once across boxes.
- **Permissions:** Who can interact with which box? Telegram chat ID mapping handles this implicitly for Telegram, but the web UI needs auth.
- **Shared vs separate git remotes:** Each box is its own repo. Do they all live on the same droplet as separate bare repos?

## Requirements

**Droplet setup (fully scriptable):** Bash bootstrap script. Pull git repo(s), install deps, set up cron. Reverse proxy (Nginx) for domain access and mobile chat interface. Everything reproducible — if the droplet dies, spin up a new one from the script.

**Git server:** Droplet acts as a git remote via SSH. Set up bare repo per box, configure SSH keys. Both local and droplet have complete copies. Using git LFS.

**Domain & DNS:** Using Cloudflare. Automate DNS record updates via Cloudflare API to point domain to droplet IP. DigitalOcean API to script droplet creation.

**Mobile access:** Custom chat interface accessible from phone. Notifications pushed to mobile devices.

## Key Constraints

- Droplet doesn't need to be powerful — just coordination and scheduling
- Browser automation may have issues on cloud servers (blocking, CAPTCHAs) — defer this
- Server is low-value/disposable — all important state in git

## Git Sync Concerns

If both local and cloud are making commits (e.g., chat on cloud while developing locally), merge conflicts in thread files could get messy. Possible approaches:

- Pull-before-write discipline on both sides
- Sync daemon that pulls/pushes frequently
- Accept occasional conflicts; thread files are append-only so conflicts are resolvable mechanically

## Authentication & User Awareness

- Cloudflare authentication for the web UI
- Google logins (proper OAuth) so the system knows who's interacting
- System needs to become user-aware — different people interact with different boxes, and within a box the system should know who it's talking to

### Trust Model

- Starting with semi-trusted groups (family, friends) — not adversarial
- "Security by politeness" is acceptable at first — users can do things if they want to, and that's fine
- Users creating their own email addresses, drafting emails, etc. — interesting capabilities to enable rather than restrict

### Group Chat as Default

- Telegram chat is currently one-on-one, and that's fine for each permitted user
- But **group interaction is more interesting** and solves multiple problems:
  - People see each other's interactions — builds shared understanding
  - Bigger picture of what's happening in the box
  - Permission issues are less fraught when everything is visible to the group
- Web chat should be group-based by default
  - Users can create their own threads/sessions
  - But sessions are visible to everyone in the group
  - Everyone gets a notification when a new session is created
- Transparency as a feature: doing things in front of everyone reduces the need for fine-grained permissions

### Per-User Permission Levels

- A box has multiple users, not all at the same permission level
- Simple approach: use prompting to tell the agent what each user can do (soft enforcement)
- Harder approach: actually drop OS-level privileges when processing a message from a specific user
  - Receive message → identify sender → drop filesystem permissions for the duration of processing
  - Would provide real isolation — agent literally can't read/write files outside the user's scope
  - Question: does this work in practice? Claude Code runs as a process, could use Unix users/groups or namespaces
  - Interesting but maybe overkill for the semi-trusted starting point

## Email Integration Options

**Goal:** Import a subset of email into a box — e.g., school-tagged emails for family use.

**Option A — Gmail polling with label/tag filter:**
- Poll Gmail API for messages with a specific label
- Good for curated subsets (school notifications are already tagged)
- Concern: how to keep email connector config from being editable by agents inside the box? For now, handle manually. Longer term, need a "system config vs box config" boundary.

**Option B — Email forwarding:**
- Set up a forwarding rule in Gmail to send tagged emails to a dedicated inbox
- Simpler than polling — no Gmail API credentials needed in the box

**Option C — AgentMail (https://www.agentmail.to):**
- Email inboxes designed for AI agents. API-first, supports receiving + sending + threading.
- Free tier: 3 inboxes, 3,000 emails/month, 3GB storage — sufficient to start
- $20/month developer tier: 10 inboxes, 10K emails/month
- Could give each box its own inbox, forward relevant emails there
- Interesting because it's purpose-built for this use case

**Likely approach:** AgentMail or forwarding for the family/school use case. Avoids the complexity of Gmail API polling and the config-editability concern.

## Deployment Model

- Cloud-primary may be the right default — run most boxes on the cloud, maybe some locally
- Not necessarily multi-homed (same box on both local and cloud simultaneously)
- Could just run some boxes locally for development and everything else on the cloud
- This simplifies the git sync problem — no concurrent writers

## Box & Group Management

### Automation Goals

- Automate group/box creation as much as possible
- Easy to create a new box with a new group
- Easy to add and remove people from a group
- For things that can't be automated (e.g., creating a Telegram bot), generate checklists with step-by-step instructions — printed checklists work great for this

### Setup Wizard via Setup Card

- When creating a new box/group, create a **setup card** — a card that describes what needs to be configured
- The agent talks to the user to collect needed information (box name, members, which connectors, etc.)
- Agent fills in the setup card progressively through conversation
- Once complete, a script (mostly agentic) takes the setup card and explodes it out into all the right places:
  - Config files, connector setup, user records, Telegram bot config, etc.
- Setup card is deleted once applied
- **Reusable pattern:** could recreate a setup card anytime to describe general changes, re-run the setup process. Like a declarative config step that gets applied and cleaned up.
- This is basically: describe the desired state in one place → agent applies it everywhere → remove the description
- Same pattern applies to **migrations** — setup card describing what changed, agent applies it across the box. Can defer until actually needed, but won't be long.

## Secrets Management

Bot tokens, API keys currently in box config files committed to git. Fine for single-user local, but with multiple boxes on a shared droplet:

- Consider `.env` files or a secrets directory excluded from git
- Or encrypt secrets in git (git-crypt, SOPS)
- Or just keep config files in git but restrict repo access — simplest for now
