---
title: "The scan uploader learns when it has drifted from the box"
status: implemented
workstream: scan-ingest
issues: []
---
# The scan uploader learns when it has drifted from the box

A copied `scan-uploader.mjs` bundle never updates itself, and the box it uploads
to does. Today neither side carries any version identity, so a bundle built
before a contract change keeps sweeping against a box that has moved, and
nothing anywhere reports it. This plan gives the wire contract one monotonic
version integer, has the uploader compare its own against the box's every sweep,
and surfaces a mismatch to the person at the laptop.

**Issues addressed:** none filed. Raised by the boxholder on 2026-09-14: *"the
scanner is kind of stand-alone and the box might get updated. There should at
least be a way to know the version drift has happened, between the uploader and
the expected version."* Grepped the queue for `version`, `drift`, `uploader`,
and `scan` — nothing filed. It is also absent from the original design's own
deferrals: `docs/implemented-plans/scanner-ingest.md:636-664` (NOT in scope) and
its risk register at `:601-633` never mention client staleness, so this is an
unconsidered gap rather than a deliberate deferral.

## Smallest fix and budget

**Smallest fix (~15 lines source, ~10 test).** Put a build stamp in the bundle
(`scan-uploader/build.ts` esbuild `define`) and add a `--version` flag. The
boxholder can then ask a bundle what it is. That is not drift detection — it
tells you what you have, never that it is wrong, and it requires suspecting a
problem first.

**This plan's budget** *(as first written, before the boxholder added the
build-stamp requirement — superseded by the re-set below).* One track, two
subprojects (`beebox/`, `scan-uploader/`).

| | source | tests |
|---|---|---|
| Contract version + compare + report | ~70 | ~90 |
| **Total** | **~70** | **~90** |

Docs reported separately: `docs/scan-upload-contract.md` (the version's
definition and its bump rule) and `scan-uploader/README.md`.

This is ~5× the smallest fix and it **adds a field to a wire contract** — a
protocol addition, which the circuit breaker says goes to the boxholder as a
choice before the rest is written.

### Budget re-set 2026-09-14, and the breaker report that forced it

**What was asked.** The boxholder approved the contract version and then added a
second requirement the budget above does not cover: *"I'd also like some
indication just of the date/revision of the uploader too. It might work, but not
well. If the box is simply aware of it, then it can notify someone that there's
an old version. (Eg it might obey the protocol, but be missing features)."*

That reverses this plan's own first *NOT in scope* entry — a build stamp
recorded per token — and adds a box-side surface, which is a subsystem this
plan did not name. Both are breaker conditions, so this section exists rather
than the budget being quietly raised.

**What is built.** Two tracks, two subprojects.

| | source | tests |
|---|---|---|
| Track 1 — contract version, client side (`e8f1fbdd3`) | ~180 | ~475 |
| Track 2 — build stamp + box-side freshness check | ~130 | ~65 |
| **Total** | **~310** | **~540** |

**Size against budget: ~5× on source, ~6× on tests.** Past the 1.5× gate, so
the number above is re-set to what was built rather than treated as met.

**What drove the growth**, honestly separated:

1. *The second requirement* (~60% of Track 2, and all of the box side). The
   build stamp, its build-time git plumbing, the token-record fields, and the
   `scan-uploaders` health check exist because the boxholder asked for them
   after the budget was written. Not creep — but not budgeted either.
2. *Doctest prose.* The test line counts are mostly commented Markdown, not
   assertions: 6 doctest files, ~80 assertions. The repo's doctests are
   documentation that runs, so this is the house style rather than
   over-testing, but it makes the test column a poor proxy for effort and it is
   why the two columns are reported separately.
3. *`max-params` and `exactOptionalPropertyTypes`.* Threading the identity
   through `TokenStore.verify` needed a params-object refactor and an explicit
   `| undefined`. Real work the plan did not anticipate, but small.

**What was NOT built, deliberately**, and remains deferred: the latched
`notifyBoxholder` push (the research found that channel reaches nobody unless
the boxholder has wired Telegram or a web-push device, and there is no
notification history — so the health check has to stand alone regardless, and
the push is a second surface for the same fact); a question card (a question
borrows the boxholder's authority for a real choice among outcomes, and a stale
uploader has one remedy and no decision); and surfacing `lastClient` in the
Settings → Scan uploaders row (cheap, but the health check already answers the
question the boxholder asked).

