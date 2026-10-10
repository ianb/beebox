# Architecture of a studio: the workspace template and the desktop app (read 2026-10-08)

> **Naming note (2026-10-09):** agent instruction files in this repository and in boxes were renamed from `CLAUDE.md` to `AGENTS.md`. This document predates that and keeps the old name.


Read from clones of the public repos; see [sources.md](sources.md). Paths are relative to the template repo root unless prefixed. Written by a reading agent and edited by the research session.


Source: `github.com/imbue-ai/default-workspace-template` (clone at `src/default-workspace-template`, HEAD `45a1730`, "Merge pull request #817"), with `src/mngr` (`apps/minds` is the Electron desktop app) and `src/bottled-minds` (a self-hosted packaging) beside it. Paths are relative to the template repo root unless prefixed `mngr/` or `bottled-minds/`. Read-only survey; nothing was run inside a workspace.

## 1. Runtime topology

### One container, one supervisord, several mngr agents

A workspace is one container (Docker locally, or Docker on a VPS) or one VM (Lima, Modal). Inside it the only always-on mngr agent is `system-services`, and it is not an LLM. `.mngr/settings.toml`:

- `[agent_types.main] parent_type = "command"`, `command = "sleep infinity"`. Comment: "No claude ever runs as this agent: window 0 only sleeps while the bootstrap window (extra_window) runs supervisord".
- `[create_templates.main] extra_window = ["bootstrap='uv run bootstrap'"]`.

`system/libs/bootstrap/README.md`: bootstrap "runs first-boot setup, then `exec` supervisord in the foreground"; on first boot it "commits the rsynced workspace onto a clean `main` branch". It creates no chat.

`system/supervisord.conf` declares no programs. It includes `supervisord.conf.d/*.conf`: "One file per program means two agents adding creations concurrently never touch the same file." The 17 drop-ins:

- `system_interface.conf` -- the desktop shell, port 8000 (`system-interface`).
- `chat.conf` -- the chat app (`chat-app`), port 8010.
- `terminal.conf`, `terminal-pty.conf` -- ttyd wrapper pages and the pty origin.
- `files.conf` -- `dufs --allow-all --bind 127.0.0.1 --port 8300 ... /` (a file viewer over the whole container filesystem).
- `browser.conf`, `xvfb.conf` -- a Chromium fleet streamed to the UI on `DISPLAY=":99"`.
- `getting-started.conf` -- the Getting Started page, port 8030.
- `agent-observer.conf` -- `exec mngr observe --quiet`, the one lifecycle event stream every chat page follows.
- `host-backup.conf`, `share-gateway.conf`, `env-converge.conf`, `earlyoom.conf`, `oom-tag-backstop.conf`, `owner-exec.conf`, `vm-exec-register.conf`, `cron.conf` (`/usr/sbin/cron -f`).

Memory is managed in bands. Program lines are wrapped as `python3 system/services/oom_priority/bin/oom_tag_service.py <band> ...`; `earlyoom.conf` runs earlyoom with `--avoid "^(sshd|supervisord|earlyoom|tini)$|^tmux"`; every harness launches through `system/services/oom_priority/bin/agent_oom_launch.py` so "earlyoom sheds an agent's subprocesses, then worker agents, then user agents, before any protected service" (`.mngr/settings.toml`, `[agent_types.claude]`). `AGENTS.md` tells the agent to check `data/.state/oom_priority/events/shed.jsonl` when a command dies with exit 137.

### Image and provisioning

`system/Dockerfile`: `FROM python:3.12-slim-trixie@sha256:...`; runs `system/scripts/setup_system.sh` (toolchain, pinned Claude Code, codex, pi, opencode, agy), `install_dependencies.sh`, `build_workspace.sh`; then `mv /home/user/workspace /docker_build_code` so the first-boot seed (`system/scripts/default_workspace_template_seed.sh`) copies the tree onto the persistent `/home/user` volume. Root's home is rewritten to `/home/user`; the agent runs as root (`supervisord.conf`: "We intentionally run as root"). Lima and Modal skip the Docker build; `[create_templates.lima]` and `[create_templates.modal]` run the same three scripts over SSH.

