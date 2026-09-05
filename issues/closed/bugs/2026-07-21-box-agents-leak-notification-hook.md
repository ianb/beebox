---
title: "Box agents occasionally leak a macOS notification — they inherit the user's Notification hook"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder gets occasional stray notification popups from boxes
resolution: implemented
---

> **Closed 2026-08-06 — symptom fixed (boxholder call).** The stray popups stopped
> after a fix on the notifier side (the boxholder's personal `~/.claude/hooks/notify.sh`
> now suppresses tab-less/box invocations). NOTE the repo-side root is still latent:
> box-agent spawns (`src/core/agent/run.ts:88`) set only PreToolUse/PostToolUse and
> don't neutralize the inherited `Notification` hook, so a dev/CI without that
> notify.sh guard could still leak. The small repo-side fix (neutralize the
> Notification hook in the inline `hooks` object) remains available if it ever
> matters, but the boxholder's symptom is resolved.

Occasionally a macOS notification popup appears "from a box" that's normally
suppressed. Diagnosed via bbx-debug; **strong mechanism, not yet reproduced with a
red loop** (the trigger is a rare event — see below).

## The channel

The popups come from `~/.claude/hooks/notify.sh` — the boxholder's personal
focus-aware notifier, wired in `~/.claude/settings.json` to the Claude Code
**`Notification`** hook (matcher `permission_prompt|elicitation_dialog`). It
fires a macOS notification via `alerter`, formatted `⏳ <worktree> needs you`.

## Why box agents fire it at all

Box agents are Claude Code subprocesses (Agent SDK `query()`), spawned by both
the reactor (`src/core/agent/run.ts`) and chat (`src/services/claude-chat.ts`).
Neither sets `settingSources`, so it **defaults to `["user","project"]`** — the
comment at `run.ts:88` even says so — which loads `~/.claude/settings.json`,
**including the user's `Notification` hook**. The inline `hooks` both paths pass
only sets `PreToolUse`/`PostToolUse`, so the `Notification` key isn't overridden;
it survives and fires.

So a headless box agent inherits the dev's personal notifier. It shouldn't — a
box run is not an interactive session the boxholder is watching.

## Why "usually suppressed, occasionally leaks"

- Both paths use `permissionMode: "bypassPermissions"`, which means a
  **`permission_prompt` never fires** — that's the common half of the matcher,
  suppressed. Usual case: silence.
- But the matcher is `permission_prompt|elicitation_dialog`, and
  **`elicitation` is NOT suppressed by bypassPermissions.** When a box agent hits
  an elicitation (an MCP/tool eliciting structured input, etc.) the hook fires.
  Elicitations are rare in a headless run → occasional popup.
- notify.sh is focus-aware ("are you looking at this tab? then stay silent") and
  **fails open**. A box agent has **no Terminal tab** — verified: a headless
  invocation logs `tty=none` — so the focus check finds no matching tty and falls
  through to notifying. The one safeguard that would suppress it can't apply to a
  tab-less subprocess.

## Capture in place (the red loop for an intermittent trigger)

Since the trigger can't be forced on demand, `notify.sh` is instrumented
(`[DEBUG-notif-leak]`) to append every invocation — event name, cwd, tty, payload
— to `~/.cache/beebox/notify-hook-trace.log`. **The next stray popup will
name its `hook_event_name` and which box.** That confirms elicitation-vs-something
before any fix. (Remove the debug block once pinned.)

## Fix candidates — do NOT apply blind (verify SDK hook semantics first)

The root fix is: **a box agent must not inherit the user's `Notification` hook.**
Options, in rough order of surgical-ness:

1. **Neutralize just the Notification hook** in the inline `hooks` object both
   paths pass: add `Notification: []` (and possibly `Stop: []`) alongside the
   existing `PreToolUse`/`PostToolUse`. Cleanest *if* an inline empty array
   overrides the settings-loaded hook rather than merging — **that per-event
   merge-vs-replace behavior is SDK-version-specific and must be confirmed**
   (check the installed `@anthropic-ai/claude-agent-sdk` version's docs/source,
   don't assume). This is the "search the library, don't trust memory" case.
2. **Drop `"user"` from `settingSources`** (e.g. `["project"]`) so box agents
   stop reading `~/.claude/` entirely. Broader — also stops inheriting any other
   personal user config, which may be desired (a box agent arguably shouldn't)
   but is a bigger behavior change touching both spawn paths.
3. **Guard notify.sh against tab-less/box invocations** — exit early when there's
   no controlling tty *and* a box marker is present. Patches the symptom in the
   personal hook, not the engine; wrong layer, but a fast personal stopgap.

Prefer #1 if the SDK honors an inline override; else #2. #3 is only a personal
band-aid and doesn't fix it for other users who install their own notifier.

## Note for the general-audience angle

This matters beyond the boxholder: **any** user who runs Claude Code with a
`Notification` hook in their `~/.claude/settings.json` will get box agents firing
it, because `settingSources` defaults to loading user settings. So this is a real
default-behavior bug, not a personal-config quirk — relevant to the
soft-open-source effort.