## Stated preferences this plan trades against

**Principle 4 — resilient AND never silent** (`docs/engineering-principles.md:49`):
*"Degradation is allowed for failures that can genuinely happen; invisible
degradation is not."* This is the whole case for the plan, and it is also the
test the design has to pass rather than merely invoke. A stale bundle that still
*parses* the current contract is the failure that matters: the client throws
`ProtocolError` on an unknown `state` or an unexpected status
(`scan-uploader/src/wire-client.ts:118-121,141-145`), so a contract change that
breaks parsing already fails loudly and accurately. What does not announce
itself is a bundle whose parsing is fine but whose *client obligations* are old
— the settle gate and the restat-before-disposition rules that decide whether a
file is deleted. Those obligations live only in the client
(`docs/scan-upload-contract.md` "Client obligations"), and a bundle that
predates a tightening of them applies the old rule to a real scan.

**Principle 8 — one way to do each thing** (`:95`). The repo has **no**
contract-version precedent: greps for `CONTRACT_VERSION`, `apiVersion`,
`minClientVersion`, `protocolVersion`, and `X-*-Version` return nothing outside
`node_modules`. The established habit is the one the scan contract states — a
single coordination document, a breadcrumb comment at each encoding site, and a
change-discipline clause requiring doc plus both implementations plus doctests
in one change (`docs/scan-upload-contract.md:186-189`). This plan's version
integer is deliberately shaped to *ride that ritual* — one more line in a change
that already touches both sides — rather than to introduce a parallel
versioning system. That is the trade: one new concept, placed inside an existing
discipline instead of beside it.

**Principle 13 — a control shows the state the system is in, never the one it
intends** (`:151`). Relevant to where the report goes: a version the box merely
*records* shows what the last sweep claimed, which is fine; a version the box
*acts on* would be a gate this plan does not build.

**The strongest countervailing preference is `beebox/CLAUDE.md`'s "Work only on
the requested problem."** Both halves were asked for: the contract version on
2026-09-14, and the build stamp plus box-side awareness in the same
conversation (quoted in the budget re-set). What stays out is everything the
boxholder did not ask for — the push notification, the question card, the
Settings-row display.

## What already exists

**Reuse — the additive seam, verified on both sides.** The check response is
literally `return { states };` (`src/webapp/routes/scan-upload.ts:126`), and the
client requires only `isRecord(body) && isRecord(body.states)`
(`scan-uploader/src/wire-client.ts:54`) before iterating `body.states`. A
sibling top-level key is ignored by every existing bundle. In the other
direction `CheckBodySchema` is a plain `z.object` with no `.strict()`
(`src/webapp/routes/scan-upload-validation.ts:31-33`), so zod strips unknown
request keys, and headers are read individually by name
(`scan-upload-validation.ts:37-40`). **So both halves can be added with no flag
day**: a new box tolerates old bundles and an old bundle tolerates a new box.
This is the fact the whole design rests on, and it is why the plan needs no
transition state.

**Reuse — the optional-header precedent, including its warning.**
`X-Scan-Profile` is exactly this shape: an optional one-way client header, read
and capped by the server (`src/webapp/routes/scan-upload.ts:198`,
`scan-upload-validation.ts:25`) and documented in the contract table
(`docs/scan-upload-contract.md:84`). Grepping `scan-uploader/src` for it returns
nothing — **the client has never sent it**. That is a shipped precedent for the
mechanism and, at the same time, the sharpest evidence for what an optional
field nobody's workflow depends on looks like later. This plan's answer is that
the version is *compared and reported*, not merely recorded, which is the
difference between the two.

**Reuse — the notification channel, shipped 2026-09-14** (`19a5c4187`,
`scan-uploader/src/notify.ts`). A drift warning has somewhere to go that a
person actually sees. Without it this plan could only write to
`~/Library/Logs/scan-uploader.log`, which the notifier's own header calls out as
the thing nobody reads — and a drift report in an unread log is the failure mode
this plan exists to fix.

**Reuse — the hub's header rule, as a constraint.** `stripHubHeaders`
(`src/hub/hub-server.ts:225-235`) deletes every client header starting with
`x-bbx-`: *"The spoof wall: no client-supplied `x-bbx-*` header ever reaches a
box."* So the request header must not use that prefix. `x-scan-contract` mirrors
`x-scan-profile` and survives the proxy.

