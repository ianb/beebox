# Studio against Bee Box, with dispositions (2026-10-08)

Each row traces to a Bee Box file, plan, or decision. Dispositions: **adopt**,
**adapt**, **reject**, **later**. Studio facts come from the code notes in this
directory; Bee Box facts from the docs named. No hands-on Studio use.

## Summary table

| Area | Studio | Bee Box today | Disposition |
|---|---|---|---|
| Right-click to modify | Context menu on any element, shell included: Copy reference / Explain… / Modify…; a DOM-derived JSON reference is attached to the chat; the agent greps the app's source, edits, restarts, and refreshes every window | Selections carry a reference to the agent (`src/frontend/src/lib/selection/`); the agent points back at controls (`plans/agent-points-at-ui.md`); views are box-authored JSX on a card | **adapt** the "Modify…" entry on box-authored views and cards; **reject** it on the app shell |
| Default-deny per-action permissions | Every third-party call leaves through a gateway with detent rules; the agent files a permission request, the user approves in a dialog; grants per scope per account | Secrets granted per box at `server` or `agent` level (`docs/secrets.md`); OAuth scopes fixed per connector; no request-level mediation | **adapt** the request-and-approve flow; **reject** an HTTP gateway |
| Cloud or local, export | Electron over Docker (Linux) or a Lima VM (macOS); the workspace is a git repo; restic backups; a cloud workspace restores onto any machine | Container-first; boxes are git repos; `research/installable-app/` chose VM-app "later" | **later**, unchanged; take two concrete mechanisms (image delivery, substrate-independent restore) |
| Model switching | Provider = harness; same-harness account rebind restarts the agent; cross-harness switch is a summary-file handoff | Engine fixed at birth, model switchable; GLM and OpenRouter on the claude engine (`docs/model-policy.md`) | **reject** mid-chat harness switching; **later** the handoff summary |
| Integrations, cross-tool to-do | ~35 latchkey services by browser-captured credentials; per-app JSON stores; task-inbox is read-only Slack+Gmail(+Granola) with LLM extraction, no write-back | Four connectors sync into cards; todos are `{% todo %}` tags queried box-wide (`docs/box/todos.md`); no Slack | **adopt** the use case; **reject** the per-app silo |
| Scheduled work | Cron drop-ins and a `run_job.sh` runner that catches up after downtime; one singleton agent per scheduled skill; a weekly Caretaker, off by default; no starter uses any of it | Scheduled-script cards, launchd daemon, sleep recovery, quota deferral (`docs/scheduler.md`) | **reject**; nothing to take |
| Starter templates | 42-entry catalog; a template is a whole image plus one app and a `template.toml` of required permissions and adaptations; a welcome skill scripts the first turn | Box content templates (`beebox/src/core/box/templates.ts`), chat openers, journeys; the decision of 2026-10-05 asks for starters | **adapt** the manifest and the first-turn script |
| Self-modification | The whole shell, chat app, and skills live in the workspace repo; an `update-self` skill merges upstream | Boxes contain no app code (`docs/box-layout.md`); extension is schemas, skills, views (`docs/design/extensibility.md`) | **reject** for the shell; **later** for themes |
| Sharing | Share one app or the whole studio by email or domain; live over Imbue's relay; visitors log in through Imbue's broker | Static publishing with public or secret links (`docs/publishing.md`); members; paired devices | **later** |
| Positioning | "Personal AI operating system"; "Personal Computing 2.0"; "made by humans, not by companies" | General box, pitch undecided; the 2026-10-05 decision to target specific use cases | **adopt** the use-case-first on-ramp; **reject** the OS framing |

## 1. Right-click to modify

**What Studio does.** See [architecture.md](architecture.md) §4. One
`contextmenu` listener is served into every app page and the shell. On a
right-click it builds a JSON reference from the DOM as it is: tag, id,
classes, attributes, role, aria label, a selector checked to match alone, the
selected text, the input value, link and image targets, the pointer position,
and which app, window, and desktop. No component or source-file mapping is
captured; the agent "resolves it by grep and by reading the page, never
through a registry". The rows are "Copy reference", "Explain…", and
"Modify…"; the last drafts `Change REF-… to ` plus the JSON into the current
chat, where the composer uploads the JSON as a `REF-<id>.json` attachment.
The agent's instructions say: start from `app` and `page_path`, grep that
app's frontend for the id and classes. After the edit, the `update-app` skill
restarts the program and reloads every page of that app on every client. The
shell is an app in the same repo, so "make yourself Windows 95" is the same
loop with a preview-and-apply step for critical apps.

