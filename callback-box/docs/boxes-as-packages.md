# Design Exploration: Boxes as Code Repositories

**Status:** Draft for review.
**Author:** Conversation between Ian and Claude.
**Question:** Should a box be a code repository that consumes `callback-box` as a library, instead of a pure data repository operated on by an external `callback-box` install?
**Related:** [Box as Linux User Account spec](box-user-account-spec.md) — tightens this proposal by adopting the OS user account as the unit of box identity.

---

## 1. Why this is on the table

The system's central premise is that agents author code as part of operating a box — views, schemas, custom handlers. Today the code-shaped parts have to pretend they aren't really code: the compiler is regex, imports are forbidden, metadata is parsed out of the source, and there's no toolchain inside the box. The workarounds are getting in the way of the premise.

**Primary driver — agents writing code without import tricks.** Concrete pain points:

1. **Views can't `import` anything for real.** `src/webapp/views/compiler.ts` runs each `.tsx` through esbuild with a custom plugin that resolves `react` to `window.__cbReact`. Metadata (`name`, `description`, `dependencies`, `modes`) is parsed by **regex** because the file is never loaded as a real module on the server. Anything other than React, Tailwind classes, and inline types is out of reach.
2. **Schemas are a stub package.** `config/schemas/package.json` is `{"type":"module"}` with no dependencies. To define a real schema the agent would want `import { z } from "zod"; import { element } from "cardworks";` — same as built-in schemas in `src/schemas/`. Today this works only by accident (transitive resolution from the callback-box install) and gives no IDE help inside the box.
3. **Tricks have a marker package.json with no toolchain.** `tricks/package.json` is `{"name":"tricks","private":true,"type":"module"}` — enough to get ESM resolution but no dependencies, no types, no tests.
4. **No type-checking inside the box.** An agent editing `views/todos.tsx` has no `tsc` to run. Errors surface only at view-render time in the browser. There is no IDE LSP because there's no `tsconfig.json` and no `node_modules`.
5. **No way to share customisations across boxes.** Two boxes that want the same custom view, schema, or connector copy files. There is no `pnpm install some-callback-plugin`.
6. **The "extension surface" is implicit and growing.** Views, schemas, tricks today; tomorrow probably custom connectors, custom procedure steps, custom inbox routers, custom command handlers. Each one re-invents its own loader.

**Secondary driver — isolation between coexisting boxes.** All boxes on a server share one Node process and one OS user. Box A's connector code can read Box B's `config/connectors/*.secret.json`. A buggy view, runaway agent, or hung connector affects every box. Network egress is uncapped per-box. Important on its own, but it wouldn't justify upending the deploy model. It's a co-benefit of the same architectural change that fixes #1–6.

Both drivers point in the same direction: each box should be a real Node package, with real imports, real toolchain, and a process boundary.

Counterweight to keep in mind: a box being "just a directory of cards" is part of the design. Cards-as-state, git-as-history, no app build, no install. Anything that breaks that property has to earn its keep — and the agent-authoring story is what earns it.

---

## 2. The three options

Three points on the spectrum, from least to most disruptive.

### Option A — Status quo, better shims

Keep the box as data. Improve the loaders so authoring hurts less:

- Replace the regex meta-extractor with a real ESM `import()` of the compiled view module so `name`/`description`/etc. come from actual exports.
- Drop the `window.__cbReact` shim by building views with a real React import that callback-box's frontend bundler dedupes.
- Generate a `tsconfig.json` + `box-types.d.ts` into each box on `cb init` so an IDE opening the box gets `ViewProps`, schema helpers, etc. — without an actual `node_modules`.
- Pre-install a single shared `node_modules` somewhere (e.g. `~/.callback-box/node_modules` or symlinked into each box) so `import "react"` and `import "zod"` resolve.

**What it doesn't fix:** sharing customisations across boxes, version pinning per box, real `npm test` inside a box, custom connectors as packages.

### Option B — Hybrid: a `plugins/` package inside the box

Carve out a single subdirectory of the box that is a real Node package, leave the rest as data.

```
<box>/
├── box/                    data (unchanged)
├── store/                  data (unchanged)
├── config/                 config files, no code (unchanged)
├── plugins/                ← real Node package
│   ├── package.json        depends on callback-box, react, zod, cardworks
│   ├── tsconfig.json
│   ├── node_modules/       gitignored
│   ├── views/              moved from <box>/views/
│   ├── schemas/            moved from <box>/config/schemas/
│   ├── tricks/             moved from <box>/tricks/
│   └── connectors/         new: custom connectors
└── ... (cards, etc.)
```

The callback-box server, when serving a box, looks at `<box>/plugins/package.json`, runs `npm install` if needed, and loads modules normally. The view compiler becomes "import the module," not "esbuild + regex." Schemas register through a real import. Custom connectors get a published surface (`registerConnector`).

Boxes with no customisations don't have a `plugins/` directory and pay nothing.

**What this preserves:** boxes are still primarily data; the code surface is one carved-out subdirectory; one callback-box version still serves all boxes (the package.json depends on `callback-box` but is satisfied by the parent install or a peer-resolved symlink).

**What it costs:** there's now a `node_modules/` (or symlink) inside the box working tree; agents authoring plugins need to think about `npm install` after editing `package.json`; the loader has a new failure mode (install failed, version mismatch).

### Option C — Boxes are full code repositories

The box repo *is* the package. `package.json` at the root, depends on `callback-box`. The box owns its own `cb` binary via `node_modules/.bin/cb`. The repo has two clean halves: code in `src/`, the actual box (cards, configs, runtime state) in `data/`.

```
<box-repo>/
├── package.json            "callback-box": "*"  (see §7.2 on update policy)
├── tsconfig.json
├── pnpm-lock.yaml
├── node_modules/
├── src/                    custom code — views, schemas, connectors, tricks
│   ├── views/
│   ├── schemas/
│   ├── tricks/
│   └── connectors/
└── data/                   the box itself — code-free
    ├── .cb-box             marker file
    ├── box/, store/, config/, people/, procedure/, ...
    ├── .callback-box/      runtime state, sqlite, logs
    └── .git/ ... or shares the outer repo's git
```

