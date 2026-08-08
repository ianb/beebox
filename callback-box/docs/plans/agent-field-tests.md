# Agent field tests — an agent-operator exercising realistic box activities end-to-end

A new top test tier: a persistent Claude "operator" with a persona works through a
checklist of realistic activities (add a recipe, retrieve it later, upload
documents, react to an arriving email) against a fresh box through the real web
UI and real agent processing. The operator judges discoverability and flow — a
feature that is possible but hidden is a finding, not something to automate
around. Expensive by design (real Opus operator + real box agents + a browser);
runs weekly or on demand, never as a CI gate.

**Issues addressed.**

- `issues/features/2026-08-06-agent-driven-integration-tests.md` — the spec this
  plan resolves.
- Related, not resolved here:
  - `issues/features/2026-07-22-modeled-demo-family-box.md` — deferred; v1 starts
    from an empty box (onboarding-first, boxholder decision 2026-08-08). The
    family box becomes a later scenario's seed.
  - `issues/features/2026-07-20-first-run-experience.md` — the onboarding
    scenario is precisely the probe that will exercise (and likely flag) this.
  - `issues/watch/2026-07-10-agent-browser-screenshot-flake.md` — a known flake
    the harness must tolerate (retry a failed screenshot once before reporting).
  - `issues/docs-and-chores/2026-08-08-maintenance-cadence-framework.md` — the
    weekly cadence should eventually register there.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — traced by number below;
  chiefly **#3 validate-at-boundaries**, **#4 resilient-AND-never-silent**,
  **#6 right-sized defensiveness**, **#8 one-way-to-do-each-thing**,
  **#10 testability-is-architectural**, **#12 the-maintainer-is-usually-an-agent**.
- `callback-box/CLAUDE.md` — "don't add features beyond what the task requires";
  the services real/fake pattern (`src/services/CLAUDE.md`).