**Rebuild — nothing to reuse for identity.** `scan-uploader/package.json:3` is
`"version": "0.1.0"`, has never been bumped, and nothing imports it.
`scan-uploader/build.ts:8-18` passes esbuild no `define` and no banner beyond
the shebang, so **the bundle embeds no identity at all** — a copied bundle
cannot even in principle report what it is. On the server side a real build
stamp does exist (`deploy-info.json`, written at `deploy/deploy.sh:656`, read by
`readVersionInfo()` at `src/webapp/trpc/routers/health.ts:69-101`) but it is a
git SHA with no ordering a client can reason about, and it is exposed only
through the authenticated tRPC `health.check` — not on the scan routes. It is
the wrong value for this job, which is why the plan introduces a contract
integer rather than plumbing a SHA.

**Searched: no other stand-alone client has a drift mechanism to copy.**
`beebox-clerk/` derives a build-date manifest version
(`beebox-clerk/wxt.config.ts:9-25`) and sends nothing to the server.
`ios-app/` sends `User-Agent: BeeBox-iOS/0.1`, and
`docs/mobile-contract.md:1088-1105` states the server never branches on it —
informational only, with per-feature capability detection instead of version
comparison. That is a finding in both directions: nothing to reuse, and nothing
this plan contradicts.

**Searched: there is no update path to point a warning at.**
`scan-uploader/src/schedule.ts:155-158` (`detectRunMode`) splits source mode (a
checkout, which `git pull` updates and which therefore **cannot drift**) from
bundle mode (`node /path/to/scan-uploader.mjs`). `scan-uploader/README.md:73-75`
is the entire distribution story: build once, copy the file. Nothing fetches and
nothing self-updates. This bounds what the warning can usefully say — "rebuild
and re-copy" — and it is the reason the warning must be actionable prose rather
than a version number alone.

## Prior art (external)

One external premise matters: whether a bare integer is the right shape for a
protocol version compared by two independently-deployed halves, versus semver or
a capability list. The relevant prior art is HTTP's own lesson — capability
negotiation scales, single integers do not — but it applies to protocols with
many independent features and many clients. This contract has two routes, one
client, and a change discipline that already requires both sides to move
together (`docs/scan-upload-contract.md:186-189`). Under that discipline an
integer's only job is to detect that the discipline was *not* followed for a
copy that was never updated, which needs ordering and nothing else. No external
search was run for a library: there is no dependency to add here, and the
package's zero-runtime-dependency constraint
(`scan-uploader/README.md:3-8`) forbids one anyway.

No prior art was sought on "how do other single-client file uploaders detect
staleness" — no design decision here turns on it.

## Tracks / scope

### Track 1 — a contract version, compared every sweep

*Built in `e8f1fbdd3`.* One deviation from the Direction below: the
"last reported verdict" state file was **not** built, so the drift report is a
stdout line every sweep rather than a desktop notification on change. That
settles the first *Open design question* by removing it — see the note there.


**What.** The wire contract gains `SCAN_CONTRACT_VERSION`, a monotonic integer
declared in `docs/scan-upload-contract.md` and spelled once on each side. The
client sends its own on both routes; the box returns its own on the check
response; the client compares and reports a mismatch through stdout and the
desktop notifier.

**Why this needs to change.** Neither side carries any version, so the drift is
not merely unannounced — it is unobservable. And the failure it hides is not
cosmetic: the client obligations that decide whether a scanned file is moved to
the Trash live only in the client.

**Direction.**

Server, `src/webapp/routes/scan-upload.ts`:

```ts
// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
/** Bumped when a change alters what a correct client must DO — the client
 *  obligations, the state vocabulary, or a route's shape. Not bumped for
 *  server-internal changes a client cannot observe. */
export const SCAN_CONTRACT_VERSION = 1;
```

and `handleCheck`'s return at `:126` becomes
`return { states, contractVersion: SCAN_CONTRACT_VERSION };` — a sibling key,
which §*What already exists* establishes every existing bundle ignores.

