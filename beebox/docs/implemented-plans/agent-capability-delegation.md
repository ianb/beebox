---
title: "Agent self-configuration of credentialed connectors (Drive first)"
status: implemented
workstream: agent-capability-delegation
issues:
  - ../../../issues/features/2026-07-20-agent-containment-allowed-directories.md
  - ../../../issues/closed/features/2026-07-20-schedules-off-by-default.md
---
# Agent self-configuration of credentialed connectors (Drive first)

A design view, written before building, for one question: how does a box agent
set up something like a Drive mount, confirm it works, and keep it working,
when the agent's own process is deliberately not allowed to hold the Google
credential?

When the boxholder says "mirror this Drive folder into the box," the agent
should be able to write the mount, check that the folder id resolves, pull it
once, and tell them exactly what happened. When something is missing, it should
say which thing, and who can fix it, in one sentence the boxholder can act on.

## The incident, restated as a structure

On 2026-09-14 the production box's agent wrote a correct
`<name>.gfolder.card`, then could not verify or activate it. It ran the same
`bbx drive` verbs the boxholder would, and every one exited with "Google auth
not configured. Run: bbx google-auth." The boxholder reauthorized twice against
a healthy grant. The message is fixed (`connectors/google-auth-gap.ts`); this
document is about why the agent was in that position at all.

Verified against the code:

- Two spawn profiles (`core/script-env.ts`). Agent-safe (`buildScriptEnv`)
  drops `BBX_GOOGLE_TOKENS_FILE` and `BBX_SECRETS_FILE`. Tooling
  (`buildToolingScriptEnv`) keeps them. `pickBoxSubprocessEnv` filters an
  inherited env and never fetches, so nothing an agent spawns can recover them.
- The client credentials are not the gap. `getBoxGoogleClientCreds` resolves
  them through the secret store, which finds its file through `HOME`
  (`core/secrets/store.ts:90`). The gap is the OAuth token record: in the agent
  process `centralTokenPath()` is null, and the legacy per-box file no longer
  exists on migrated boxes.
- The server already has the credentialed verbs. `webapp/trpc/routers/drive.ts`
  exposes `mounts`, `mount`, `link`, `unmount`, `syncFolder` as box-auth'd
  procedures, running in the server process, which holds the tokens. The
  settings page uses them. The agent bearer passes box auth
  (`webapp/server-box-scope.ts:96`), so the agent can already call them. It has
  no CLI that does.
- `bbx drive add|inspect|list|sync` (`cli/commands/drive.ts`) and `bbx drive
  mount|link|unmount` (`cli/commands/drive-mount-cli.ts`) build a Drive
  service in-process via `requireDriveService`. In an agent shell that is the
  dead end. Nothing routes them to the server, even though the mount verbs
  call the same operations the server's procedures do.
- The dev-router 401 bug
  (`issues/bugs/2026-08-23-agent-bearer-401-through-dev-router.md`) is not on
  the real agent path. A box child registers its own loopback port as the
  ambient URL (`webapp/server.ts:372`), and that is what `BBX_SERVER_URL`
  carries into agents. The screenshot timeouts the same agent hit are
  unexplained by that bug.
- `scheduler.trigger` runs the script with `stdio: "ignore"`
  (`webapp/trpc/routers/scheduler-run.ts:98`) and returns a duration. It is not
  a result an agent can reason about, and a script card that runs a
  credentialed command is the "agent-reachable tooling profile" hole the
  custody plan already names (`core/script-env.ts:180-190`).
- There is no seeded Drive schedule. `DEFAULT_SCHEDULES` has `check-email`
  (requires `gmail`) and `check-calendar` (requires `google`), both
  `enabled: false`; nothing for `drive`. `installSchedules` runs from `bbx
  init` and from docs regeneration, so a new seed reaches existing boxes.
- The wakeup connector is named `google-drive` (`connectors/google-drive.ts:53`)
  and `bbx wakeup --connector` matches the name exactly
  (`cli/commands/wakeup-connectors.ts:72`). A seed that says `--connector
  drive` would report "Connector not found" every hour.

