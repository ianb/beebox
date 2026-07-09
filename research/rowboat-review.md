# Rowboat vs Callback Box — competitive note

*Reviewed 2026-07-08 from the Show HN (https://news.ycombinator.com/item?id=48819808) and Rowboat's pitch. A dated snapshot of both systems as they stood; not maintained as our code evolves.*

## In a nutshell

**Rowboat** is an open-source, **local-first desktop app** billed as an alternative to Claude Desktop — but organized around *work surfaces* rather than a chat box. Its thesis: *"it's not enough for the AI to be right, the help has to show up where the work is happening."* Data *"lives on your machine as plain Markdown,"* it runs without their servers, and you can point it at local models (Ollama/LM Studio). Built-in surfaces cover email, meeting notes, a browser, parallel coding, and notes. The headline capability: **you build your own work surfaces (web apps) inside Rowboat — each app gets its own UI and a background agent** — and the community ships more by publishing a GitHub repo and registering it. (Its background email agent *"pre-creates drafts for important emails"* and learns your writing style.)

**Callback Box**, for contrast: cards-first, **filesystem + git as the database**, the Claude Agent SDK as a rented loop, one box = one agent = one human, agent-*generated* views attached to cards, proactivity via schedules → wakeup → reactor over job cards, served through a hub to a browser (not a desktop app).

This is the closest external parallel we've scouted — closer than OpenClaw/Hermes on the *product* thesis, if not the architecture.

## Where we converged independently (validation)

- **"Help shows up where the work is, not in a chat box."** Rowboat's core pitch *is* our bet — views/surfaces over chat-centrism (see `project_views_attach_to_cards`, the interface-as-cards direction). Independent convergence on the anti-chat thesis is a strong signal we're aimed right.
- **Plain Markdown, local-first, own-your-data.** Same substrate choice (our cards; git history). Same value story for a source-available release.
- **Background agents that draft ahead and learn your style.** Rowboat's draft-ahead email agent is our reactor + feedback/personality loop by another name. Convergence on "proactive drafting, not reactive Q&A."
- **Community extensibility via published repos.** Rowboat's "publish a GitHub repo, register it" ≈ our boxes-as-packages (v2) and box-local schemas/views.

## The real divergences (different bets)

| Axis | Rowboat | Callback Box |
|---|---|---|
| Shell | **Desktop app** (Electron-ish), its own runtime | Claude-Code-operated; hub → browser; git-native |
| Agent granularity | **One background agent per work-surface/app** | Box-wide reactor + chat agents; views are agent-*generated*, not agent-*owned* |
| Extension unit | A **web app** (own UI + own agent), registered from a GitHub repo | A **box** (package) with local schemas/views/procedures; views attach to cards |
| Loop | Their own runtime + local-model option (Ollama/LM Studio) | Rented Claude Agent SDK loop (configured provider key; never ambient) |
| State | Plain Markdown on disk | Plain Markdown cards + **git as history** (their pitch stops at "files," not versioned history) |

## Idea triage

**Tier 1 — worth genuinely investigating**

- **Per-surface background agent.** Rowboat's sharpest divergence: each surface has its *own* resident agent, not a shared one generating views on request. Ours are agent-*generated* but box-wide. Question worth a design pass: is a per-view/per-surface agent (a "this surface's agent," scoped to that card/view's job) worth the complexity, or does box-wide reactor + on-demand view generation already cover the same UX at lower cost? Trace: `src/core/reactor/`, the views direction, `project_views_attach_to_cards`. **Investigate** (don't adopt blind — it multiplies agent count and cost).

**Tier 2 — confirmations to bank, cheap lessons**

- **"Draft-ahead, surface-native" as an explicit pattern.** Their email surface pre-creates drafts inline. We have the pieces (reactor, drafts, gmail connector); worth naming "the surface shows a ready draft" as a first-class UX pattern rather than a chat reply. **Adapt** — trace to gmail connector + reactor.
- **Local-model option (Ollama/LM Studio).** We hard-require a configured Claude key (deliberately — bill safety, `feedback_typescript`… the provider-auth work). A local-model escape hatch is a source-available selling point *and* a privacy story. **Later / gated** — trace to the provider-auth polish + `docs/plans/source-available-release.md`.

**Tier 3 — cautionary**

- **"Local-first" honesty.** Rowboat got the top critical comment: markets local-first, ships Deepgram (transcription) + ElevenLabs (voice) + PostHog (analytics). **We share this exposure** (transcription/TTS providers, any analytics). Lesson for our source-available release: state the cloud dependencies plainly and make them swappable/optional, or take the same reputational hit. **Adopt (as release discipline)** — trace to `docs/plans/source-available-release.md` and the provider-key work.

## Deliberate non-adoptions

- **Desktop-app shell.** Our hub→browser + git-native model is a different (and, for a git-backed system, better-fitting) bet; no reason to chase Electron.
- **Web-app-per-surface as the extension unit.** Our extension unit is the *box* (and card-attached views); a full web-app-with-its-own-agent per surface is heavier than card-attached views and cuts against "one box = one agent."

## Follow-ups worth filing

- *Per-surface / per-view background agent — design pass* (Tier 1 above): is it worth it vs. box-wide reactor + generated views?
- *"Draft-ahead, surface-native" as a named UX pattern* for reactor output (Tier 2).
- *Source-available release: state + make swappable the cloud provider dependencies* (Tier 3) — fold into `docs/plans/source-available-release.md`.

(Not auto-filed — flag which you want in `issues/`.)
