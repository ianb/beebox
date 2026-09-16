---
title: "bbx is the box agent's surface; everything else moves under `bbx engine`"
status: implemented
workstream: bbx-agent-surface
issues:
  - ../../../issues/closed/code-quality/2026-08-08-audit-bbx-subcommand-surface.md
---
# bbx is the box agent's surface; everything else moves under `bbx engine`

`bbx` registers 61 top-level verbs. A box agent reads all of them, and the list
is the agent's mental model of what a box is. Some of those verbs cannot be run
by an agent at all: they start daemons, edit a machine-wide manifest, drive a
browser OAuth flow, or act across every box on the host. This plan sorts every
verb by one criterion, moves the ones an agent can never call under a single
`bbx engine` namespace, and adds a test that stops the sort from rotting.

The criterion is the boxholder's, stated 2026-09-14:

> only things run by an agent (scheduled, chat, procedure, etc). If it's not
> ever callable by an agent (e.g., by the server, by deploy, etc) then it
> shouldn't be in bbx.

So `bbx engine` is not a second permanent surface. It is the staging area that
names exactly which verbs should leave the binary, which is what
[extracting `bbx serve`](../../../issues/code-quality/2026-08-08-extract-bbx-serve-from-the-box-cli.md)
needs and does not have. It is also the enforceable form of the audit issue's
own amendment — "engine and operator verbs may remain in `bbx` for now provided
every one is listed here" — with the list in code instead of in prose.

**Issues addressed:**
`issues/code-quality/2026-08-08-audit-bbx-subcommand-surface.md` (both halves:
the surface audit and the "nobody tells coding agents who `bbx` is for" docs
half). Unblocks, does not close,
`issues/code-quality/2026-08-08-extract-bbx-serve-from-the-box-cli.md`.
Grepped the queue for `bbx`, `cli`, and `agent-surface`: the only other hits
are `issues/docs-and-chores/2026-07-04-instruction-surface-size-budget.md`
(instruction budget, adjacent but about generated guidance volume, not command
registration) and `issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md`
(touches `bbx pub setup`, which this plan moves; that issue's work is unaffected
by the new path).

## Smallest fix and budget

**Smallest fix as reported.** Mark each verb in one table and pass
`{ hidden: true }` when registering a non-agent one, so `bbx --help` shows only
the agent surface. No renames, no deploy change, no prod risk. About 120 lines
of table plus 20 lines of registration change. The boxholder rejected this
shape: it separates what agents *see* from what exists, but leaves the verbs
addressable at top level, so nothing stops the next operator verb landing there
and nothing tells the `bbx serve` extraction what to take.

**This plan's budget.**

| Track | Source | Tests |
|---|---|---|
| A — surface table + registration | 220 | 60 |
| B — split three families (`scheduler`, `pub`, `secrets`) | 120 | 40 |
| C — deploy: setup-server.sh, deploy.sh, drop-ins, server-bin | 90 | 0 |
| D — agent-surface doctest | 60 | 180 |
| E — docs half + generated-reference consistency check | 60 | 60 |
| **Total** | **550** | **340** |

Subprojects touched: `beebox/` and `beebox/deploy/`. Generated box docs
(`box-docs/bbx-commands.md`) and the audit issue are reported separately, per
the template.

That is roughly 4× the smallest fix, above the ~3× line, so it went to the
boxholder as a choice: they chose the namespace over hiding, and chose the hard
rename over an alias window. Recorded here rather than re-asked.

## Stated preferences this plan trades against

- **Engineering principle 7, "Hierarchy is a discoverability contract"**
  (`beebox/docs/engineering-principles.md:87`). This is the principle the plan
  is about: a flat list of 61 verbs asserts they are peers to the reader, and
  they are not.
- **Principle 11, "Enforcement beats convention"** (`:127`). The audit issue's
  existing mechanism is a prose list in an issue file, which is convention.
  Track D converts it to a test. This is the plan's main justification for
  spending more than the hiding fix.
- **Principle 8, "One way to do each thing"** (`:95`). Traded against in
  Track B: three families end up with subcommands in two places
  (`bbx scheduler status` and `bbx engine scheduler start`). The alternative —
  a whole family on one side — puts either a daemon-lifecycle verb on the agent
  surface or a read the agent legitimately wants behind the engine namespace.
  The name stays the same in both places, so there is still one name per act.
- **`beebox/CLAUDE.md:5`**: "Work only on the requested problem. Do not expand
  scope into adjacent cleanup." The audit turned up dead surface (`scenario`,
  five stub verbs, three deprecated aliases). Those are removed because the
  boxholder asked for them to be, verb by verb, not swept up on the plan's own
  authority. `scenario`'s removal is still open (see *Open design questions*).