Client, `scan-uploader/src/wire-client.ts`: its own copy of the constant, sent
as `x-scan-contract` on both requests (never `x-bbx-*`), and `checkHashes`
widens from `Map<string, CheckResult>` to carry the server's integer alongside
the states. It is the only consumer besides `run-target.ts` and
`configure.ts:76-98`, so widening it is cheaper than a parallel call.

The comparison is a pure function, so the whole decision is doctest-reachable
without a server:

```ts
export type DriftVerdict =
  | { kind: "current" }
  | { kind: "client-behind"; client: number; server: number }
  | { kind: "server-behind"; client: number; server: number }
  | { kind: "unknown" };   // pre-version box: no contractVersion in the response

export function compareContractVersion(params: { client: number; server: number | undefined }): DriftVerdict;
```

`unknown` is a real case, not a defensive one: a box running code older than
this plan answers without the field, and that is the state of every box until it
deploys. It reports nothing — an old box is not evidence the client is wrong.

Reporting, in `cli.ts` beside the existing `notifySweep` call: a stdout line
every sweep, and a notification. The notification is subject to the rule the
notifier already enforces in its header — **only newly-observed events** —
because drift is a *sticky* state: it is true on every sweep from the moment the
box deploys until someone re-copies the bundle. Notifying per sweep would nag
every 15 minutes, which `notify.ts`'s header names as the same failure as
notifying on a quiet run. So the drift banner posts when the verdict *changes*,
which needs one line of state on disk beside the config.

**Vocabulary lock-ins.** `SCAN_CONTRACT_VERSION` (both sides, same spelling);
the `x-scan-contract` request header; the `contractVersion` response key;
`DriftVerdict`'s four kinds. All four are committed across two packages and the
contract doc, and the bump rule quoted above is the part that must be right —
a version nobody knows when to bump decays into a constant.

**First implementation chunk.** `compareContractVersion` plus its doctest, in
`scan-uploader/`. Pure, no wire change, no open questions: the four verdicts and
the `unknown` rule are settled above.

### Track 2 — the build stamp, and the box reports a stale uploader

**What.** The uploader sends the revision it was built from and when
(`x-scan-client-build`, `x-scan-client-built-at`); the box records both on the
scan token's record and a health check reports an uploader whose build predates
the box's own deploy.

**Why this needs to change.** The contract version answers "does this client
still speak the protocol". It does not answer "how old is it", and an uploader
can be current on the protocol and still be missing features. Nothing on either
side carried any build identity at all: `scan-uploader/build.ts` passed esbuild
no `define`, so a copied bundle could not report what it was even in principle.

**Direction, as built.**

- `scan-uploader/src/build-stamp.ts` — a discriminated union over the two run
  modes. `bundle` carries a revision and build time, baked in by esbuild
  `define`; `source` is a checkout, which runs current source every sweep and
  therefore cannot drift, so it reports the mode rather than a fictional date.
  The `typeof __UPLOADER_BUILD__` guard is what lets one module serve both:
  esbuild replaces the identifier in the bundle and leaves it undeclared in
  source, and `typeof` is the only way to ask without a `ReferenceError`.
- `scan-uploader/src/build-revision.ts` — the `git describe --always --dirty`
  call, in its own module precisely so it cannot reach the runtime graph (it
  shells out to git, which the target machines do not have). Verified absent
  from the built bundle.
- `TokenStore.verify` gains an `onUse` hook so `resolveScanRequestAuth` can
  stamp the identity on the locked write `lastUsedAt` already performs — no
  second lock. Values are capped, not validated: untrusted client strings whose
  only use is being shown to a person must be harmless, not fatal.
- `src/webapp/trpc/routers/health-scan-uploaders.ts` — the `scan-uploaders`
  check. Compares the uploader's build time against `readVersionInfo()`'s
  `deployedAt`: two timestamps from the same monorepo, which is ordered in a way
  comparing git revisions could not be. `warning`, never `error` — an old
  uploader still uploads and this must not fail a deploy.

**Why a health check and not a notification.** It is the load-bearing surface
because it needs no channel: `bbx health` and the dashboard banner show it
whether or not push or Telegram is configured, and a stale uploader is a
*sticky* condition — true on every request until someone re-copies the bundle —
which a pull surface reports without nagging. Same reasoning as
`template-updates`, which is the shipped precedent for "something is out of
date, tell the boxholder".