**What Bee Box has.** The selection scheme already carries "what the user is
pointing at" to the agent, with a freeform position string
(`plans/agent-points-at-ui.md`, "What already exists"). Box-authored views are
JSX compiled per view (`beebox/src/webapp/views/compiler/compile.ts`), hang off a
card (`?view=`), and are a security-sensitive surface that must not widen
beyond card viewing (`implemented-plans/card-view-widgets.md`). The app shell is
not in the box.

**Disposition.**

- **Adapt** on views and cards: a "Modify this view…" entry (and "Explain")
  on a box-authored view or a card renderer that opens chat with a reference to
  the view file and the card. The agent already authors the view; the menu
  removes the "which file is this?" step. Bee Box can do better than a DOM
  dump: a view is one compiled file on one card, so the reference can name
  the view file and the card path directly, in the existing selection token.
- **Reject** on the app shell. The shell is shipped code, tested and reviewed;
  letting a box agent patch it breaks the "boxes contain no app code" rule,
  the upgrade path, and the review gates. Studio's own template drift shows the
  cost: every starter carries a stale 36 KB `CLAUDE.md` and lacks six skills the
  base added since ([starter-templates.md](starter-templates.md) §1).
- Filed: [right-click modify on box-authored views](../../issues/features/2026-10-08-modify-this-view-from-the-context-menu.md).

## 2. Default-deny permissions

**What Studio does.** [permissions-models-integrations.md](permissions-models-integrations.md) §1.
Credentials never enter the container. `latchkey curl` forwards to a gateway
on the user's machine, which checks detent rules keyed `<scope>:<account>` and
materialized deny-by-default per agent. The agent files a request by POSTing
to a reserved host and ending its turn; a PreToolUse hook blocks any chained
or piped form of that call so the chat can render an approval card. The
desktop app shows "Approving will let the agent…" with a switch per catalog
permission. Revocation is a toggle in the app, not chat.

**Where the claim and the code part.** "Label emails but not send or delete
them" is not expressible with the shipped catalog: label application is
`messages/{id}/modify`, which only the `write-messages` schema matches, and that
schema also matches send and delete. The OAuth grant is `gmail.modify`
regardless. Plain `curl` from the container is unmediated; the gateway governs
only calls routed through it. Secrets the gateway cannot inject sit in
`data/.secrets/*.env` behind a text-matching hook that its own README calls "a
backstop against a slip, not a boundary".

**What Bee Box has.** One machine-level store, grants per box, `server` or
`agent` access level, every agent resolve logged, declared and observed uses
per secret (`docs/secrets.md`). Connector scopes are OAuth scopes
(`gmail.readonly`, `gmail.compose`, `drive.file`, `docs/connectors/google-auth.md`).
Box-authored code with an `agent` grant can call anything with the key.

**Disposition.**

- **Adapt** the request-and-approve flow: an agent that needs a secret or
  a connector scope it lacks files a request card with a rationale; the
  boxholder approves on the admin page or in chat. The secrets plan already
  names a chat capture widget as a later chunk; this is the grant half of it.
  Enforcement stays where it is (the store and the grant), so the card changes
  nothing about what code can do, only how a grant gets asked for.
- **Reject** an HTTP gateway with a rule catalog. It is a second permission
  system beside grants and OAuth scopes (two tiers of anything is a smell), it
  does not cover direct egress, and Studio's own catalog cannot express its
  marketing example. Bee Box's honest position is the one in
  `docs/security-overview.md`: say what the grant covers.
- **Adopt** one rule from the hook: a request that must be seen by the user
  is a standalone call that ends the turn. Bee Box's questions subsystem
  (`docs/questions.md`) already has that shape.