The `data/` half is what the box *was* before — a code-free location with cards, attachments, configuration, runtime state. The repo root adds the package wrapper and the `src/` tree for custom code. An agent commit that adds `data/box/inbox/foo.memo.card` is purely data; an agent commit that adds `src/views/calendar.tsx` is code. The two stay visually separated.

Now `callback-box` is genuinely a library: it exports a `startServer(dataRoot)` API, schema helpers, connector base classes, view types. The box uses them like any other Node application.

**What this gives:**
- Real imports, real type-checking, real `pnpm test`, IDE LSP — the agent-authoring premise (§1) without workarounds.
- Sharing via packages — `pnpm add callback-box-plugin-recipes` becomes a real thing.
- Process boundary per box, OS-user enforcement (§3.1).
- Clean separation between code edits and data edits in commit history.

**What this costs:**
- Every box now has `package.json`, `tsconfig.json`, `node_modules`, lockfiles. The "git is the entire state" property dilutes — lockfile drift becomes a thing.
- Multiple callback-box versions running on the same server (production has many boxes). Each box runs in its own process; see §7 for the update policy.
- The current production model — one server process serving many boxes via `cb serve` and routing by URL prefix — gets replaced by per-box processes (more orchestration; moderate memory increase).
- Agents authoring inside a box are now editing a real codebase. The dev loop ("edit a card, see it on next wakeup") is no longer cleanly separated from the code loop ("edit a view, restart something, hope it builds"). The `src/` ↔ `data/` split makes this visible at the commit level but doesn't eliminate it.
- `cb init` becomes a scaffold (`pnpm create callback-box`); bootstrapping a new box is install-then-init instead of `mkdir && cb init`.

---

## 3. Cross-cutting concerns

Independent of which option, these have to be answered.

### 3.1 Isolation model (the load-bearing question)

The driver for separating boxes is **security/access scoping**: secrets, filesystem reach, and network egress should not commute between boxes that happen to share a server. Layers, in order of strength:

| Layer | What it gives | Cost |
|-------|---------------|------|
| Same process, different code paths | Convention only — no enforcement | Free, status quo |
| Per-box Node process | Crash isolation, memory isolation, separate event loops | Process orchestration; ~30–80MB resident per process |
| Per-box OS user | Filesystem permissions enforce secret/data scoping | User provisioning; UID/GID hygiene |
| Per-box namespaces / chroot / container | Network egress, mount isolation, kernel isolation | Container runtime, image build, deploy complexity |

Per-box Node process + per-box OS user is the sweet spot for the threat model implied by "don't let one box's compromised connector read another's Gmail token." Containers are stronger but the operational cost is real and probably premature unless the user expects to host other people's boxes.

Option A (status quo) cannot deliver any of these layers. Option B can if the server spawns per-box processes, but then most of the per-box-package machinery already exists. Option C delivers them naturally because the box is the unit of deployment.

### 3.2 Where does `node_modules` live?

- **Per-box `node_modules`:** required for Option C with per-box processes — each box resolves its own deps, can pin its own callback-box version, and the OS-user permission boundary covers `node_modules` along with the rest. Disk multiplies by `O(boxes)`, mitigable with `pnpm` and a shared content-addressed store. Production has a handful of boxes; not a scaling concern.
- **Shared at server level:** ruled out under Option C because it punctures the isolation boundary (one shared install, one shared package surface).
- **Per-box pnpm with shared store:** best of both — per-box `node_modules` symlinks into a single content-addressed store. Disk is near-free, isolation is preserved.

Recommendation under Option C: per-box install via `pnpm` (or `npm` with hard links), one store per server.

### 3.3 Who owns the `callback-box` version?

**Decision: hard fleet update, with per-box revert as the safety net. Not per-box pinning.**

The intent is that all boxes run the same callback-box version, and a library release rolls out to every box at once. Pinning isn't a feature — it's a consequence of a failed update being reverted. The flow:

1. A new callback-box version is published.
2. A fleet-update script bumps each box's `package.json` to the new version, runs `pnpm install`, runs a smoke test (typecheck + service starts + `/health` responds), and either:
   - **Pass:** commit the bump, restart the service with the new version.
   - **Fail:** revert the bump, restart with the previous version, log the failure for human follow-up.
3. A box that's been reverted ends up pinned to the previous version *until the underlying issue is fixed*. This is exceptional, not the steady state.

Why not real pinning:
- It tempts boxes to stay on stale versions indefinitely.
- It multiplies the test matrix (library × box versions).
- It hides bugs — a fix only lands when each box opts in.

Why a per-box revert is enough safety:
- Updates ship frequently; the gap between green and broken is small.
- A typecheck + boot smoke test catches the common failure modes.
- A reverted box is visibly stuck on a stale version, so the operator notices and fixes.

Implication: callback-box semver discipline is still important — but the threshold is "don't break the smoke test," not "don't break any box anywhere." Looser than a published-on-npm package, tighter than internal-only code.

### 3.4 Process model and routing

Today: one `cb serve` process, URL prefix `/<box>/...` routes inside that process.

Under Option C: each box is its own process (its own `cb serve` or programmatic equivalent), bound to its own port (or unix socket). A thin reverse proxy at the front (nginx, or a tiny dedicated router) maps `cb.example.org/<box>/...` to the right backend. Health checks and restarts are per-box. systemd unit per box, or a supervisor process that owns the lifecycle map.

Wakeups, schedulers, and connectors all run inside the per-box process. The shared scheduler (`cb tick`) becomes a per-box concern — each box ticks itself. Cross-box coordination disappears, which is the goal.

### 3.5 Authentication vs authorization