**Vocabulary lock-ins.** `x-scan-client-build` / `x-scan-client-built-at`; the
literal `source` for checkout mode; `lastClientBuild`/`lastClientBuiltAt`/
`lastClientContract` on the token record; the `scan-uploaders` check name.

## Could this be simpler?

**The simplest version is a build stamp and a `--version` flag** (the *Smallest
fix*, ~15 lines): `esbuild` `define` injects a git short SHA and a build date,
and the uploader can print it. The boxholder can then check a suspect bundle by
hand.

**It fails the actual request.** *"A way to know the version drift has
happened"* is a detection requirement, and a stamp you have to go and read
detects nothing — it requires already suspecting the problem. It also cannot be
compared: a git SHA has no ordering, so even with the stamp on the wire the box
could say "different" but never "older", which is the only direction that
matters. This is the point where I differ from the research that preceded this
plan, which recommended stamping the bundle and displaying the stamp in
**Settings → Scan uploaders** next to the existing "last request" row
(`src/frontend/src/components/settings/ScanUploaderSection.tsx:45-50`). That is
a genuinely cheap and useful *identifier* — but it is display-only, on a page
visited rarely, and it tells a person which copy they are looking at rather than
that anything is wrong. Per principle 4, a degradation that is visible only to
someone who goes looking is not visible.

**What the integer buys over the stamp:** ordering (so "you are behind" is
sayable), a comparison the client can make unattended every sweep, and a report
that reaches a person through a channel that already exists. What it costs: one
concept the repo has no precedent for, four vocabulary lock-ins, two more sites
under the "change both sides together" discipline, and a bump rule that has to
be maintained by hand.

**What I would drop if the budget has to shrink:** the `server-behind` verdict.
It is real (a laptop with a newer bundle than the box, which happens when a
checkout machine rebuilds before the box deploys) but harmless — the client's
obligations are stricter, not wrong — and it could be collapsed into `current`.
I keep it because distinguishing the two costs one union member and reporting
"the box is behind" prevents the boxholder chasing the wrong side.

## Subplans

None. The one genuinely unsettled question (below) is a single decision, not a
design step, and it sits outside the first chunk.

## Failure modes

> **Critical gap:** the bump rule itself. If `SCAN_CONTRACT_VERSION` is not
> bumped when client obligations change, this plan reports "current" for a
> bundle that is genuinely stale — a false negative that is *worse than no
> mechanism*, because it answers the question wrongly instead of not at all.
> Nothing can test that a human bumped a constant. Handling: the bump rule is
> stated in the constant's own doc comment on both sides, and added to the
> contract's existing "Change discipline" clause
> (`docs/scan-upload-contract.md:186-189`), which already requires doc plus both
> implementations plus doctests in one change — so the bump lands in a ritual
> that is already enforced by review rather than as a new obligation. Accepted
> as a documented risk: it is the irreducible cost of a hand-maintained version,
> and the alternative (deriving the version from a hash of the contract doc)
> would bump on typos and train people to ignore it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| box predates the plan, sends no `contractVersion` | no — chunk 1 adds it | no — plan adds the `unknown` verdict | clear: reports nothing, which is correct |
| bundle predates the plan, sends no header | no — plan adds a server-side doctest | yes — headers are read by name (`scan-upload-validation.ts:37-40`), absent is `undefined` | silent, and correctly so: the box cannot warn a client that cannot hear it |
| hub strips the header | no — plan adds one asserting the name survives | yes — `stripHubHeaders` only matches `x-bbx-` (`src/hub/hub-server.ts:225`) | **silent if the header is ever renamed into that prefix** — the verdict would read `unknown` forever |
| drift verdict sticky, notified every sweep | no — plan adds it | no — plan adds the changed-verdict state file | would be clear but intolerable (nags every 15 min) |
| verdict state file unwritable (read-only home, full disk) | no — plan adds it | no — plan must decide | must degrade to notify-every-sweep or notify-never; see *Open design questions* |
| constant not bumped on a contract change | **impossible to test** | no | **silent false negative** — the critical gap above |
| client sends a malformed/huge header | no — plan adds one | partial — `x-scan-profile` is capped at `MAX_PROFILE_LENGTH` (`scan-upload-validation.ts:25`); the new header needs the same and an integer parse | clear (parse failure → treat as absent) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — n/a: no card vocabulary, no schema field.
- **Stale ref** — n/a: nothing here references a card.
- **Two agents touching the same card** — n/a: no card writes. The verdict state
  file is written only by the uploader process, and the launchd agent's two
  triggers can overlap — see the `_tmp`-style concurrency note below.