- Filed: [grant requests the agent can file](../../issues/features/2026-10-08-agent-files-a-grant-request.md).

## 3. Cloud or local, and export

**What Studio does.** [architecture.md](architecture.md) §1 and §7. One
Electron app (ToDesktop, v0.8.5, mac and linux) runs a Python backend that
creates workspaces with `mngr`: Docker with gVisor on Linux, a Lima VM with
runc as root on macOS, or Imbue Cloud. The macOS VM image ships prebuilt,
fetched as content-defined chunks (`desync`) and verified with a minisign
signature instead of being built in the VM. A workspace is a git repo of
code, skills, config, and docs; everything the user made (`data/`), the
agent's memory, and the chat transcripts (under the provider account's config
directory) are outside git and reach another machine only through hourly
restic backups to R2 under a key held in the workspace. The glossary says
backups are "substrate-independent: a workspace's data can be restored onto a
different machine", which is the "download a cloud studio and run it locally"
claim; the desktop app can also export the latest snapshot as a zip without
the workspace running. Account state syncs across devices "end-to-end
encrypted" (changelog), but workspace contents are not: the mngr audit says a
running cloud slice "is not private from the operator", and the research-preview
terms license user content for model training.

**What Bee Box has.** Container-first ([container-install](../../issues/features/2026-09-06-container-install-is-the-primary-path.md)),
boxes as git repos with a remote as the backup, and the installable-app
research, which rated a VM-wrapping Mac app "later" with three open items:
memory sizing, a stable address, and image delivery
([phase1-spike-app.md](../installable-app/phase1-spike-app.md)). A Mac
companion app is filed separately ([mac-companion-app](../../issues/features/2026-10-07-mac-companion-app.md)).

**Disposition.**

- **Later**, unchanged. Studio is evidence that option B (Electron over a
  Linux VM running the image) ships at a six-person team, and also evidence of
  its weight: a ToDesktop pipeline, release channels with staged rollout, crash
  pages, and a 2 s intro animation documented at length.
- **Adopt** one mechanism when the Mac app is picked up: signed, chunked
  prebuilt image delivery (the phase 1 open item). Recorded on the Mac
  companion app issue.
- **Keep** Bee Box's export story as it is. A box is one git repo holding the
  content; Studio needs a backup service and a key to move what the user made.
  The planned `EXPORT.md`
  ([export-md-agent-instructions](../../issues/features/2026-07-20-export-md-agent-instructions.md))
  can say this in one paragraph.
- **Reject** the encryption and open-source claims as a model. Bee Box's
  security overview is the right register; Studio's launch wording outruns
  its code, its terms, and its licence files (the shell and desktop app are
  Fair Core licensed; the template repo has no licence).

## 4. Model switching

**What Studio does.** [permissions-models-integrations.md](permissions-models-integrations.md) §2.
A provider is a harness: Claude Code, Codex, pi-coding (OpenRouter, Z.ai, keys),
opencode, Antigravity. A chat binds to an account folder at create. Switching
accounts on the same harness restarts the agent. Switching harness archives the
agent, has it write a `/handoff-summary` markdown file, and seeds a new agent
with that file; the transcript shows an `agent_switch` chip. "Keeping context
and memory" means that summary plus `data/memories/` on disk.

