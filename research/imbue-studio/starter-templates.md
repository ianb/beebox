# Starter templates: the `*-mind-template` repos (read 2026-10-08)

> **Naming note (2026-10-09):** agent instruction files in this repository and in boxes were renamed from `CLAUDE.md` to `AGENTS.md`. This document predates that and keeps the old name.


Read from clones of the public repos; see [sources.md](sources.md). Paths are repo-relative. Written by a reading agent and edited by the research session.


Sources: clones under `scratchpad/src/` of `default-workspace-template` (base, HEAD 2026-10-08),
`daily-digest-`, `megabox-`, `orchard-`, `bullet-journal-`, `lego-todo-planner-`,
`task-inbox-`, `plain-text-gtd-mind-template` (all HEAD 2026-09-10/11), plus GitHub
API reads of `family-weekend-radar-`, `inbox-digest-review-`, `thread-writer-`,
`spec-workbench-`, `zenbox-mind-template` (manifests saved under `scratchpad/remote-manifests/`).
All repos are public under `github.com/imbue-ai`. Paths below are repo-relative unless noted.

## 1. What a template is, structurally

A template repo is a complete bootable workspace, not a plugin. Every one of the twelve
is the full `default-workspace-template` tree (6,400+ files, most of it the vendored
`system/vendor/mngr` tree) with one app and a few config files copied on top, plus a
three-file manifest at the repo root:

- `template.md` (prose: What it is / How it works / Recipe / Requirements / Environment /
  How to adapt it / Publication history / Adaptation history),
- `template.toml` (machine-readable: `[template]` slug/title/description/thumbnail/version,
  `[recipe]` include/exclude, `[requirements]` permission/secret/llm/adaptation,
  `[environment]` apt/npm/uv/cargo, optional `[[lineage]]`),
- `template.svg` (hand-drawn thumbnail used by the README hero and the catalog card).

The recipe, not a diff, defines the template. `daily-digest-mind-template/template.toml`:
`include = ["system/apps/daily_digest", "system/supervisord.conf", "pyproject.toml", "uv.lock"]`.
Publishing re-runs the recipe against the author's live workspace onto a clean base; the
prose says "It is not a fork of the workspace it came from -- it is DERIVED from it."
Everything under `data/` is excluded (`data_include = []` in all twelve), so no template
ships personal data; several (bullet-journal, task-inbox) therefore boot to an empty view.

The app itself follows the base's `build-app` convention: `system/apps/<name>/` is a uv
package with `src/<name>/runner.py` (Flask or FastAPI), `assets/` for the frontend, a
`pyproject.toml`, `icon.svg`, and a `test_<name>_ratchets.py`. It is wired as one
supervisord program that first registers itself with the workspace forwarder
(`system/scripts/forward_port.py --url http://localhost:8084 --name daily-digest --icon-file ...`)
and then runs (`daily-digest-mind-template/system/supervisord.conf:347-359`). Apps that need
account grants ship `autostart=false`; apps with no requirements (bullet-journal, lego-todo,
gtd, family-weekend-radar, spec-workbench) autostart.

Two extra skills ride along in every template that the base no longer ships: `welcome`
(see section 5) and `latchkey`. The templates were cut against an older base: they are
missing the base's newer `connect-external-service`, `data-pipeline-builder`, `devices`,
`handoff-summary`, `manage-desktop`, `notify-user` skills, and they lack the base's
`system/apps/getting_started` and `chat` apps (they still have the older `system_interface`
shell). The base's `CLAUDE.md` is 625 bytes and only an `@`-include of `AGENTS.md`; the templates carry a
36 KB `CLAUDE.md` that is a copy of the older `AGENTS.md`.

### How it is installed

`default-workspace-template/.agents/skills/use-template/SKILL.md` defines two entry points.

Template path (A): the workspace was created from the template repo, so the tree is already
there. The agent reads the manifest and starts the adaptation conversation.

Merge path (B): the user pastes `/use-template <git-url>` into an existing workspace. The
skill's procedure, abridged from the file:

0. Trust gate: "tell the user in plain language that you are about to pull third-party
   code that Imbue has not verified and that could be malicious ... Do NOT fetch, merge, or
   run anything from the template until they reply yes."