## Two principles from the boxholder (2026-09-14)

1. **Anything `bbx` does, the agent should be able to do.** Some acts are
   not for the agent, and those should not be `bbx` verbs at all. The
   boxholder's own assessment: "this has been weakly handled." Refined later
   the same day: engine and operator verbs may stay in `bbx` for now so long
   as every one is listed in the surface audit issue
   (`issues/code-quality/2026-08-08-audit-bbx-subcommand-surface.md`). What is
   not acceptable is a verb that is **both** server-only and designed for the
   agent. A verb that works for the agent only with some options is that
   case, and it also gets in the way of the later separation.
2. **`bbx` should be able to do the work, confirm it is done, and force it to
   happen instead of waiting for a sync. Forcing and letting it happen must be
   equivalent.** If a person or agent forces a sync, the result must be the
   same as the scheduled one.

Audit of the first principle against the CLI as it stands:

| Verb | Under the agent profile today | Verdict |
|---|---|---|
| `bbx drive add\|inspect\|list\|mount\|link\|unmount\|sync` | exits with the auth-gap message | violates 1; delegate |
| `bbx calendar calendars\|add\|remove` | exits with the auth-gap message | violates 1; delegate |
| `bbx calendar [timespan]` (advertised to agents in `agent-guide/commands.ts:28`), `bbx connector gmail pending` | read local state only; work | fine |
| `bbx connector gmail track\|gws` | exits "not configured" | violates 1; delegate |
| `bbx wakeup [--connector <name>]` | runs, but each Google connector's `getService` returns null; Gmail and Calendar sync nothing and report success, Drive reports a failure | server-only by design, yet the agent guide describes it to agents; the "both" case; see below |
| `bbx google-auth` | a browser OAuth flow | correctly not for agents; keep, it is the boxholder's verb and the agent relays it |
| `bbx secrets set\|grant\|revoke\|migrate`, `bbx auth …` | refuse without `--agent-confirmed` | correctly not for agents; the flag is a person's signature, so these stay `bbx` verbs a person runs |
| `bbx secrets status\|declare\|describe --add-use` | work, scoped to the agent's own box | fine |
| `bbx secrets describe --remove-use\|--clear-uses` | refuse without `--agent-confirmed` | fine; removal is the boxholder's |

So the class of verbs that fails the first principle is exactly "needs a
connector credential in-process." That is one mechanism to fix, not a
per-verb list.

Audit of the second principle. The scheduled Drive sync is
`connector.sync()` under the mirror lock (`connectors/google-drive.ts:79`),
covering every file and folder mount, the push-back, and job creation, with
`triggeredBy` set by the caller. The forced paths:

- `bbx drive sync` calls the same `connector.sync()` in-process. Equivalent
  in code, but only under the tooling profile; under the agent profile it is
  the auth-gap exit.
- The settings page's `drive.syncFolder` runs one folder mount through
  `mirrorFolderOnce`, the same per-folder function the connector uses. A
  subset by design, not a divergence.
- `bbx wakeup --connector google-drive` from an agent shell is the fidelity
  failure: it runs, the connector finds no service, and the cycle continues
  as if the box had nothing new. Forcing produced a different answer from
  letting it happen, and the difference was invisible to the caller.

The requirement this sets for the design: there is one sync function per
connector, the scheduled path and every forced path call it, and a forced
call returns that function's `SyncResult` to the caller. A forced path that
runs different code, or discards the result, is a defect.

## The frame: custody, not authority

The sudo analogy assumes the agent lacks *authority* and needs a way to
borrow more. That is not the situation. The server-box-scope comment states
the trust model: the agent bearer is "box-scoped auth, same trust as the box
user they run as." The agent is already allowed to mount a Drive folder. What
it must not do is *hold the credential* while doing it. The wall is a custody
wall (secret-custody plan, Track 1), and it is doing exactly its job: the
agent could not widen its own grant even when it considered it.