**What Bee Box has.** Engine fixed at birth because transcripts live in
different stores and models are engine-scoped (`docs/model-policy.md`, "A
chat's engine is fixed at birth"); the model dial is free; GLM and OpenRouter
models run on the claude engine through Anthropic-compatible endpoints, and
sessions "may move between providers freely" because transcripts are local.

**Disposition.**

- **Reject** mid-chat harness switching. Bee Box already gets most of the
  benefit (Claude, GLM, DeepSeek, Kimi, Qwen in one chat) without a summary
  handoff, because it switches the endpoint under one harness. The remaining
  case, Claude to Codex mid-chat, is exactly the one the policy doc declines
  for a stated reason.
- **Later**: the handoff-summary pattern is a reasonable answer if a boxholder
  ever asks for it. Note it on the policy doc only when that happens.

## 5. Integrations and the cross-tool to-do

**What Studio does.** [starter-templates.md](starter-templates.md) §3 and
[permissions-models-integrations.md](permissions-models-integrations.md) §3.
Integrations are HTTP calls through latchkey to ~35 services whose credentials
were captured from a browser login, plus custom services, MCP servers through
`mcpc`, and a stealth Playwright browser. Each app keeps its own store:
task-inbox has a dozen JSON files under `data/.apps/task-inbox/`, megabox keeps
drafts in browser localStorage. The hero demo, "turn your calendar, email and
Slack into a to-do list that updates in real time", is the task-inbox shape:
deterministic fetch, an LLM extraction pass (`claude-sonnet-4-6` with a fixed
field spec), deterministic assembly, bucketing by due date, three refreshes a
day from a bash loop, and no write-back to Slack or Gmail. daily-digest is the
one template that writes decisions back (archive, label, trash in Gmail).

**What Bee Box has.** Connectors sync into cards and commit (`docs/connectors.md`);
todos are tags inside cards with `start`/`due`/`assigned`, one query path, and
a review sweep (`docs/box/todos.md`); triage turns inbound items into handled
work (`docs/triage.md`). There is no Slack connector, and the todo sweep and
connector schedules are seeded disabled
([agent-assigned todos](../../issues/features/2026-09-24-agent-assigned-todos-have-no-pickup.md)).

**Disposition.**

- **Adopt** the use case as a candidate for the 2026-10-05 decision: "one
  live list of what I said I'd do and what was asked of me, from email,
  calendar, and chat". Bee Box's substrate is better suited than Studio's (one
  card store, one todo vocabulary, write-back through the Gmail and Calendar
  connectors already exists), and the gap is one connector and a starter.
  task-inbox's "deterministic fetch → judgement → deterministic assemble" is
  the procedure shape Bee Box already uses (`docs/procedure-implementation.md`).
- **Reject** per-app data silos. Studio's "live to-do" cannot be queried
  beside the user's other records; Bee Box's can.
- Filed: [the cross-tool to-do as a target use case](../../issues/features/2026-10-08-cross-tool-todo-as-a-target-use-case.md),
  which names the Slack connector as the missing piece.

## 6. Scheduled work

Studio's base has `system/libs/automations/`: cron drop-ins call a runner
every minute that runs a job at most once per interval, catches up the first
minute the machine is back after downtime, and retries a run killed
mid-flight; each scheduled skill gets one singleton agent whose chat is
cleared and re-sent `/<skill>` on every run. The weekly Caretaker (service
health, log errors, disk, OOM sheds) is off until the user enables it and its
first run is look-only. The glossary still marks automations "[future]", and
no starter uses the runner; the two that refresh unattended use in-process or
bash sleep loops. The launch copy's "scheduled tasks run 24/7 while your
machine is online" is the honest version; a stopped local container runs
nothing. Bee Box's scheduler (`docs/scheduler.md`) has the same catch-up and
adds quota deferral, inconclusive verdicts, and per-box logs. **Reject**;
nothing to take. The one adjacent idea, a weekly self-maintenance run, Bee
Box already has as `refresh-maps`, `gc-procedure-runs`, and
`process-retrospective`.

## 7. Starter templates against "target specific underserved use cases"

