---
title: "Source-available release of callback-box"
status: active
workstream: unknown
issues: []
---
# Source-available release of callback-box

Make the `callback-box` monorepo publishable as a public, source-available
GPLv3 project on GitHub: readable and cloneable by strangers, buildable by
contributors, free of personal secrets/PII, and with its personal-infrastructure
coupling parametrized rather than hardcoded. This is the *first* release cut —
it deliberately does not promise a turnkey install (npm publish) or a hosted
service; those are named deferrals below.

**Decisions already made** (this planning session, 2026-07-05):
- **Release model:** source-available on public GitHub. Not npm-installable, not hosted, for this cut.
- **Git history:** no rewrite. The boxholder's real name and email are already
  easy to find publicly, so their presence in history is acceptable and does
  **not** gate the release. History scrubbing is out of scope; the only residual
  history concern is an actual leaked *secret* (a real one, not a name) — see Track A.
- **deploy/:** the primary start path is **running locally** (`pnpm install` +
  `cb serve`), so deploy genericization is **deprioritized** — it moves to a
  fast-follow, not the source-available cut. What *stays* in this cut is the cheap
  part of Track C: strip the real server IP and the `box.example.com` source
  comments (a stranger reading the source shouldn't hit the author's domain). The
  full deploy parametrization + subplan waits until someone actually needs to
  self-host on a server.
- **Scope:** the whole monorepo ships as one repo, mixed licenses intact (app GPLv3; `agent-doctest` + `personal-vibe-check` MIT).
- **Claude auth:** never implicitly inherit an ambient `ANTHROPIC_API_KEY` from
  the environment (bill-safety — keep force-stripping it), but allow a key the
  operator *explicitly configures* as an alternative to subscription auth. See Track F.
- **Track B working-tree PII scrub:** DONE this session — real name/email in the
  three identified files swapped to the `example-names` roster (`Priya Marlowe`);
  the personality doctest re-run green (6/6).