1. `git remote add template <git-url>; git fetch template main`, then in a throwaway
   worktree `git merge --allow-unrelated-histories --no-edit FETCH_HEAD`. Conflicts are
   "HOLES, not a hard failure"; a Python snippet realizes `system/supervisord.conf` to confirm
   it still yields programs; only then `git merge --ff-only` into `/home/user/workspace`.
2. Read `template.toml` first ("its presence is what tells you the format"), then `template.md`.
3. "Activate first, then ask how to adapt": file one latchkey permission request per
   `[[requirements.permission]]` (`latchkey curl -XPOST http://latchkey-self.invalid/permission-requests`),
   install `[environment]` entries with plain `apt-get`/`npm -g`/`uv tool install`, request
   secrets, start services. "Definition of done for a data-backed app: the user can open it
   and see their OWN data."
4. Work through `[[requirements.adaptation]]` interactively, one at a time.
5. Append a dated entry to "Adaptation history" (append-only).
6. Record `[origin]` (repo URL, commit, date) in `template.toml`; a later publish turns it
   into a `[[lineage]]` entry. A workspace holds exactly one manifest; a new one overrides.
7. Commit.

### v1 "inspiration" vs v2 "template"

The GitHub repo descriptions carry a flow-version suffix: `(minds inspiration v1)` on
bullet-journal, lego-todo-planner, orchard, plain-text-gtd, thread-writer; `(minds template v2)`
on daily-digest, spec-workbench, task-inbox. `publish-template/SKILL.md:10-16` explains:
"v2 publishes ONE slug-free `template.md` + `template.toml` + `template.svg` per repo,
overriding any previous manifest rather than accumulating beside it ... v1 -- slug-named
`inspiration-<slug>.md` with a YAML recipe block inside it and no TOML -- is still READ by
the adopt paths, but nothing writes it any more." The publish script writes the suffix
`(minds template v2)` into the repo description (`SKILL.md:1058-1064`). The suffix on the
five "inspiration v1" repos is stale: all five cloned ones contain `format = "v2"` TOML and a
single `template.md`, and their Publication history entries all say "re-cut onto" the
current base on 2026-09-09..11. So the vocabulary moved from "inspiration" to "template"
between July and September 2026, and the imbue-ai org re-published the community
originals (gnguralnick/daily-digest, cinxwei, annao-h, pseay-imbue, kanjun, ...) as v2.

### The catalog

`default-workspace-template/catalog/new-tab-templates.json` (format 1, 42 entries, generated
2026-09-07) is what the base's Getting Started app fetches from GitHub every six hours
(`system/apps/getting_started/src/getting_started/config.py:9-10`). It carries slug, title,
description, several paragraphs of `what_it_is`, author, repository URL, thumbnail,
required accounts/secrets, `needs_ai`, apt packages, and `choices` (the adaptations).
Six curated shelves: popular (8, hand-picked), organize-your-life, inbox, work,
friends-and-family, for-the-fun-of-it. Only 12 of the 42 have been re-cut into imbue-ai
repos; the other 30 still point at the authors' personal GitHub accounts, and 22 of 42 have
an empty `version` (never published through the v2 flow).

## 2. Template table

Sizes are the included app directory only (code excludes tests; `tests` = test files).
Base-tree file counts are ~6,430 for every template, so they are omitted. "Scheduled"
means a background loop or scheduler ships in the template.