- **`beebox/code-style.md:112`**: files max 300 lines. `src/cli/index.ts` is 219
  lines and the table is ~220, so the table gets its own module rather than
  growing the entry point past the limit.
- **Shipped precedent:** `docs/implemented-plans/agent-capability-delegation.md`
  (merged `0174ab032`, this afternoon). It established `BBX_SPAWN_PROFILE`, the
  agent-bearer tRPC client, and the rule that a credentialed verb runs
  in-process only under `tooling`. This plan classifies what that plan made
  dispatchable, and Track D's doctest is modelled on its
  `test/cli/commands/drive-delegation.doctest.md`.

## What already exists

- `beebox/src/cli/index.ts:100-158` — 61 `program.addCommand(...)` calls in
  registration order, with no classification of any kind. Rebuild: the calls
  become a loop over the table.
- `beebox/src/cli/index.ts:161-218` — five commands defined inline that print
  `"Not yet implemented"`: `show`, `log`, `diff`, `inject`, `step`. `show --raw`
  is documented as *"Show raw XML instead of pretty-printed"* (`:168`), the
  stale flag the audit issue opens with. Their only other mention in the repo is
  `docs/implemented-plans/mvp-implementation-guide.md:1007-1016`. Delete.
- `beebox/src/lib/spawn-profile.ts:16-20` — `spawnProfile()`, returning
  `"agent" | "tooling" | "unset"`. Reuse: Track D's doctest sets
  `BBX_SPAWN_PROFILE=agent` and this is what reads it.
- `beebox/src/cli/lib/credentialed-verb.ts:95-115` — `dispatchCredentialed`,
  which already routes every credentialed verb to the server under any profile
  but `tooling`. Reuse: this is *why* the credentialed agent verbs (`drive`,
  `calendar`, `connector`) can stay on the agent surface, and what Track D's
  doctest asserts is reached.