- `callback-box/code-style.md` — mechanical rules for all new code.
- Precedents: the `cb scenario` harness (`src/scenario/`) as the prior
  end-to-end-fixture design; `bin/manual-tests-scheduled.sh` as the prior
  "real services, weekly, triaged by an agent" cadence
  (`bin/manual-tests-scheduled.sh:1-9`: *"Weekly runner for callback-box tests
  that are deliberately excluded from the default suite because they use real
  services or fixed wall-clock delays."*).
- Boxholder decisions from the design conversation (2026-08-08): agent-operator
  (not scripted steps) with a discernment mandate; single persistent operator
  session, checklist-driven, harness interleaved between activities; optional
  cleanup between activities; auth out of scope; Opus operator; simulated
  multi-day wall time; the name `field-test` (not `itest`).

## What already exists

- **`cb scenario` harness** (`src/scenario/runner.ts`, `loader.ts`, `types.ts`) —
  multi-step fixtures against real box repos, git-branch isolation, `CB_TIME` /
  HTTP stubs / strict fetch (`runner.ts:245`, `:261`, `:270`), clean-`main`
  preflight (`runner.ts:216-222`). **Reused as a pattern, not as code**: the
  field-test harness borrows its git-isolation and env-freezing discipline, but
  the scenario runner is CLI-only (no server, no browser) and its step model is
  the opposite of goals-not-steps. Extending it would bend both designs
  (principle #8: these are two different things, each done one way).
- **Service fakes** (`src/services/`, real/fake DI per `src/services/CLAUDE.md`).
  `FakeGoogleGmailService.addMessage()` already models "an email arrives"
  (`src/services/google-gmail.ts:272-278`: pushes the message and a
  `messagesAdded` history record). `createGmailConnector(boxRoot, service?)`
  takes the optional injected service (`src/connectors/gmail.ts:268-273`).
  **Reused**; Track 1 adds a file-backed construction path so a *subprocess*
  (`cb wakeup`) can use the fake.
- **`bin/browse` / agent-browser** — persistent per-worktree headless Chromium
  daemon; navigate/click/fill/snapshot/screenshot/wait and `upload <sel>
  <files...>` (verified in `agent-browser --help` core commands). Auth via the
  `cb_browse_key` cookie, fail-closed when `CB_BROWSE_API_KEY` is unset
  (`src/core/browse-key.ts:41`, `browse/src/worktree.ts:60`). **Reused as-is**;
  the operator drives it through Bash.
- **Agent SDK plumbing** (`src/core/agent/run.ts:203` — `runAgent`, default
  `maxTurns = 20`; `run.ts:72` — `permissionMode: "bypassPermissions"`).
  **Reused for box agents** (they run untouched inside the server/reactor). The
  operator gets its own thin session wrapper (Track 3) because `runAgent` is
  one-shot and box-rooted, while the operator is a long-lived multi-turn session
  rooted in the run directory.
- **Completion detection**: tRPC `chat.status`
  (`src/webapp/trpc/routers/chat-control-procedures.ts:115`) returns
  `{ sessionId, running, busy, model }` — the harness's "wait until the box
  agent finishes" poll. **Reused as-is.**
- **`CB_TIME`** resolved in `src/lib/time.ts:51-52` (*"CB_TIME env var takes
  priority"*) and read by server-side modules (chat session registry, capture
  sweep, bulk-upload sweep, question aging, login throttle). **Reused** for
  simulated multi-day time; day boundaries restart the server with a new value.
- **`cb serve`** (`src/cli/commands/serve.ts:98` — `--port`; box roots are
  positional args). **Reused as-is** for the dedicated per-run server. (Note: no
  `CALLBACK_STATE_DIR`-style isolated state dir exists in callback-box — that
  mechanism belongs to the dev router. Isolation comes from the fresh box
  directory itself.)
- **Real-agent test precedents**: scenario `prompt:` validations
  (`docs/testing.md:271`) and session critiques (`docs/testing.md:409`) both
  talk to real agents; `bin/manual-tests-scheduled.sh` is the weekly real-service
  cadence. Field tests slot in beside these as a new tier in `docs/testing.md`.
- **Fake agent for doctests** (`test/helpers/fake-agent.ts:128`) — the reason no
  existing tier covers what field tests cover: everything below this tier fakes
  the agent.

## Prior art (external)

- **[UXAgent (CHI '25)](https://arxiv.org/abs/2504.09407)** — LLM personas
  driving a real browser to simulate usability testing. Validates the
  operator-with-persona concept. Its noted failure mode — personas drift
  off-profile in long sessions without repeated anchoring — supports our
  design: every harness checklist message re-states persona context.
- **LLM-driven QA agents** —
  [browser-use for QA](https://qaskills.sh/blog/browser-use-ai-agent-testing-guide),
  [qa-agent](https://github.com/jimmytoan/qa-agent),
  [an agent-browser QA-agent walkthrough](https://dev.to/smakosh/build-an-ai-powered-qa-agent-with-agent-browser-vercel-ai-sdk-and-llm-gateway-2om0):
  natural-language browser tests run by an LLM, with screenshot/GIF artifacts.
  These test *task completion*; none add our combination of persona judgment,
  a real agent-backed product under test, connector injection, and interleaved
  hard asserts. No prior art found for that full loop.
- **[agent-browser](https://github.com/vercel-labs/agent-browser)** — our
  substrate is explicitly built for AI-agent driving; no impedance mismatch to
  design around.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — File-backed fake Gmail for subprocesses

- **What:** Let a spawned `cb wakeup` build `FakeGoogleGmailService` from a
  state file instead of the real Gmail API, gated so it can never divert a real
  box.
- **Why:** Email intake runs in CLI subprocesses (`cb wakeup` → connector sync →
  intake job → reactor), not in the server. In-process DI
  (`createGmailConnector(boxRoot, service?)`) cannot cross the process
  boundary. Today there is no way to run the *real* pipeline on synthetic mail.
- **Direction:** A JSON state file holding the fake's `messages` / `labels` /
  `attachments` arrays (same shapes `createFakeGoogleGmail` accepts). The
  connector factory checks `CB_FAKE_GMAIL=<path>`: if set AND the box root
  contains the test-box marker (below), it builds the fake from the file;
  if set without the marker, it **throws** (fail-closed, principle #4 — never
  silently divert; principle #3 — the gate is validated at the boundary).
  "An email arrives" = the harness appends a message object to the file and
  runs `cb wakeup --connector gmail`. The fake's history cursor is derived from
  array length, so successive wakeups see only new messages.
  **Test-box marker:** a `test-box` marker file inside the box's `config/`
  directory, written by `cb field-test` box creation, committed with the box.
  Real boxes never contain it.
- **Vocabulary lock-ins:** `CB_FAKE_GMAIL` (env var), `config/test-box` (marker
  file), `field-test` (the tier's name everywhere: command, directory, docs).
- **First implementation chunk:** the marker + gate + file-backed factory path +
  a connector doctest proving fail-closed behavior and a full
  `addMessage`-equivalent file append → `sync()` → cards on disk.

### Track 2 — Run lifecycle harness (`cb field-test`)

- **What:** `cb field-test run <scenario>` (plus `list`): create the run
  directory and fresh box, start a dedicated `cb serve`, manage the browse
  session, drive the activity loop, advance simulated days, apply cleanup
  policy, collect the report, tear down.
- **Why:** The spec's "good harness for resetting, starting, managing"
  (boxholder). Nothing existing manages a server + browser + box as one
  disposable unit.
- **Direction:** Run directory `~/src/boxes/field-runs/<scenario>-<timestamp>/`
  containing `box/` (fresh `cb init`, test-box marker, git-committed baseline),
  `screenshots/`, `report.md` + `findings.json`, and the operator transcript.
  Server: `cb serve <box> --port <free port>`, `CB_TIME` set to the scenario's
  start time, `CB_FAKE_GMAIL` pointing into the run dir. Browser: a dedicated
  `bin/browse --session field-<ts>` with `CB_BROWSE_API_KEY` set (auth is out
  of scope; the operator lands post-login).
  **Activity loop:** for each checklist item — (1) harness performs the item's
  `pre` actions (inject email, advance day); (2) harness sends the item's brief
  to the operator session and waits for its structured activity report;
  (3) harness waits for box-agent quiescence (`chat.status` poll until
  `busy === false`, plus a settle delay); (4) harness runs the item's `checks/`
  scripts against the box; (5) harness applies the item's **cleanup policy**:
  `keep` (default — residue is realistic), `commit` (checkpoint, continue), or
  `reset` (hard-reset the box to the previous checkpoint so a messy attempt
  does not contaminate later items; the server is restarted after a reset).
  Every item ends with a git checkpoint tag either way — that is what makes
  `reset` and post-hoc inspection cheap.
  **Day advance:** stop the server, set the new `CB_TIME`, run `cb wakeup` /
  `cb tick`-due work at the new time, restart the server. Long-lived in-server
  state does not survive across simulated days by construction.
- **Vocabulary lock-ins:** `cb field-test` (command), `field-runs/` (run
  artifacts), cleanup policy values `keep | commit | reset`.
- **First implementation chunk:** box+server lifecycle only — create, serve on
  a free port, health-check, browse-session smoke (open `/`, screenshot),
  teardown — as a doctest-able module with the process management isolated from
  the loop logic (principle #10).

### Track 3 — Operator runtime

- **What:** One persistent Opus session that is the persona for the whole run:
  receives checklist items as messages, drives `bin/browse` itself, perceives
  via screenshots + a11y snapshots, and returns a structured activity report
  per item.
- **Why:** Boxholder decisions: single session ("a person is a single
  identity"); open-ended within an activity ("succeed or fail based on how well
  the whole thing actually works"); discernment mandate (hidden-but-possible is
  a bug to detect).
- **Direction:** A thin wrapper over `@anthropic-ai/claude-agent-sdk` in
  streaming-input mode (the same SDK the box agents use, but *not* through
  `runAgent` — the operator is multi-turn and rooted in the run directory, not
  a box). Model `opus`; per-activity turn cap (start: 25) so one stuck activity
  cannot eat the run. Tools: Bash (for `bin/browse` and nothing else by
  instruction), Read (for screenshots and provided assets). System prompt: the
  persona brief, the discernment mandate ("you are evaluating whether this is
  usable, not proving it can be done; confusion is a finding, not your
  failure"), the browse cheat-sheet, and the report format. Each activity ends
  with the operator emitting a fenced JSON activity report:
  `{ outcome: "smooth" | "friction" | "blocked", observations: [{ severity,
  note, screenshots: [...] }] }` — every observation must cite at least one
  screenshot it took (evidence requirement; see fabrication edge case). The
  harness parses the fence; a malformed report is re-requested once, then
  recorded as a harness finding (principle #4).
- **Vocabulary lock-ins:** outcome values `smooth | friction | blocked`.
- **First implementation chunk:** the session wrapper + report-fence parsing,
  exercised by a doctest with the fake chat backend
  (`src/services/claude-chat-fake.ts` precedent) — the wrapper's mechanics are
  testable without a real operator.

### Track 4 — Scenario format, first scenario, asset corpus

- **What:** The on-disk scenario shape and the first scenario:
  `onboarding-first-days`.
- **Why:** Boxholder: design the scenario descriptions and the materials we
  hand the operator (it cannot take photos; every asset must be provided).
- **Direction:** `callback-box/field-tests/<scenario>/` (in-repo: reviewable,
  doc-checked; run artifacts stay out at `field-runs/`):
  - `scenario.yaml` — start time; the ordered checklist: per item an `id`, the
    persona-voiced `brief` (goals, never steps; may reference `assets/` files
    by path), optional `pre` actions (`inject-email: <fixture>`,
    `advance-days: <n>`), `cleanup: keep|commit|reset`, and `checks: [<script>]`.
  - `persona.md` — who the operator is (drawn from `docs/example-names.md`,
    never real names), their situation, what they know coming in (nothing).
  - `assets/` — the corpus: a recipe photo, a scanned school flyer PDF, a few
    household photos for bulk upload. Checked in; small.
  - `emails/<name>.yaml` — inbound-email fixtures in the fake-Gmail message
    shape.
  - `checks/<id>-*.sh` — hard asserts run by the harness in the box root
    (scenario-`script:`-style; exit 0 = pass). The operator never sees these.
  - `onboarding-first-days` v1 checklist (~6 items over 3 simulated days):
    first contact with the empty box; save the recipe photo; bulk-upload the
    household photos; next day — ask for the recipe back; dentist-reminder
    email arrives, see what the box did with it; day three — ask "what needs my
    attention?".
- **Vocabulary lock-ins:** the `scenario.yaml` field names above.
- **First implementation chunk:** loader + validation for the format (Zod at
  the boundary, principle #3) with the first scenario checked in.

### Track 5 — Reporting and docs

- **What:** Merge operator findings + check results + harness events into
  `report.md` / `findings.json` in the run dir; document the tier in
  `docs/testing.md`; wire an optional entry into `bin/manual-tests-scheduled.sh`.
- **Why:** A run whose output needs archaeology will not be read weekly
  (principle #12 — the reader is often a triage agent).
- **Direction:** `report.md` leads with a per-item table (outcome, checks,
  cleanup applied), then findings ordered by severity with screenshot links,
  then harness events (retries, resets, timeouts). Findings are triaged by a
  human (or a triage agent) into `issues/` — no auto-filing.
- **First implementation chunk:** report writer + the `docs/testing.md`
  section; the scheduled-runner wiring waits until a few manual runs prove
  stability (see NOT in scope).

## Could this be simpler?

Simplest plausible version: no harness — a human runs `claude` in a scratch
directory, pastes a persona prompt, lets it drive `bin/browse` against a
hand-made box, and reads the transcript. That is in fact a good **week-one
smoke test of the operator concept, and Track 3's prompt design should be
prototyped exactly this way before code exists.** But as the standing tier it
fails on: reproducibility (no fixed box baseline, no `CB_TIME`, no email
injection — principle #10), silent gaps (no hard asserts; an operator that
charitably works around a bug reports success — principle #4), and cost
accounting/cadence (nothing an unattended weekly run can invoke). A middle
version — harness but no fake email (drop Track 1) — loses the single activity
class that exercises connectors and intake, which is the pipeline least covered
by any existing tier; that is the concrete case the extra track buys.
Conversely this plan already *chose* simpler shapes where they hold: no new
browser layer (reuse `bin/browse`), no scenario-runner extension (pattern
reuse only), fake for Gmail only (not Calendar/Drive), no auto-filed issues.

## Subplans

None. The demo-family box (`2026-07-22-modeled-demo-family-box.md`) is adjacent
and stays a separate future plan; v1 deliberately starts from an empty box, so
nothing here depends on it.

## Failure modes

> **Critical gap (accepted as documented risk):** operator self-consistency —
> an operator that hallucinates UI it did not see, or reports success it did
> not verify, produces a false-clean weekly report. Mitigated (not eliminated)
> by the screenshot-evidence requirement per observation and hard asserts the
> operator never sees; the checks are the spine, the operator is the color.
> No automated test can fully verify judgment quality; the first few runs get
> human review of the full transcript.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `CB_FAKE_GMAIL` set on a box without the test-box marker | Track 1 doctest | Throws at connector construction | Clear |
| Malformed fake-Gmail state file | Track 1 doctest | Zod parse at load; wakeup fails loudly | Clear |
| `cb serve` fails to start / port collision | Track 2 doctest (lifecycle module) | Free-port allocation + health-check with timeout; run aborts before operator starts | Clear |
| Browse daemon dies or screenshot flakes (os error 35, known) | No (external flake) | One retry per browse call in harness `pre`/setup paths; operator instructed to retry once then report | Clear (logged as harness event) |
| Box agent never goes quiescent (`chat.status.busy` stuck) | Track 2 doctest with fake status | Poll timeout per activity → harness records `blocked`, applies `reset` policy if set, continues | Clear |
| Operator emits unparseable activity report | Track 3 doctest | One re-request, then harness finding | Clear |
| Operator exceeds per-activity turn cap | Track 3 doctest | SDK turn cap → recorded as `blocked` with partial transcript | Clear |
| Operator session dies mid-run (API error, quota) | No | Run aborts; report written with completed items + abort reason; no resume in v1 | Clear |
| Day-advance restart loses in-flight box-agent work | No | Quiescence wait precedes every day advance | Clear (ordering) |
| `reset` cleanup leaves server serving stale state | Track 2 doctest | Server restart is part of `reset` by construction | Clear |
| Checks pass but operator reports `blocked` (or inverse) | n/a | Both recorded; disagreement is itself surfaced in the report header | Clear |
| Screenshots bloat operator context over a long run | No | Per-activity turn cap + instruction to snapshot selectively; monitor in early runs | Silent-ish — accepted, revisit if runs die |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — n/a to the harness itself; *box-agent* tag
  misuse during a run is exactly what checks + operator observation exist to
  catch. **ADDRESSED** (that is the product under test).
- **Stale ref** — browse `@e` refs go stale on any page change. **ADDRESSED**:
  operator cheat-sheet mandates re-snapshot after navigation/mutation (the
  browse skill already teaches this).
- **Two agents touching the same card** — real risk: the operator triggers chat
  work while a day-advance wakeup runs the reactor. **ADDRESSED**: quiescence
  wait before every harness `pre` action and day advance (Track 2 loop order).
- **Hand-edit drift** — n/a; no human edits during a run. **ADDRESSED** by
  scope.
- **Fabricated free-form value** — the operator inventing observations.
  **ADDRESSED** (partially): evidence requirement — each observation cites a
  screenshot; the critical-gap note covers the residual risk.
- **Validation error UX** — when a `checks/` script fails, the report shows the
  script name, exit code, and stderr verbatim. **ADDRESSED** (Track 5).
- **Partial migration / transition state** — none; this is all-new surface.
  **ADDRESSED** by scope.

## NOT in scope

- **Auth, login, pairing** — boxholder decision; the browse key skips the wall.
  Login UX stays untested; noted in `docs/testing.md`.
- **Calendar / Drive / Telegram fakes** — email is the one connector class in
  v1; the `CB_FAKE_*` pattern extends later if scenarios need it.
- **Demo-family box** — separate issue; later scenarios can seed from it.
- **CI / pre-commit integration** — expensive by design; never a gate.
- **Parallel or concurrent runs** — one run at a time; a run owns its port,
  box, and browse session.
- **Auto-filing issues from findings** — human/triage-agent judgment stays in
  the loop (per "arrange context, don't automate judgment").
- **Run resume after mid-run abort** — v1 reruns from scratch; checkpoint tags
  make a future resume possible but it is not built now.
- **iOS/mobile surfaces** — web UI only.
- **Scheduled-runner wiring on day one** — lands only after ≥3 manual runs
  complete without harness-caused aborts.

## Open design questions

- **Operator context pressure** — if 6 activities × screenshots overflow even
  with turn caps, the fallback is summarize-and-continue at day boundaries
  (still one identity, compressed memory). Lean: don't build until a run shows
  the need.
- **Sonnet operator experiment** — after the harness is stable, run the same
  scenario with `--model sonnet` and diff report quality. Lean: worth one run;
  Opus remains the default (boxholder).
- **Where triage lives** — weekly reports could feed the same constrained
  triage agent `manual-tests-scheduled.sh` uses. Lean: yes, when the scheduled
  wiring lands; manual until then.

## Knowledge audits

Skipped with rationale: field tests are dev-repo infrastructure. Box agents
never see the harness, the scenario format, or `CB_FAKE_GMAIL`; there is no
agent-facing concept for a box agent to recall, so there is nothing for
`knowledge-audits.yaml` to verify. (The *operator's* prompt is exercised every
run by construction.)

## Implementation order

0. **Prototype (no code):** hand-run the operator concept once — a Claude
   session with a persona prompt driving `bin/browse` against a scratch box —
   to pressure-test the persona/report prompt design before Track 3 hardens it.
1. Track 1: test-box marker + `CB_FAKE_GMAIL` gate + file-backed fake +
   doctests.
2. Track 2 chunk 1: box/server/browse lifecycle module + doctests.
3. Track 4: scenario format loader + `onboarding-first-days` + assets + email
   fixtures + checks.
4. Track 3: operator session wrapper + report parsing + doctests.
5. Track 2 chunk 2: the activity loop (wires 1–4 together) + cleanup policies +
   day advance.
6. Track 5: report writer + `docs/testing.md` tier section.
7. First full real run; human transcript review; fix-round.
8. (Post-plan, after stability) scheduled-runner wiring.

## Rollout shape

- **Test posture.** Doctests land with each track as named in the chunks: the
  Track 1 gate (fail-closed + happy path), the Track 2 lifecycle module
  (create/serve/teardown with a real ephemeral server), the Track 3 wrapper
  (fake chat backend), the Track 4 loader (fixture scenarios, invalid-input
  cases). The activity loop gets a doctest with a scripted fake operator. The
  done-when of the plan is: `cb field-test run onboarding-first-days` completes
  a real run end-to-end, its hard asserts pass, and the report is judged
  readable by the boxholder.
- **Knowledge audits:** none (see above).
- **Migration:** none — no existing data shape changes; all surface is net-new
  plus one gated branch in the Gmail connector factory.