| Template | Purpose | Integrations | Storage | UI | Scheduled | Tests | App size | Last commit |
|---|---|---|---|---|---|---|---|---|
| daily-digest | AI-read Gmail digest, triage back to Gmail, PR mail folded per PR | Gmail read+write, GitHub read, Claude (keyed litellm, haiku-4-5) | JSON under `data/.apps/daily-digest/` (digest, handled set, per-email cache, reading list) | Flask + Jinja, vanilla JS/CSS | hourly in-process refresh loop | 14 files, 2,362 lines | 35 files, 3,866 code lines | 2026-09-10 |
| megabox | Unified Slack+Gmail inbox and a channel-agnostic composer | Slack read/chat/conversations/reactions/files, Gmail read/send/write-threads | JSON cache; drafts in browser localStorage | two Flask apps, vanilla JS | 5-min sync loop | 6 files, 497 lines | 26 files, 4,352 code lines | 2026-09-11 |
| orchard | Recruiter pipeline, templated multi-inbox outreach, open-tracking pixel | Gmail send+read, ContactOut API token (secret), Claude keyless `claude -p`, cloudflared tunnel (env.d unit) | JSON files + `pending_opens.jsonl` | Flask, single 1,725-line HTML | none (3 programs, autostart=false) | 16 files, 1,681 lines | 32 files, 4,154 code lines | 2026-09-10 |
| bullet-journal | Dot-grid rapid log of tasks/events/notes with mood tracker | none wired (email/calendar/Slack aggregation "is not wired") | `sample.json`, `state.json`, `moods.json` | Flask, single HTML | none | 4 files, 224 lines | 12 files, 713 code lines | 2026-09-11 |
| lego-todo-planner | Deadline calendar + drag-and-drop daily plan, goals, today's calendar strip | Google Calendar read (primary calendar, today only) | one `state.json` with rotating backups | Flask, single HTML + SortableJS from CDN | none | 7 files, 631 lines | 18 files, 1,058 code lines | 2026-09-10 |
| task-inbox | Ranked, deduped to-do board from Slack+Gmail(+Granola) | Slack read, Gmail read, optional `GRANOLA_API_KEY`, Claude keyed (sonnet-4-6) | ~12 JSON files under `data/.apps/task-inbox/` | FastAPI + Jinja, inline JS | bash scheduler 08:00/12:30/17:00 local, autostart=false | 6 files, 974 lines | 20 files, 3,068 code lines (incl. 780-line skill script) | 2026-09-10 |
| plain-text-gtd | GTD lists (inbox/next/projects/weekly review) over markdown | none | one `.md` per item with YAML frontmatter under `data/.apps/gtd/items/` | FastAPI + Jinja + htmx (unpkg) | none | 3 files, 941 lines | 31 files, 5,632 code lines (2,198 CSS) | 2026-09-10 |
| family-weekend-radar | Weekly kid-event radar with drive times, SF Bay Area sources | Claude keyless `claude -p` (~$0.65-0.85/run); no accounts | snapshot file written by skill | Flask single runner (20 KB) | none shipped ("no weekly schedule ships") | 2 files | app 6 files 22 KB + skill 20 files 180 KB | 2026-09-11 |
| inbox-digest-review | 10-bucket Gmail triage with archive/spam/mute/unsubscribe | Gmail read+write, Claude keyless | digest data file written by skill | Flask (100 KB `runner.py`) | none (on demand; monthly `contact_audit.py` by hand) | 6 files | app 15 files 186 KB + skill 11 files 121 KB | 2026-09-10 |
| thread-writer | Blog/link to X thread / LinkedIn drafts in three voices, schedule queue | Claude keyed; no accounts (publish = copy to clipboard) | `DATA_DIR/voices/*.md` corpora (not shipped) | Flask (110 KB single `runner.py`) | none | 2 files | 7 files, 138 KB | 2026-09-10 |
| spec-workbench | Markdown docs with margin comment threads stored inline; notify-agent loop | none | the markdown file itself; JSON notify events | Flask + 46 KB app.js | none | 10 files | 29 files, 215 KB | 2026-09-10 |
| zenbox | 3D zen garden of unread Slack messages | Slack read | none (live reads) | Flask + 25 KB HTML (three.js) | ~1-min client refresh | 1 file | 7 files, 34 KB | 2026-09-10 |

`simple_mind` (2026-04-10) predates all of this: a README pointing at the old mngr "Minds"
docs, "the full behavior of the agent is defined by the text in the `*.md` files". It is
not a workspace template and is not in the catalog.

## 3. Deep dives

### daily-digest

Fetch (`system/apps/daily_digest/src/daily_digest/gmail.py`): every Gmail call is
`latchkey [--account <addr>] curl -s https://gmail.googleapis.com/gmail/v1/users/me/...`;
no token touches the process. `list_unread_ids` pages `q=is:unread in:inbox&maxResults=500`
through every page unless `DAILY_DIGEST_MAX_EMAILS` caps it; `fetch_message` pulls
`?format=full` and `parse_message` flattens MIME to markdown and strips tracking params.
`generate.py:_fetch_all` fetches on an 8-thread pool, one account at a time, and
`cache.py` skips any message id already processed (cache pruned to the current unread set).

