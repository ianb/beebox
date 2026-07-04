# Boxes as Packages v2 — callback-box as a library

**Status:** Draft for review.
**Supersedes:** `docs/boxes-as-packages.md` (2025 design exploration). This plan re-derives that
design from the current codebase, corrects what has gone stale, and locks the decisions the
boxholder made on 2026-07-03. Companion working notes: `scratch/cb-as-library-fresh-design.md`
(independent re-derivation) and `scratch/cb-as-library-comparison.md` (reconciliation).

Each box becomes a Node package that depends on `callback-box` as a library — real imports,
real types, its own process — while the *operational* box (cards, config, runtime state) stays
a code-free directory that agents inhabit. A new hub process owns routing, auth, and per-box
supervision on multi-box hosts. The equally weighted goal alongside import hygiene: **a
stranger can start a box in minutes**, without this monorepo, Ian's server, or any of its
conventions.

## Decisions already made (boxholder, 2026-07-03)

These are inputs to this plan, not open questions:

1. **Layout** — the root for normal operations must be a single directory that does NOT
   contain `package.json`. Coding surfaces (package wrapper, `src/`) live above it.
2. **Distribution** — git/tarball channel first; npm publish is a deliberate later phase.
3. **Serving** — a parent process that does routing and authentication is an important,
   first-class component (not incidental nginx config). Isolation hardening (per-box OS
   users) can phase in later.
4. **Versioning** — per-box pinning is the mechanism; the fleet staying current is policy
   (fleet script). Reconciles the old plan's "hard fleet update" with per-box independence.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` ("Behavioral Notes"): *"Keep source and docs generic — never
  hardcode personal names. This is a generic tool; any box can be adopted by any user."* —
  the onboarding goal is this principle applied to infrastructure: today the *code* is
  generic but the *operations* are hardcoded to one person's machines.
- `callback-box/CLAUDE.md` ("Cards"): *"The filesystem is state, Git is history, the `cb` CLI
  is the universal interface."* — the operational root must stay a plain directory of cards;
  the package wrapper must not leak into it (hence decision 1).
- `docs/box-layout.md:139-143`: boxes contain no app code, no global secrets, no cross-box
  references. This plan relocates the box's *code* surfaces out of the operational root
  rather than adding more code into it.
- `callback-box/CODE-STYLE.md`: strict types, no `any`, custom error classes — the new
  public library surface is typed and versioned; failures during upgrade/hub supervision are
  logged, never silent (see Failure modes).
- Boxholder standing preferences: bias toward strict (fail-closed defaults), consolidate
  duplicates rather than preserve drift (migrate on-disk data), plan end-to-end rather than
  "ship a slice and see."
- Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — scaffold/upgrade commands
  must be quiet on success.

## What already exists

The architecture is already half library-shaped. Reuse dominates this plan; the load-bearing
existing pieces, and whether each is reused or replaced:

| Existing piece | Where | Reuse or replace |
|---|---|---|
| Public exports map (`.`, `./cards`, `./view-widgets`) | `package.json:7-11` | **Reuse and extend** — it is already the only surface box code imports (verified: no deep imports from `test1`) |
| `PACKAGE_ROOT` walk-up ("find package.json named callback-box") | `src/lib/package-root.ts:24-42` | **Reuse unchanged** — already resolves correctly when installed under `node_modules/callback-box` |
| Agent `cwd = boxRoot` (`cwd: options.cwd ?? options.boxRoot`) | `src/core/agent-run.ts:61` | **Reuse** — the operational root stays the agent's whole world |
| `.cb-box` marker + `findBoxRoot` upward search | `src/cli/lib/paths.ts:83-103` | **Reuse**, marker gains `shapeVersion` |
| Schema resolve-hook: *"Virtual parent URL at callback-box's package root (NOT inside node_modules). Rewriting a box schema's parentURL to this makes Node resolve bare deps (`zod`, `yaml`) from callback-box's node_modules AND self-references (`callback-box/cards`) via callback-box's own `exports` map."* | `src/schemas/registry.ts:129-139` | **Replace** with native resolution (box has real `node_modules`); keep during the transition window, delete in the final chunk |
| Keep-last-good schema loading (per-file failure falls back) | `src/schemas/registry.ts:347-353` | **Reuse** — survives the move to `src/schemas/` |
| View compiler: esbuild + browser shims (`window.__cbReact`, `__cbViewWidgets`) | `src/webapp/views/compiler.ts:44-108` | **Reuse the browser shims** (runtime React sharing is not a monorepo hack); **replace** the node-target resolution with native imports |
| View metadata: *"Extract metadata from view source via regex on export const declarations."* | `src/webapp/views/compiler.ts:115` | **Replace** — import the compiled module (node target) and read real exports |
| `cb migrate`: ordered registry, agent-procedure migrations with abort gates | `src/core/migrations.ts`, `docs/migrations.md` | **Reuse** — becomes one stage of `cb upgrade`; the fleet conversion itself ships as a migration |
| Template sync: *"When a template changes upstream, we want to push the new version into boxes — but only if the local copy hasn't been customised."* park-on-divergence + `boxOwnedFields` | `src/core/install-template-file.ts:1-30` | **Reuse** — the second stage of `cb upgrade` |
| `cb serve` box resolution: args → manifest (`~/.config/cb/boxes.json`) → cwd | `src/cli/commands/serve.ts:60-75` | **Replace** — standalone `cb serve` serves the current box; the manifest is retired in favor of hub config |
| Multi-box Fastify (per-box scope, per-box EventBus, webhooks outside auth) | `src/webapp/server.ts:126-133`, `src/webapp/server-box-scope.ts:200-213` | **Reuse internals**; the multi-box loop survives only behind the legacy escape hatch during transition |
| In-process Google OAuth gate + per-box `allowedEmails` ACL | `src/webapp/` auth preHandler, `deploy/README.md:144-173` | **Split**: login moves to the hub; the per-box ACL check stays in the box process |
| Dev router: lazy spawn, prefix routing, idle shutdown, WebSocket passthrough | `bin/router.ts:384-596` | **Reuse the shape** — the hub is its productization; the dev router itself stays monorepo-only |
| `cb init` (idempotent scaffold: dirs, templates, rules, skills, hooks, docs, search index) | `src/cli/commands/init.ts:26-160` | **Reuse** — remains the idempotent step after package scaffolding |
| Session/env plumbing: `buildScriptEnv` (`CB_BOX_ROOT`, `PATH` prepend) | `src/core/script-env.ts` | **Reuse**, paths updated for the new layout |
| `resolveClaudeCodeBinary()` (resolves SDK binary via `require.resolve`, not `$PATH`) | `src/core/sdk-binary-path.ts:56-64` | **Reuse**; verify under per-box `node_modules` topology (isolated pnpm layout) |
| Known drift: *"If you add, remove, or rename an entry here, also update: docs/box-layout.md … src/core/agent-guide/box-shape.ts … drift between them has caused confusion before."* | `src/cli/lib/paths.ts:16-22` | **Replace** — one exported box-shape spec generates all three |

## Prior art (external)

Searched during planning (2026-07-03). One-line findings; empty results stated as such.