Local Docker sizing: `[providers.docker] default_cpus = 4`, `default_memory = "8g"`, `--tmpfs /tmp:exec,size=1g`. gVisor is an overlay template (`docker_runsc`). Cloud providers (`vultr`, `ovh`, `aws`, `gcp`, `azure`, `imbue_cloud_slice`) are declared `is_enabled = false` so the in-container mngr skips them.

### Python side

`pyproject.toml` is a uv workspace: `members = ["system/libs/*", "system/services/*", "system/apps/*"]`. mngr is not vendored: every `imbue-mngr*` package is a git source pinned to one commit (`rev = "6d49b1ead..."`), and `system/test_mngr_pin.py` enforces it.

- `system/libs/`: `app_manifest`, `automations`, `bootstrap`, `github_sync`, `mngr_cli_contract`, `tk_command_parsing`, `workspace_ui` (JS), two pytest plugins.
- `system/services/`: `caretaker`, `env_converge`, `host_backup`, `oom_priority`, `share_gateway`.
- `system/vendor/tk`: the vendored ticket tracker the agent uses instead of TodoWrite.

Apps with a manifest run from their own `uv tool install -e system/apps/<package>` environment, "what keeps it running while the root venv is rewritten" (`system/apps/README.md`).

### Node side

`system/package.json` is an npm workspace: `libs/workspace_ui`, `apps/system_interface/frontend`, `apps/chat/frontend`, `apps/getting_started/frontend`. `prebuild` runs `scripts/fetch_mngr_assets.sh`, which fetches the desktop app's `embed_contract.js` from the pinned mngr commit into `system/vendor/mngr-assets/`, so "both sides always ship from one source of truth" (`mngr/apps/minds/docs/embed-contract.md`). The shell is Mithril (`m.redraw()` in `system/apps/system_interface/frontend/src/views/App.ts`).

### Desktop app to container

`mngr/apps/minds/README.md`: the desktop client (`minds run`; Electron via ToDesktop) does "Authentication via one-time login codes", "Reverse proxying to agent web servers (HTTP + WebSocket)", and shows "local and shared URLs per agent".

- The proxy is `mngr/libs/mngr_forward`: "`mngr forward` runs a local proxy that serves `[<service>.]<agent-id>.localhost:<port>/*` and byte-forwards each request to the matching backend", on `127.0.0.1:8421`.
- The bare `agent-<hex>.localhost:8421` origin redirects to the system interface; each app is `<label>.agent-<hex>.localhost:8421`, where `label` is `<name>-<rand>` from `data/.state/apps.toml` (`mngr/apps/minds/docs/overview.md`, "Port forwarding").
- Remote machines are reached through a per-host SSH tunnel.

The chrome frames the workspace in a cross-origin iframe and speaks `postMessage` with `minds:`-prefixed types. `embed-contract.md` lists them: `minds:workspace-ready`, `minds:focus-chat`, `minds:permission-resolutions`, `minds:open-share-settings`, `minds:provider-sign-in`, and the pop-out window set (`minds:pop-out-window`, `minds:tear-out`, `minds:reattach-window`). Security rests on the proxy's `Content-Security-Policy: frame-ancestors` header plus `event.source === window.parent` checks: "being framed at all proves the embedder was allowed". Ratchet tests on both sides confine `postMessage` to that one module.

"Global forwarding" is the share stack:

- Publishing calls `mngr imbue_cloud shares create` and writes `data/.secrets/share.env`.
- `share-gateway` (`system/services/share_gateway/README.md`) runs caddy on `127.0.0.1:8443` terminating "the share's real TLS" inside the container, an frpc tunnel per regional relay, and a Flask `forward_auth` backend that re-reads `data/.secrets/share_grants.toml` on every request.
- Shared URL: `https://{label}.{workspace_domain}/`. Identity reaches services as one header, `X-Imbue-Identity` (`{"owner":true}` on the local path).