This plan is release preparation, not a code feature. Several template sections
(knowledge audits, agent-flow card edge cases) map awkwardly and are marked
skip-with-rationale rather than omitted.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:103` — *"Keep source and docs generic — never hardcode
  personal names. This is a generic tool; any box can be adopted by any user."*
  This is the governing principle for the PII-scrub and deploy-genericize tracks;
  every finding there traces here.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"don't add features beyond what
  the task requires."* Governs the deferrals: source-available first, npm/hosted
  later. Doing the smallest coherent release is the on-preference choice.
- `callback-box/code-style.md` — style rules for any code touched by deploy
  genericization (no default parameters, max 2 positional params, no `any`,
  custom error classes). Config parametrization must obey these.
- Licensing decisions from 2026-07-05: root `LICENSE` GPLv3; `agent-doctest`
  and `personal-vibe-check` MIT with their own `LICENSE` files. The release must
  not contradict these (see the README claim finding under What already exists).

## What already exists

Reuse-heavy: the release story is mostly *finishing* work already started, not
new construction.

- **Secret hygiene — reuse as-is.** Layered `.gitignore`: root `.gitignore:6`
  (`.env`), `callback-box/deploy/.gitignore:1-2` (`.env`, `server-ip`),
  `callback-box/.gitignore:12` (`deploy-info.json`); connector secrets excluded
  by the `*.secret.json` convention enforced at `callback-box/deploy/deploy.sh:26`
  and documented at `callback-box/docs/box-layout.md:194`. No credential values
  are committed. This track needs verification, not construction.
- **The generic-vs-personal boundary is already annotated** — `docs/adding-a-box.md:6-8`
  marks which commands are `box.example.com`-specific vs. generic. The author
  has already separated these mentally; the deploy track formalizes it.
- **Fictional example roster — reuse.** `docs/example-names.md` and
  `docs/architecture/family.md` (Lund-Vega roster) are the sanctioned
  replacements for real names in the PII-scrub track. No new convention needed.
- **External-owner entry doc — extend, don't rebuild.** `callback-box/README.md:22`
  has a "Five-minute start" for a box owner, but it depends on a tarball
  (`README.md:24`: *"npm publish is planned but not live yet"*). The
  source-available cut rewrites this to a build-from-source path, not a new doc.
- **LICENSE files — partially done.** Root `LICENSE` (GPLv3), `agent-doctest/LICENSE`
  and `personal-vibe-check/LICENSE` (MIT) exist. `README.md:35` claims *"Each
  carries its own `LICENSE`"* — currently false for `callback-box/`, `callback-clerk/`,
  `browse/`. Rebuild: add the three missing files or correct the claim.
- **agent-doctest + personal-vibe-check are already standalone** (own README,
  LICENSE, docs). No packaging work for them in this cut.

## Prior art (external)

- **Apache-2.0 → GPLv3 compatibility.** `agent-browser` (the dep `browse/`
  wraps) is Apache-2.0 (`node_modules/agent-browser/package.json`,
  `node_modules/agent-browser/LICENSE`). Apache-2.0 is one-way compatible *into*
  GPLv3 (FSF: <https://www.gnu.org/licenses/license-list.html#apache2>), so a GPL
  project may depend on / redistribute it provided its `NOTICE`/attribution is
  preserved. `browse/README.md:3` already attributes vercel-labs/agent-browser.
  Low risk; the only action is preserving attribution.
- **Secret scanning** — `gitleaks` / `trufflehog` are the standard tools for
  Track A's history+tree secret scan. `git-filter-repo`
  (<https://github.com/newren/git-filter-repo>) is only needed if the scan finds
  a real committed credential (name/email in history is accepted, not scrubbed).
- **Provider key management in self-hosted apps** (research pass, 2026-07-05 —
  feeds Track F pieces 3-5). Findings:
  - *Storage.* The dominant model is encrypt-at-rest keyed by one symmetric
    secret auto-generated on first run to a `0600` file — n8n
    (`N8N_ENCRYPTION_KEY`, <https://github.com/n8n-io/n8n/blob/master/packages/core/src/instance-settings/instance-settings.ts>),
    LibreChat (`CREDS_KEY`, <https://raw.githubusercontent.com/danny-avila/LibreChat/main/packages/data-schemas/src/crypto/index.ts>),
    Flowise, Langflow. Open WebUI stores provider keys **plaintext** and Home
    Assistant does so *by design* — so plaintext-`0600` is a legitimate honest
    tier, not negligence. Encryption here defends a leaked backup, not root.
  - *Ambient-vs-explicit is precedented but inverts every SDK default.* The
    Claude Agent SDK forcibly grabs an ambient `ANTHROPIC_API_KEY` even from a
    cwd `.env` (<https://github.com/anthropics/claude-code/issues/12047>); the
    precedented fix is to scrub the child env and inject via an explicit
    `apiKeyHelper` temp-file (<https://github.com/anthropics/claude-code/issues/10211>).
    AWS is the cleanest general prior art (static-credentials provider +
    `AWS_EC2_METADATA_DISABLED`). This is why Track F's key path can't just set
    the env var.
  - *Validation probes* (free/cheap, per provider): Anthropic
    `count_tokens` (<https://platform.claude.com/docs/en/build-with-claude/token-counting>),
    OpenAI/Mistral `GET /v1/models`, Deepgram `GET /v1/auth/token`
    (<https://developers.deepgram.com/guides/fundamentals/authenticating>).
  - *Cost guards:* Anthropic per-workspace spend limits
    (<https://platform.claude.com/docs/en/manage-claude/workspaces>) and Mistral
    org limits are the only *outside-the-app* hard stops; OpenAI/Deepgram offer
    only prepaid-balance + auto-recharge-off; LiteLLM
    (<https://docs.litellm.ai/docs/proxy/users>) has in-app fail-closed budgets
    but is a whole service. Layer native caps + tiny balances + a thin in-app
    meter rather than run a proxy.
- **Deploy parametrization** — this is ordinary 12-factor config (env/args over
  hardcoded hosts); no exotic prior art. No external search beyond that returned
  anything the plan must account for.
- **skill-creator bundled license** — `.claude/skills/skill-creator/LICENSE.txt`
  is third-party; its terms need a glance for public-release compat (unread; the
  first line is blank). Flagged, not yet resolved.

## Tracks / scope

Ordered by dependency then risk. Track A (history verification) gates public
push and comes first because its outcome could change everything. Tracks B–E
are independent and can land in any order once A clears.

### Track A — Real-secret scan (history + tree) — **DONE / CLEAN (2026-07-05)**

**Scan result: CLEAN — no live credential in the working tree or full git
history. The gate passes.** Ran `gitleaks` (full history via `--log-opts=--all`,
2,008 commits + working-tree `--no-git`) and `trufflehog git file://.` **with
live verification** (28,621 chunks): **0 verified and 0 unverified secrets**.
The only scanner hit was the RFC 6455 §1.3 sample `Sec-WebSocket-Key`
(`dGhlIHNhbXBsZSBub25jZQ==` = "the sample nonce"), a fixed spec constant in the
hub handshake doctests — allowlisted in `.gitleaks.toml`. Spot-checks confirmed
no secret-value file was ever committed on any ref (the long-gone
`callback-box/.env.example` held only dev ports/paths; `deploy/` scripts read
from gitignored `.env`/`server-ip`; no `config/connectors/` secrets tracked).
Boxholder name/`ianb@colorstudy.com` in commit metadata is accepted per the
history decision. **No history surgery needed.** The repeatable gate is
`gitleaks detect --log-opts=--all` (config: `.gitleaks.toml`).