- **Hand-edit drift** — ADDRESSED by the `unknown` verdict: a hand-edited or
  hand-built bundle reports whatever constant it carries, and a mismatch is
  reported as drift rather than trusted. A hand-edited verdict state file at
  worst causes one redundant notification.
- **Fabricated free-form value** — ADDRESSED: the wire value is an integer,
  parsed and rejected if not, so there is no free-text field to fabricate. This
  is a deliberate difference from `X-Scan-Profile`, which is free-text prose.
- **Validation error UX** — ADDRESSED: the drift message names the direction
  (which side is behind), both integers, and the action — rebuild and re-copy
  the bundle, plus `schedule install` if the plist predates source mode
  (`scan-uploader/README.md:144-147`). Stating the action matters more than
  usual here because there is no update path (*What already exists*).
- **Partial migration / transition state** — ADDRESSED and it is the design's
  best property: because both halves are additive (verified, §*What already
  exists*), new-box/old-bundle and old-box/new-bundle both behave, so there is
  no window to sequence. A concurrent-sweep race on the verdict file is the one
  residual: two overlapping sweeps could both see a changed verdict and both
  notify. Accepted — the cost is one duplicate notification, and a lock for that
  would be defending against a harmless outcome (principle 6).

## NOT in scope

- **A build stamp recorded per scan token** — the research's recommendation:
  inject a git SHA at build time, send it, and persist it onto the token record
  in the write `TokenStore.verify` already performs under lock
  (`src/core/token-store.ts:205-222`), where it would surface in
  `ScanTokenSummary` (`src/core/scan/tokens.ts:98-104`) and the existing
  Settings row. It answers a different and real question — *which* copy is
  stale, when there are several — and it is cheap. Deferred because with one
  uploader the notification already identifies the machine, and it is a second
  mechanism for a question the boxholder did not ask. Worth filing as an issue
  when a second laptop appears.
- **Any gating or minimum-version refusal.** The box will not refuse an old
  client. It has no honest basis to: a contract change that genuinely breaks the
  client already fails loudly at parse (`wire-client.ts:118-121,141-145`), and
  refusing a client that still works would strand scans on the laptop for a
  cosmetic reason. The repo's own precedent agrees — template drift *parks* and a
  health check reports it, never a hard refusal
  (`src/core/install-template-file.ts:328-414`).
- **Exposing the box's build SHA on the scan routes.** `deploy-info.json` is
  server-local and reaches only authenticated tRPC
  (`src/webapp/trpc/routers/health.ts:69-101`); putting a deploy identity on a
  scan-token-authenticated route widens what that credential can learn. The
  contract integer carries no deployment information.
- **Versioning the other stand-alone clients.** `beebox-clerk/` and `ios-app/`
  have the same staleness problem and neither has a mechanism. Out of scope, but
  if this integer works it is the pattern to copy — and `mobile-contract.md`'s
  capability-detection approach is the competing design, so that comparison
  should happen deliberately rather than by precedent.
- **Bumping the frozen package versions.** `scan-uploader/package.json:3` and
  `beebox/package.json:3` are both `0.1.0` and never bumped. Leaving them is
  deliberate: a second version number that means something different would be
  the drift generator principle 8 warns about.

## Open design questions