Classify (`processor.py`): one litellm `completion` per email, model `claude-haiku-4-5`,
8,000 max tokens, run concurrently. The system prompt asks for one JSON object: a single
`category` from `needs_you | personal | reading | receipt | promotion | job_outreach | other`
("used only to order it"), a 1-3 sentence summary, `primary_url` + label, `unsubscribe_url`,
and every "facet" present: `action {action_required, deadline, urgency}`, `receipt {vendor,
amount, items}`, `events[]`, `articles[]`, with "Every event MUST have a real URL copied from
the email -- never invent one". `_coerce_processed` salvages out-of-schema output (bad
category -> `other`, event without a name dropped) so one bad reply does not lose the email;
per-email LLM errors drop that email rather than the run. README cites ~$0.01/email.

GitHub folding (`github.py`, `pr_cache.py`): comment/review/push mail is matched by the
`owner/repo/pull/N` in headers; CI-failure mail carries only a SHA and is resolved with one
`commits/{sha}/pulls` call through `latchkey curl` to the GitHub API. A second prompt
(`_PR_SYSTEM`) summarizes the whole thread into `headline`, `summary`, `needs_you`.

Render (`generate.py:_CATEGORY_RANK`, `digest.py`, `assets/digest.html.j2`): server-side
Jinja. Order is needs_you, personal, reading, receipt, other, promotion, job_outreach.
Sections: "Pull requests" (needs-you first), "Everything else", and a "Job opportunities"
divider when the first job_outreach card appears. Each card shows sender, tags, subject,
summary, then action pill with deadline/urgency, event rows with "Save event", article rows
with "Read later", and a footer with Open in Gmail / View original (sandboxed iframe, strict
CSP) / destination select / Dismiss.

"Clear in one pass" (`runner.py`, `assets/app.js`): Dismiss posts `/api/act` with the
chosen destination (`keep` removes UNREAD only; `archive` removes INBOX+UNREAD; `receipts`
adds the label id and removes INBOX+UNREAD; `trash` calls `/trash`), applied to Gmail
immediately with an undo toast (`/api/undo`). "Finalize all N remaining" posts `/api/act-all`;
the server applies every card's selected destination on an 8-thread pool and the client
polls `/api/act-all/status`, removing cards as each lands. Dismissed ids persist in
`handled.json` so a refresh does not resurrect them; a "to go" counter ends in a caught-up
state with a Regenerate button. Refresh: `_auto_refresh_loop` waits on an Event for
`DAILY_DIGEST_REFRESH_SECONDS` (3600) and silently regenerates, but only after the user has
generated the first digest ("so a fresh install shows its landing page rather than silently
spending on an unrequested run").

### task-inbox (the cross-tool to-do)

Three layers: a skill, an app, and a scheduler.

Skill (`.agents/skills/task-inbox/SKILL.md`, 179 lines, `metadata.crystallized: true`): the
process is "deterministic-fetch -> your-judgement-extraction -> deterministic-assemble".
`scripts/run.py fetch` pulls Slack DMs (`conversations.list?types=im` then history), Slack
@-mentions (`search.messages`), configured channels (`conversations.history`), and Gmail
(`q=in:inbox newer_than:14d`), all through `latchkey curl`. It writes `raw_records.json`
(every record keyed `slack:<channel>:<ts>` or `gmail:<id>`) and `fetch.json`
(`extraction_candidates`, `recruiting_followups`, `filtered_out`). Deterministic parts:
Greenhouse digests in `#recruiting-feedback` (messages with `*Candidate:*` and `*Decision:*`)
are parsed, dropped if they carry a white_check_mark reaction, deduped per candidate across
rounds, and bucketed moving_forward / send_rejection / discuss_for_review; a noise-sender
list (Rippling, Zapier, Okta, Lever, Checkr, Deel, Linktree, Gem, Navan) filters Gmail;
`dedupe_slack` collapses the same message seen via channel history and mention search,
keeping the copy with reactions. Step 2 is the agent reading `fetch.json` and writing
`extracted_tasks.json` with `task, type (free-form), requester, due_date, due_basis,
urgency (critical|high|medium|low), urgency_reason`; "This is judgement a script cannot do."
`run.py assemble` joins by `record_id` and fails loudly on an unknown id.

App (`system/apps/task_inbox/src/task_inbox/`): `refresh.py` automates step 2 with litellm
`anthropic/claude-sonnet-4-6` using the same field spec as the SKILL.md prompt, then
`granola.py` fetches `public-api.granola.ai` notes (last N days, only when a `grn_` key is in
`data/.secrets/task-inbox-granola.env`) and runs a second LLM pass for action items. `data.py`
layers the aggregated `task_inbox.json` with manual tasks and ~10 per-task override files
(done state, category, urgency, due, text, notes, side lists, filters, theme) and suppresses
re-fetched tasks whose fingerprint matches an archived one. Ranking is grouping, not scoring:
`tasks_by_due_date` (overdue/today/this week buckets), `tasks_by_type`, `tasks_by_urgency`.
`runner.py` is FastAPI + Jinja with a 644-line inline-JS HTML page.

Write-back: none. Permissions are `slack-read-all` and `google-gmail-read-all` only; a grep
for `chat.postMessage`, `reactions.add`, `/modify`, `conversations.mark` finds nothing.
Checking off a task only writes `task_state.json`; the original Slack/Gmail item is untouched.
This is the opposite of daily-digest, whose whole point is writing the decision to Gmail.

Scheduling: `system/scripts/task_inbox_scheduler.sh` is a bash loop under supervisord that
sleeps until 08:00, 12:30, 17:00 in `TASK_INBOX_TZ` and runs `uv run task-inbox-refresh`;
failures are logged and retried at the next slot. It does not use the base's cron-based
automations machinery (`system/libs/automations/`), and neither does any other template.

lego-todo-planner, for contrast, is not cross-tool despite the catalog shelf: its only
integration is read-only Google Calendar for a "today" strip (`calendar_client.py` picks the
`primary` calendar and fetches one day), tasks live in one `state.json`, and the manifest
lists "no event creation or editing -- the planner never writes to the calendar".

## 4. Prompt/skill vs code

Per template, lines of agent-facing prose (template.md + README + welcome skill, plus
SKILL.md where one ships) against non-test app code:

- daily-digest 301 prose / 3,866 code; megabox 329 / 4,352; orchard 344 / 4,154;
  bullet-journal 294 / 713; lego-todo 315 / 1,058; task-inbox 507 / 3,068 (179 of the prose
  is the skill); plain-text-gtd 283 / 5,632 (plus 522 lines of app-level markdown: a
  403-line orientation README and the seeded `instructions.md`/`weekly_review_prompt.md`).

So these are finished apps with a ~300-line adoption script, not prompt packs. The
~300 lines are mostly boilerplate: the "How to adapt it" section is byte-identical across
all seven clones (md5 591f7f2f), the README follows the generator's fixed outline (hero,
Open in Minds button, Why you care, How to use it, Ideas for making it yours, What this is,
per `publish-template/references/readme-recipe.md`), and `welcome/SKILL.md` differs only in
the title/slug/description lines.

