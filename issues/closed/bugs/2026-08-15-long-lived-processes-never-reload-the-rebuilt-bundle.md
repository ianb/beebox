---
title: "Long-lived dev processes run stale engine code — staleness is only checked at spawn"
workstream: unattached
area: callback-box
labels: [dev-server, process-lifecycle, scheduler]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed main's dev server not showing recent changes
---

`bin/cb` self-heals a stale bundle **at spawn time and only then**. In a dev
checkout it scans for any backend `.ts` newer than `dist/cli.mjs`, rebuilds if
so, and `exec`s the bundle. Newly spawned processes are therefore always
current — and nothing ever re-checks after `exec`. Any process that outlives a
source change runs stale code indefinitely while the bundle on disk keeps
advancing without it.

Measured 2026-08-15:

```
dist/cli.mjs built     10:08:51
main's cb serve child  started 08:21:38   ← serving 08:21 code at 10:08
scheduler daemon       started Aug 9      ← six days stale
```

The boxholder's requirement for the fix: **make it work, not report.** A
staleness *warning* is acceptable as a secondary signal, but the goal is that
long-lived processes pick up new code on their own.

## Two victims, and the second has no protection at all

**Box `cb serve` children.** Protected only by idle-collect — stop when unused,
respawn fresh on the next request. A worktree in *continuous* use never idles,
so it never restarts. The protection is inversely proportional to how heavily
the checkout is being used, which is backwards: the checkout you are actively
working in is the one most likely to be serving stale code.

**The scheduler daemon.** Designed to run forever, and it runs the tick
**in-process**:

```
src/core/schedule/scheduler.ts:12   import { runTick } from "../../cli/commands/tick.js"
src/core/schedule/scheduler.ts:230  const result = await runTick(boxPath, { quiet: true })
```

`tick.ts` has no spawn path of its own, so every scheduled task on every local
box runs whatever engine the daemon loaded at start. Nothing will ever restart
it except a manual bounce or a reboot. It had been up six days when this was
found (bounced by hand at 10:38 on 2026-08-15; the daemon itself is unchanged,
so it will drift again).

**Suspected, not established:** three scheduled tasks were failing on a local
box while the daemon was six days stale (`chat-review` and
`process-retrospective` timing out at 600s awake runtime,
`demo-weekly-research` exiting 1). Stale engine code is now a much better
suspect than it was, but nobody has tied them together — worth re-checking
those failures against a current daemon before assuming they are separate bugs.

## Why it stays invisible

Vite transforms on request, so the frontend always updates and the app looks
alive. `bin/cb` rebuilds silently. A change spanning both surfaces appears
half-applied, which reads as a UI bug rather than a stale process. And the
post-commit hook deploys to the *server* — nothing bounces local long-lived
processes.

## Fix directions

Preference is for self-healing over reporting, per the boxholder.

- **The daemon re-execs itself.** Compare `dist/cli.mjs` mtime against process
  start each loop; when the bundle is newer, re-exec. This is the same
  philosophy `bin/cb` already applies at spawn, extended to the process that
  most needs it. Needs care around a tick in flight — finish the current pass,
  then replace.
- **The hub recycles a child when the bundle moves**, rather than relying on
  idleness that heavy use prevents. Interacts with in-flight chat turns and a
  live `codex app-server` child, so "when is it safe to bounce" is the real
  question, not "how."
- **A `bin/doctor.ts` check** — it already has `checkDeployCurrency` comparing
  the deployed SHA to main; a local analogue would surface this. Explicitly the
  *fallback*, not the fix: the boxholder wants it to work, and a report is only
  worth adding for cases self-healing can't cover.

## Design questions

- **What counts as safe to restart.** A box child may have an in-flight chat
  turn and a long-lived `codex app-server` beneath it. Killing mid-turn loses
  work; waiting for idle is what already fails. Something in between — drain,
  or restart at a turn boundary — is probably the answer, and it is the crux.
- **Whether dev box children should run the bundle at all.** Running `tsx` from
  source would always be current, at the cost of the fast cold start
  `bin/cb`'s bundle exists to provide (see its header comment). Worth pricing
  rather than assuming.
- **Whether this generalizes.** Any long-lived process spawned from a dev
  checkout has the same shape. Enumerate them before fixing two cases.