**~~Where does the "last reported verdict" live?~~ Settled by not building it
(2026-09-14).** The drift report is a stdout line, so there is no persistent
client state and nothing to nag: the sweep's stdout goes to the launchd log,
which is the right place for a standing condition that repeats every sweep. The
*box* now carries the sticky-condition report instead, in a surface built for
exactly that (Track 2's health check). That is a better home than a state file
beside the client's config, because the box already knows how to report a
standing condition and the client would have had to learn.

Residual risk, accepted: a drift warning on stdout is read by nobody under
launchd. It is not the only signal — the health check covers the same drift from
the box side — but a boxholder who never opens `bbx health` and never reads the
log learns nothing from the *client* half. Escalating it to a desktop
notification is a one-line change if that turns out to matter, and it would then
need the verdict-change state this question originally described.

**Should `configure` refuse on drift, or only warn?** It is the loudest moment —
`configure.ts:76-98` already round-trips a check with an empty `hashes` array,
so the server's integer arrives there for free. My lean is warn, not refuse:
`configure` writes a token file and a config entry before verifying, and has no
rollback (`configure.ts:88-95`), so a refusal there leaves half-written state
for a condition that does not prevent uploading. It fits better as a `warnings`
field on `ConfigureResult` (`configure.ts:26-32`) than a `console.warn`, since
that module deliberately avoids process globals to stay doctestable
(`configure.ts:6-8`).

## Knowledge audits

No box-agent-facing concept is added: this is a laptop client and an HTTP
header, and no agent working in a box encounters either. Skipped with rationale
— purely infrastructural, per the skill's allowance. The one human-facing
concept (what a drift notification means and what to do about it) belongs in
`scan-uploader/README.md`, not in a knowledge audit.

## What will hold this after it ships

**The decision is extracted as a pure function on purpose.**
`compareContractVersion({ client, server })` takes two numbers and returns a
verdict — no I/O, no process globals — so every branch including `unknown` is a
doctest assertion. This follows the guidance that when a decision is the risky
part, extract it rather than reaching for a heavier tier.

- **`scan-uploader/test/contract-version.doctest.md`** (new) — the four
  verdicts, the `unknown` case for a pre-version box, and a non-integer header
  value.
- **`scan-uploader/test/wire-client.doctest.md`** — that the client sends the
  header and reads the response integer. `test/fake-scan-server.ts:165-171` is
  where a version-bearing check response gets faked; the fake gains one optional
  field.
- **`scan-uploader/test/notify.doctest.md`** — the sticky-verdict rule: a drift
  notification on the sweep the verdict changes, and silence on the sweeps after
  it. This is the same rule the file already asserts for `rejectedOnUpload`, so
  the pattern is in place.
- **`beebox/test/webapp/routes/scan-upload.doctest.md`** — that the check
  response carries `contractVersion`, and that a request with no header is
  accepted unchanged. The contract doc calls these doctests *"its executable
  form"*, so the new field is not landed until they assert it.

**Mock trap check:** the one fake here (`fake-scan-server.ts`) is extended by
one optional field, and the server-side doctest asserts the real route's
response independently — so the client's fake cannot encode a wrong belief about
what the box sends.

**No new test tier**, and no tour: the behaviour that must stay true (the four
verdicts, the additive tolerance) is in doctests.

## Implementation order

1. **`compareContractVersion` + doctest**, client-side only. Pure; no wire
   change.
2. **Contract doc**: declare `SCAN_CONTRACT_VERSION`, its bump rule, the
   `x-scan-contract` request header row beside `X-Scan-Profile`, and the
   `contractVersion` response key — plus the addition to "Change discipline"
   (`:186-189`). Doc first, because this contract's own rule is that the document
   is the coordination point.
3. **Server**: the constant, the header read with a cap and integer parse, the
   response key, and the route doctests.
4. **Client**: the constant, the header send, the widened `checkHashes` return,
   and the wire doctest.
5. **Reporting**: the stdout line, the verdict state file, the notification, and
   the notify doctest. Last, because it depends on every piece above.
6. **`configure` warning** (pending the open question) and
   `scan-uploader/README.md`.

## Rollout shape

**Tests first**, per `docs/testing.md` and this contract's own clause that the
route doctests are its executable form: chunks 3 and 4 write their doctests
before their source, and chunk 1 is a test-only chunk by construction.

**Done-when:** `compareContractVersion`'s doctest covers all four verdicts; the
box's check response carries the integer and still accepts a header-less
request; the client reports drift once per verdict change; `pnpm test` green in
both `beebox/` and `scan-uploader/`; and the bundle still builds
self-contained (`pnpm --filter scan-uploader build`, then `smoke-install.sh`'s
bare-directory run) with no runtime dependency added.

**Migration approach: none needed**, and that is a designed property rather than
luck — both halves are additive over parsers that ignore unknown keys and
unknown headers, verified at `wire-client.ts:54`,
`scan-upload-validation.ts:31-33`, and `scan-upload-validation.ts:37-40`. No box
and no bundle has to be updated in any particular order, and neither breaks
while the other is old.

**Cross-model review** before this is declared done, per root guidance, by the
other model family.