- **What.** Confirm no actual *secret* (API key, token, password, private key)
  exists in the working tree or git history before going public. Names and the
  boxholder's email are explicitly **not** in scope (boxholder decision — they're
  publicly findable; no history rewrite).
- **Why this needs to change.** Secret hygiene looks clean (recon: layered
  `.gitignore`, no committed credential values), but "looks clean" isn't
  "scanned." A single old committed secret is the one thing that would force a
  history rewrite, so verify before the push, not after.
- **Direction.** A repeatable scan for *secret shapes* — run `gitleaks`/`trufflehog`
  (or equivalent) over `git log --all` and the tree; spot-check high-risk paths
  (`config/connectors/`, `deploy/`, `.env*`). A name/email hit is expected and
  ignored; a live credential hit is the only thing that escalates (to targeted
  history surgery on that blob, not a full scrub). Record the clean result.
- **First implementation chunk.** Run the secret scanner over history + tree;
  triage hits into "known-fine (name/path)" vs. "real credential." Only the
  latter needs action.

### Track B — PII scrub in the working tree

- **What.** Replace real personal identifiers in tracked files with the
  boxholder/`example-names` convention.
- **Why.** `callback-box/CLAUDE.md:103` requires generic shared text; these
  violate it: `test/schemas/personality-boxholder.doctest.md:20` (real name as
  test data), `docs/knowledge-taxonomy.md:468-491` (agent inferring the real
  name), `docs/reports/user-stories-audit-2026-06-26.md:671` (real email).