- **pnpm `file:` vs `link:` vs `workspace:`** — `workspace:` refuses paths outside the
  workspace. `file:` on an external directory **hard-links** the package in and installs its
  deps — correct peer resolution but goes stale until reinstall. `link:` is a live symlink
  that never installs the target's deps. Cleanest dev redirect: `pnpm.overrides` with
  `"callback-box": "link:../…"` — revertible without touching `dependencies`
  (https://pnpm.io/cli/link, https://pnpm.io/faq, https://pnpm.io/package_json,
  https://github.com/pnpm/pnpm/issues/9527). Track G uses the override form for worktree
  boxes.
- **Git-URL deps and build steps** — lockfiles pin git deps to a commit SHA; npm runs a git
  dep's `prepare` (installing dev deps) to produce `dist/`, but pnpm has an **open regression**
  where a git dep's `prepare` output is silently missing (worked in pnpm 8.15.8:
  https://github.com/pnpm/pnpm/issues/8868). This decides the channel: prebuilt **tarballs**,
  not raw git refs — no install-time build to silently fail
  (https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).
- **`npm create` convention** — `npm create foo` runs the `create-foo` package's bin
  (https://docs.npmjs.com/cli/commands/npm-init). A future `create-callback-box` package is
  the npm-phase onboarding entry; the scaffold logic should live in callback-box now and get
  the thin `create-*` wrapper at publish time.
- **Forward-auth pattern** — oauth2-proxy with nginx `auth_request` is mature; identity
  reaches upstreams via `X-Auth-Request-Email` + explicit `auth_request_set` plumbing
  (https://oauth2-proxy.github.io/oauth2-proxy/configuration/integrations/nginx/). Caddy's
  `forward_auth` has a known WebSocket bug — WS upgrades are forwarded to the auth endpoint
  *as* upgrades, which auth services don't handle (https://github.com/caddyserver/caddy/issues/5430);
  callback-box is WebSocket-heavy. **Considered and not chosen** for the primary design: the
  boxholder wants the routing/auth parent to be a product component (box picker, discovery,
  supervision — Track D), the dev router already proves the Node-parent shape including WS
  prefix passthrough, and the Caddy WS gotcha shows how un-product-shaped the off-the-shelf
  path is for this traffic. oauth2-proxy remains the documented alternative for users who
  bring their own proxy.
- **Multiple versions of one package in one process** — Node resolves per-`node_modules`-path;
  two copies mean two module instances, broken `instanceof`, duplicated singletons. This is
  conventional wisdom (long-documented via React's "invalid hook call"/duplicate-React
  guidance, https://react.dev/warnings/invalid-hook-call-warning). Confirms per-box processes
  as the only sane multi-version story.
- **systemd template units** — `cb@<box>.service` per-instance units are the standard
  one-unit-per-tenant pattern (`man systemd.unit`, `%i` specifier). No surprises found.
- **App/content split prior art** — Ghost is the clean comparable: app code in the install
  dir, all mutable state under `content/` (relocatable via `contentPath`, must pre-exist
  with the expected layout — https://docs.ghost.org/config). n8n likewise: one app, data
  selected per-instance via `N8N_USER_FOLDER`
  (https://docs.n8n.io/hosting/configuration/configuration-examples/user-folder/). Both
  validate "operational root owned by the user, package owned by the tool," and Ghost's
  layout is why the operational root, not the package root, is the unit users back up.
- **`module.registerHooks`** — shipped stable in Node 22.15 as the durable synchronous
  successor to the now-deprecated async `module.register()` (DEP0205;
  https://nodejs.org/en/blog/release/v22.15.0,
  https://github.com/nodejs/node/issues/56241). No churn pressure on `registry.ts` — and
  moot regardless: this plan *deletes* the resolve hook at the end of the transition window.

## The target shape

### The box repository

```
<box-repo>/                        the package — coding surfaces live here
├── package.json                   { "dependencies": { "callback-box": "0.x.y" } }, private
├── pnpm-lock.yaml
├── tsconfig.json                  extends a base shipped by callback-box
├── node_modules/                  gitignored; pnpm store-linked
├── CLAUDE.md                      thin: "this is a box package; the box lives in data/"
├── src/
│   ├── schemas/                   moved from  data-root config/schemas/   (code)
│   ├── views/                     moved from  data-root views/            (code)
│   └── tricks/                    moved from  data-root tricks/           (code; keeps its
│                                   own nested package.json for agent-installed deps)
└── data/                          THE BOX — the operational root, no package.json inside
    ├── .cb-box                    marker, + "shapeVersion": 2
    ├── CLAUDE.md                  the operating agent's context (agent cwd = here)
    ├── .claude/                   rules, skills, memory symlink, settings
    ├── .callback-box/             runtime state (sqlite, logs, generated guide)
    ├── briefing.briefing.card, briefing.md, Box.landmark.card
    ├── box/  store/  config/  people/  places/  docs/  procedure/  tmp/
    └── ...                        everything a box is today, minus the three code dirs
```

- One git repository at the repo root (the box's existing history, paths moved with `git mv`).
- `boxRoot` (everywhere in the engine) = the `data/` directory. `findBoxRoot` still finds it
  by `.cb-box`. A new `boxPackageRoot(boxRoot)` = its parent when `../package.json` declares
  a `callback-box` dependency; a legacy (unconverted) box has `boxPackageRoot === boxRoot`
  minus the code dirs — this one predicate is the entire bilingual-transition switch.
- **Why box-relative paths don't change:** URLs (`/<slug>/browse/<path>`), card refs, agent
  prompts, and git trailers are all box-root-relative today; since `boxRoot` moves *with* the
  content, every relative path is untouched. Only the code dirs move, and their consumers
  (schema registry, view compiler, trick runner) are engine code updated in this plan.
- `config/schemas/` → `src/schemas/`: schemas are code and belong with code. This also
  delivers the "flatter" instinct from decision 1 — `config/` stays in the operational root
  because everything left in it (connectors, guides, procedures, schedules, box.json) is
  operational data, not code.
- Two CLAUDE.md personas fall out naturally: the *operating agent* (cwd `data/`) never sees
  the package machinery; a *coding session* opened at the repo root gets a thin CLAUDE.md
  pointing at `src/` and the library docs.

### The library surface

`callback-box`'s exports map is the API boundary — everything reachable is supported,
everything else is internal:

```jsonc
"exports": {
  ".":               // cb programmatic entry (today: dist/cli/index.js)
  "./cards":         // cardSchema, body, splitCardContent — exists today
  "./view-widgets":  // CardLink, CardRef — exists today
  "./schema":        // NEW: re-exports z (zod) and yaml, pinned to engine versions
  "./server":        // NEW: createServer/startServer(boxes) — exists as code (server.ts:40),
                     //      needs exporting for the hub and embedders
  "./tsconfig.base.json": // NEW: the base tsconfig boxes extend
}
```

Box `src/` code imports only these. `zod`/`yaml` via `callback-box/schema` keeps a box's
dependency list to exactly one entry and pins validator versions to what the engine runs
(consolidation over drift). Types ship with the package (the box tsconfig gives agents real
LSP/typecheck — today *"the view doesn't compile, but its metadata is regex-extracted"*
(`compiler.ts:284`) is the only feedback).

### Serving

- **`cb serve` inside a box** = the standalone default: one process, one box, in-process
  auth exactly as today (Google OAuth when configured, open on localhost). This is the
  stranger's whole story: scaffold → `cb serve` → browser. No hub, no proxy, no manifest.
- **`cb hub`** = the multi-box parent (decision 3). Productizes the dev-router shape
  (`bin/router.ts` already does lazy spawn, prefix routing, WebSocket passthrough, idle
  shutdown, PID hygiene):
  - Config file (`hub.json`: slug → box-repo path, plus login config) replaces
    `~/.config/cb/boxes.json`.
  - Spawns each box's server via **that box's own** `node_modules/.bin/cb serve` — per-box
    engine versions, ports/sockets assigned by the hub.
  - Terminates login (the OAuth gate extracted from the box server), injects
    `X-CB-Authenticated-Email` to children over loopback/socket; each box keeps its own
    `allowedEmails` ACL check (auth is shared, authorization is per-box).
  - Serves the box-picker at `/`, health at `/healthz`, restarts crashed children with
    backoff, exposes per-box status.
  - TLS stays in front (nginx/Caddy pass-through) — the hub is not a TLS terminator.
- The legacy multi-box `cb serve <dir>...` form survives the transition window only, then is
  removed along with the manifest.

### Upgrade lifecycle (decision 4)

`cb upgrade [--to <version>]`, run at the box repo root:

1. Bump the `callback-box` dependency; `pnpm install`.
2. `cb migrate` — data migrations from the ordered registry (exists).
3. Template sync — park-on-divergence machinery (exists).
4. Regenerate rules, skills, generated docs, search index (the tail of `cb init`, exists).
5. Typecheck the box's `src/` (new, cheap, catches library-surface breaks).
6. Commit with trailer `Upgraded-To: callback-box@x.y.z`; on any failure, revert the bump,
   reinstall the previous version, log to `.callback-box/logs/upgrade.log`, exit nonzero.

`cb fleet upgrade` (server-side script) walks the hub config, runs `cb upgrade` per box,
smoke-tests (service restart + `/healthz` within 10s), reverts on failure and records the
laggard. `cb status` and `/healthz` surface "engine N versions behind" the way parked
template updates surface today. Pinning is the mechanism; fleet-current is the policy.

### Distribution (decision 2)

- **Now:** release = build (`build-cli` + frontend) → pack a tarball with `dist/` included →
  host it (server path or GitHub release). Boxes depend on the tarball URL; lockfiles pin
  its integrity hash. No install-time build, no registry dependency.
- **Later (separate plan):** npm publish + `create-callback-box`. The exports surface and
  scaffold are built now so that phase is only publishing mechanics.

## Tracks

Ordered by implementation dependency, then size.

### Track A — Library surface
**What:** Extend the exports map (`./schema`, `./server`, base tsconfig), ship types, audit
that nothing internal leaks, document the surface.
**Why:** The boundary must exist before anything can consume it; today box code compiles
against the surface only via the resolve-hook/shim fakery.
**Direction:** as in "The library surface" above. `./schema` re-exports `z` and `yaml`;
`./server` exports the existing `createServer`/`startServer` (`src/webapp/server.ts:40`,
already side-effect-free by design — `server-main.ts` exists precisely so importing the
server has no side effects).
**First chunk:** add the three export entries + type shipping; a doctest that imports each
export the way box code will and exercises one symbol from each.

### Track B — Box package contract
**What:** The repo layout above; `cb init` learns to scaffold the wrapper (package.json,
tsconfig extending the base, thin root CLAUDE.md, `src/`); `.cb-box` gains `shapeVersion: 2`;
`boxPackageRoot()` predicate; the box-shape spec becomes one exported data structure that
generates `BOX_DIRS` consumers, `docs/box-layout.md`'s table, and `agent-guide/box-shape.ts`.
**Why:** Decision 1; and the shape-spec drift is documented in the code itself
(`paths.ts:16-22`).
**First chunk:** `boxPackageRoot()` + `shapeVersion` detection with doctests covering legacy
and v2 layouts (the bilingual switch lands before anything depends on it).

### Track C — Loaders on native resolution
**What:** Schema registry reads `src/schemas/` (v2) or `config/schemas/` (legacy); native
import resolution for v2 (no resolve hook); view compiler node-target uses real resolution;
view metadata read from the imported compiled module instead of regex; tricks unchanged
except path. Stance B editing model formalized: views/schemas/tricks are the hot-reload
surface (chokidar watcher already exists for schemas — `src/core/schema-watcher.ts`);
`package.json`/`src` beyond that surface is off-limits to the operating agent, stated in the
agent guide.
**Why:** This is the "clarifying imports" heart — the old plan's pain points #1–#4.
**First chunk:** v2 branch of `loadBoxSchemas` with native import + keep-last-good retained,
doctested against a fixture v2 box.

### Track D — The hub
**What:** `cb hub`: config, child supervision (spawn per-box `cb serve` via the box's own
bin), prefix routing + WebSocket passthrough, login extraction + trusted header, per-box ACL
retained in children, box picker, health, crash backoff.
**Why:** Decision 3; per-box engine versions require per-box processes; login can't live in N
per-box processes.
**Direction:** Start from the dev router's mechanics but as engine code with tests, not a
monorepo script. The auth split is the delicate part: the box server keeps its full
in-process auth for standalone mode and trusts `X-CB-Authenticated-Email` *only* when started
in hub mode (explicit flag/env — fail closed, never trust the header by default).
**First chunk:** hub config + spawn/route/health for one child, no auth changes yet
(children still do their own auth behind the hub, which works because auth is
cookie-per-domain — this is exactly today's behavior via the dev router).

### Track E — Upgrade lifecycle
**What:** `cb upgrade` verb composing the existing ledgers; `cb fleet upgrade`; version-lag
surfacing in `cb status`/`/healthz`.
**Why:** Decision 4; per-box pinning without a first-class upgrade verb rots.
**First chunk:** `cb upgrade` happy path + revert-on-failure, doctested with a fixture box
and two local tarball "versions".

### Track F — Distribution channel
**What:** Release script: build → pack tarball (dist + frontend dist included) → host;
box scaffold points at the channel; document the release ritual.
**Why:** Decision 2; boxes need something to pin before the fleet can convert.
**First chunk:** `scripts/release.ts` producing an installable tarball; a doctest-adjacent
smoke script that scaffolds a fresh box against it in a temp dir and boots it.

### Track G — Dev loop
**What:** Monorepo router spawns per-box `cb serve` (v2-aware) instead of passing box paths
to a shared `server-main`; worktree box clones get a `pnpm.overrides` `link:` redirect to their
sibling engine worktree (WorktreeCreate hook update); `.claude/memory` symlink re-pointing
(see Failure modes — the Claude Code project key changes when the agent cwd moves to
`data/`).
**Why:** Engine development against live boxes must stay zero-ceremony (edit → next request).
**First chunk:** router change behind a v2-detection branch so main keeps working mid-plan.

### Track H — Fleet migration
**What:** A standard migration `box-packageify` (registry entry + script): `git mv` code dirs
into `src/`, everything else into `data/`, write wrapper files, re-point memory symlink,
`pnpm install`, `cb init`, commit. Then per-box server conversion (hub config entry +
`cb@<box>.service`), canary first (`hearth-test`), `test1` second, then the rest.
Deletions at the end: resolve hook, `boxes.json` manifest + `cb boxes`, multi-box serve path,
rsync deploy of the engine (replaced by release + `cb fleet upgrade`), hardcoded
`~/src/boxes` paths in engine source (`src/scenario/loader.ts:16`, `src/dev/csp-report.ts:43`,
`src/cli/commands/scenario.ts:15`).
**Why:** All boxes live on this laptop or box.example.com and are available for migration;
the top priority is the good end-state, not legacy accommodation.
**First chunk:** the `box-packageify` migration script, exercised on a scratch clone of
`test1`.

## Subplans

- **Per-box OS users / socket permissions / secrets split** (`box-user-account-spec.md`
  revisit) — deferred hardening phase per decision 3. It has its own decisions (UID ranges,
  credential sharing, egress) and does not gate anything here. To be planned when the fleet
  is converted and the hub is stable.
- **npm publish + `create-callback-box`** — the "later" of decision 2. Publishing cadence,
  semver policy, and the create-package are their own small plan once the surface has
  soaked.

## Failure modes

> **Critical gap (accepted as documented risk):** during a box's cutover, the old shared
> `cb serve` and the new per-box process must never both serve the same box — two engines on
> one `events.db`/chat runtime. Handling: the conversion runbook makes hub-route flip and
> shared-process box-removal one step; no code-level guard planned. Accepted because the
> window is operator-driven, per-box, and short — but it is listed here, not hidden.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `pnpm install` fails mid-`cb upgrade` (network, bad tarball) | planned (Track E chunk) | revert bump + reinstall previous + nonzero exit | clear (log + exit code) |
| Box `src/schemas` file throws on import after upgrade | exists pattern (`registry.ts:347-353` keep-last-good) | keep-last-good + lint surfacing | clear |
| Hub child crash-loops (bad box, port conflict) | planned (Track D) | restart with backoff, box marked unhealthy in picker/healthz | clear |
| Box process trusts identity header outside hub mode (spoofable) | planned (Track D chunk: header rejected unless hub-mode flag) | fail closed by default | clear |
| `.claude/memory` symlink breaks on migration (Claude Code keys project dirs by cwd path; cwd moves from `<repo>` to `<repo>/data`) | planned (Track H script test) | migration re-links and moves the old project memory dir | clear if handled; **silent memory loss if forgotten** — hence in the migration script, not the runbook |
| Legacy box (no wrapper) hits v2-only engine after transition window | planned | `cb` refuses with "run box-packageify" error, not misbehavior | clear |
| Tarball channel URL unreachable at `pnpm install` on server | no (operational) | lockfile-pinned integrity; install fails loudly | clear |
| Regex→real-import metadata change: a view module with top-level side effects now executes at list time | planned (Track C) | node-target import in a subprocess with timeout (same isolation stance as tricks) | clear |
| Worktree hook still cloning boxes with old layout mid-plan | n/a (dev-only) | router/hook v2-detection branch (Track G) | clear |
| Fleet upgrade leaves a box reverted and nobody notices | planned (Track E) | version-lag in `cb status`/`/healthz`, same surfacing as parked templates | clear |

## Agent-flow / user-flow edge cases

- **Wrong location for new code** (agent writes a schema into `data/config/schemas/` out of
  habit) — **ADDRESSED**: legacy path absent in v2 boxes; `cb validate` + generated
  `.claude/rules` and the schemas/views CLAUDE.md scaffolds point at `src/`; knowledge audit
  below verifies recall.
- **Stale ref** — **ADDRESSED** by design: box-root-relative paths are unchanged (boxRoot
  moves with the content), so no new staleness class is introduced.
- **Two agents touching the same card** — unchanged by this plan; existing behavior. **NOT
  IN SCOPE** (no new concurrent surface is added; the hub serializes nothing new).
- **Hand-edit drift** (boxholder edits `package.json` by hand, breaks install) — **ADDRESSED**:
  `cb upgrade`/`cb serve` fail loudly with the pnpm error; `cb status` shows install state.
- **Fabricated free-form value** — n/a: this plan adds no free-form agent-authored fields.
- **Validation error UX** — **ADDRESSED**: schema load failures keep-last-good and surface in
  lint output as today (`registry.ts:347-353`); box typecheck errors read as normal tsc
  output in the coding persona.
- **Partial migration / transition state** — **ADDRESSED**: `boxPackageRoot()` +
  `shapeVersion` is the single bilingual predicate; engine supports both layouts until Track
  H's deletion chunk; the old plan's shared-process server keeps serving unconverted boxes
  during the window.
- **Operating agent tries to edit the package surface** (Stance B boundary) — **ADDRESSED**
  in Track C (agent-guide statement + rules); `cb deps add`-style verbs **DEFERRED** (see
  Open questions).

## NOT in scope

- **npm publish / `create-callback-box`** — decision 2 says later; separate small plan.
- **Per-box OS users, unix-socket permissions, per-box `.env` split** — hardening subplan
  after conversion; the hub gives process isolation now, user isolation later.
- **Subdomains per box** — the old plan's deferral stands: breaks URLs/webhooks/OAuth
  callbacks, needs wildcard TLS; path prefixes preserved.
- **Containers/namespaces** — threat model doesn't require them (single operator).
- **Cross-box features** — boxes stay self-contained (`docs/box-layout.md:139-143`).
- **Sharing plugin packages between boxes** (`pnpm add some-box-plugin`) — the layout enables
  it; building any actual shared package is not this plan.
- **Rewriting the browser-side React/view-widgets shims** — they are the correct runtime
  sharing mechanism, not debt.
- **`callback-clerk`, `agent-doctest` packaging** — untouched; only callback-box becomes a
  consumable library.

## Open design questions

- **Name of the operational directory** — `data/` is the working name; candidates: `data/`,
  `box/` (collides with the inner `box/` dir), `desk/`. Lean: `data/` (boring, honest,
  matches Ghost's `content/` precedent). Decide before Track B's scaffold chunk.
- **Does `docs/` stay in the operational root or split?** Box docs are agent/boxholder
  content → lean: stays in `data/`.
- **`cb deps add` verb for agent-driven dependency additions** (Stance B relief valve) —
  lean: defer until an agent actually needs a dep beyond `callback-box`; tricks already have
  their own escape hatch.
- **Hub idle-shutdown** — the dev router idles boxes out after 5 min; should the production
  hub? Lean: no (schedulers/webhooks want the process resident), but keep the code path for
  memory-constrained hosts.
- **Where the hub lives** — `cb hub` inside callback-box (lean: yes, one package; the hub
  pins its own engine version independently of the boxes it supervises) vs. a separate
  package.

## Knowledge audits

New agent-facing concepts → `src/dev/knowledge-audits.yaml` entries, landed *run* with Track
H:

- `knows_directly`: "Where do box-local card schemas live, and what do they import?"
  (expect: `src/schemas/` at the package root, importing `callback-box/cards` /
  `callback-box/schema`).
- `knows_directly`: "You want to add a custom view. Where does the file go and what may it
  import?" (expect: `src/views/`, the exports surface, hot-reload — no restart needed).
- `knows_directly`: "What parts of the box repository are off-limits to you during normal
  operation?" (expect: `package.json`, `node_modules`, `src/` outside views/schemas/tricks —
  Stance B).
- `knows_directly`: "How does the boxholder upgrade this box's engine?" (expect: `cb upgrade`;
  agent should not attempt it unprompted).

Skip-with-rationale: hub configuration and fleet upgrade get no audits — they are operator
surfaces, never in an operating agent's context.

## Implementation order

1. **A1** exports surface + types (+ doctest). Unblocks everything.
2. **B1** `boxPackageRoot()` + `shapeVersion` bilingual predicate (+ doctests).
3. **B2** scaffold: `cb init` writes the wrapper for new boxes; box-shape spec consolidation.
4. **C1** schema loading v2 (native resolution), **C2** views (native node-target +
   real-import metadata), **C3** agent-guide/rules for the editing model. Depends on A1+B1.
5. **F1** release script + tarball channel; smoke: fresh scaffold in a temp dir boots.
6. **E1** `cb upgrade` (+ revert path), **E2** version-lag surfacing.
7. **D1** hub spawn/route/health, **D2** login extraction + trusted-header mode, **D3** box
   picker. D1 depends on nothing above (can parallel A–C); D2 depends on D1.
8. **G1** dev router v2 branch + worktree hook update. Depends on B2, C1.
9. **H1** `box-packageify` migration script (scratch-clone tested), **H2** laptop fleet
   conversion, **H3** server conversion (canary → `test1` → rest; hub replaces
   `callback-serve`; runbook step for the critical-gap cutover), **H4** deletions (resolve
   hook, manifest, multi-box serve, rsync deploy, hardcoded paths), **H5** knowledge audits
   run, docs rewrite (`adding-a-box.md`, `deploy/README.md`, a real `README.md` with the
   stranger's five-minute path).

Each numbered item is a commit-sized chunk on this worktree; the plan ships as one unit when
H5 completes. No merge to main without the boxholder's explicit go.

## Rollout shape

- **Tests first, as design tools:** the bilingual predicate (B1), v2 schema loading (C1),
  upgrade-with-revert (E1), and hub routing/health (D1) each get their doctest named in
  their chunk above — written when the chunk starts, not after. The done-when of the plan is
  encoded as: fresh-scaffold smoke boots (F1), all doctests green, `test1` converted and
  serving via hub with all existing doctests still green.
- **Knowledge audits:** the four entries above land run in H5; statuses recorded in
  `knowledge-audits.yaml`.
- **Migration:** scripted (`box-packageify` as a registry migration), per-box atomic (one
  commit per box), fleet-complete within the plan — a partially converted fleet is a
  transition state inside the plan, not an end state. Rollback per box: `git reset` to the
  pre-migration SHA + remove the migrations.jsonl line (`docs/migrations.md` rollback
  pattern), plus hub-route revert.
- **What the boxholder sees at the end:** every box a package pinning an engine version;
  `cb upgrade`/`cb fleet upgrade` as the update ritual replacing rsync-on-commit;
  box.example.com fronted by the hub; and a README whose first page works for someone who
  has never heard of this monorepo.