Authentication is shared across boxes (one user, one login, one session). Authorization is per-box (each box's `config/box.json` decides who can access it). This split has architectural consequences that didn't show up in §3.4.

**Login can't live inside a per-box process.** Each box implementing its own login flow gives the user N logins for N boxes — wrong shape — and per-box processes shouldn't each terminate sessions independently. Auth has to sit in front, in a server-level identity service that the reverse proxy delegates to. This is the standard oauth2-proxy / forward-auth pattern:

- Proxy receives request, checks session cookie.
- If unauthenticated, redirect to identity service (login form, OAuth, magic link).
- If authenticated, proxy injects a trusted header (`X-Authenticated-Email: …`) and forwards to the per-box backend.
- Per-box backend trusts the header *because* it only listens on a unix socket / localhost port the proxy can reach. It does its own ACL check against `config/box.json`'s `allowedEmails` and answers 403 if the email isn't on its list.

This means the supervisor/proxy story from §3.4 has a third component: **identity service**.

**Don't write our own — use oauth2-proxy.** Specifically designed for the forward-auth pattern, handles Google OAuth out of the box, mature cookie/session implementation, deployed as a single binary. Sits in front of nginx (or behind it as an `auth_request` target). Setting it up is a config file, not code.

Alternatives considered:
- **Authelia** — heavier; password DB, 2FA, MFA. More than needed for single-operator. Worth a look if multi-user requirements appear.
- **Authentik** — closer to enterprise SSO; overkill.
- **Caddy + caddy-auth-portal** — if we ever switched off nginx, plausible alternative.
- **Pocketbase / Lucia / better-auth** — application-level libraries; would mean writing the wrapper ourselves. Skip unless oauth2-proxy specifically doesn't fit.

What stays ours: the **box-picker page** (logged-in user lands on `/`, sees boxes they can access) and the **server-level allow-list** (which emails can log in at all). These are small and product-shaped enough to live in a tiny dedicated service that reads `getent passwd` / per-box `box.json` files to compute access.

**Discovery.** When a user lands on the root logged in, they should see the boxes they have access to. The supervisor reads each box's `config/box.json` (pull, with a watch) — simpler than having boxes push their ACL on startup, and tolerates restarts.

**Connector OAuth stays per-box.** Gmail / Calendar / Drive tokens are per-box-per-data-source and should not be shared between boxes. The proxy just routes `/<box>/oauth/callback` to the right backend; the box owns the secret. This is distinct from *login* OAuth (Google sign-in for the server itself), which lives in the identity service.

**Sessions span boxes.** Cookie is set on the parent domain. Logout logs you out everywhere. This is the desired property — one identity, many boxes.

### 3.6 Cardworks and the broader monorepo

Cardworks is already a package. Under Option C boxes depend on it directly *or* via callback-box re-export. Re-export is cleaner — `import { element, z } from "callback-box/schemas"` keeps the box's dependency surface narrow and lets callback-box control which cardworks features are stable for plugin authors.

### 3.7 Production deployment

Today: rsync the callback-box repo to `/opt/callback/`; one process, all boxes.

Under Option C:
- `cb provision-box` creates a per-box OS user (see `box-user-account-spec.md`), clones the box repo, runs `pnpm install`, installs a systemd `--user` unit, registers the nginx route.
- Upgrading callback-box is a **fleet operation** (see §3.3 and §7.2): a script walks every box, bumps its `package.json`, smoke-tests, and either commits the new version or reverts. The fleet step replaces today's rsync.
- Server-wide infrastructure changes (oauth2-proxy config, nginx, supervisor, the `cb` CLI scaffold) are a separate, smaller, less-frequent deploy.
- A new box per-deploy lifecycle on the server is `git pull && pnpm install && systemctl --user restart cb-server` — driven either by a post-receive hook on the box's bare repo, or by the fleet-update script when pushing a library bump.

This is a real production-shape change, not a small refactor. It's worth it because it solves the agent-authoring problem and gets isolation as a co-benefit.

### 3.8 Bootstrap and `cb init`

A new box becomes:
```
npx create-callback-box my-box
cd my-box && git init && pnpm install
```
The scaffold provides `package.json` (with `callback-box` pinned), `tsconfig.json`, the standard data directories (`box/`, `store/`, `config/`), an empty `src/` for custom code, and the `.cb-box` marker. `cb init` becomes the post-scaffold idempotent step that installs default cards, generates `agent-guide.md`, etc. — runnable as `npx cb init` against an existing checkout.

### 3.9 What about agents writing code?

Under Option C the agent inside a box is editing a real codebase, with the `src/` ↔ `data/` split making code edits visually distinct from content edits in commit history. The agent's editing model is one of two stances (see §7.4 for the trade-offs):

- **Stance B (recommended start):** the agent only edits hot-reloadable plugin types (views, schemas, tricks). No restart, ever. `package.json` and other source files are off-limits, or routed through specific `cb` commands.
- **Stance A:** the agent can edit anything in `src/`. Every change restarts the service (with revert on failure). More flexible, less robust.

Either way:
- `pnpm test` inside a box is meaningful — agents can write doctests for their plugins.
- `agent-guide.md` gets a new section explaining the package layout, the `src/` ↔ `data/` split, and the editing model.
- Install failures (Stance A) or off-limits edits (Stance B) need clean error paths — log to `data/.callback-box/logs/`, surface on the dashboard.

### 3.10 Migration

Existing boxes (`test1`, etc.) need a one-time conversion to the `src/` + `data/` layout:

1. Add `package.json`, `tsconfig.json`, `pnpm-lock.yaml` at the repo root.
2. Move existing box content into `data/`: `box/`, `store/`, `config/`, `people/`, `procedure/`, `.callback-box/`, etc., plus the `.cb-box` marker.
3. Move agent-authored code into `src/`: `views/` → `src/views/`, `config/schemas/` → `src/schemas/`, `tricks/` → `src/tricks/`.
4. Rewrite the few imports that relied on injected globals (`window.__cbReact` in views, transitive resolution in schemas).
5. `pnpm install` to materialise `node_modules` and the lockfile.
6. Provision an OS user (`cb provision-box`), register the systemd unit, switch the nginx route from "shared serve" to "per-box backend."

A migration script can do steps 1–5 mechanically; step 6 is the deploy ritual. Cutover is per-box: the legacy shared-process server keeps running for un-migrated boxes during the transition window.

---

## 4. Concrete: box.example.com

The actual production server, today and under Option C.

### 4.1 Today

- One Linux box, one IP, one nginx, TLS for `box.example.com`.
- One `callback` OS user owns everything in `/home/callback/`.
- Single Node process started with `cb serve <box1> <box2> ...`, listening on a backend port, fronted by nginx.
- 8 boxes currently mounted: `hearth`, `hearthside`, `ledger`, `hearth`, `hearth-test`, `scenarios`, `seminar`, `test1`. URL shape: `box.example.com/<box>/...`.
- Source code at `/opt/callback/{callback-box,cardworks}/` (root-owned, read-only to `callback`). Deploy is `rsync` from a laptop's working tree.
- Auth: in-process Google OAuth cookie gate. The gate sees an authenticated email and the per-box code checks `config/box.json`'s `allowedEmails`.
- Shared ambient state:
  - `/home/callback/.env` — every API key for every box and every connector.
  - `/home/callback/.claude/.credentials.json` — single Claude Code OAuth credential used by all boxes' agents.
  - One Node event loop, one process memory footprint, one crash domain.
- Per-box state, already isolated on disk:
  - `/home/callback/boxes/<box>/.callback-box/events.db` — per-box sqlite.
  - `/home/callback/boxes/<box>/config/connectors/*.secret.json` — per-box connector tokens.

What this means for the proposed migration: the per-box data layout is already correct. The deltas are all about *processes*, *users*, *front-door auth*, and *box code*. The cards on disk don't move.

### 4.2 Target shape

```
internet
  ↓
nginx (box.example.com, single TLS cert)
  ├── /auth/*                  → identity service (callback-id user, port 4000)
  ├── /                         → identity service: "box picker" page
  ├── /test1/*                 → unix:/run/callback/test1.sock        (callback-test1 user)
  ├── /hearth/*              → unix:/run/callback/hearth.sock     (callback-personal user)
  ├── /ledger/*                → unix:/run/callback/ledger.sock       (callback-ledger user)
  ├── /hearthside/*          → unix:/run/callback/hearthside.sock (callback-hearthside user)
  └── ... (8 total)
```

Each per-box backend:
- runs as `callback-<box>` OS user (homedir `/home/callback-<box>/`).
- listens on a unix socket only readable by `www-data` and itself (or by the nginx user).
- has its own systemd unit (`cb@<box>.service`).
- has its own git checkout at `/home/callback-<box>/box-repo/`, its own `node_modules`, its own pinned `callback-box` version.
- has its own `.env` at `/home/callback-<box>/.env`, mode 0600, owned by that user.
- trusts nginx-injected `X-Authenticated-Email` and ACL-checks against its own `config/box.json`.

The identity service:
- runs as `callback-id` OS user, port 4000 (loopback only, fronted by nginx).
- session sqlite at `/var/lib/callback-id/sessions.db`.
- holds the Google OAuth client for *login* (separate from per-box connector OAuth).
- discovers boxes by reading `/home/callback-*/box-repo/config/box.json` (or via a registry file the supervisor maintains).

URL shape stays the same (`box.example.com/<box>/...`), so:
- existing OAuth callback URLs registered with Google for connectors still work.
- existing browser bookmarks still work.
- existing telegram webhooks, RSS endpoints, share-target shortcuts still work.

This is intentional. Subdomains are a tempting upgrade for browser-origin isolation (`<box>.box.example.com`) but they break URLs and require wildcard TLS — better as an opt-in later step, not part of the initial migration.

### 4.3 What changes for shared ambient state

| Today | Tomorrow |
|-------|----------|
| `/home/callback/.env` (one file, all keys) | `/home/callback-<box>/.env` per box, owned by that user, mode 0600 |
| `/home/callback/.claude/.credentials.json` shared | Per box: `/home/callback-<box>/.claude/.credentials.json`. Or: keep one credential, bind-mount it into each home read-only — Claude Code account isn't really a per-box security boundary. (See open question.) |
| One `callback` user owns everything | One `callback-<box>` user per box. `callback-id` user for the identity service. The `callback` user can be retired. |
| One process, shared memory + event loop | N processes, no shared address space. systemd handles restart-on-crash per box. |
| Cookie scope: `box.example.com` | Same — single domain, single cookie. Auth is shared by design. |

Connector secrets (`config/connectors/*.secret.json`) stay per-box-on-disk as today; what changes is that they're now also protected by the OS-user permission boundary, not just by convention.

### 4.4 Migration order on this server

Pulling apart what can move independently:

**Phase 0 — preparation (no production change yet):**
- Make `callback-box` consumable as a library (proper `exports`, no internal leaks). Validate by getting `test1` to run via `pnpm install && pnpm dev` against a published-locally callback-box. Pure dev-machine work.

**Phase 1 — identity service in front (no per-box change yet):**
- Extract today's in-process Google OAuth gate into a separate `callback-id` Node process running on the server.
- Configure nginx to forward-auth via that service and inject `X-Authenticated-Email`.
- The existing single-process `cb serve` stops doing auth; it trusts the header. ACL checks unchanged.
- This validates the proxy + identity component end-to-end while everything else stays the same.
- Win even if Option C is paused: cleaner auth boundary, easier to add magic links / other login methods.

**Phase 2 — convert one low-risk box (`hearth-test` or `scenarios`):**
- Pick the least active box. Convert to package layout (its own git repo, `package.json` pinning callback-box, real `import`s in views/schemas/tricks).
- Provision `callback-hearth-test` OS user, give it its own homedir, install the box repo, `pnpm install`.
- Add `cb@hearth-test.service` systemd unit, start it, point nginx `/hearth-test/*` at the new socket.
- Other 7 boxes still in the shared process.
- Validates per-box-process, per-OS-user, per-version-pinning end-to-end with one box at a time.

**Phase 3 — convert remaining boxes one at a time:**
- Same conversion per box, in increasing order of risk (`seminar` → `hearthside` → `ledger` → `hearth` → `hearth` → `test1`).
- After each: nginx route flipped, old shared process keeps the others.
- When the last box flips, the shared `cb serve` is decommissioned, `/opt/callback/` source tree retired, `callback` user removed.

**Phase 4 — optional later upgrades:**
- Per-box subdomains for browser-origin isolation. Wildcard TLS via DNS-01.
- Network egress policy per OS user (`iptables --uid-owner` rules).
- Container-per-box if the threat model ever requires it.

### 4.5 Operational implications for box.example.com

- **Deploy ergonomics change.** Today: rsync from laptop, one-shot. Tomorrow: each box pulls from its own git remote, `pnpm install`, systemd restart. The current post-commit hook auto-deploy (callback-box repo) becomes a separate concern from per-box deploys (each box's own repo).
- **Monitoring per box.** Today, "the server is up" is one bit. Tomorrow, "box X is up" is one bit per box. systemd unit status + nginx upstream health is the surface.
- **Shared `claude-update.timer` still works.** It's an OS-level concern, not per-box. Updates the binary; per-box processes pick up the new binary on next agent invocation. Worth keeping shared.
- **`CB_DIAG_API_KEY` becomes per-box** (it lives in each box's `.env`). The bypass curl pattern in `server-operations.md` still works, with per-box keys.
- **Logs.** Per-box `journalctl -u cb@<box>` plus the existing per-box `.callback-box/logs/`. Cleaner than today's "everything in one journal."
- **Resource accounting.** Per-box CPU/memory becomes visible in `systemctl status`. Today it's all one process, no way to tell which box is the heavy one.

### 4.6 What this commits to and what it doesn't

Committing to:
- A small new piece of server infrastructure (identity service + nginx forward-auth).
- Per-box OS users and systemd units — operational hygiene one-time cost.
- Each box being a real git repo with a `package.json`. Box repos need a remote (could be on the server itself as a bare repo, doesn't have to be GitHub).

Not committing to:
- Subdomains. Path prefix preserved.
- Containers / namespaces. Per-OS-user is the boundary unless threat model expands.
- Real per-box version pinning. Updates are hard-fleet with revert on smoke-test failure (§3.3); pinned boxes only exist as reverted-state exceptions.
- Removing shared Claude Code credentials. Decide that separately.

---

## 5. Local development

Production runs N per-box processes behind nginx + identity service. The laptop can't reasonably stand up that whole shape on every `cb dev`, and shouldn't have to. Local dev is a separate arrangement that has to keep working from the command line.

What developers need locally:
- One command brings up a usable environment.
- Edits to `callback-box` source take effect on the next request — no rebuild, no reinstall, no `pnpm link` ceremony.
- Edits to a box's views/schemas/tricks/connectors do the same.
- Multiple boxes available concurrently (the current dev router loads `hearthside`, `test1`, `hearth-test`, `studio` into the main worktree's Fastify).
- No nginx, no systemd, no per-OS-user, no real OAuth.
- Vite HMR for the frontend.

### 5.1 The arrangement

A pnpm workspace at `~/src/callback/` that pulls in the library *and* boxes via a relative glob:

```yaml
# ~/src/callback/pnpm-workspace.yaml
packages:
  - callback-box
  - cardworks
  - ../boxes/*
```

Each box's `package.json` declares `"callback-box": "workspace:^"` (pnpm syntax) for dev, which resolves to the local source. For production deploy, the workspace specifier is rewritten to a real version (`pnpm publish` does this automatically; `pnpm deploy` does it for an unpublished consumer). Editing `callback-box/src/…` is picked up on the next request inside any box because the box runs `node --import tsx` against the workspace-linked source — same shape as today, just behind a proper resolution boundary.

The boxes are physically still at `~/src/boxes/<box>/` (outside the callback monorepo, so agents working inside a box don't inherit the parent CLAUDE.md). The workspace glob reaches across that boundary; it's a build-time relationship, not a directory-tree containment one.

### 5.2 What runs

The existing dev router (`bin/router.mjs`, Decision 24) already does the path-prefix routing piece. Under this hypothetical boxes-as-packages arrangement, the router's "spawn Vite + Fastify per worktree" logic would extend to "spawn a server per box":

```
# pseudo-Procfile of what the router would orchestrate
test1:           pnpm --filter test1 dev          # → some internal port
hearth-test:   pnpm --filter hearth-test dev  # → some internal port
hearthside:    pnpm --filter hearthside dev   # → some internal port
id:              pnpm --filter callback-id dev    # → :4001 (dev stub)
```

The router already presents `localhost:3210/<segment>/<box>/...` — same URL shape as production. Today's router uses the first segment for *worktree* selection; the boxes-as-packages variant would either fold box selection into the same segment or add a second level. Either way the URL shape and lazy-start behaviour are inherited from the existing router.

### 5.3 Auth in dev

The local identity service is a stub: it reads `DEV_EMAIL` from env (or per-box `.env.dev`), unconditionally issues a session, and the proxy injects `X-Authenticated-Email`. Per-box `config/box.json` is still consulted — so you can still test "this email isn't on the allow-list" 403 paths without standing up Google OAuth.

This matches the existing behaviour ("On localhost/dev (no `GOOGLE_OAUTH_CLIENT_ID` set), auth is disabled entirely") in cleaner shape: not "auth disabled" but "auth via a dev stub that always says yes." The per-box code path is identical to production.

### 5.4 The `cb` CLI

`cb` is a workspace bin exposed by `callback-box`. Inside the workspace, `pnpm exec cb wakeup` (or just `cb` if `~/src/callback/node_modules/.bin/` is on PATH) runs the local source. Inside an arbitrary box outside dev (`cd ~/src/boxes/some-box && cb wakeup`), the box's own `node_modules/.bin/cb` resolves — same script, but bound to that box's pinned `callback-box` version.

That gives the right behaviour for both worlds: dev iteration uses workspace source; a production-shaped box invocation uses its pinned version.

### 5.5 Trade-offs vs today

What you lose:
- One Node `--watch` loop becomes N. Each per-box process holds its own module graph in memory. On a 16GB laptop with 3 active boxes this is unmeasurable; on a smaller machine with 8+ boxes it's noticeable.
- Debugging is per-process. `--inspect` port per box (or use a multi-target debugger config).

What you gain:
- The local shape mirrors production. Per-box semantics — module isolation, separate event loops, separate sqlite handles — get exercised on every dev run. Bugs that only show up under isolation no longer hide until staging.
- A blown-up plugin in one box's `pnpm dev` doesn't crash the others. Today, a malformed view loader takes down the whole dev server.

### 5.6 Escape hatch: legacy single-process mode

`cb serve <box1> <box2> …` keeps working for at least one release window after the cutover, loading multiple boxes into one process the way the current dev router's "main" Fastify does. Useful for: cross-box demos, sandbox experiments where isolation isn't the point, low-resource machines. Won't catch isolation bugs, so it's an opt-in, not the default. Drop it if nobody uses it after a few months.

---

## 6. Recommendation

**Option C: each box is a code repository that depends on `callback-box` as a library, runs as its own process under its own OS user, deployed via fleet updates with per-box revert as the safety net.**

Reasoning, in priority order:

1. **Agents need to write real code without import tricks.** Primary driver (§1). Real `import`s, real type-checking, real `pnpm test`, real dependency declaration. No more esbuild+regex view compiler. No more stub `package.json` files. The view in §1 becomes `import type { ViewProps } from "callback-box";` and that's it. This is the central premise the workarounds have been obscuring.
2. **The `src/` + `data/` split keeps code and data visually separate.** Code in `src/views/`, `src/schemas/`, `src/connectors/`. The actual box (cards, config, runtime state) lives in `data/` and stays code-free. Commit history makes the distinction obvious: a `data/box/inbox/foo.memo.card` change is content; a `src/views/calendar.tsx` change is code.
3. **Isolation between boxes falls out as a co-benefit.** Per-box processes + per-box OS users (see `box-user-account-spec.md`). Important but secondary — it wouldn't justify the deploy upheaval on its own.
4. **Update policy is hard fleet update with revert, not per-box pinning.** Library bumps push to every box; failed smoke tests revert that box to the previous version. Keeps the fleet on one version most of the time; reverted boxes are exceptional and visible (§3.3, §7.2).
5. **Sharing becomes possible.** Reusable plugin packages can ship via `pnpm add callback-box-plugin-<name>`. Today this requires copying files between boxes.
6. **Cost is real but bounded.** Per-box processes (modest memory), bootstrap complexity (scaffolding, `pnpm install`), production reshaping (oauth2-proxy + per-box systemd units + fleet-update script). One-time or amortised.

Sequence of work, if we go ahead:

1. **Define the public surface** that `callback-box` exports for box consumption: `ViewProps`, schema helpers (re-exported from cardworks), connector base, registration APIs, `startServer(dataRoot)`. Lock import paths.
2. **Make `callback-box` consumable as a library** — proper `exports` map, no deep imports leaking internals, document the surface.
3. **Pick the agent-editable extension surface.** Decide whether the agent edits arbitrary `src/` (with restart on change) or only hot-reloadable plugin types (no restart). See §7.4. Affects how the loader is built.
4. **Build the per-box process model in dev first:** a single box can `pnpm install && pnpm dev` and get a working server. Validates the library shape and the `src/` + `data/` layout before touching production.
5. **Stand up oauth2-proxy + a small box-picker service** in front of the existing single-process server. Decouples auth from the box process before changing the box process model.
6. **Build the fleet-update script** with smoke-test-and-revert. Test it against a sacrificial box.
7. **Convert `test1`** as the first real migration.
8. **Convert remaining production boxes** one at a time. Decommission the shared-process server.
9. **Publish a `pnpm create callback-box`** scaffold so new boxes are one command.

Fallback: if Option C turns out to be too heavy in production, **Option B with per-box processes** is the graceful retreat — same isolation model, narrower code surface (just `plugins/`). Option A (better shims, no per-box process) remains as the "start over" position.

---

## 7. Update and deploy

Today's deploy story is elegantly simple: one thing to ship (callback-box), one trigger (post-commit hook), one mechanism (rsync to `/opt/callback/`, restart one service). Option C breaks that simplicity in exchange for independence between surfaces. Worth designing the new flows explicitly so the loss of "one button" doesn't become a thicket of ad-hoc scripts.

### 7.1 What gets deployed, by surface

Four surfaces, each with its own cadence:

| Surface | What it is | How often | Who triggers |
|---------|-----------|-----------|--------------|
| **Library** (`callback-box`, `cardworks`) | Shared code consumed by every box | Frequently (active development) | Fleet-update script: bump every box, smoke-test, revert on failure |
| **Per-box code** | A box's `src/`, custom views/schemas/connectors, `package.json` | Per box, occasionally | Laptop or server-side agent commits |
| **Per-box content** | Cards, attachments — the box's `data/` | Constantly | Mostly server-side (agent commits via `cb commit`) |
| **Server infrastructure** | nginx config, oauth2-proxy, supervisor, systemd unit templates, `cb provision-box` | Rarely | Manual / its own small deploy |

A library update is fleet-wide and aggressive (§3.3, §7.2). Per-box code and content stay independent — an agent committing a card on the server doesn't restart anything, and a new connector in box A doesn't touch box B.

### 7.2 Library distribution: hard fleet update with revert

**Decision:** When callback-box ships a new version, the fleet-update script pushes it to every box. Boxes that fail a smoke test revert to their previous version. Pinning is the exception, not the rule.

**Mechanism.** A bare repo on the server at `/srv/git/callback-box.git` holds the library. Laptop publishes via `git push prod main && git push prod v0.4.1`. The fleet-update script (`cb fleet upgrade` or similar) does the rest:

```
for each box in $(getent passwd | awk -F: '$3>=2000 && $3<3000 {print $1}'); do
  ssh-into-box's-home
  prev_version=$(jq -r .dependencies.\"callback-box\" package.json)
  pnpm update callback-box@latest
  if pnpm typecheck && cb smoke-test; then
    git commit -am "bump callback-box to <new>"
    systemctl --user restart cb-server
  else
    git checkout package.json pnpm-lock.yaml
    pnpm install   # restore prev_version
    record "$box reverted to $prev_version at $(date)"
  fi
done
```

**Smoke test.** Minimum bar before accepting the new version:
- `pnpm run typecheck` passes against the box's `src/`.
- Service starts under the new version (`systemctl --user start cb-server` succeeds).
- `/health` responds within 10 seconds.
- (Optional, later) `pnpm test` of the box's own tests if any.

If any step fails, revert. The reverted box is now stuck on the previous version, visible in operator dashboards and in the fleet-update log. Operator follows up.

**Per-box dep specifier.** Either `"callback-box": "*"` (always-latest) or a concrete version that the fleet-update script bumps. Both work; the concrete version is preferable because the lockfile then reflects exactly what's installed and reverts are clean git operations on `package.json` + `pnpm-lock.yaml`.

**Why this over per-box pinning.**
- Pinning tempts boxes to stay on stale versions indefinitely; bugs and fixes only land when boxes opt in.
- Pinning multiplies the effective test matrix.
- The fleet-update + revert model gets the safety of pinning (broken boxes don't break) without the staleness (working boxes stay current).

**Why bare repo over npm publish.** Same reasoning as before — no third-party dependency for a personal project, the tag is the version surface, the server doesn't need outbound to a registry. Easy to switch to npm later if a multi-author future warrants it.

Cardworks ships through the same mechanism, fleet-updated alongside callback-box. Cross-version coexistence between them isn't a concern because the fleet runs one version of each.

### 7.3 Per-box upgrade on the server

A per-box upgrade — used when only one box's code changed, not a library bump — is three commands:

```
cd /home/cb-<box>/box-repo
git pull
pnpm install   # no-op if package.json didn't change
systemctl --user restart cb-server
```

Wrap as `cb upgrade`. Idempotent.

Triggers:
- **Post-receive on the box's bare repo:** `git push prod main` from the laptop triggers a hook that runs `cb upgrade`. This is the everyday flow for box-code changes.
- **Manual:** SSH in, `cb upgrade`. Used for diagnosing the previous trigger.
- **From the fleet-update script:** when bumping callback-box across the fleet, this runs per-box with the smoke-test + revert wrapper (§7.2).

Failure mode within a per-box upgrade: same as fleet — if `pnpm install` or the smoke test fails, revert the commit, keep the previous process running, log to `.callback-box/logs/upgrade.log`.

### 7.4 Agent-authored changes on the server

The biggest behavioural shift. Today, an agent committing a `.tsx` view inside a box just changes a file the loader will re-read. Under Option C, an agent committing source code may need an install + restart — which makes the system feel less robust and adds a new failure mode.

Two fundamentally different stances. Worth picking one explicitly.

#### Stance A — Permissive: agent can edit anything in `src/`

Any commit under `src/` triggers a restart of that box's systemd unit (cheap, ~1–2s). `package.json` changes trigger `pnpm install` then restart. Failure path: revert the commit (or move to `wip/`), keep the previous process running, log it, surface on the dashboard.

Pros: maximum flexibility for the agent. Anything callback-box exposes as a library, the agent can use.

Cons: every source edit by an agent is a brief outage. Bad commits can land in the post-commit path and cause boots that just immediately revert. The system feels less robust as a self-editing organism.

#### Stance B — Restrictive: agent only edits hot-reloadable plugin types

The runtime supports dynamic load/unload for a fixed set of "plugin" file types — typically views, schemas, tricks, and possibly procedure steps. Edits to these never require restart; the running process re-imports the changed module.

Source files outside the plugin surface (`package.json`, custom connectors with running state, custom routes, server entry-point glue) are off-limits to the agent — or routed through specific commands that handle the install + restart safely:
- `cb deps add <pkg>` → `pnpm add`, then schedule a restart at a quiet moment.
- `cb upgrade-library` → call the fleet-update flow.
- Custom connectors / routes: stage as a PR-like proposal that a human reviews and applies offline.

Pros: agent edits never cause restarts. The system stays robust. The agent's mental model is narrow ("you can write views, schemas, tricks") and well-supported.

Cons: tighter ceiling on what the agent can build. Adding a custom connector or HTTP route requires human-in-the-loop. Implementing hot-reload for schemas (re-registering in the registry, invalidating cached parses) is non-trivial.

#### Recommendation

**Start with Stance B; allow Stance A as opt-in per box.** Reasons:
- Most agent code edits today fall into the plugin surface (views, schemas, tricks). Stance B covers the common case without ever restarting.
- Stance A is reachable from B — once the plugin surface is solid, extending it (or relaxing the restriction for power users) is incremental.
- The restart-on-every-source-edit model in A is the kind of thing that looks fine in design and feels bad in practice. Better to discover whether it's worth it after using B.

Either way: card commits (`data/box/`, `data/store/`, `data/config/*.card`) never restart anything. Same as today.

#### Mechanics either way

Per-box git post-commit hook installed at `cb provision-box` time (lives in `.git/hooks/` so it follows the repo). Hook diffs the commit and routes to:
- Card change → no-op (or invalidate a watched-file cache).
- Plugin file under the hot-reload surface → trigger the plugin's reload path in the running process via a control socket.
- (Under Stance A) Other `src/` change → schedule restart.
- (Under Stance A) `package.json` change → `pnpm install` + restart with revert-on-failure.

### 7.5 Server infrastructure deploys

nginx config, identity service code, supervisor scripts, systemd unit templates, `cb provision-box` — none of these are per-box. They live in a small `callback-server-infra/` repo (or an `infra/` subdir in callback-box, if that stays simple).

Deploy is manual SSH + `git pull` + service restart, with one wrinkle: **adding a new box is its own command**, not a server-infra deploy. `cb provision-box <name>` (running as root or via sudo) does:
- Create `callback-<name>` OS user with home `/home/callback-<name>/`.
- Clone the box's bare repo into `/home/callback-<name>/box-repo/`.
- `pnpm install` as that user.
- Install `cb@<name>.service` systemd unit (rendered from a template).
- Add the nginx upstream and `location /<name>/` block, reload nginx.
- Start the service.

Removing a box is the inverse, plus `userdel`. Both should be idempotent.

### 7.6 Frontend bundling

The frontend (`src/frontend/`) ships *with* callback-box. The library's release process (the act of pushing a tag to the bare repo) builds the frontend and includes the bundle in the published tree — either as a committed `dist/frontend/` on the release branch, or via a `prepare` script that builds on `pnpm install`. Either way, every box that adopts a callback-box version automatically gets the matching frontend.

Trade-off: each box has its own copy of the frontend bundle on disk (~10MB per box). 8 boxes × 10MB = 80MB. Negligible. The win is that frontend and backend versions stay locked together per box, which today they do not (frontend is built once on the laptop and shipped to one shared location).

### 7.7 Database migrations

Each box has its own sqlite (`.callback-box/events.db`, `usage.db`). Migrations run on startup, must be idempotent. Already roughly the case today; the per-box upgrade flow runs them naturally as part of `systemctl restart`.

Constraint this imposes on library development: callback-box can never break the on-disk format in a way that requires a manual step. Any sqlite schema change ships with an in-process migration. If a breaking change is genuinely needed, it goes through a deprecation cycle (one minor version supports both formats, the next drops the old one).

### 7.8 Rollback

Two flavours:

**Automatic per-box revert** is built into the fleet update (§7.2). A box whose smoke test fails gets its `package.json` and `pnpm-lock.yaml` reverted, previous library version reinstalled, service kept running on the old code. No operator action needed in the moment — but the box is now stuck on a stale version, visible in the fleet log, requiring follow-up.

**Manual fleet rollback** when a library version turns out to be bad in production after smoke tests passed:
```
git push prod prev-tag:main --force   # publish previous as the new latest
cb fleet upgrade                       # bump every box back down
```
This is unusual; the smoke test should catch most things.

What rollback doesn't fix: a database migration that already ran. Migrations must be backward-compatible across at least one minor version (see §7.7). If they aren't, rollback requires a snapshot restore — operational, not architectural.

### 7.9 Per-box code rollback

Independent of library rollback. If a box's own `src/` change broke it: `git revert` in the box repo, `git push prod main`, post-receive hook handles the rest. No fleet coordination.

### 7.10 Local development update flow

Two distinct local update concerns:

**Updating the library locally** is a non-event. The pnpm workspace links `callback-box` source directly into every local box's `node_modules`. `git pull` in `~/src/callback/callback-box/` and the next request inside any local box runs the new code. No bumping, no installing, no restarting (unless you're changing module-level state). Local matches "everyone on the same version" by construction — there's nothing to pin.

**Syncing a box between laptop and server** is the new ritual. Today there's no real sync — laptop has its own copy, server has its own copy, they diverge silently because neither has the other as a remote. Under Option C, the server's box repo is the canonical state, and the laptop should treat it that way:

```
# One-time setup per box
cd ~/src/boxes/<box>
git remote add prod ssh://cb-<box>@box.example.com/home/cb-<box>/box-repo.git

# Daily flow
git pull prod main         # bring agent-authored changes down
# ... make changes locally, commit ...
git push prod main         # post-receive hook runs cb upgrade on the server
```

callback-box itself gets a `prod` remote pointing at the server's bare repo, used for `git push prod main` to publish a release. After publishing, the operator runs `cb fleet upgrade` (or it runs on a schedule) to roll the new version across all boxes.

**Replaces today's auto-rsync-on-commit with these triggers:**
1. `git push prod` on a box repo → that box upgrades.
2. `git push prod` on callback-box, then `cb fleet upgrade` → all boxes adopt (with per-box revert on failure).
3. Manual deploy on `callback-server-infra` → server-level changes.

Trade-off: today is one push, tomorrow is two-or-three commands depending on what changed. In exchange you get a real git relationship between laptop and server (no more silent divergence), agent-authored changes that don't conflict with developer-authored changes, and the fleet kept on a known version most of the time.

### 7.11 Summary diff vs today

| Concern | Today | Tomorrow |
|---------|-------|----------|
| Library update | Laptop commit → rsync → restart all boxes | Laptop push to bare repo → `cb fleet upgrade` → per-box smoke-test → restart or revert |
| Box code update | (Same as library — no separate surface) | Per-box `git push prod` → post-receive runs `cb upgrade` |
| Card change by agent | Commit in box `.git/`, no restart needed | Same |
| Source change by agent | (Doesn't really exist) | Plugin types: hot reload, no restart. Other source: restart (Stance A) or off-limits (Stance B) |
| Adding a box | `add-box.sh` (SSH, mkdir, cb init) | `cb provision-box <name>` (user + unit + nginx + clone) |
| Adding a dep | (Doesn't really exist for boxes) | `cb deps add <pkg>` inside the box |
| Rollback | Redeploy older callback-box | Automatic per-box revert on smoke-test failure; manual `cb fleet rollback` for after-the-fact |
| Local→server sync of box state | Manual ad-hoc (mostly nobody does it) | Per-box `prod` remote, `git push prod` |

---

## 8. Open questions

- **Stance A vs Stance B for agent-authored code (§7.4).** Recommendation is start with B, allow A as opt-in. Validate this against actual agent behaviour — what does the agent today try to edit that wouldn't fit the plugin surface? If the answer is "lots of things," reconsider.
- **What's the plugin surface, exactly?** Views, schemas, tricks are obvious. Procedure steps? Custom prompts/personalities? Inbox routers? Connectors-with-no-running-state? Each one needs a hot-reload implementation. Pick the minimum that covers actual agent edits today.
- **Per-OS-user vs shared user with chroot/namespace.** Per-OS-user is the simplest enforcement boundary and works on stock Linux. Containers are stronger but heavier. Threat model question: protect against compromised connector code (per-OS-user is enough), or against malicious box authors (containers needed)? Single-operator today, so per-OS-user.
- **Smoke test scope.** Recommendation is typecheck + boot + `/health`. Is that enough to catch the failures that matter? Should we add a quick `cb validate` of a few representative cards, a smoke render of the dashboard, or run a tiny subset of the box's own tests?
- **Cross-box communication, if any.** Today there is none. Per-process isolation enforces this naturally. If we ever want cross-box features (shared people directory, federated chat), it has to go through an explicit API, not shared filesystem.
- **`cb` CLI distribution.** The CLI inside the workspace resolves to local source; inside a real box it resolves to that box's installed callback-box. Is there ever a context where the developer wants a *globally installed* `cb` that points at "the system default"? Probably not, but worth confirming.
- **Interaction with the [Markdown cards idea](ideas.md#markdown-cards-replacing-xml).** Both touch the schema-definition surface. Probably independent; markdown-cards is about on-disk format, this is about who runs the schema validator and where. Decide before locking the schema-helper export surface.
- **Scheduler ownership.** Today `cb tick` is shared. Per-box ticks are simpler but lose any cross-box scheduling intelligence (e.g., don't run two heavy wakeups simultaneously). Probably fine — each box can rate-limit on its own.
- **Test box (`test1`) as the canary.** Worth pulling forward as the first real exercise of the library shape, before anything else changes.
- **Shared Claude Code credentials.** Currently one credential at `/home/callback/.claude/.credentials.json` serves all 8 boxes. Under per-OS-user, each box would need its own credential and its own auth flow — or the credential file is bind-mounted read-only into each box's home. The Claude Code account isn't a meaningful per-box security boundary, so bind-mount is probably fine. Decide explicitly.