- `beebox/src/core/agent-guide/commands.ts:1-95` — the in-box three-way
  taxonomy ("Reach for these" / job lifecycle / "System-run — you don't invoke
  these"). Reuse as the consumer: its lists get derived from, or checked
  against, the table.
- `beebox/src/core/docs-gen/bbx-commands.ts:18-45` and its two siblings — the
  generated reference, assembled as hand-written prose string arrays, not
  derived from the registry. Reuse partially: rewriting the prose generator is
  out of scope, so Track E adds a consistency check (every verb the generated
  reference names is on the agent surface) rather than a derivation.
- `beebox/deploy/deploy.sh:786-808` — the systemd drop-in installer. Reuse: it
  is the documented seam for a setting a deploy must own without owning the
  unit, and its own comment (`:775-777`) says the units "are NOT regenerated by
  this script". Rebuild lightly: today it installs every `deploy/systemd/*.conf`
  into *both* `beebox-hub` and `beebox-scheduler`, so a per-unit `ExecStart`
  override needs per-unit subdirectories.
- `beebox/deploy/systemd/git-drain.conf` — the one existing drop-in, and the
  worked example of the pattern (a `[Service]` block plus a comment explaining
  what it is for).

## Prior art (external)

One design decision depends on an external premise: that a systemd drop-in can
replace a unit's `ExecStart` without editing the unit.

- systemd.unit(5), "Drop-in files": a `.d/*.conf` fragment is merged over the
  unit. For a list-typed setting such as `ExecStart`, assigning the empty string
  first (`ExecStart=`) resets the list, and a second line sets the new value. A
  fragment that sets `ExecStart=` only once *appends* a second command rather
  than replacing it, which would start two hubs.
  https://www.freedesktop.org/software/systemd/man/systemd.unit.html
  This is the single most failure-prone line in the plan; Track C's drop-in
  carries the reset line and the failure mode is in the table below.

No external prior art searched for the CLI split itself: the shape (one binary,
a namespaced admin subtree) is `git` / `kubectl` conventional, and no design
decision here turns on how another tool did it.

## Tracks / scope

### Track A — the surface table and registration

**What.** Two modules. `src/cli/surface-data.ts` holds the classification as
pure data — no `Command` objects, no imports from `commands/` — so a test can
import it without loading the CLI. `src/cli/surface-build.ts` reads it and
assembles the program: agent verbs at top level, engine verbs under a `bbx
engine` parent. `src/cli/index.ts` shrinks to env setup plus
`buildProgram().parse()`.

The `buildProgram()` extraction is required, not incidental: today `index.ts`
runs `loadEnv`, `migrateUserState`, and `program.parse()` at module top level
(`src/cli/index.ts:80-86,219`), so importing it from a test parses `process.argv`
and exits. Track D's totality check needs the assembled program as a value.

**Why this needs to change.** There is no classification anywhere in the code
today. The audit issue's buckets are prose in an issue file, which cannot be
read by `bbx --help`, by the agent guide, or by a test.

**Direction.**

```ts
/** Who can invoke a verb: the box agent, or only a person or a unit file. */
export type Audience = "agent" | "engine";

export interface SurfaceEntry {
  /** The verb as typed, e.g. "scheduler". */
  name: string;
  audience: Audience;
  /** Why it is engine — a sentence, not a category. Empty for agent verbs. */
  reason?: string;
  /**
   * A safe, read-only invocation for the agent-surface doctest (Track D), or
   * `null` when the verb has none. `null` requires a `reason` saying why.
   */
  smoke: readonly string[] | null;
}
```

Split families (Track B) contribute two entries under the same `name`, each
naming its own subcommands. `surface-data.ts` stays free of `Command` objects;
`surface-build.ts` is the only module that maps a name to a registration.

**The classification.** Engine, with the reason each one cannot be reached by an
agent:

| Verb | Why it is not agent-callable |
|---|---|
| `serve` | The hub spawns one per box (`src/hub/supervisor.ts:441`). |
| `hub` | systemd `ExecStart` (`deploy/hetzner/setup-server.sh:254`) and the dev router (`workstreams-app/src/router/router-worktree-start.ts:172`). |
| `boxes` | Machine-wide box manifest; an agent has no second box. |
| `activity` | Reports across every box; the deploy's at-rest gate (`deploy/server-bin/bbx-wait-quiet:19`). |
| `tick` | Drives every box's due scripts. The daemon calls `runTick` in-process (`src/core/schedule/scheduler.ts:11`); the CLI verb is reached only by the field-test harness. |
| `scheduler start\|install\|uninstall` | Daemon lifecycle. `start` is a systemd and launchd `ExecStart`; `install` writes the launchd plist (`src/cli/commands/scheduler.ts:164-168`). |
| `tailscale` | Machine networking, outside any box. |
| `google-auth` | An interactive browser OAuth flow. |
| `auth` | Local account management; every verb refuses an agent session without `--agent-confirmed`. |
| `secrets set\|rm\|grant\|revoke\|list\|copy-grants\|migrate` | Mutations refuse agents without `--agent-confirmed`; `list` and `copy-grants` span the machine. |
| `pub setup\|go\|revoke` | `setup` needs a wrangler login; `go` is "the human-only flip (interactive confirmation required)". |
| `field-test` | The agent field-test harness, run by a developer in this repo. |
| `scenario` | Same, and dead (see *Open design questions*). |
| `wakeup` | Tooling-profile only; `force-wakeup` is the agent's counterpart (decision 2026-09-14). |
| `init`, `upgrade`, `migrate` | Act on the box's *installation* rather than its content (boxholder, 2026-09-14). |

Everything else is `agent`. The full list lives in the table, not here.

**Vocabulary lock-ins.** `bbx engine <verb>` as the namespace (boxholder's
choice over `admin` and `sys`). `Audience` with exactly two values — a third
tier would be the "two tiers of anything is a smell" trap, and the third
audience the issue names (coding agents in this repo) gets *none* of the
surface, which is a docs fact, not a table value.

**First implementation chunk.** `buildProgram()` extracted from `index.ts` with
no behaviour change (verified by the existing CLI doctests), then
`surface-data.ts` with every entry and `audience` set, then `surface-build.ts`
registering from it — with the three split families still whole on whichever
side holds their majority. Splitting is Track B, so this chunk has no open
question in it.

### Track B — split `scheduler`, `pub`, `secrets`

**What.** Three families have subcommands on both sides of the criterion.

| Family | Agent | Engine |
|---|---|---|
| `scheduler` | `status`, `log` | `start`, `install`, `uninstall` |
| `pub` | `draft`, `ls`, `status` | `setup`, `go`, `revoke` |
| `secrets` | `declare`, `describe`, `status` | `set`, `rm`, `grant`, `revoke`, `list`, `copy-grants`, `migrate` |

`secrets describe` splits at the *option* level, below anything the table can
express: `--add-use` is the agent's and `--remove-use`/`--clear-uses` refuse an
agent session without `--agent-confirmed`
(`src/cli/commands/secrets-describe.ts:82-91`). The table classifies the
subcommand as agent and leaves the option gate where it already is. This is the
one place the classification is coarser than the code, and it is deliberate —
splitting a command by flag would put the surface boundary somewhere no `--help`
output shows it.

**Why this needs to change.** Putting a family wholly on one side is wrong in
both directions. Wholly engine hides `bbx scheduler status` and
`bbx secrets status`, and the generated agent guide already names
`secrets declare|describe|status` to agents (`src/core/agent-guide/secrets.ts:20-21`)
— that guidance is correct and would break. Wholly agent leaves
`bbx scheduler install` (which writes a launchd plist) on the agent surface.

**Direction.** Each of the three command modules currently builds one `Command`
with all subcommands attached. Export the subcommands individually and assemble
the two parents in `surface-build.ts` (never in `surface-data.ts`, which stays
data). `bbx scheduler --help` then lists `status` and
`log`; `bbx engine scheduler --help` lists `start`, `install`, `uninstall`.

`scheduler add|remove|list` are deleted, not sorted: they already print
`[deprecated] Use bbx boxes add instead` (`src/cli/commands/scheduler.ts:63,78,93`)
and are still listed in the generated box reference
(`src/core/docs-gen/bbx-commands-scheduling.ts:86-88`).

**Vocabulary lock-ins.** The same family name on both sides. `bbx scheduler` is
the agent's half and `bbx engine scheduler` the operator's; neither gets a
disambiguating suffix.

**First implementation chunk.** All three splits, plus the alias deletion.

### Track C — deploy

**What.** Rename every call site of a moved verb, and migrate the two running
systemd units to the new `ExecStart` in the same deploy.

**Why this needs to change.** `deploy.sh:775-777` states that the units are not
regenerated by the deploy, and `setup-server.sh` still emits the pre-hub shape.
So the live `ExecStart=/usr/local/bin/bbx hub` survives any change to the repo.
The first deploy carrying the rename would restart a hub whose verb no longer
exists.

**Direction.**

1. `deploy/systemd/` gains per-unit subdirectories. `deploy.sh`'s installer loop
   (`:791-804`) reads `deploy/systemd/<unit>/*.conf` and `deploy/systemd/all/*.conf`,
   with `git-drain.conf` moving to `all/`.
2. `deploy/systemd/beebox-hub/exec-start.conf` and
   `deploy/systemd/beebox-scheduler/exec-start.conf`, each resetting the list
   before setting it — the reset is the one line that matters, since a fragment
   without it appends a second command instead of replacing the first:
   ```
   [Service]
   ExecStart=
   ExecStart=/usr/local/bin/bbx engine hub
   ```
3. `setup-server.sh:254,282` emit the new command, so a fresh install needs no
   drop-in. `:197` (`bbx init`), `:270` (`bbx boxes add`), and `:213-214` (the
   commented `bbx secrets` checklist) update too.
4. `add-box.sh:231,365,414,443,444` — `hub add-box`, `init`, `secrets
   copy-grants`, `boxes add`.
5. `deploy/server-bin/bbx-wait-quiet:19` — `bbx activity`. It is installed from
   the synced tree at `deploy.sh:702`, so it renames atomically with the verb.
6. `deploy.sh:743` — `bbx migrate --sweep`. Same tree, same commit.
7. `docker/entrypoint.sh:124,130` — `bbx migrate --sweep`, `bbx serve`.
8. `workstreams-app/src/router/router-worktree-start.ts:172` — the dev router's
   `hub` spawn. Not deployed, but breaks every worktree if missed.
9. `schedules/box-convergence/run.ts:93` — `bbx migrate --status` over ssh.
10. `src/hub/supervisor.ts:441`, `src/cli/commands/migrate.ts:102`,
    `src/cli/commands/upgrade.ts:272,280`, `src/field-test/*`,
    `scripts/smoke-*.ts`, `docker/smoke-*.sh` — programmatic spawns.

**The cutover is deliberately unengineered** (boxholder, 2026-09-14: "Don't make
this complicated! There's half a dozen boxes and if it's broken I'll just wait").
`deploy.sh` rsyncs the new tree (`:438-477`) well before the drop-in install
(`:786`), so there is a window in which `/usr/local/bin/bbx` has no top-level
`hub` while the unit still names one. A hub that crashes inside that window, or
a drop-in install that fails, leaves the unit unable to restart until someone
runs the deploy again. No alias window, no restore path, and no reordering of
`deploy.sh` to shrink it: the blast radius is six boxes and a manual re-deploy,
and each of those mitigations costs more than the failure does.

**Vocabulary lock-ins.** `/usr/local/bin/bbx engine hub` as the unit's command.

**First implementation chunk.** The whole track in one commit: per-unit drop-in
restructure, both `exec-start.conf` files, and every call site above. It ships
with Track A's registration change, because a renamed verb and the script that
calls it must land together.

### Track D — the agent-surface doctest

**What.** A doctest that walks the table's agent entries and asserts each one,
run under `BBX_SPAWN_PROFILE=agent` with no Google token file and no secrets
env, does not exit with a credential gap.

**Why this needs to change.** Without it the classification is a comment. The
2026-09-14 incident was exactly a verb that was agent-designed and could not run
from an agent shell, and nothing detects the next one.

**Direction, in two halves with very different costs.**

*The totality check* is pure: import `surface-data.ts` and `buildProgram()`,
compare name sets, assert every `smoke: null` carries a reason. No box, no
server, no subprocess. This is the half that stops the drift the audit issue was
filed about, and it is nearly free.

*The smoke run* spawns real processes, and that is a new mechanism in this
repo — stated plainly because the plan template warns that a new test tier
becomes a norm for every future agent. The cited precedent does **not** do this:
`test/cli/commands/drive-delegation.doctest.md:71-84` mutates `process.env` in
the test process and calls `dispatchDrive` directly; it never spawns `bbx`. What
carries over from it is the harness (`makeTestServer`, the agent bearer, the
auth wall on) and the shape of the assertion, not the execution model.

The smoke run stands up that box and server, then for each agent entry spawns
`bbx <smoke...>` with `BBX_SPAWN_PROFILE=agent`, `BBX_SERVER_URL` and
`BBX_AGENT_TOKEN` set, and `HOME` pointed at an empty directory so no token file
or secret store is reachable. It asserts the process did not fail with
`PRECONDITION_FAILED`/`FORBIDDEN` naming a credential gap, and that stderr does
not contain `google-auth`.

The subprocess is not optional for this assertion: `BBX_SPAWN_PROFILE` and
`HOME` are read through `process.env` at call time, and an in-process test that
mutates them cannot also prove the *registered* verb reaches
`dispatchCredentialed` — which is exactly what regressed in the incident. But
the cost is real, and several verbs will need `smoke: null` because they shell
out to things a test host may not have (`attachments to-annex` needs git-annex,
`pub status` needs wrangler, `scheduler status` inspects launchd). Those
exclusions are the honest limit of this test and are recorded per entry.

What it does *not* assert: that the verb succeeded. Many read-only verbs exit
non-zero for ordinary reasons on an empty box. The invariant is narrow on
purpose — "no credential dead end" — because that is the failure the incident
produced and the one the boxholder's first principle forbids.

A verb with `smoke: null` is excluded and must carry a `reason`. The doctest
asserts the *table* is total — every registered top-level command appears in it
— so a new verb cannot be added without being classified, which is the part that
stops the drift.

**Vocabulary lock-ins.** `smoke` as the field name; `null` plus a reason as the
only way to opt out.

**First implementation chunk.** Totality check plus the smoke run over the
agent entries.

### Track E — the docs half

**What.** Replace the "universal interface" framing with a per-audience
statement, and add the consistency check between the generated reference and the
table.

**Why this needs to change.** `beebox/CLAUDE.md:3` says "`bbx` is the
command-line interface" and `README.md:5` says "the `bbx` CLI is the interface".
The audit issue records a live instance: a main-session agent ran `bbx health`
and `bbx scheduler status` against real boxes as ordinary diagnostics, and
nothing in the repo told it not to.

**Direction.** A short paragraph in `beebox/CLAUDE.md`, which
`bin/generate-agents-md.ts` mirrors into `AGENTS.md`, so it reaches both agent
families from one place. The four audiences, per the issue: box agents get the
everyday surface; operators and unit files get `bbx engine`; **coding agents
working in this repo get none of it**; end users get none of it. Kept to a few
sentences, per `feedback_doc_altitude_matches_importance`. The README twin gets
one sentence.

`bbx --help` grows one line naming its audience and pointing at `bbx engine`.

The consistency check: a test asserting every verb named in the generated
reference (`src/core/docs-gen/bbx-commands*.ts`) is `audience: "agent"` in the
table. It checks one direction only — it catches an engine verb being described
to agents, not an agent verb with no documentation, and it does not reach
subcommand or option granularity, so `bbx scheduler install` inside a prose
block is caught but `secrets describe --remove-use` is not. The other direction
is not worth a test while the reference is hand-written prose; a verb missing
from it is visible to anyone reading the doc, whereas the drift this catches is
invisible. This catches the asymmetry the audit already found —
`bbx-commands-scheduling.ts:34-119` ships `scheduler install|uninstall` and the
whole `scenario` block into every box's agent-readable reference, for verbs
nothing executes.

**Vocabulary lock-ins.** None; this is prose.

**First implementation chunk.** The consistency check and the generated-doc
fixes it forces, then the CLAUDE.md/README paragraphs.

## Could this be simpler?

The simplest version is the hiding fix in *Smallest fix*: one table, and
`{ hidden: true }` on the non-agent verbs. No renames, no deploy change, no
drop-in, and `bbx --help` shrinks to the agent surface immediately. The audit
issue itself proposes this as "the cheapest useful first step."

What the fuller plan buys, and why the simple version is not enough:

- **The simple version fails the boxholder's criterion.** "If it's not ever
  callable by an agent then it shouldn't be in bbx" is a statement about where
  the verb *is*, not about what is printed. A hidden `bbx hub` is still
  `bbx hub`, and the `bbx serve` extraction still has no list to act on.
- **It cannot be enforced.** Hiding is a flag on a registration; nothing fails
  when the next operator verb is registered without it. Track D's totality check
  is what makes the classification hold, per principle 11 (`:127`).
- **The deploy work is not optional once the rename is chosen**, and the rename
  is what the boxholder chose over an alias window.

Track B (the three splits) is the piece most at risk of being complexity for its
own sake. The honest alternative is putting all three families wholly on the
engine side and accepting that `bbx scheduler status` and `bbx secrets status`
move. That breaks guidance already shipped to agents
(`agent-guide/secrets.ts:20-21`), so the split is buying correctness of existing
guidance, not tidiness. If Track B runs long, collapsing `pub` wholly to engine
is the cheapest retreat — no shipped guidance names `pub draft|ls|status`.

## Subplans

None. The three tracks with design content (A, C, D) each have one decision,
settled in Direction. The `scenario` removal is a yes/no in *Open design
questions*, not a design step.

## Failure modes

> **Critical gap:** the `ExecStart` drop-in without its reset line —
> a fragment that sets `ExecStart=/usr/local/bin/bbx engine hub` without a
> preceding bare `ExecStart=` *appends* to the unit's list, so systemd runs the
> old `bbx hub` and then the new command. The old one fails instantly on a
> missing verb and the unit is marked failed, with the real hub never starting.
> Handled: the reset line is in the fragment (Track C, direction 2) and the
> rollout verifies with `systemctl show -p ExecStart beebox-hub` before the
> restart, not after.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Drop-in appends instead of replacing `ExecStart` | No — needs a live systemd | Yes: reset line + pre-restart `systemctl show` check | Clear: unit fails to start, deploy's restart step reports it |
| Drop-in install fails, or the hub crashes, between the rsync and the `daemon-reload` | No | No — **accepted risk** (boxholder, 2026-09-14) | Silent until the next restart, then the unit fails to start. Recovery is re-running the deploy. Six boxes; the boxholder chose to wait over three mitigations that each cost more than the outage. |
| A call site is missed and only runs on a cadence (`schedules/box-convergence/run.ts:93`, hourly) | Track C lists it; no test | Partial: the schedule reports a failing run | Clear but **late** — hours after the deploy |
| `bbx scheduler install` was run on a laptop; its launchd plist holds the old argv | No | No — the plist is on a machine this repo cannot reach | **Silent**: the laptop scheduler stops running and nobody is told. Accepted risk: the only known install is the boxholder's, and `scheduler status` names it. Noted in the rollout. |
| A new verb is registered and not added to the table | Yes — Track D's totality check | Yes: the test fails | Clear |
| An agent verb acquires a credential dependency later | Yes — Track D's smoke run | Yes | Clear |
| A verb's `smoke` entry goes stale (flag renamed) | Partly — the smoke run would fail on a bad flag | No | Clear but reads as a false positive; the doctest's failure message names the entry |
| Generated box reference keeps naming a moved verb | Yes — Track E's consistency check | Yes | Clear |
| Box `CLAUDE.md` prose in a *live box* names a moved verb | No — box content is outside this repo | No | **Silent**: the agent runs a verb that no longer resolves. Handled by the knowledge audit below, which tests what agents actually absorbed. |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — not applicable: no schema or tag vocabulary
  changes. The analogue is an agent picking `bbx wakeup` over
  `bbx force-wakeup`; ADDRESSED by `wakeup` leaving the top level entirely, so
  the wrong choice stops being reachable by the name the guide used to print.
- **Stale ref** — ADDRESSED for generated docs (Track E's consistency check);
  **GAP** for prose inside live boxes, which this repo cannot grep. The
  knowledge audit is the only instrument, and it tests absorption, not text.
- **Two agents touching the same card** — not applicable: no card writes.
- **Hand-edit drift** — the boxholder types `bbx hub` from muscle memory and
  gets commander's "unknown command". ADDRESSED weakly: commander suggests near
  matches, and `bbx --help`'s new line names `bbx engine`. Not addressed at all
  for a *script* the boxholder keeps outside this repo; see the launchd row
  above.
- **Fabricated free-form value** — the `reason` field on an engine entry is
  free text an agent could fill with something plausible but wrong. The table is
  reviewed like any source file; no mechanism proposed, and none warranted.
- **Validation error UX** — DEFERRED. An agent that runs a moved verb gets
  commander's generic unknown-command error, which does not say "this is an
  engine verb, ask the boxholder." A custom handler is listed in *NOT in scope*.
- **Partial migration / transition state** — the window between the deploy
  installing new code and the drop-in reload. ADDRESSED by ordering: the drop-in
  install and `daemon-reload` both precede the restart (`deploy.sh:786-808`,
  then `:810`).

## NOT in scope

- **Extracting `bbx serve`/`bbx hub` into their own binary.** The sibling issue.
  This plan produces the list that extraction needs; taking the step too would
  double the deploy surface in one change.
- **Deriving the generated reference from the table.** `docs-gen/bbx-commands*.ts`
  is hand-written prose (`bbx-commands.ts:18-45`); rewriting it as a generator is
  a larger change with its own review. Track E adds a consistency check instead,
  which catches the drift without the rewrite.
- **A custom unknown-command handler** that tells an agent a verb moved.
  Worth having; wants its own decision about whether it also covers typos.
- **Auditing `bbx --help` text and flag descriptions** beyond the `show --raw`
  case the issue names. Several descriptions are likely stale by the same
  mechanism; that is a separate pass and a separate issue.
- **Retiring the `bbx engine` namespace.** It exists so the verbs in it can
  leave the binary later. Deciding *when* is the sibling issue's call.
- **Changing what `bbx wakeup` does**, or revisiting the `force-wakeup` split
  settled on 2026-09-14.

## Open design questions

**Delete `scenario`, or move it to `bbx engine`?** SETTLED (boxholder,
2026-09-16): deleted. Original reasoning kept below.

Lean was delete. There are no
scenario YAML files anywhere in the repo — only `src/scenario/{loader,runner,types}.ts`
(502 lines) — so no invocation can succeed. Its last commit was the Bee Box
rename (2026-08-30), while `src/field-test/` kept receiving
maintenance through 2026-09-04. It reads as field-test's predecessor. Deleting
it removes the verb, the three modules, the mention at
`.claude/skills/bbx-debug/SKILL.md:34`, and the `scenario` block shipped into
every box's reference (`docs-gen/bbx-commands-scheduling.ts`). Dropping a verb
is the boxholder's decision and is not taken here; if the answer is no, it
becomes an ordinary engine entry and the generated-docs block still goes.

**Should the per-verb smoke run be built?** The table carries a `smoke` entry
for every agent verb and the doctest asserts those entries are well-formed, but
nothing yet spawns them. What is enforced today is that the classification is
total and that no evicted verb is reachable or documented to agents — not that
every agent verb actually runs without a credential dead end. Building it means
~38 `bbx` subprocesses under `tsx`, which is a new and slower test shape than
anything in the suite. Lean: leave it. The 2026-09-14 incident's mechanism is
already covered by `drive-delegation.doctest.md` and
`connector-delegation.doctest.md` at the dispatch layer, and the structural
check is what stops the drift this issue was filed about.

**Does `field-test` belong in `bin/` instead?** The boxholder raised this. Lean:
no. It is 4,088 lines under `src/field-test/` importing beebox internals
throughout, with its own design doc (`docs/plans/agent-field-tests.md`); `bin/`
is the monorepo's thin-launcher area (`bin/CLAUDE.md`). `bbx engine field-test`
keeps it where its code is while taking it off the agent surface. Recorded as a
question because the boxholder asked it, not because the plan is unsure.

## Knowledge audits

The plan changes the command names agents were taught, which is exactly what
`docs/knowledge-audits.md` exists to catch. Two `knows_directly` entries in
`beebox/src/dev/knowledge-audits.yaml`:

- **`bbx-agent-surface-wakeup`** — does the agent reach for `bbx force-wakeup`
  when asked to make a sync happen now, rather than `bbx wakeup`? This one is
  already at risk from the 09-14 change and is not created by this plan; the
  plan is why it gets written.
- **`bbx-agent-surface-engine`** — asked to check whether the scheduler daemon
  is running, does the agent use `bbx scheduler status` (which stays) rather
  than reaching for a moved verb?

Both land RUN (`pnpm knowledge-audit run --box <absolute path> --filter <id>`),
with the status recorded, per `feedback_run_authored_verification`. Note the
`--box` hazard: a bare `--box test1` resolves inside the monorepo; pass an
absolute path.

## What will hold this after it ships

The table's totality check is the load-bearing test, and it is cheap: it imports
`surface.ts` and the registered program, and compares name sets. It fails the
moment someone registers a verb without classifying it, which is the exact
failure mode ("operator commands keep landing in it") the audit issue was filed
about.

The smoke run is the expensive half. Each entry is a real `bbx` subprocess under
`tsx`, so ~38 agent verbs is the dominant cost of the file. It runs them
concurrently with a bounded pool. If it lands slower than about a minute it
should be split into its own doctest file rather than trimmed, so the coverage
stays honest.

No new test tier, and no new mock: the doctest reuses
`test/helpers/doctest-server.ts`, the same harness
`drive-delegation.doctest.md` stands up. The decision worth isolating is the
classification itself, and it already is a pure data structure — a test can
assert over it without running a CLI, which is why the totality check is not
dependent on the slow half.

The deploy change has no test; there is no systemd in CI. It is held by the
pre-restart `systemctl show -p ExecStart` verification in the rollout, which is a
procedure, and the plan says so rather than claiming coverage.

## What changed during implementation

Recorded against the plan above rather than rewriting it, so the difference
stays visible.

**`tick` came back to the agent surface.** The plan evicted it as a fleet-wide
driver. It is not: `--box` defaults to the current directory, the scheduler
daemon calls `runTick` in-process rather than through the verb, and the
generated reference tells agents to reach for `tick --script <name> --force`
when the boxholder asks for a run from chat.

**`push` was missing from the plan's table entirely** and turned up only when
the totality doctest failed. It is engine: `push test` fires a web push at this
box's subscribers to prove delivery.

**A box data migration was not budgeted and was required.** Stock schedule
cards carry `runs: bbx wakeup --connector <name>` as a literal shell string
that the scheduler executes through a shell, so the rename would have stopped
every box's connector sync. `schedule-engine-verbs-2026-09` rewrites them.
That migrator grew from a regex into a small tokenizer once lint rejected a
runtime-built `RegExp`, which earned it its own doctest.

**The three splits were done by partitioning, not by restructuring modules.**
`scheduler` and `secrets` attach subcommands with `parent.command(...)`, so the
plan's "export the subcommands individually" would have meant rewriting three
modules. `surface-build.ts` reads them off the assembled parent instead. Cross-
model review confirmed parent pointers and help output are correct on both
sides.

**The cutover was deliberately unengineered** after the boxholder saw the real
failure mode (2026-09-14: "Don't make this complicated! There's half a dozen
boxes and if it's broken I'll just wait"). No alias window, no restore path.

**The smoke half of Track D was not built.** The totality and partition checks
were, and they are what stops the drift. The per-verb subprocess run remains
specified in the table (`Smoke`, with a stated skip reason on every verb that
has no safe invocation) but unimplemented — see *Open design questions*.

**Cross-model review of the diff found four call sites no string grep reaches**,
the sharpest being the launchd plist, which builds its argv as an array of
`<string>` elements.

## Implementation order

1. **A-1 — `buildProgram()` extracted** from `index.ts` with no behaviour
   change, verified by the existing CLI doctests. Nothing else moves.

2. **A-2 + C — the table and the rename, one commit.** `surface-data.ts`,
   `surface-build.ts`, `bbx engine` created, top-level engine registrations
   removed, stub verbs and deprecated `scheduler` aliases deleted, and every
   call site in Track C updated — including both `exec-start.conf` drop-ins and
   the per-unit installer change. This is the commit that auto-deploys, and the
   verb and its callers must move together.

3. **B — the three splits**, plus the generated-doc fixes they force.

4. **D — the doctest**: totality check first, then the smoke run.

5. **E — the docs half**: the consistency check, then the CLAUDE.md and README
   paragraphs, then `bbx --help`'s audience line.

6. **Knowledge audits authored and run.**

Steps 3-6 do not touch deploy and can land in any order after step 2.

## Rollout shape

**Tests, named while designing:**

- `test/cli/agent-surface.doctest.md` — the totality check (every registered
  top-level command is in the table; every table entry is registered; every
  `smoke: null` carries a reason) and the credential-gap smoke run under
  `BBX_SPAWN_PROFILE=agent` with an empty `HOME`. Models
  `test/cli/commands/drive-delegation.doctest.md`.
- `test/core/docs-gen/bbx-commands-audience.doctest.md` — every verb named in
  the generated reference is `audience: "agent"`.
- Existing CLI doctests are re-run for the three split families; any that invoke
  a moved verb are updated in the commit that moves it.

**Done-when:** both new doctests pass; `pnpm typecheck` and `pnpm lint` clean;
the change-selected doctests pass; both knowledge audits have been run with
their status recorded; and on prod, `systemctl show -p ExecStart beebox-hub`
reports the single new command.

**Deploy verification.** After the step-2 deploy lands:
`systemctl show -p ExecStart beebox-hub beebox-scheduler` reports exactly one
command each, naming `bbx engine hub` and `bbx engine scheduler start`, and
`systemctl is-active` reports both running. One command each is the part to
actually look at — two means the drop-in's reset line is missing.

**No data migration.** Nothing on disk changes shape. The only migration is the
two unit overrides, and it is atomic per unit (systemd reads the merged unit at
`daemon-reload`).

**The one thing the rollout cannot reach:** a launchd plist written by a past
`bbx scheduler install` on a laptop still names `["bbx", "scheduler", "start"]`.
After step 3 that agent stops working silently. The fix is one
`bbx engine scheduler install` on that machine, and it belongs in the finish
report as an action for the boxholder, not in a script.