**What Studio does.** [starter-templates.md](starter-templates.md). The empty
workspace opens a Getting Started window beside chat with tiles ("Build a new
app", "Start from a template", "Connect your data", "Set up a routine") and six
shelves of a 42-entry catalog. A template is one finished app on the full image
with a three-file manifest. `template.toml` lists `[[requirements.permission]]`
(acted on first, before any question), secrets, the LLM path, environment
packages, and `[[requirements.adaptation]]` entries that point at a specific
file and variable. A `welcome` skill forces the first turn: name the template,
say what it needs, end on "connect your accounts now?"; the definition of done
is "the user can open it and see their OWN data". Adaptation history is
append-only; lineage records which repo a template came from.

**What Bee Box has.** The decision of 2026-10-05 lists the candidates (lending,
inventory, reconnecting, chemistry, newcomer, meal planning, scanned paper) and
asks what "get started" is: a starter pack, a first-run choice, or a chat
opener. Box content templates exist; chat openers exist; journeys are the
evidence method.

**Disposition.**

- **Adapt** the manifest: a starter declares the cards, views, schedules it
  adds, the connector scopes and secrets it needs (requested first, by the
  agent), and a short list of named adaptations. This is the "starter pack
  applied to an existing box" option in the decision, made concrete.
- **Adapt** the scripted first turn and its done-when: the starter is live
  when the person sees their own data in it, and the agent's first message
  ends on that question. Bee Box's openers are the mechanism to seed it.
- **Reject** templates as whole images. A Bee Box starter is content and
  config inside a box, not a box.
- **Reject** the catalog as a product surface for now; one starter done well
  comes first, as the decision says.
- Filed: [starter manifest and first turn](../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md).

## 8. Self-modification

Studio puts the shell, the chat app, the skills, and the hooks in the user's
repo, so the agent can rewrite any of them; `update-self` merges the upstream
template over local edits. The demo's "Windows 95" is a theme change to the
shell. Bee Box keeps app code out of boxes by rule and extends through typed
artifacts. **Reject** for the shell (see §1 for the drift evidence). **Later**
for appearance: the box-authored themes exploration
([box-authored-themes](../../issues/exploration/2026-09-08-box-authored-themes.md))
and the closed-builtin theme decision
([theme-is-a-closed-builtin](../../issues/decisions/2026-09-11-theme-is-a-closed-builtin-that-blocks-box-themes.md))
are the right scope: validated data, not code. The demo shows the demand is
real.

## 9. Sharing

"Send a link" shares a live app over Imbue's relay to people who log in
through Imbue's broker; a grants file is re-read per request. Bee Box publishes
static sites (public or secret link) and has members and paired devices. A
live shared view with its own grant is the question the Echo Show issue raises
([echo-show dashboard](../../issues/features/2026-07-27-echo-show-display-dashboard-view.md)).
**Later**; Studio's design (visitor identity from a broker, a grants file the
owner edits, revocation on next request) is a reasonable reference when that
issue is picked up.

## 10. Positioning

Studio's pitch is an operating system: "Reimagine your personal computer",
"your digital HQ", Personal Computing 2.0, "made by humans, not by companies".
Underneath, the product answers the empty workspace with a catalog of specific
apps (inbox digests, a recruiter pipeline, a GTD list, a kid-events radar),
each a few thousand lines, each with a scripted on-ramp. That is the direction
the 2026-10-05 decision chose, reached independently by a six-person team at a
funded lab. The decision is validated, not challenged.

Where Bee Box differs, and should say so:

- **The medium.** Studio's tools are separate web servers with separate JSON
  stores. Bee Box's are cards in one git repo that every tool and the agent
  read. A Bee Box pitch can promise "ask about anything you have told it, in
  one place"; Studio cannot.
- **Honesty about the hosting and the claims.** Studio says end-to-end
  encrypted while its audit says the operator can read running workspaces and
  its terms license content for training. Bee Box's security overview and the
  release-honesty decision are the opposite posture; keep them, and say so in
  the pitch.
- **No OS framing.** "Personal AI operating system" invites comparison with
  OpenClaw, PAI, and now Studio on their terms (apps, models, shells). Bee
  Box's territory is records a household keeps and an agent that tends them.

**Adopt** the use-case-first on-ramp (§7). **Reject** the OS framing.

## What only hands-on use could settle

Collected from the three notes.

1. Whether "Modify…" produces a reliable edit on a non-trivial app, and how
   often the reload breaks the app.
2. Whether the permission dialog's "Adjust" editor is used by non-technical
   people, or everyone approves the agent's ask.
3. Isolation on macOS (runc as root in Lima) against a hostile skill.
4. Quality of a Claude → Codex handoff summary in a long chat.
5. Whether the shared-app visitor flow (broker login, iframe cookies) works
   for a friend without an Imbue account.
6. Catalog success rate for services with bot protection.
7. What leaves the workspace under explorer-plan analytics collection.
8. Memory and battery cost of the Lima VM on a laptop.
9. Whether templates stay installable as the base moves (they already drift).
10. Pricing of Imbue Cloud for Studio; nothing public yet.