So the design question is not "how does the agent get permission" but "how
does the agent get the credentialed *work done* without the credential." The
answer already exists in three places: `bbx chat self-note` (agent asks the
server to write a note), `/api/secrets/resolve` (agent asks the server for a
value it is granted), and `bbx chat screenshot` (agent asks the server to drive
a browser). Each is the same shape. The agent calls its own box's server with
the bearer it already has; the server does the credentialed part; the agent
reads back a typed result. Drive is missing from this pattern, not from a
permission model.

A capability or sudo layer would add a second concept on top of box auth: a
token per operation, a registry of what each token unlocks, and a grant
lifecycle. Every one of those would be a tier on top of a primitive the code
already has. It buys *narrowing* (an agent that may mount but not unmount), and
nothing in the incident or the boxholder's framing asks for that. When it is
asked for, it is the policy-proxy issue's Tier 2
(`issues/features/2026-07-28-google-auth-policy-proxy.md`), which puts the
policy on the far side of a real trust boundary, where the agent cannot edit
it. Inside the box, "policy" the agent can rewrite (`_config/box.json`'s
`googleServices`) is a preference, not a control, and this plan does not
pretend otherwise.

The headless constraint from the containment issue is satisfied for free: no
step below asks a human anything at the moment of the call. A refusal is
terminal, typed, and relayed; the boxholder acts on a page or a command in
their own time; the agent retries later.

## What the agent does alone, delegates to the server, or leaves to a person

**On its own (no credential involved):**

- Author configuration: cards, landmarks, explainer docs, a `.gfolder.card`
  by hand if it wants to. This already works and stays.
- Read status that needs no credential: `bbx secrets status`, whether Drive is
  enabled in box policy, the list of mount cards on disk.

**Delegated to the server (credential stays server-side):**

- Force a wakeup, full or scoped to one connector: a new agent-facing verb,
  `bbx force-wakeup [--connector <name>]`, that asks the server to run the
  same supervised `bbx wakeup` child the Sync button and the scan-promote
  worker already run (`core/commands/wakeup.ts:runBbxWakeup`). It never runs
  in-process, under any profile: with no reachable server it refuses and
  says so. Because the server runs the identical child the schedule runs,
  forcing and letting it happen are the same code by construction. The
  scoped form is the one agents will mostly use; it is sync plus a reactor
  pass over the jobs that sync produced, which is what "let it happen" does,
  so a bare connector sync would not satisfy the fidelity rule.

  The seam is not ready as it stands, and the plan owns the gaps rather than
  claiming them away (cross-model review, round 3):

  - `runBbxWakeup` always spawns an unscoped `bbx wakeup`
    (`core/commands/wakeup.ts:55`); it gains a `connector` option.
  - The child's outcome line carries aggregate counts only
    (`cli/commands/wakeup-outcome.ts:29`), and `runConnectors` prints each
    `SyncResult` and discards it (`cli/commands/wakeup-connectors.ts:99`).
    The outcome report gains a per-connector entry: name, created, updated,
    pushed, jobs, and either `error` or `skipped` with a reason. That is
    the typed channel the agent reads; no output parsing.
  - A connector whose service is unavailable currently reports success with
    nothing synced (Gmail and Calendar) or a failure (Drive), and one whose
    service is switched off in policy reports success with nothing synced
    (`connectors/google-drive.ts:89`). Both become `skipped` with a reason
    (`not-configured`, `not-allowed`) in the `SyncResult`, so a forced run
    can never say "done" about work it did not do. This is the same
    invisible-nothing-happened failure the incident exposed, one layer down.
  - Nothing serializes whole wakeup cycles. Only the reactor step has a lock
    (`core/reactor/engine.ts:115`); the comment in `lib/file-lock.ts:5`
    naming a wakeup mutex in `cli/lib/lock.ts` refers to a file that does
    not exist. Today the Sync button and `bbx tick` can already interleave
    preprocessing, connectors, and push. `bbx wakeup` takes a per-box cycle
    lock through `lib/file-lock.ts`; a second cycle reports
    `skipped: wakeup-running` in its outcome rather than interleaving, and
    the stale comment is corrected. This goes in the cycle itself, not the
    server procedure, so tick and forced runs share it.