Where the agent is in the loop at runtime rather than only at adoption:
- task-inbox, family-weekend-radar, inbox-digest-review ship a skill whose middle step is
  agent judgement (`crystallized: true` marks a flow that was run interactively and then
  frozen into scripts). task-inbox's app additionally replaces the agent with a litellm call
  for unattended refreshes.
- plain-text-gtd's "Triage in chat" / "Plan" / "Handoff" buttons copy a self-contained prompt
  that names `data/.apps/gtd/instructions.md` and the item file; the manifest notes the
  original author's auto-triggering `gtd-triage` skill "was never part of this snapshot".
- spec-workbench's notify button stamps the file and pings the agent to sweep comment threads.
- daily-digest, megabox, orchard, thread-writer call the model directly from Python
  (litellm or `claude -p`); the agent is not involved after setup.

Extensibility is taught through the manifest's `[[requirements.adaptation]]` entries
(which point at concrete files and variables: "`processor.py`'s classification prompt and
`models.py`'s `Category` enum are the two places a new bucket ... would go") and the README's
"Ideas for making it yours", and through the base workspace's general skills (`build-app`,
`update-app`, `use-ai-integration`, `manage-scheduled-tasks`). Every "Ideas" list includes
at least one scheduling idea that the template itself does not implement ("Schedule the
digest to rebuild automatically every morning", "Add a recurring cron job that opens the
Weekly Review prompt in chat every Friday").

## 5. Onboarding as the files describe it

Entry from the base workspace. The Getting Started app
(`default-workspace-template/system/apps/getting_started/`) opens its own window once per
workspace for the first connected client. Its tiles (`frontend/src/views/startSomething.ts`)
each seed a chat message: "Build a new app", "Start from a template" (scrolls to shelves),
"Connect your data" ("Help me connect an account I already use, like Gmail, Slack, Notion, or
GitHub ... Ask me which one, then walk me through connecting it."), "Set up a routine"
("like a briefing every morning"), "Delegate a task", "Make sense of a pile of stuff",
"Learn about Imbue Studio", "Edit Imbue Studio itself". A template's detail page shows the
drawing, write-up, required accounts and repo, with two buttons
(`views/TemplateDetail.ts:54-66`): "Make it mine" seeds `/use-template <repository_url>`
(merge path), and "Create a new machine from this" seeds "Please create a new Imbue Studio
machine for me from the template at <url> (the minds-api skill can create one). Walk me
through anything it needs from me, like permissions or accounts, and tell me when it is ready."
The GitHub README's "Open in Minds" badge points at a trampoline page
(`boweiliu.github.io/open-in-minds/?git_url=...`) with the `/use-template` line as fallback.

First run of a workspace created from a template. `.agents/skills/welcome/SKILL.md` in each
template instructs the agent to do all of this "in your FIRST response, in the same turn,
without waiting to be asked": a custom greeting naming the template and its one-line
description ("Do NOT use a generic 'Welcome to Minds' greeting"), read `template.md`,
present in plain language what it is and what it needs, and "End your first response on
THAT question": whether to hook it up to the user's own accounts now. If yes: file every
`requires_permission` as a latchkey permission request (which opens the OAuth/approval flow
in the Studio app), start the `autostart=false` program, and confirm the app shows the
user's own data before saying it works. Only then "how do you want to adapt it?", walking
the `[[requirements.adaptation]]` list. For daily-digest that means Gmail read, Gmail write,
GitHub read, then: which inboxes (`DAILY_DIGEST_ACCOUNTS`), whether the "Receipts and
invoices" label exists, and the refresh/cap tunables. For task-inbox: Slack read, Gmail read,
an optional Granola secret, then replacing the placeholder `['your-channel']`, the
Greenhouse-specific grouping, the recruiting side-lists, and the HR-flavored noise list.

What the user sees before connecting: daily-digest's landing page with a "Generate today's
digest" button; task-inbox "the board simply renders empty"; bullet-journal "a fresh boot
shows an empty journal"; family-weekend-radar a "hasn't run yet" state; plain-text-gtd a
Getting Started panel plus seeded `instructions.md`. Three templates (orchard, thread-writer,
inbox-digest-review) ship the author's identity or org as placeholders the adopter must
replace (Alex/Sam example inboxes, imbue.com blog URL, placeholder `account.py`).

Noted gaps: the LLM path is split. Five templates hardcode keyed litellm
(`ANTHROPIC_API_KEY`), three hardcode keyless `claude -p`; each manifest tells an adopter on
the other path to rewrite the call sites "per the use-ai-integration skill". No template
uses the base's cron automation runner; the two that refresh unattended do it with an
in-process loop or a bash sleep loop under supervisord. The catalog JSON is a hand-run
export (`catalog/build_catalog_from_export.py`) whose metadata is stale against the repos
(empty `version` for 22 entries, personal repo URLs for 30).

## 6. What this says about Imbue's answer to the empty workspace

The empty workspace is answered with a complete app plus a scripted conversation, not with
a blank chat or a prompt pack. A template is the whole bootable machine image with one
finished Flask/FastAPI app on it; the agent's job on day one is activation (file permission
requests, start the service, show the user their own data) and then a guided list of named
adaptations, each pointing at a specific file or variable.

The scripts are uniform and generated: identical "How to adapt it" text, identical README
outline, identical welcome skill shape. Variation lives in the TOML requirement entries and
in the app code. The apps themselves are small (700 to 5,600 lines), single-user, JSON- or
markdown-backed, and mostly read-only against the connected accounts; daily-digest and
inbox-digest-review are the only ones that write decisions back.

The 42-entry catalog is seeded by employees and a few community authors, curated into
shelves by hand, and framed as "adopt something another person already built and make it
yours". The expectation set by every "Ideas for making it yours" section is that the user
keeps extending the app through the agent, including adding the scheduling the templates
leave out. Templates are the on-ramp; the general-purpose agent plus `build-app`,
`update-app`, and `manage-scheduled-tasks` is the destination.