## 2. The agent

### How Claude Code runs

Chats are separate mngr agents the chat app creates on demand. `[agent_types.claude]` in `.mngr/settings.toml`:

- `cli_args = "--dangerously-skip-permissions --disallowed-tools ExitPlanMode,TodoWrite,TaskCreate,TaskList,TaskUpdate"`.
- `settings_overrides__extend = {model = "opus[1m]", fastMode = false, skipDangerousModePermissionPrompt = true, feedbackSurveyRate = 0, feedbackDrafts = "off", tui = "fullscreen"}`.
- `version = "2.1.293"`; host env sets `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
- Each chat binds to a provider account through `CLAUDE_CONFIG_DIR` pointing under `~/.minds/accounts/<id>/`; "`~/.claude` holds no credential" (`mngr/apps/minds/docs/design.md`).

Peer harnesses sit beside it: `[agent_types.codex]` (`model = "gpt-6.1-sol"`, `sandbox_mode = "danger-full-access"`, memories and web search off), `[agent_types.pi-coding]`, `[agent_types.opencode]`, `[agent_types.antigravity]`. A chat can hand off between harnesses mid-conversation (`system/apps/chat/README.md`, "A handoff").

`.claude/settings.json`:

- `"autoMemoryDirectory": "~/workspace/data/memories"`; plugins `imbue-code-guardian` and `frontend-design`.
- `SessionStart`: `uv sync --all-packages`, `claude_update_plugin.sh`, `ensure_tk_on_path.sh`, an OOM shed notice.
- `PreToolUse`: `agent_prevent_commit_rewrite.sh`, `agent_block_pipe_tail_head.sh`, `agent_latchkey_request_standalone.sh`, `agent_secrets_guard.sh`, `agent_tk_standalone.sh`, `agent_require_steps_pretool.sh`, `agent_rewrite_bash_command.py`.
- `UserPromptSubmit`: open-tickets reminder. `Stop`: a nudge about open tickets and "Be sure to return to the repo root".

`.codex/hooks.json` wires the same scripts for Codex; `.pi/extensions` is the pi equivalent. `CLAUDE.md` is an `@`-include of `AGENTS.md` plus a memory note; `AGENTS.md` (37 KB) is harness-neutral. `.claude/skills` is a symlink to `.agents/skills`.

### How chat reaches it

The chat app (`system/apps/chat/README.md`) serves one page per chat at its own origin and follows `mngr observe`'s event file.

- Sends go through mngr's in-process message API into the agent's tmux pane: `agent_manager.py`'s `send_message_to_agent` "hands it to the `MngrMessenger`"; `harnesses/claude/tap.py` says "dwt never drives raw tmux".
- The transcript is read from Claude's own files: `harnesses/claude/watcher.py` reads "raw Claude session JSONL files into events" at `<config dir>/projects/<encoded work dir>/<session id>.jsonl`, with `subagents/` beside it.
- Progress view: the agent runs `tk create --step "<title>"`; the chat parses the `Created <id>: <title>` line from tool output (`AGENTS.md`, "Task management"). Hooks refuse redirects or chaining on those commands.
- Outside callers use `system/scripts/message_chat.py` (POST to the chat app, fallback `mngr message`). Texts from the launcher enter through `POST /api/chats/intake` with `target` in `new_chat`, `current_chat`, `chat_selector`, `chat` and an `is_draft` flag.
- The first chat is seeded from the desktop onboarding conversation: `system/scripts/seed_welcome_chat.py` posts `/api/chats/seed` via `mngr exec`.

### How many agents

- One `system-services` command agent per workspace.
- N chat agents. A chat is "a sequence of agent transcripts run by one agent at a time"; its id is its first agent's id; records live at `data/.apps/chat/chats/<chat-id>/record.json`.
- Worker agents: `[create_templates.worker] transfer = "git-worktree"`, with the system prompt "You were launched by another agent."
- Automation agents: one singleton per scheduled skill (`[create_templates.automation]`, labelled `automation=<skill>`); the Caretaker is a tailored automation (`[create_templates.caretaker]`).

Chats get `output_style = "Engineering Subordinate"` (`.agents/output-styles/engineering-subordinate.md`: "Assume the user is a non-technical manager ... The machinery behind it is invisible plumbing").

### Standing instructions about apps

From `AGENTS.md`:

- "When adding a new app, use the `build-app` skill".
- "Before editing any code that belongs to a supervisord program ... load the `update-app` skill first".
- "Default UI is web view."
- "Always preserve and surface the raw data and its source."
- "Commit all your changes locally ... Git is invisible plumbing, like `tk`."
- "Live first, ratify at turn-end": handle the request live, then a background worker hardens it through `crystallize-creation`, `update-creation`, or `heal-creation`.

`.agents/skills/build-app/SKILL.md` is an "interactive-delivery" flow: "confirm the look and feel on a cheap throwaway mock first, then build the real app to a usable state, then harden it in the background". It also runs `system/scripts/imbue_plan_extra/write_plan.sh` to record the brief under `data/.imbue/plans/` for offline analysis.

## 3. Apps as tabs (windows)

The shell's vocabulary is windows on desktops, not tabs (`system/apps/system_interface/README.md`: "A **window** is one page of one app on one desktop"). `system/test_meta_ratchets.py` forbids the words "application" and "web service" in the tree.

### Manifest

Every app has `system/apps/<package>/app.toml`, validated by `system/libs/app_manifest` (pydantic, `extra = "forbid"`). Fields:

- `name`, `display_name`, `icon`, `critical`, `priority` (OOM band), `stop_when_no_windows`, `launcher_rank`, `program`.
- `[default_shortcut]`, `[pin]` (taskbar entry).
- `[[launch_paths]]`: GET opens a window at the path; POST posts params and opens the path the app answers; `text_param` / `draft_param` mark the param the launcher fills with typed text.
- `[[message_handlers]]`: `minds:` types the shell posts to the app.
- `[[references]]`: files the app owns outside its directory; `[scope] exclude`; `[preview]`: how a throwaway instance boots on a free port against a copy of its data.

`system/apps/chat/app.toml` is the full example: `critical = true`, three POST launch paths onto `/api/chats/intake` (`new`, `send`, `draft`), and `[[message_handlers]] type = "minds:focus-chat"`.

`system/test_app_manifests.py` checks every manifest in the tree, including `test_every_declared_wiring_program_has_a_supervisord_block`, `test_no_two_app_packages_declare_the_same_console_script`, and `test_built_in_manifests_agree_with_the_contract_table`.

### Registration and serving

`system/scripts/forward_port.py` ("deliberately standard-library only") upserts a row into `data/.state/apps.toml` with the manifest's fields, the URL, and a stable origin label. The shell watches that registry and announces apps to the desktop (`system/services/README.md`: "there is no separate watcher service"). The app serves at its own origin; "registered app names must be DNS-safe hostname labels" (`docs/system/workspace-internals.md`).

A scaffolded app (`.agents/skills/build-app/scripts/scaffold_flask_lib.py`) is a Flask `runner.py` with `run_simple(..., threaded=True)` and a `DATA_DIR` defaulting to `data/.apps/<name>/`, overridable by `<PACKAGE_UPPER>_DATA_DIR` so a copy can be previewed on a spare port. Non-critical apps with `stop_when_no_windows = true` are stopped a minute after their last window closes and the shell "holds its port" so the next request restarts them (`system_interface/README.md`, `shell/port_parking.py`).

### Catalog and new-tab templates

`catalog/new-tab-templates.json` (format 1) lists published templates with `slug`, `title`, `description`, `what_it_is`, `repository_url`, `thumbnail`, `required_accounts`, `choices`, plus `shelves`. `catalog/README.md`: the workspace "fetches it from a fixed URL ... reuses a fetched copy for six hours, and keeps the last copy that parsed under `data/.state/getting-started/template_catalog.json`". The Getting Started app renders "Start something" intents and "Start from a template" shelves; "Every tile and both actions start a chat through one contract message, `shell:start-with-text`" (`system/apps/getting_started/README.md`).

### Sharing and publishing

Two different operations.

- Sharing a running app: the share panel in the desktop chrome publishes the whole workspace through the relay and grants per target ("the whole workspace, or one app"); an app's Share button deep-links via `minds:open-share-settings`. Grants are `users`, `emails`, `email_domains` in `data/.secrets/share_grants.toml`; "Publishing admits nobody by itself" (`mngr/apps/minds/docs/overview.md`).
- Publishing a template: `.agents/skills/publish-template/SKILL.md` builds a snapshot in a worker worktree and pushes "`template.md` + `template.toml` + `template.svg`" to a new GitHub repo via latchkey. `use-template` adopts one into an existing workspace; `update-installed-template` pulls newer versions; `docs/VERSION_HISTORY.md` records each. The skill warns of a past incident where a merge-back "silently reset `/home/user/workspace`'s entire live tree to an old base ... 1400+ files gone from a live agent".

## 4. Right-click to modify anything

The mechanism is an element-reference context menu, specified in `docs/system/blueprint/element-reference-menu/plan-element-reference-menu.md` and implemented in `system/libs/workspace_ui/src/`.

1. `context_menu.ts` installs one `contextmenu` listener per document that "yields to a page's own handling (an event already `defaultPrevented`), captures the target and the selection as they were at the click, builds the rows, and opens the menu". Every app serves it as `/_static/context_menu.js` from its own origin. The shell installs it on its own chrome in `system/apps/system_interface/frontend/src/views/App.ts` (`installElementContextMenu({ draft: (text) => void current.draftText(text), ... })`).
2. `element_reference.ts` builds the JSON: `reference_id` (`REF-` + 11 base-36 chars), `app`, `window_id`, `desktop_id`, `client_id`, `page_origin`, `page_path`, `page_title`, `tag`, `id`, `classes`, `attributes`, `role`, `aria_label`, `selector` ("checked to match it alone"), `selection_text`, `input_value` (null for passwords), `link_href`, `image_src`, `pointer`, `bounding_box`, `viewport`. "Built from the DOM as it is ... so an agent resolves it by grep and by reading the page, never through a registry." No component or source-file mapping is captured.
3. `context_menu_rows.ts` adds rows "Copy reference", "Explain...", "Modify...". `modifyPromptOf` returns `` `Change ${referenceId} to ` ``; `explainPromptOf` returns "Explain what I attached in REF-...". The draft is the prompt, a blank line, and a fenced `json` block holding the reference.
4. The page sends `shell:draft-text {text}` through the app contract (`app_contract.ts`, `SHELL_DRAFT_TEXT`). The shell's `DesktopStore.draftText` (`frontend/src/store/DesktopStore.ts`) puts it "into the pinned window that takes a draft, else through the first draft row of the machine" -- the chat's `draft` launch path, a POST to `/api/chats/intake` with `target = "current_chat"`, `is_draft = "true"`. On an unframed page the rows are greyed: "Open this page in the workspace to draft into a chat".
5. In the composer, `system/apps/chat/frontend/src/models/elementReferences.ts` takes each JSON block out of the text, "uploads it as a `REF-<id>.json` file through the ordinary attachment path, and leaves the prompt that names it". The file lands under `data/uploads/`. The user finishes the sentence and sends.
6. The agent is briefed by `AGENTS.md` ("A user can right-click anything on their screen and attach a description of it") and `.agents/shared/references/element-references.md`: "Start from `app` and `page_path`: the page's source is that app's frontend ... Grep that source for the `id`, the classes ... `selector` is for the live page (Playwright, the browser), not for grep."

Reload is the `update-app` skill's live loop (`.agents/skills/update-app/SKILL.md`): edit, `supervisorctl restart <name>`, then `python3 system/scripts/layout.py refresh --app <name>`, which "reloads every page of the service on every client". For the shell itself, `system/scripts/refresh_workspace_view.py`. The reference carries `window_id` and `desktop_id` so the agent can address the exact window with `layout.py`. For a critical app the change goes through the preview-and-apply flow in section 5 instead.

## 5. Self-modification

`AGENTS.md`, "Self-modification": "You can (and should) modify your own configuration ... CLAUDE.md or AGENTS.md ... .agents/skills/ ... system/supervisord.conf.d/ ... system/scripts/. Commit your changes to git after making modifications, silently." Appearance lives in the shell (desktops, wallpapers at `/api/wallpapers`, avatar designs in `docs/system/avatar-designs.md`, icons per `docs/system/app-icons.md`); behavior lives in the output style, skills, and `AGENTS.md`.

Two editing regimes:

- Ordinary apps: edit the served tree, restart, refresh, then a turn-end harden worker (`.agents/shared/worker/references/harden-creation.md`).
- Critical apps (`critical = true`: shell, chat, terminal) and `system/libs/workspace_ui/`: `.agents/skills/update-app/references/critical-app.md`, "Never edit a critical app's tree in the served checkout" -- an isolated worktree, a `<name>-preview` window as the user's view, a background harden worker, then "the atomic apply (pre-flight, health-checked, auto-rollback)".

### Update path

`system/config/parent.toml` names upstream (`url = "https://github.com/imbue-ai/default-workspace-template.git"`, `branch = "main"`). `.agents/skills/update-self/SKILL.md`:

- A worker merges and validates on its own branch; the lead runs `update_self.py apply --merge-ref mngr/update-self --ff-only --target-ref "$REF"` from a staged copy of the target version's own skill.
- The apply "fast-forwards the worker's `update-self:` merge commit, snapshots the pre-apply state, ... pre-flights the merged backend ... restarts the services agent ... probes the shell's health route ... writes the `docs/VERSION_HISTORY.md` entry ... reverting the entire merge and restoring the snapshots on any other failure." Exit 2 is "automatically rolled back"; exit 3 "emergency".
- The default target is "the release the Imbue Studio app driving this workspace was built against" (`references/version-ceiling.md`).
- A workspace older than `minds-v0.3.9` cannot update across the Debian 12 to 13 boundary and uses `migrate-workspace` (a fresh workspace pulls the old one in over a live connection) instead.

`refs/openhost/incoming` belongs to the self-hosted packaging, not the template: `bottled-minds/scripts/openhost_entrypoint.sh` says "stage the new commit into the live workspace as refs/openhost/incoming so update-self can merge it", and sets `OPENHOST_UPDATE_PENDING_PATH` so "the system_interface watches the pending marker to prompt the mind to reconcile".

Fixes to built-in code go upstream rather than staying local: "Fixing it locally is *not* an alternative: a fix to a file that is byte-identical to the release only manufactures divergence" (`AGENTS.md`). `submit-upstream-changes` opens a PR; `report-built-in-issues.md` posts a report the user reviews in a modal.

### Changelog and guards

`system/scripts/check_changelog_entries.py`: "a PR that touches a project must add `<project_dir>/changelog/<branch>.md`"; buckets are each package, `.agents/changelog/` for skills, `system/changelog/` for the rest. Guards:

- `system/test_meta_ratchets.py`: gitignore `**` patterns, `.dockerignore` symlink, bash strict mode, terminology bans, "no service identifiers in the shell".
- `system/test_mngr_pin.py`: every mngr package at the one pinned commit; `test_no_copy_of_mngr_is_tracked`.
- `system/test_workspace_claude_config.py`: `test_main_agent_type_resolves_to_plain_command_agent`; the Claude version pin matches `setup_system.sh`.
- `system/test_supervisord_layout.py`: drop-in filename matches its program; no program declared twice.
- `system/test_app_manifests.py` (section 3).
- `.reviewer/settings.json` disables the code-guardian stop hook, autofix, CI, and `fetch_and_merge` at repo level; the worker template re-enables only the uncommitted-changes gate. `.agents/skills-lock.json` pins externally sourced skills (`imbue-ai/blueprint`) by hash.
- Test marks `browser`, `frontend`, `real_claude` select suites; `uv run app-manifest select-tests --diff-base <commit>` picks what to run.

## 6. Skills and automations

Layout: `.agents/skills/<name>/SKILL.md` (37 skills; `skills` and `.claude/skills` symlink there), `.agents/shared/references/` (user-facing-language, element-references, freeing-memory), `.agents/shared/worker/` (the harden worker contract), `.agents/shared/scripts/` (`serve_isolated_instance.py`, `validate_skill.py`). Lifecycle skills: `do-something-new`, `fetch-process-show`, `crystallize-creation`, `update-creation`, `heal-creation`, `launch-task`.

Automations are skills on a schedule (`system/libs/automations/README.md`):

- `with_agent_env.sh` restores the agent environment under cron.
- `run_job.sh` is "a durable, completion-tracked runner ... Invoked every minute by a cron line; runs the given command at most once per interval (`--every 15m` / `3h` / `7d`, optional `--at <hour>`), catches up after downtime, and retries a run that failed or was killed mid-flight". State under `data/.state/jobs/<job-id>/`.
- `run_automation.sh` creates a singleton agent per skill and "on later runs clears its chat and re-sends `/<skill>`".
- Cron drop-ins live in `/etc/cron.d/` with copies under `data/.state/cron.d/`; the container clock follows the user's timezone fetched at boot.

Caretaker (`system/services/caretaker/README.md`): off by default; `enable-caretaker` writes the cron entry; `caretaker_check.sh` runs `--every 7d --at 3` and looks for FATAL/BACKOFF services, new log errors, a nearly-full disk, OOM sheds. With findings it wakes the agent, which follows `.agents/skills/caretaker/SKILL.md` and keeps its permissions in `data/.state/caretaker/permissions.md`. The first run is "look-only".

Offline: `manage-scheduled-tasks/SKILL.md` states plain cron "only fires when the machine is up at that moment (a job whose time passes while the container is off or asleep is skipped, never made up)"; `run_job.sh` runs "the first minute the machine is back after downtime". Nothing runs while a local container is stopped. `mngr/apps/minds/docs/desktop-app.md`: quitting the app prompts to shut local workspaces down; cloud ones "keep running their agents with the app closed, which is the point of running one".

## 7. Data

`data/README.md` layout:

- Visible: `documents/`, `my-project/`, `uploads/` (chat attachments), `memories/` (Claude auto-memory), `system/` (runtime config such as `backup.toml`).
- Hidden: `.apps/<name>/` (per-app data), `.skills/`, `.tickets/` (tk), `.tasks/` (worker scratch), `.state/` (registry `apps.toml`, jobs, cron.d, caretaker, update-apply snapshots, OOM ledger), `.secrets/` (`restic.env`, `share.env`, `share_grants.toml`, `share_tls/`), `.imbue/plans/`.

`.gitignore` excludes `data/*` and whitelists only each folder's `README.md`. Git therefore holds code, skills, config, and docs. It holds no user data, no memory, and no chat transcript; transcripts live under the account's Claude config dir, outside the repo.

Backups (`system/services/host_backup/README.md`): "Background service that continuously backs up the agent's full `host_dir` (`/home/user/.mngr/`) to a remote restic repository (Cloudflare R2 by default)." Defaults in `system/services/host_backup/src/host_backup/config.py`: `backup_interval_seconds = 3600`; retention 24 hourly, 30 daily, 12 weekly, 24 monthly; prune daily. "The repository is created (and keyed) by Imbue Studio ... the workspace's own random password is the repository's single key." Snapshot methods: `btrfs_local` (lima), `outer_trigger` (VPS docker), `direct`. Apps mark rebuildable directories with a `.nobackup` file. Memory survives container loss only this way (`CLAUDE.md`).

Export: `mngr/apps/minds/imbue/minds/desktop_client/backup_export.py`, "Export a workspace's latest restic snapshot as a downloadable zip ... without the workspace being reachable". `mngr/apps/minds/docs/backup-retention.md`: destroyed workspaces' backups are kept 30 days; "Restoring is not offered -- these workspaces no longer exist; the download is the escape hatch."

Sync: `mngr/apps/minds/test_sync_e2e.py` exercises "sign-in, workspace association, the master-password settings panel, the landing unlock banner, and the backups page's snapshot table and download control" against a real connector. `desktop_client/dek_store.py`: "Each signed-in account has a random 32-byte DEK that encrypts its workspace records' secret payloads"; the master password's "only role ... is wrapping DEKs". Workspace records (which machines exist, their `restic.env`) sync through the connector. `folder_sync.py` mirrors user-chosen local folders into `~/synced_folders/<device id>/` in the container (`.agents/skills/file-sharing/SKILL.md`); other local files are read over WebDAV through the latchkey gateway.

Opt-in GitHub sync (`system/libs/github_sync`) auto-pushes commits only; "`data/` is covered by the restic host backup instead" (`AGENTS.md`).

Cloud vs local: one template, different create templates (`docker`, `lima`, `modal`, `vultr`, `ovh`, `aws`, `gcp`, `azure`, `imbue_cloud`). `[create_templates.lima]` installs a systemd unit so the workspace "recovers from a VM reboot even when the Imbue Studio desktop app is not running". Modal sandboxes are capped at 24h and recreated. `mngr/apps/minds/docs/workspace/glossary.md`: a workspace's "backups are substrate-independent: a workspace's data can be restored onto a different machine", and the machine "is a swappable attribute".

## What only hands-on use could settle

1. Latency of a chat turn end to end (tmux send, Claude, JSONL watcher, SSE) compared with a native chat UI.
2. Whether the `REF-` JSON is enough for the agent to find the right source on a non-trivial app, and how often it asks instead of guessing.
3. Time from right-click "Modify..." to a refreshed window on an ordinary app, and whether `layout.py refresh` fires reliably.
4. How the critical-app preview-and-apply flow feels when the shell itself is the target; how often the auto-rollback triggers.
5. Whether `--dangerously-skip-permissions` plus the hook guards (`agent_secrets_guard.sh`, `agent_prevent_commit_rewrite.sh`) catch what they claim.
6. Memory behaviour on an 8 GB local container with a browser fleet, Xvfb, and two chats open; how visible earlyoom sheds are to the user.
7. Cold start of a fresh workspace (image pull, `uv sync`, `npm run build`, the deferred Fortress install).
8. Whether the "Engineering Subordinate" style and the no-plumbing-vocabulary rule hold across long sessions.
9. Caretaker quality: what its weekly findings look like, and whether users grant it permissions.
10. The `use-template` adopt flow on a template with `required_accounts`; how latchkey permission requests appear to the user.
11. Share flow: time from "publish" to a working TLS URL, and what a non-owner grantee sees.
12. Restore in practice: whether a restic restore onto a new machine brings back chats, memory, and app data consistently.
13. `update-self` wall time and failure rate on a workspace with user edits to critical apps.
14. How many skills a workspace accumulates and whether their descriptions stay discoverable in Claude's context.
15. Cost: Opus with 1M context by default for every chat, fast mode toggles; actual per-day spend on a Max subscription.