- `bbx wakeup` itself stays exactly what it is: the tooling-profile cycle
  that tick, the reactor, and the server spawn. It is listed in the surface
  audit issue as engine surface, and the agent guide stops describing it as
  something the agent runs. Making it half-work under the agent profile is
  the "both server-only and agent-designed" case the boxholder ruled out.
- A full forced wakeup runs the box's on-wakeup scheduled scripts under the
  tooling profile (`cli/commands/wakeup.ts:206`, `cli/commands/tick-utils.ts:140`),
  and scheduled-script cards default to enabled. So an agent that authors a
  script card can force it to run now rather than waiting for the next
  cycle. This plan does not open that path; it removes the delay on a path
  the custody plan already names as Track 3's. The delay was never the
  protection (the custody plan claims "hygiene, not a wall"), and skipping
  on-wakeup scripts in a forced run would break the fidelity rule. The plan
  keeps fidelity and names the residual; the boxholder can overrule (see
  open decisions).
- Resolve a Drive URL or id to a name and type. This is the verification step
  the incident lacked. It needs a new `drive.inspect` procedure; the settings
  page would benefit from it too (it currently learns the name only after a
  mount succeeds).
- Mount a folder or link an item: validate against Drive, write the card,
  sync once, commit. Exists as `drive.mount` and `drive.link`.
- Sync one mount now. Exists as `drive.syncFolder`; a subset of the
  connector sync, sharing its per-folder function.
- List mounts with their connection state. Exists as `drive.mounts`.

**Left to a person (the agent relays the ask and stops):**

- Authorizing Google (`bbx google-auth` is a browser flow).
- Granting or rotating any secret (`bbx secrets` mutations refuse agent
  sessions without `--agent-confirmed`; that stays).
- Turning a service on in box policy. The agent *can* write `box.json`, but it
  should not flip `googleServices.drive` on the boxholder's behalf. This is a
  guidance rule, not an enforcement point, for the reason above.
- Enabling a seeded schedule, unless the boxholder asked for it in chat (the
  2026-07-20 decision).

## How the agent asks

One rule, stated so that a missing marker fails closed: a credentialed `bbx`
verb (the `drive`, `calendar`, and `connector` families) runs in-process only
when `BBX_SPAWN_PROFILE=tooling`. Any other value, or no value, delegates to
the box's server with `BBX_SERVER_URL` and `BBX_AGENT_TOKEN`; if either of
those is also missing it refuses, naming the missing piece. A spawn site
that forgets the marker therefore gets delegation or a refusal, never local
credential use and never the old auth-gap dead end. Drive is the first family
wired, because it is the one the incident hit; the others follow the same
helper. The one new verb is `bbx force-wakeup`, which is agent-designed and
server-backed in every profile, and replaces the agent-facing use of `bbx
drive sync` (which stays as the tooling-profile in-process form). The
profile is stated, not inferred: `buildEnv` sets `BBX_SPAWN_PROFILE` to
`agent` or `tooling` alongside the token, and the CLI branches only on
`tooling`. The
first draft of this rule was "in-process when a token record loads, else
server," and the cross-model review rejected it: a predicate keyed on
credential visibility silently turns any process that can see the token into
one that uses it. Delegation should be chosen by who is calling, not by what
it happens to be able to read. The CLI surface the agent reads about in its
guide does not change; the dead end goes away.

This is the `bbx chat` pattern lifted into `drive`. The client half is a small
tRPC caller in the CLI; the CLI already has `fetch`-based helpers for the chat
routes and none for tRPC, so the first real piece of work is a shared
"call my box's procedure with the agent bearer" helper, which `chat` can then
move onto as well.

Why not always go through the server? A scheduled `bbx wakeup --connector
google-drive` under the tooling profile would loop back into the process that
spawned it for no reason, and the wakeup sync path (`connectors/google-drive.ts`)
is not one procedure call but a full connector run. Both profiles stay on the
same operations in `connectors/drive-mounts.ts` and `drive-mount-sync.ts`.
What this plan does not change: a scheduled-script card is agent-authorable
and runs under the tooling profile, so an agent can still reach the credential
by writing a script and waiting. That is the hole the custody plan assigns to
Track 3, and it is neither opened nor closed here.