- **Direction.** Swap to a roster name from `docs/example-names.md`. The
  `agent-doctest/LICENSE` + `agent-doctest/README.md` real-name uses are
  *authorship attribution*, not boxholder data — leave them (author's call).
- **First implementation chunk.** Replace the three identified files' real
  identifiers with roster equivalents; re-run the affected doctests to confirm
  the personality/knowledge tests still pass with the substituted name.

### Track C — Strip personal domain from source (+ deploy genericization, deferred)

- **Priority.** Local-run is the primary start path, so this track **splits**:
  the source-comment/IP scrub (below) stays in the cut; the `deploy/`
  parametrization + its subplan are **deferred to a fast-follow** and are the
  lowest-priority item in the plan. Only do the deploy half when self-hosting on
  a server becomes a real need.
- **What.** Parametrize the deploy target (domain, server host/IP, system user)
  and remove `box.example.com` from product-source comments.
- **Why.** `callback-box/CLAUDE.md:103` (generic tool). Hardcoded:
  `deploy/setup-server.sh:5,40,56`, `deploy/add-box.sh:26-27`,
  `deploy/create-server.sh`, `deploy/migrate-to-callback-user.sh:77`; real IP in
  `docs/implemented-plans/box-migration.subplan.md:162`; domain in source comments
  `src/connectors/telegram.ts:269`, `src/frontend/src/lib/audio/mic-tab-lock.ts:10`,
  `src/webapp/routes/admin.ts:31`.
- **Direction.** Move domain/host/user into deploy config (env or a
  gitignored `deploy/*.local` values file with a committed `.example`). Source
  comments switch to a neutral example (`box.example.com`). Obeys
  `code-style.md` for any script/TS touched. **This may warrant a subplan** (see
  Subplans) — genericizing deploy without breaking the author's *live* deployment
  is a transition-state problem with its own decisions.
- **First implementation chunk.** Not yet decision-complete — see Subplans and
  Open questions. Do not start Track C code until the subplan settles the
  config mechanism.

### Track D — Licensing loose ends

- **What.** Make the on-disk license state match `README.md:35`, and clear the
  two third-party checks.
- **Why.** `README.md:35` claims each package carries its own LICENSE; false for
  `callback-box/`, `callback-clerk/`, `browse/`. Traces to the 2026-07-05
  licensing decisions.
- **Direction.** Either add `LICENSE` files (GPLv3) to the three packages *or*
  reword the README claim to "root LICENSE covers all packages except the two MIT
  ones." Preserve `agent-browser`'s attribution/NOTICE. Read
  `.claude/skills/skill-creator/LICENSE.txt` and confirm compat (or exclude that
  skill dir from the public repo).
- **First implementation chunk.** Add the three GPLv3 `LICENSE` files (or reword
  README — pick in Open questions); verify `agent-browser` NOTICE is preserved.

### Track E — Stranger-facing orientation & build-from-source path

- **What.** A top-level "what is this / should I use it / how do I build and run
  it from source" that isn't the contributor/agent-facing README, plus rewrite
  the box-owner "Five-minute start" to a from-source path (no tarball).
- **Why.** All docs are contributor/agent-facing; `callback-box/README.md:24`
  install path depends on a tarball the author hands out. A source-available repo
  needs an honest "clone, build, run a box locally" walkthrough.
- **Direction.** Extend the root `README.md` (already terse, good) with a short
  orientation + a from-source quickstart that resolves `callback-box` via the
  workspace, not npm. Keep it honest about pre-1.0 status.
- **First implementation chunk.** Write the from-source quickstart and verify it
  end-to-end on a clean clone (the `verify` discipline: actually run it).

### Track F — Provider-auth onboarding (Claude, OpenAI, STT/TTS)

- **What.** Make it possible for a stranger to supply their *own* Claude,
  OpenAI, and speech-provider credentials and have the box work — with clear
  errors when a credential is missing or wrong. This is distinct from the
  secret-*hygiene* Track A/B cover (not leaking the author's keys); it's whether
  a new operator can plug in theirs at all.
- **Why this needs to change.** Today the credential surface is
  under-exercised and hand-edited:
  - **Claude auth is subscription/OAuth-only by deliberate design.**
    `ANTHROPIC_API_KEY` is force-deleted at `src/cli/bootstrap.ts:27` (*"Force
    Claude … to use subscription auth, never an API key"*) and again at
    `src/core/script-env.ts:103`; the Agent SDK reads the ambient `~/.claude/`
    login (`src/hub/child-env.ts`). A self-hoster who has an Anthropic **API
    key but no Claude subscription cannot run a box** — and nothing says so.
  - **No failure guidance in the run path.** A missing/expired `~/.claude/`
    session surfaces as an opaque `success:false` from the SDK stream
    (`src/core/agent/run.ts:100-146`) — no "run `claude auth login`" hint. The
    only proactive check is a health probe that is **skipped on macOS**
    (`src/webapp/trpc/routers/health.ts`), so local dev gets no signal at all.
    Real auth is never exercised in tests — everything runs on
    `createFakeClaudeCli` / `createFakeChatBackend`.
  - **STT/TTS/OpenAI keys are inconsistent and template-less.** OpenAI is
    env-only (`THINKING_OPENAI_API_KEY`, read at
    `src/webapp/routes/chat-audio-routes.ts:129`, `src/core/transcription/index.ts:254`);
    Deepgram/Mistral are secret-file-or-env (`src/core/deepgram-key.ts:22`,
    `src/core/mistral-key.ts:11`). There is **no `.env.example`, no
    `*.secret.json.example`**, no admin UI for any of them, and validation only
    fires as a runtime 502 at point-of-use — unlike Telegram, which validates a
    token and writes its secret file at `src/webapp/trpc/routers/admin.ts:60-78`.
- **Direction.** Three pieces, each independently shippable:
  1. **Fix the Claude-auth surface.** Two parts, both decided:
     - *Document + preflight.* State the auth model loudly and add a preflight
       credential check with an actionable error (*"not logged in — run `claude
       auth login`, or configure an API key"*) in the run path; fix the
       macOS-skipped health probe so local dev gets a signal. **Implemented
       (preflight + health half) by `docs/plans/installation-story.md` Track B
       (B2)** — the run-path preflight and un-skipped `claude auth status` health
       probe landed there; only the explicit-config API-key path below remains.
     - *Explicit-config API key (decided this session).* Keep force-stripping the
       **ambient** `ANTHROPIC_API_KEY` (`bootstrap.ts:27`, `script-env.ts:103`) —
       never inherit it from the environment; that's the bill-safety guarantee.
       Honor a key the operator has **explicitly configured** as an alternative
       to subscription auth. **Mechanism matters here** (research finding): the
       Agent SDK *forcibly* grabs an ambient `ANTHROPIC_API_KEY`, even from a
       `.env` in cwd (Claude Code issue #12047), which is *why* the box strips it
       today. So "honor a configured key" cannot mean "set the env var from
       config" — that re-opens the exact ambient-pickup bill risk. It must mean:
       spawn the Agent SDK child with `ANTHROPIC_API_KEY` scrubbed from its env
       (keep), then inject the configured key through the SDK's **explicit**
       credential path (constructor `apiKey` option / `apiKeyHelper` writing to a
       temp file the child reads then deletes — the precedented pattern from
       #10211). Invariant: ambient env key never reaches the SDK; a
       deliberately-set config key does, and only via the explicit path. Its own
       commit, with a test proving an ambient `ANTHROPIC_API_KEY` is stripped
       while a configured one reaches the SDK.
  2. **Ship credential templates** — `.env.example` enumerating every provider
     env var (currently only discoverable as commented lines in
     `deploy/setup-server.sh:120-125`) and `*.secret.json.example` files for the
     file-based connectors, wired into what `cb init` scaffolds.
  3. **Unify the config story + validate-on-entry.** One documented place per
     provider, and a cheap authenticated probe at setup (research-sourced):
     Anthropic → `POST /v1/messages/count_tokens` (free, 401 on bad key — there's
     no authenticated `GET /v1/models`); OpenAI/Mistral → `GET /v1/models`;
     Deepgram → `GET /v1/auth/token`. Store a last-verified timestamp. This is
     the Telegram `getMe()`-then-persist pattern (`admin.ts:60-78`) generalized —
     a bad key fails at setup, not as a mid-call 502.
  4. **Credential storage** (research-informed — see Prior art). Lean: encrypt
     stored provider keys at rest with a master secret **auto-generated on first
     run** to a `0600` state file (the n8n / Open WebUI / Flowise model — one
     symmetric secret, libsodium `secretbox`), keeping unattended restart
     working. Offer plaintext-`0600` as an honestly-documented tier for operators
     who don't want a master secret, stated plainly (adjacent-key encryption
     defends a leaked backup, not root). OS keychains are out (headless-hostile);
     secret-manager sourcing (SOPS+age, `op read`) is an optional power-user path,
     not the default. This piece is the one that most wants the key-management
     subplan (see Open questions).
  5. **Cost guardrails** (the boxholder's "too easy to run up a bill" concern,
     as its own piece). Three cheap layers, none a proxy to run: (a) provider-
     native hard caps set *outside* the app so an agent bug can't disable them —
     route the Anthropic key through a *named workspace* with a monthly spend
     limit (429 on breach), same for Mistral; (b) tiny prepaid balances with
     auto-recharge OFF for OpenAI/Deepgram (their only true hard stop); (c) a
     thin in-app fail-closed USD meter — price each call (LiteLLM `completion_cost`
     / a cost map), decrement a per-day budget, refuse past threshold. Document
     (a)+(b) as operator setup; (c) is the box's own guard for its own call paths.
- **First implementation chunk.** The Claude-auth preflight check + actionable
  error in `agent-run.ts`, and the doc paragraph stating the subscription-only
  constraint (and how to configure a key instead). This is decision-complete and
  unblocks the honest onboarding doc in Track E; the templates, storage, cost
  guards, and admin-UI work follow (some gated on the key-management subplan).

## Subplans

- **`deploy-genericization.subplan.md` (candidate, not yet written).** Track C
  needs its own design step: what's the config mechanism (env vars vs. a values
  file vs. arguments), how does the author's live deployment keep working during
  and after the change (transition state), and does the public repo ship a
  worked example or just the parametrized skeleton. These are real decisions, not
  inline detail. The parent waits on this subplan before Track C code starts.

No other track needs a subplan — B, D, E, and Track F's first chunk are
decision-complete enough to start. The admin-UI / admin-chat piece of Track F is
still a shape question (see Open questions) and could grow its own subplan if it
survives triage.

## Failure modes

> **Critical gap:** an actual *secret* (live API key / token) sits undiscovered
> in git history. `.gitignore` prevents *new* commits of the known secret shapes,
> but nothing has scanned the *existing* history. If one is there and the repo
> goes public, it leaks silently and can't be un-published. This — not names or
> the boxholder email, which are acceptable per the history decision — is what
> gates the public push. Mitigation: Track A's secret scanner is the gate.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A live credential sits in old history and ships public | **Yes — Track A scan, CLEAN 2026-07-05** | `.gitignore` blocks *new* ones; the `.gitleaks.toml` gate scans old | **Cleared** — gitleaks + trufflehog(verified) found none |
| Deploy genericization breaks the author's live deployment | Partial (deploy is exercised on real deploys) | The author would notice on next deploy | Clear (deploy fails loudly) |
| PII-scrub name change breaks a doctest asserting the old name | Yes (the doctests themselves) | Re-run after swap — done, 6/6 green | Clear (test fails) |
| README license claim stays false after Track D wording drift | doc-check catches broken *links*, not false *claims* | No | Silent |
| `agent-browser` attribution dropped during repackaging | No | Manual (Track D checklist) | Silent (license non-compliance) |
| New operator's Claude session missing/expired; box appears broken | No (real auth untested) | None in run path; health probe skipped on macOS | Silent (opaque SDK error) |
| Operator's ambient `ANTHROPIC_API_KEY` silently drives up a bill | n/a | Ambient env key force-stripped by design (kept) | Prevented — intended behavior |
| Operator wants to use an API key instead of a subscription | No (config path not built yet) | Track F adds an explicit-config key path | Clear once Track F lands |
| Bad OpenAI/Deepgram/Mistral key | No | Runtime 502 at point-of-use only | Clear-but-late (fails mid-call, not at setup) |

The first row is the load-bearing one and is the Critical gap above. Mitigation:
Track A's secret scanner is the pre-public-push gate. The Claude/STT rows are
Track F's job — a preflight credential check turns the silent auth failures into
actionable "log in / add your key" errors.

## Agent-flow / user-flow edge cases

Most of the seven canonical cases assume new tags/cards/refs; this plan
introduces none, so they don't apply. The two that do:

- **Partial migration / transition state** — **ADDRESSED (deferred to subplan).**
  Track C changes the deploy config shape while the author's live deployment must
  keep working. The `deploy-genericization.subplan.md` owns this; it's the reason
  Track C can't start inline.
- **Hand-edit drift** — **ADDRESSED.** The genericized deploy ships a committed
  `.example` and a gitignored real values file, so the author's personal values
  live outside version control and can't drift back into the public repo.
- Wrong tag / stale ref / two-agent / fabricated value / validation UX — **GAP by
  irrelevance:** no card, tag, ref, or validation surface is added or changed by
  this plan. Stated explicitly rather than omitted.

## NOT in scope

- **npm publish / turnkey install.** Deferred: source-available first; a stranger
  builds from source. Publishing is its own release with versioning + distribution
  concerns (`docs/implemented-plans/boxes-as-packages-v2.md` is the roadmap). Doing
  it now adds features beyond the task (`CLAUDE.md` Behavioral Notes).
- **Hosted / multi-tenant service.** Deferred: largest scope (auth, ops, support);
  not part of a source drop.
- **History rewrite as a track.** Only triggered *if* Track A finds a committed
  secret (not merely a name) in deep history. Names get scrubbed in-tree; a full
  `git-filter-repo` rewrite is out of scope unless the sweep forces it.
- **Genericizing the personal dev harness** (`bin/router.ts`, `bin/workstreams`,
  `.claude/` hooks/agents/skills). These assume `~/src/...` and are the author's
  workflow. Ship as-is (they're honest personal tooling) — do not invest in making
  the worktree/router harness reusable. Revisit only if contributors ask.
- **CI, CONTRIBUTING.md, issue templates, code of conduct.** Community
  infrastructure is a fast-follow once the repo is public and clean; not a
  blocker for the source drop.
- **The conversational admin-chat.** Track F ships a plain admin key-management
  *section* (a form, following the Telegram validate-then-persist pattern). An
  agent-driven admin *chat* that walks an operator through auth conversationally
  is a separate, bigger shape deferred to its own subplan/issue (see Open
  questions). (Note: accepting an explicitly-configured Claude API key is *in*
  scope for Track F — only the conversational-chat surface is deferred.)

## Open design questions

- **Track C config mechanism** — env vars vs. a `deploy/values.local` file vs.
  script arguments. Lean: a gitignored values file with a committed `.example`,
  because it keeps the author's real domain/IP/user out of git while giving
  others a fill-in template. Settle in the subplan.
- **Track D: add three LICENSE files vs. reword the README claim.** RESOLVED
  (2026-07-05): reworded `README.md` to state GPLv3 covers callback-box/
  callback-clerk/browse and the two MIT packages each carry their own LICENSE —
  unambiguous, no duplicate GPL copies. `skill-creator/LICENSE.txt` read and
  cleared (Apache-2.0, © Anthropic PBC, GPLv3-compatible, ships as-is). Remaining
  Track D item: preserve `agent-browser`'s Apache NOTICE on repackage.
- **`.claude/skills/skill-creator/LICENSE.txt`** — RESOLVED (2026-07-05, read):
  Apache-2.0, © Anthropic PBC (Anthropic's own skill, bundled as-is). One-way
  compatible into GPLv3, no `NOTICE` file, unmodified — the `LICENSE.txt` next to
  it satisfies the only real obligation. Ships fine; no action.
- **Path leaks — FIXED (2026-07-05; reports KEPT).** Investigated and resolved.
  The ~168 `/Users/<user>/...` leaks were almost entirely *generated
  artifacts*, not source (`src/schemas/extfile.tsx` uses `me`/`you` placeholders
  on purpose). Fixes applied:
  - **Reports kept, paths relativized.** Stripped the
    `/Users/<user>/src/callback-worktrees/<wt>/callback-box/` prefix in
    `user-stories-audit-2026-06-26.md` and `research/…/deep-cbx-search.md` →
    monorepo-relative `callback-box/...`.
  - **doc-graph generator fixed at the source.** `doc-graph.md` only *quoted* the
    report (fixed by relativizing the report + regen). But `doc-graph.html` had a
    real generator bug: `doc-graph-html-render.ts` built `vscode://file` chip
    links from the absolute `ROOT`, so **every regen re-embedded the home path**.
    Changed `vsLink` to emit a repo-relative path; regenerated — clean.
    Trade-off: the `vscode://file` click-to-open needs an absolute path, so the
    committed HTML's links no longer launch the editor (a local regen restores
    that). Alternative if that's unwanted: gitignore `doc-graph.html` and
    regenerate locally — boxholder's call.
  - **Answer to "will future reports auto-include full paths?"** The *committed
    generators* are now clean (doc-graph-html fixed; doc-graph.md/doc-check only
    quote content). The user-stories audit itself came from an **ad-hoc
    multi-agent workflow with no committed generator**, so the only recurrence
    risk is a future such workflow — file a note that report-generating workflows
    must instruct agents to emit repo-relative paths (`bin/browse`/file reads
    return absolute).
  - Still open: whether `research/` and `notes/vision/` ship (lean: keep `issues/`).
- **A tracked `settings.local.json` leaked a home path — FIXED (2026-07-05).**
  `personal-vibe-check/.claude/settings.local.json` was committed (against this
  package's own commit-hygiene rule) with the stale `/Users/<user>/src/personal-vibe-check`
  path in Bash permission entries. `git rm --cached`'d it; the existing
  `.claude/settings.local.json` ignore rule now covers it. It's still on disk
  locally, just untracked.
- **Track F: key-management mechanism (researched; lean recorded).** The
  ambient-vs-configured Claude-key policy is decided; the storage/cost design is
  now research-informed (see Prior art) with a lean: auto-generated `0600` master
  secret + libsodium `secretbox` for encrypt-at-rest, plaintext-`0600` as an
  honest documented tier, per-provider validation probes, and layered cost guards
  (native caps + prepaid balances + a thin in-app meter). What's *not* settled
  and wants a subplan: whether v1 ships encryption at all vs. plaintext-`0600`
  first; where the in-app USD meter hooks into the existing call paths; and
  whether cost-guard setup is docs-only or enforced. Boxholder's call on how much
  of this lands in the source-available cut vs. a fast-follow.
- **Track F: admin key-management UI, and the "admin chat" idea.** The
  `AdminPage` already has a working Claude OAuth section
  (`src/frontend/src/components/admin/ClaudeCodeSection.tsx` +
  `admin.claudeStatus/Login/Logout`), and the Telegram flow
  (`admin.ts:60-78`) is a proven "validate a key, then persist a secret file"
  template a new OpenAI/Deepgram/Mistral section could copy directly — low-risk,
  fits the existing architecture. The boxholder's larger idea — *a scratch,
  isolated admin chat that handles auth/key setup conversationally* (an agent
  that walks a new operator through plugging in providers) — is a bigger,
  separate shape: it's an agent surface, not a form, and would need its own
  design (what context it has, how it writes secrets safely, whether it's a
  distinct session from the normal chat). Lean: ship the plain admin **section**
  as the Track F onboarding UI; spin the **admin-chat** into its own subplan/
  issue if it survives triage — don't block the release on it.

## Knowledge audits

Skip with rationale: this plan is release-preparation and introduces no
agent-facing concept (no new tag, card shape, convention, or "how you do X"
rule) that an agent would need to recall from CLAUDE.md. The one convention it
*enforces* — generic-names — already exists (`CLAUDE.md:103`) and is not new. No
new audit entries in `src/dev/knowledge-audits.yaml`.

## Implementation order

1. **Track A** real-secret scan — **DONE / CLEAN (2026-07-05).** gitleaks +
   trufflehog(verified) over full history + tree: 0 real credentials; only false
   positive (RFC 6455 WebSocket nonce) allowlisted in `.gitleaks.toml`. Gate passes.
2. **Track B** working-tree PII scrub — **DONE this session** (name/email → roster,
   doctest green; `settings.local.json` untracked). Remaining small cleanups:
   relativize the audit-report paths + regen `doc-graph`, and Track C's cheap half
   (strip the real IP + `box.example.com` source comments).
3. **Track D** licensing — README reword **done**; NOTICE-preservation + skill-creator read remain.
4. **Track F** provider-auth: Claude-auth preflight + doc + explicit-config key
   first (unblocks E), then validation probes + templates, then storage + cost
   guards (some gated on the key-management subplan), then the admin section.
5. **Track E** orientation + from-source quickstart, verified on a clean clone —
   lands last so it references the real Track F auth flow.
6. **Track C deploy genericization — deferred fast-follow.** Lowest priority;
   only when server self-hosting is a real need. Its subplan waits.

Decide before the push: whether `research/` and `notes/vision/` ship (reports stay).

The public push is a single final step after all tracks complete and the Track A
scan is clean — the plan ships as one unit (no partial public drop).

## Rollout shape

- **Test posture.** Two substantial new codepaths: the Track A scan and the Track
  C deploy config. Track A's scan *is* the test — encode "no known identifier
  resolves in tree or history" as a runnable check (grep/`git log -S` over the
  identifier list, non-zero hits = fail); this becomes the pre-publish gate.
  Track C's config change is exercised by an actual deploy (the author's next
  real deploy is the regression anchor) — name the assertion "author's live
  deploy still succeeds against the values file." Tracks B/D/E lean on existing
  doctests + `doc-check` + a clean-clone `verify` run, not new tests.
- **Knowledge-audit entries.** None (see above).
- **Migration.** Only Track C changes an existing shape (deploy config). The
  author's real values migrate into a gitignored values file; the transition is
  owned by the subplan and must keep the live deployment working — no partial
  migration that stops midway.
- **The ship signal is the boxholder's.** Per cb-plan discipline: the plan
  completing (all tracks + clean scan) does not itself make the repo public.
  Making it public is a separate, explicit boxholder action.