Why not `scheduler.trigger`? It discards output, returns a duration, and the
only way to make it run a specific command is to author a script card, which
is the reachable-tooling-profile hole in reverse. It is the wrong seam, and
joining it up would make the hole an intended path.

## What the agent gets back

The incident's cost was an agent that could not learn *why*. Every delegated
call returns one of two typed shapes, the same ones the settings page gets:

- A result the agent can report: for `mount`, the card path, the Drive name,
  the files written, and the first-sync counts. For `inspect`, name, MIME
  type, and whether a mount card already claims that id.
- A refusal with a `kind` and a message written for relay. The three that
  exist today already carry the right text: `FORBIDDEN` ("Drive is not
  enabled for this box. Enable it in box settings."), `PRECONDITION_FAILED`
  (the `explainGoogleAuthGap` sentence, which now names the failed
  precondition and says whether reauthorizing helps), and `BAD_REQUEST` (a
  `DriveMountError`: bad URL, occupied directory, path outside the box).

The CLI prints these as text for a person and as JSON under `--json` for the
agent, following the existing `bbx` convention. A refusal names which of
three parties can fix it: the agent (fix the input), the boxholder (enable,
authorize, grant), or the machine (a store the server cannot read). That
three-way attribution is the one thing the incident's message lacked, and it
is the property to test in a doctest, not the wording.

## How the boxholder sees and controls it

- **Seeing.** The settings page Drive section already lists every mount and
  whether Drive is connected. A mount made by the agent is a card in the box,
  visible there and in the tree, with the same stamps as one made by hand.
  Attribution is not free today: the tRPC context has no record of how a
  request authenticated (`webapp/trpc/context.ts:16`), `server-box-scope.ts`
  computes the bearer check and drops it, and mount commits carry no trailer
  (`connectors/drive-mounts.ts:161`). The plan adds an `actor` field to the
  context ("agent" when the bearer authenticated the request, else the user)
  and stamps it into the mount commit message, so the git log answers "who
  mounted this." No new page.
- **Controlling.** The levers are the ones that exist: the `googleServices`
  toggles and Google authorization on the admin page, the secret grants on the
  secrets page, and the schedule's enabled flag. The design adds no new
  control because the agent gains no new authority; it only stops failing.
- **Refusing.** There is no prompt to approve. If the boxholder wants Drive
  off, they turn it off, and every delegated call refuses with the
  `FORBIDDEN` message. If they want it on but the agent should not mount
  things, that is a guidance line in the box's own instructions today and a
  policy-proxy rule tomorrow.

## The seeded `check-drive` schedule

Land this as its own small change. It is a `DEFAULT_SCHEDULES` entry shaped
like `check-calendar`: hourly, `onWakeup`, `runs: bbx wakeup --connector
google-drive` (the connector's registered name; `drive` would not match),
`requires: ["drive"]`, `enabled: false`. `connectors/requirements.ts`
evaluates `drive` as a boolean (token file present, client creds granted,
service allowed), so on a box with no Drive the scheduler skips it with
"missing connectors: drive" rather than running a failing job. That is a
clean skip gate, not a diagnosis: it says nothing about which of the three is
missing, and a token file that exists but cannot refresh counts as present.
Diagnosis is the delegated verbs' job, not the schedule's.

"Mostly automatic" and "disabled until activated" reconcile as: seeded and
inert, with an easy yes at the moment it becomes relevant. Concretely, when a
mount is created and `check-drive` is disabled, the mount result (and the
settings page) says so, and the agent's guidance tells it to ask "want me to
turn on hourly Drive sync?" rather than to enable it. That is activation by
asking the agent in chat, which the 2026-07-20 decision allows. A box with a
mount and no schedule still works on demand through `syncFolder`.

Two caveats. First, `installSchedules` merges templates through
`installTemplateFile`, so the new card reaches existing boxes on the next
docs regeneration; a brand-new file should install cleanly, but the
template-version tracker has parked changed templates on production before
and the rollout should be checked there, not assumed. Second, the `requires`
name is `drive`, not `google`; the calendar seed's `google` alias is legacy
and should not be copied.

## Smallest fix and budget

Smallest fix for the incident as reported: agent-profile `bbx drive` verbs
delegate to the existing server procedures. The server side already has
`mount`, `link`, `unmount`, `syncFolder`, and `mounts`; the work is the CLI
client and the profile marker. Roughly 150 lines of source, 100 of tests.
The `check-drive` seed is a second, independent small change (about ten
lines plus a doctest line); it keeps a mount in sync but does nothing for the
agent's ability to verify one.

This plan's budget beyond those two, in order:

1. `bbx force-wakeup [--connector <name>]` and its `wakeup.force` procedure,
   with the four seam changes above: `connector` on `runBbxWakeup`,
   per-connector entries in the outcome report, `skipped` reasons in
   `SyncResult` for the three Google connectors, and the per-box cycle lock.
   Plus the agent guide change: `bbx wakeup` moves to the "system-run, you do
   not invoke" list and `force-wakeup` joins the commands-to-reach-for list.
   Roughly 250 lines of source, 150 of tests. The cycle lock and the
   `skipped` reasons fix defects that exist today without this plan.
2. A `drive.inspect` procedure, so `bbx drive inspect` and `add` (the file
   verbs, which also need the service) have a server counterpart. Roughly 80
   lines of source, 60 of tests.
3. The `calendar` and `connector` families onto the same helper. Their
   server-side procedures mostly do not exist yet; this is where the "one
   mechanism" claim gets tested. Roughly 150 lines of source, 100 of tests.
4. `--json` output on those verbs and the three-party attribution on
   refusals, with a doctest that runs each verb from an agent-profile shell
   against a box with no token file and asserts the refusal names the
   boxholder. Roughly 100 lines.
5. The settings page and mount result mentioning `check-drive` state, and the
   agent guide's Drive row saying "these verbs work in your shell; the server
   holds the credential." Roughly 60 lines.
6. The `actor` context field and commit trailer for attribution. Roughly 30
   lines. Drop this item rather than ship the attribution claim without it.

Not in budget, and deliberately: any capability token, per-operation grant, or
approval prompt.

## Could this be simpler?

The simplest version is the seed alone. It fixes "the mount cannot stay in
sync" and nothing else; the agent still cannot verify what it wrote.

The next simplest is to hand the agent profile `BBX_GOOGLE_TOKENS_FILE`. It
would have made the incident's every command succeed. It also reverts Track 1
for the one credential with the widest reach (the whole Google grant), and
puts a refresh token in every chat subprocess's environment. Rejected.

The version here adds one helper and a profile marker. It is the same shape
three other agent-facing paths already use.

## Decisions (boxholder, 2026-09-14)

- A forced wakeup runs everything, on-wakeup scripts included, unless doing
  so turns out to need a big new structure. It does not: the forced run is
  the same child.
- The agent may turn `googleServices.drive` on. The agent guide says how, and
  the Drive refusal for a switched-off service says how.
- `check-drive` lands now.

## Open decisions for the boxholder (settled above; kept for the record)


- Whether a full `bbx force-wakeup` from an agent should run on-wakeup
  scheduled scripts (fidelity, the plan's choice) or skip them (custody). If
  skipped, the outcome report must say so, and "force equals let happen"
  acquires its first exception.
- Whether the agent may flip `googleServices.drive` on when the boxholder
  asked in chat, by analogy with schedules, or whether that is always a
  settings-page act. The plan assumes settings-page only.
- Whether to land `check-drive` now, ahead of the rest. The plan says yes.
- The name `force-wakeup` is the boxholder's suggestion and the plan uses
  it. If a full forced wakeup from inside a reactor-spawned agent should be
  refused rather than reported as skipped-locked, say so; the plan reports.
