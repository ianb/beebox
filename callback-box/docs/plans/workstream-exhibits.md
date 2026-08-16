---
title: "Workstream exhibits: a persistent presentation medium with asks"
status: draft
workstream: dev-docs-workflow
issues:
  - ../../../issues/features/2026-07-24-dev-scripted-apps-separate-origin.md
---

# Workstream exhibits

Give agents a first-class medium for showing work to the developer — rendered
documents, labeled screenshots, and small interactive pages — with an explicit
**ask** ("why am I seeing this, what do you need from me") on every item, a
persistent per-workstream store that survives worktree culls, and a generic
file-backed backend that captures the developer's responses and interactions so
later agent sessions can read them.

Chat is the wrong medium for much of what agents produce: it is ephemeral,
text-first, and feedback only lands if the developer is present at that moment.
This plan builds the missing medium as a new surface of the resident
workstreams app plus one storage convention, reusing the resident-app and
satellite-storage patterns the repo already shipped.

## Job to be done

- When an agent finishes a UI change and has six screenshots, I want to view
  them rendered and labeled in a browser and reply "A3 has too much white
  space" in chat or a voice note, so precise visual feedback costs me one
  sentence.
- When I sit down between sessions, I want one queue that says what is waiting
  on me and what each item costs ("2 decisions, 1 confirmation"), so I can
  move work forward without reconstructing context from chat scrollback.
- When an agent is tuning transcription thresholds, I want it to hand me a
  small page where I speak and see the live markup, and my samples land as
  files the agent can use as fixtures, so my five minutes of interaction
  becomes durable test data.
- When a workstream goes cold and is later recreated, I want its exhibits and
  my responses to still be there and its URLs to still work, so the medium is
  a record, not a scratchpad.

## Vocabulary lock-ins

- **Exhibit** — one presented item: a directory in the store holding a
  manifest, content files, and captured interactions. Chosen over "asset"
  (collides with box media assets, `docs/assets.md`) and "artifact" (collides
  with Claude Artifacts). Rendered items carry short **labels** (`A1`, `B3`)
  for figures so feedback can address them.
- **Ask** — the manifest field stating what the developer should do:
  `decide` (pick among enumerated options), `confirm` (veto if wrong),
  `react` (freeform impressions wanted), `fyi` (no action). Every exhibit has
  exactly one ask.
- **Disposition** — the developer's recorded answer to an ask. Stored as a
  document in the exhibit's own data area, written through the generic
  backend.
- **Store** — `<parent>/workstream-exhibits/<workstream>/`, the per-workstream
  persistent directory (see Track A).
- **Exhibits surface** — the part of the `workstreams-app/` package that
  serves the store. It listens on its own second origin (boxholder decision
  2026-08-15: the app belongs to workstreams-app; the pages belong to the
  worktree at a different path).
- **Instrument** — informal term for an exhibit with a custom `index.tsx`
  page. Not a separate mechanism: every exhibit is a directory; a custom page
  is an override of the default renderer.

## Stated preferences this plan trades against

- Principle 3, **validate at boundaries** (`docs/engineering-principles.md:37`):
  every manifest read, API input, and path parameter is Zod-validated; the
  store is disk written by multiple agents and a human, i.e. an untrusted
  boundary.
- Principle 4, **resilient and never silent** (`:49`): a broken manifest or a
  failed page renders an error page naming the file, never a blank.
- Principle 6, **right-sized defensiveness** (`:75`): containment checks
  concentrate at the store boundary (path resolution, symlinks); interior code
  trusts parsed types.
- Principle 7, **hierarchy is a discoverability contract** (`:87`): the app is
  a top-level workspace package, like `workstreams-app/`.
- Principle 8, **one way to do each thing** (`:95`): passive presentations and
  interactive instruments are one mechanism (default renderer vs `index.tsx`),
  and dispositions ride the same backend as instrument data. This also
  motivates retiring the router's scripted-app CSP exemption once story-eval
  migrates (Track F).
- Principle 12, **the maintainer is usually an agent** (`:141`): the
  agent-facing contract is a CLI plus a typed client and a filesystem
  convention; no harness-specific mechanism, so Codex gets it for free.
- Boxholder decisions (2026-08-15, this workstream's design discussion):
  one resident dev app with Next.js-style filesystem routing (but not
  Next.js); pages are React + TypeScript + Tailwind; the container supplies
  all boilerplate; **a separate, deliberately minimal lint preset for exhibit
  pages** — this is a boxholder-authorized new surface with its own rules, not
  a weakening of any existing config; exhibits persist with the workstream but
  never merge to main; every exhibit states its ask.
- Root `CLAUDE.md`: worktree URLs use the short name; never restart the shared
  router from a worktree session; commit docs with hooks.

## What already exists

- **Satellite storage that survives culls** — `bin/private-issues:7-11`:
  *"each public worktree mounts a private worktree … (symlink). Deleting a
  public worktree therefore only ever deletes a symlink — private work is
  structurally out of blast radius."* Track A reuses this topology exactly
  (a symlink mount, storage as a peer of the main checkout), minus the git
  repo — the store is plain directories.
- **Derived locations, fail closed** — `bin/lib/worktree-paths.sh:20-33`
  derives the parent via `git rev-parse --git-common-dir` and refuses to
  guess. The store root is derived the same way (`WT_PARENT`), with an env
  override (`CALLBACK_EXHIBITS_ROOT`) like its siblings.
- **Mount-on-create and self-heal on resume** —
  `bin/lib/worktree-create.sh:46-55` mounts private-issues on both the
  fresh-create and resume paths, best-effort. The exhibits mount is a second
  call at the same two sites.
- **Symlink gitignore rule** — `.gitignore:79` uses `/private-issues` with no
  trailing slash because a dir-only pattern does not match a symlink. The
  `/exhibits` entry copies this.
- **A resident app the router supervises** — `workstreams-app/` plus
  `bin/workstreams-app-supervisor.ts` (plan:
  `docs/plans/workstreams-app.md`). The exhibits surface lives inside this
  package and process group: same supervision, app-only restart on landed
  changes, buildless fallback. The one addition: a second listener the
  router does **not** proxy (see Track B — second origin).
- **Reading arbitrary checkouts from disk without waking them** —
  `workstreams-app/src/server/issue-overlay.ts:143-168` enumerates worktrees
  and reads their files; `bin/router-docs.ts` serves `dev/` from disk. The
  exhibits app reads only the store, which is not inside any checkout, so the
  never-cold-starts-a-worktree invariant holds trivially.
- **Path containment precedents** —
  `workstreams-app/src/server/issue-path.ts:13-40` (schema-validate, lexical
  containment, realpath re-check, extension pin) and `bin/router-docs.ts`
  `serveDevArtifact` (`:765-798`). The store backend reimplements this shape
  inside `exhibits-app` (the no-shared-source rule below); it does not import
  either.
- **The scripted-app exemption this plan retires** — `bin/router-docs.ts:49-59`
  documents that `tools.json` `scripted` grants the whole owner-authenticated
  origin, and names the separate-origin fix. story-eval (`dev/story-eval/`,
  save route at `bin/router.ts:1233-1238`) is the only user. Track F migrates
  it and removes the exemption.
- **Atomic writes** — `callback-box/src/lib/atomic-write.ts` is the pattern,
  but `workstreams-app` set the precedent that resident apps share callback-box
  **patterns, not source** (`docs/plans/workstreams-app.md`, "Reuse
  callback-box patterns, not callback-box source code"). No atomic-write
  helper exists in `workstreams-app` today (verified 2026-08-15); Track C
  adds a small local one.
- **Tailwind already exists in workstreams-app** — Tailwind v3 via PostCSS,
  content-scanned over `./src/frontend/**` only
  (`workstreams-app/tailwind.config.js:5`,
  `workstreams-app/postcss.config.js`). Track B extends the content globs to
  the store's page tree (out-of-repo absolute globs); whether the v3 scanner
  watches out-of-repo files correctly is a spike acceptance criterion, and a
  v4 migration is NOT part of this plan.
- **The existing app runtime shape** — one Fastify backend on loopback
  (`workstreams-app/src/server/main.ts:50`) with router-capability header
  auth (`workstreams-app/src/server/app.ts:41-47`), plus one Vite dev server
  rooted at `src/frontend` with base `/workstreams/`, HMR proxied through the
  router. The exhibits listener is a second, separate surface in the same
  process group; it reuses none of the `/workstreams/` Vite instance (see
  Track B).
- **Figure-compile machinery NOT reused** — the box `.attach` figure compile
  route (see `issues/code-quality/2026-07-15-figure-compile-cache-and-attach-guard.md`)
  is box-scoped and cache-heavy; Vite's dev server already does
  compile-on-demand for the app's own page tree. Rebuilding on Vite avoids
  that route's cache-staleness class entirely.

## Prior art (external)

- **Token-then-cookie access for a local single-user server** — Jupyter
  Notebook's security model: the URL carries `?token=`, the first request
  exchanges it for a session cookie
  ([Jupyter security docs](https://jupyter-notebook.readthedocs.io/en/6.5.2/security.html)).
  Track B copies this handshake.
- **Capability-URL hygiene** — W3C TAG
  [Good Practices for Capability URLs](https://w3ctag.github.io/capability-urls/2014-07-23.html):
  leak vectors are history, logs, referrers. Accepted here: URLs are
  loopback-only and land in local chat transcripts; the token is
  machine-scoped, not per-exhibit.
- **Per-artifact human review with anchored comments** — Chromatic
  [UI Review](https://www.chromatic.com/docs/review/) and Percy anchor
  review comments to individual snapshots/components with per-item
  approve/request-changes. Validates the labeled-figure + per-exhibit-ask
  shape; both are PR-scoped SaaS, so neither is adoptable.
- **File-backed micro-backends are a standard pattern** —
  [lowdb](https://www.npmjs.com/package/lowdb) (JSON-file store,
  explicitly low-concurrency) and json-server. We deliberately use plain
  files + JSONL instead of a library: the consumers are agents reading the
  filesystem directly.
- **Tailwind without a per-page build** — the v4 browser build
  (`@tailwindcss/browser`) can be vendored but is dev-only and compiles at
  page load ([Play CDN docs](https://tailwindcss.com/docs/installation/play-cdn)).
  Not needed under the one-app shape: the app has one normal Vite + Tailwind
  setup whose content scan covers the store's page tree.
- **esbuild single-file TSX** — `jsx: "automatic"` bundling is the documented
  pattern ([esbuild content types](https://esbuild.github.io/content-types/));
  only relevant as fallback if Vite's out-of-root globbing fails (Track B
  risk).
- No prior art found for filesystem-routed pages sourced from **outside** the
  app's own repo; this is the plan's main novel mechanism and gets a
  first-chunk spike (Track B).

## Tracks / scope

Order: A (store) unblocks everything; B (app + auth) unblocks C–F; C
(backend) unblocks D–E usefully; F is last because it deletes router code.

### Track A — The store: per-workstream persistent directories

**What.** `<WT_PARENT>/workstream-exhibits/<workstream>/` (env-overridable
`CALLBACK_EXHIBITS_ROOT`), one directory per workstream plus `main`. Each
checkout gets a gitignored symlink `<checkout>/exhibits` → its store
directory, mounted on create and resume, self-healing like the
private-issues mount.

**Why this needs to change.** There are only two persistence classes today:
committed (merges to main) and disposable (dies with the cull). Exhibits are a
third class — workstream-persistent, never merged — and nothing provides it.
The symlink also satisfies "pages belong to the worktree at a different path"
(boxholder, 2026-08-15): the agent writes at `<worktree>/exhibits/<name>/`,
and the content outlives the tree.

**Direction.**
- A `wt_exhibits_dir <workstream>` helper in `bin/lib/worktree-paths.sh`
  (derived from `WT_PARENT`, fail-closed like the rest of the file).
- Mount call added next to `wt_create_mount_private_issues` at both call
  sites in `bin/lib/worktree-create.sh:129,139`; creates the store dir on
  first mount. Best-effort with a stderr warning, same posture as the
  private-issues mount.
- `.gitignore` gains `/exhibits` (no trailing slash — symlink lesson,
  `.gitignore:79`).
- The store root carries a marker file (`.workstream-exhibits`), and the
  mount refuses to symlink to an unmarked directory — the identity-check
  posture `bin/private-issues:76-82` uses before mutating (the "reuses the
  topology" claim is only safe with this part copied too).
- Teardown gains one guard: if `<worktree>/exhibits` exists and is a **real
  directory** (a failed mount followed by an agent `mkdir`), `wt_remove_now`
  moves its contents into the store (or refuses) instead of trashing them
  with the tree — without this, that state is silent data loss at cull time.
  The symlink case needs no teardown change: removing the tree removes only
  the link. Doctests cover both (see Failure modes).
- `bin/exhibits` (Track D) never writes through the checkout symlink — it
  derives the store path itself (fail-closed), so a broken mount cannot
  redirect exhibit writes into the doomed tree.
- `bin/workstreams sweep` gains a report line for store directories whose
  workstream is neither registered nor a live worktree ("orphaned exhibits:
  <name> (<size>)"), mirroring the orphaned-private-worktree report. Sweep
  never deletes a store; culling is a manual `rm -rf` by the developer.

**First implementation chunk.** The path helper, mount, gitignore entry, and
a doctest in `callback-box/test/dev/` covering: create mounts, resume
self-heals, removal deletes only the symlink, store content survives a full
remove/recreate cycle.

### Track B — The exhibits surface: filesystem-routed pages in workstreams-app, second origin

**What.** The `workstreams-app/` package grows an exhibits surface: the same
resident supervised process group (backend + Vite), with a **second HTTP
listener** serving `http://localhost:<exhibitsPort>/<workstream>/<exhibit>/`
from the store. Default port 3220, env-overridable; loopback only. No new
workspace package (boxholder decision, 2026-08-15: the app belongs to
workstreams-app; the pages belong to the worktree at a different path).

**Why this needs to change.** The medium needs a renderer and a place for
agent-written pages. The router must not grow it (`bin/` is deliberately
dependency-light; the resident-app extraction exists precisely to keep
app-shaped work out of it). And exhibit pages must not run on the
workstreams **origin** even though they live in the workstreams **package**:
arbitrary agent-written scripts on the owner-authenticated origin could call
every workstream mutation — the exact hole `bin/router-docs.ts:49-59`
documents. The closed decision
`issues/closed/decisions/2026-07-19-boxes-share-one-origin.md` accepted
same-origin trust for *boxes* but named isolation as the fix for untrusted
content — exhibit pages are the case where it now applies. Package and origin
are separable: one process, two listeners, two trust domains.

**Direction.**
- **Second origin, not behind the router.** The exhibits listener binds its
  own TCP loopback port; the router does not proxy it (`pnpm dev` remains
  the single entry point via the existing supervisor). Exhibit pages, their
  compiled assets, and the Track C API are served **only** on this origin;
  the workstreams origin never serves store-sourced script. The exhibits
  origin's cookie grants exhibits routes only. Access uses the Jupyter
  handshake: a machine-scoped random token in
  `$WT_STATE_DIR/exhibits-token`, accepted as `?token=` once, then a session
  cookie scoped to the exhibits origin. Every other request without the
  cookie gets 401 with a hint naming the CLI command that prints a fresh
  URL. Tailscale exposure is out of scope (loopback binding).
- **One Vite instance per origin, middleware mode.** The exhibits listener
  is a Fastify server that mounts its own Vite dev server in middleware mode
  (`server.middlewareMode`), rooted at the package's exhibits frontend
  directory, `base: "/"`, with `server.fs.allow` extended to the store root.
  Shell, page modules, HMR websocket, and the Track C API all ride one
  origin — no cross-origin asset or HMR routing. The existing `/workstreams/`
  Vite instance is untouched and never serves store files.
- **The supervisor holds the port when the child is down.** A direct
  exhibit URL must not connection-refuse into silence (the existing fallback
  only covers router-proxied `/workstreams/*` requests,
  `bin/router.ts:1147-1169` — it cannot help a direct-origin URL). When the
  exhibits child is failed or restarting, the supervisor binds the exhibits
  port itself and serves the buildless fallback page (state, last failure,
  log path), releasing the port to the replacement child on restart.
- **One trust domain across exhibits, named honestly.** All exhibit pages
  share the exhibits origin, so a custom page's script can call the Track C
  API for any exhibit, not only its own. Accepted residual, the same shape
  as `issues/closed/decisions/2026-07-19-boxes-share-one-origin.md` accepted
  for boxes: single developer, local-only, agent-authored content, and the
  events log makes cross-exhibit writes visible. The load-bearing boundary
  is between exhibit pages and the router/workstreams authority — that one
  is structural (different origin, different cookie). Per-exhibit isolation
  would need per-exhibit origins and is deliberately not built.
- **Filesystem routing.** Route = store path. A request for
  `/<ws>/<exhibit>/` resolves `store/<ws>/<exhibit>/`:
  - `index.tsx` present → serve the SPA shell; the page module is loaded via
    a Vite glob over the store root (`server.fs.allow` includes the store;
    the glob pattern is anchored at the store root so nothing outside it is
    importable). Creating a directory and dropping `index.tsx` is the whole
    publish step; HMR picks it up.
  - no `index.tsx` → the **default presentation renderer**: manifest header
    (title, ask, status), `doc.md` rendered via Markdoc (client-side,
    `Markdoc.renderers.react`, the `workstreams-app` pattern), images and
    other files as labeled figures (`A1`, `A2`, … from the manifest), a
    disposition control matching the ask type, and a freeform comment field.
  - The app root `/` lists workstreams; `/<ws>/` lists that workstream's
    exhibits with ask badges.
- **Manifest.** `exhibit.json`, Zod-validated
  (`{ title, ask: { type: "decide"|"confirm"|"react"|"fyi", prose, options? },
  created, figures?: [{ label, file, caption? }] }`). A missing or invalid
  manifest renders an error page naming the file and the Zod issue
  (principle 4); it never renders a bare directory listing as if intended.
- **Container contract.** The package owns: React 18, Tailwind (the
  existing v3/PostCSS setup with content globs extended to the store's
  `**/*.tsx`), a shared layout shell (nav back to the exhibit list, the ask
  header), a typed client, a `tsconfig` the store pages compile under,
  and a **minimal ESLint preset applied only to store pages** (boxholder
  decision 2026-08-15: parse errors and correctness rules only; not the
  house preset). `workstreams-app/` source itself keeps the house preset.
- **Typed client shape** (boxholder, 2026-08-15): each page declares its
  data type and gets type-checked save/load —
  `const storage = new Storage<MyState>("thresholds")` with
  `await storage.load()` / `await storage.save(state)` over Track C
  documents, plus `new EventLog<MyEvent>("ratings")` for appends and a
  `postCapture(name, blob)` helper. Honest limit, stated in the docs: the
  type parameter is compile-time only — the server stores schema-agnostic
  JSON (Track C caps and containment are the runtime guarantees). A page
  that wants runtime validation passes a Zod schema:
  `new Storage("thresholds", { schema })`.
- **Docs.** A `workstreams-app/docs/exhibits.md` page documents the page
  contract ("create `<worktree>/exhibits/<name>/`, write `exhibit.json`,
  optionally `index.tsx`; these functions are available"), with one worked
  example of each kind (a screenshot presentation, an instrument).

**First implementation chunk.** A spike proving the load-bearing mechanism
end to end on an isolated port, with explicit acceptance criteria: (1) Vite
middleware mode inside Fastify with `fs.allow` + glob-routing over an
out-of-repo store directory; (2) HMR fires on a dropped/edited `index.tsx`;
(3) Tailwind v3 content scanning generates classes for out-of-repo pages,
including on file change; (4) the watcher ignores `data/`, `captures/`, and
`events.jsonl` (no rebuild storm while an instrument writes); (5) the
token→cookie handshake; (6) the supervisor-held fallback port swap. If Vite
cannot do (1)–(4) cleanly, the fallback is backend-driven esbuild
compile-on-request (the figure-compile shape, without its process-global
caches) — decide from the spike before building anything else in this
track.

### Track C — The generic backend: documents, events, captures

**What.** Three file-backed primitives, scoped per exhibit, served by the
workstreams-app backend:

- `GET/PUT /api/<ws>/<exhibit>/data/<key>` — whole JSON documents at
  `store/<ws>/<exhibit>/data/<key>.json`, atomic replace on write.
- `POST /api/<ws>/<exhibit>/events` — append one JSON line to
  `store/<ws>/<exhibit>/events.jsonl` (server adds a timestamp).
- `POST /api/<ws>/<exhibit>/captures/<name>` — write the raw body to
  `store/<ws>/<exhibit>/captures/<name>` (extension-allowlisted; size-capped).

All three are served only on the exhibits origin (Track B).

**Why this needs to change.** Instruments need persistence and the ask needs
a recorded answer; today the only write path an interactive dev page has is
story-eval's bespoke router route (`bin/router.ts:1233-1238`). A generic,
scoped write surface replaces per-app route negotiation (principle 8).

**Direction.**
- Zod-validate every path segment (single safe segments, no traversal);
  resolve under the store root and realpath re-check (the
  `issue-path.ts:13-40` shape, reimplemented locally).
- Dispositions are not special: the default renderer PUTs
  `data/disposition.json`
  (`{ askType, choice?, comment?, decidedAt }`) and appends an event. Agents
  read the same file from disk — no API needed on the consuming side.
- Caps: request bodies 25 MB (captures) / 1 MB (documents, events);
  `events.jsonl` is append-only and never read by the server (agents read it
  from disk), so no unbounded server-side reads.
- Auth: same origin cookie as Track B; no separate per-exhibit tokens.

**First implementation chunk.** The three routes with containment,
atomicity, and cap doctests (traversal, symlink escape, oversize, concurrent
appends), against a temp store.

### Track D — The agent-facing surface: CLI, conventions, discoverability

**What.** `bin/exhibits` — a small CLI any agent (Claude or Codex) uses to
create and reference exhibits — plus the conventions that make exhibits good.

**Direction.**
- `bin/exhibits add [--workstream <ws>] --title <t> --ask <type> --prose <p>
  [--option <label>]... [files...]` — creates the exhibit directory, copies
  the files, writes the manifest with auto-assigned figure labels, prints the
  exhibit URL (with `?token=`) on stdout. `--open` also runs macOS `open`.
  Workstream defaults from the cwd's checkout (derived, fail-closed).
- `bin/exhibits list [--workstream <ws>] [--json]` — exhibits with ask type
  and disposition state. This is also what a later agent session runs to find
  answered asks.
- `bin/exhibits url <ws>/<exhibit>` — reprint a stable URL.
- **Conventions doc** (part of the Track B docs): every exhibit states its
  ask honestly (`fyi` is not a dumping ground — see
  `issues/decisions/2026-07-29-manual-testing-flag-overuse.md` for how a
  human-attention queue rots when a tag is over-applied); figures get labels
  and captions; when presenting live in chat, the agent runs `--open` and
  discusses in label terms; the ask's prose says what happens after the
  developer answers.
- **Discoverability**: a paragraph in the root `CLAUDE.md` (the exhibits
  store, the CLI, when to present vs paste into chat) and a pointer from
  `dev/README.md`. Codex needs nothing extra — CLI + files.

**Why this needs to change.** "Super easy from here or for Codex" (boxholder,
this discussion) rules out anything harness-specific; a CLI printing a URL is
the lowest-common-denominator contract (principle 12).

**First implementation chunk.** `add`/`url`/`list` with doctests against a
temp store; the CLAUDE.md paragraph lands in the same commit
(infrastructure isn't done until discoverable, `callback-box/CLAUDE.md`
"Improving These Instructions").

### Track E — The ask queue in the workstreams app

**What.** A cross-workstream "waiting on you" panel in the workstreams app:
every exhibit whose ask has no disposition, grouped by ask type, linking to
exhibit URLs on the exhibits origin.

**Why this needs to change.** The developer's entry point is "what needs me,
across everything" — the same reason `/workstreams/testing/` exists. Without
it, exhibits are only discoverable from chat messages.

**Direction.** The workstreams app backend reads
`store/*/*/exhibit.json` + `data/disposition.json` from disk (read-only, the
`issue-overlay.ts` pattern). Counts appear next to the existing issues and
testing surfaces. No mutation from this side — answering happens on the
exhibits origin.

**First implementation chunk.** The read service + panel with fixture-store
tests.

### Track F — Migrate story-eval; retire the scripted-app exemption

**What.** Rebuild story-eval as an exhibit page (its autosave becomes a
Track C document), then remove `tools.json`'s `scripted` mechanism, the
`isPathInScriptedApp` grant (`bin/router-docs.ts:98-109`), and the bespoke
save route (`bin/router.ts:1233-1238`). `/dev/` HTML then always gets the
bare `sandbox` CSP. Close
`issues/features/2026-07-24-dev-scripted-apps-separate-origin.md` as
implemented-by-relocation.

**Why this needs to change.** The exemption is an accepted origin-wide grant
whose stated revisit trigger is "if more scripted apps appear" — this plan is
that trigger, and it builds the isolated origin the issue asks for. Leaving
both mechanisms alive is two ways to do one thing (principle 8).

**Severability.** Track F is deliberately last and separately committable:
the exhibits medium works without it, and the origin issue itself says the
fix is not urgent at one scripted app. If the rollout wants a smaller merge,
Track F may land as an immediate follow-up — but it stays in this plan so
the two-mechanisms state (`scripted` grant + exhibits origin) is a named,
bounded transition, not a drift.

**First implementation chunk.** The story-eval port (content move + a
document-backed autosave), verified side by side before the router code is
deleted.

## Could this be simpler?

**Simplest plausible version:** keep committing HTML/markdown to `dev/`,
paste screenshots into chat, and collect feedback verbally. This fails on
every motivating job: artifacts die with the cull or pollute main, there is
no ask queue, every interactive page needs a bespoke router route and an
origin-wide CSP grant (`router-docs.ts:49-59`), and nothing captures
interactions as files (principle 8 and the JTBD section).

**Middle version considered:** serve exhibit pages on the existing
workstreams origin — no second listener. Rejected because agent-written
pages would execute on the owner-authenticated origin, able to call every
workstreams mutation; that is the precise hole the scripted-app issue
documents, made bigger (principle 3's boundary logic: untrusted code gets
its own trust domain). The second listener costs one port and one cookie
scope.

**Also considered: a separate `exhibits-app/` package.** Rejected by
boxholder decision (2026-08-15): the app belongs to workstreams-app. A third
package would duplicate the supervisor, install, lint, and restart surface
for no isolation gain — origin isolation comes from the listener, not the
package boundary.

**Also considered:** no React — vanilla pages against the backend. Rejected
by boxholder decision (2026-08-15): a provided container with React, types,
and Tailwind is the "get by really quickly" contract; vanilla-with-nothing
was the earlier lean and the one-app shape removed its main advantage (no
build step to manage either way).

What the plan deliberately does NOT include is any per-exhibit build/publish
pipeline, a database, or a framework adoption in the router — the one-app
shape made those unnecessary.

## Subplans

None. The one genuinely open mechanism (Vite routing over an out-of-repo
store) is resolved by Track B's first-chunk spike, not by a separate design
step.

## Failure modes

> **Critical gap (accepted, documented):** a capture (e.g. an audio blob)
> written moments before the developer force-kills the machine can be
> truncated; captures are streamed writes, not atomic. Accepted: captures are
> re-recordable by construction (the developer is present when they're made),
> and JSONL/documents — the records that drive behavior — are atomic.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Worktree removal deletes exhibits | Track A doctest: remove → store intact | Store is outside the tree; only the symlink dies (private-issues topology) | Clear |
| `exhibits/` is a real dir at cull time (failed mount + agent `mkdir`) | Track A doctest | Teardown guard preserves contents into the store or refuses; CLI never writes through the symlink | Clear |
| Mount adopts an unrelated directory | Track A doctest | `.workstream-exhibits` marker required before symlinking | Clear |
| Store dir missing on resume (moved/renamed) | Track A doctest | Mount recreates the dir; sweep reports orphans under the old name | Clear |
| Dangling `exhibits` symlink after manual store deletion | Track A doctest | Mount self-heals on resume; app 404s with the workstream name | Clear |
| Invalid/missing `exhibit.json` | Track B doctest | Error page naming file + Zod issue | Clear |
| Agent page throws at render | Track B browser check | Per-route React error boundary; shell + ask header survive | Clear |
| Path traversal / symlink escape via API path segments | Track C doctests | Zod segment validation + resolve-under-root + realpath re-check | Clear |
| Concurrent event appends interleave | Track C doctest | Single-line `appendFile` writes; JSONL tolerates any ordering | Clear |
| Two writers race on one document | Track C doctest | Atomic replace; last write wins, both writes logged as events | Clear (accepted: single user + one agent per exhibit in practice) |
| Oversize capture / document | Track C doctest | 413 with the cap in the message | Clear |
| Token leaks via a pasted URL | — | Loopback-only origin; token grants exhibits app only (no router/box authority); W3C capability-URL caveats documented | Clear (accepted residual) |
| Exhibits child down; developer follows a direct exhibit URL | Supervisor doctest | Supervisor binds the exhibits port and serves the fallback page (a direct-origin URL cannot use the router's `/workstreams/*` fallback) | Clear |
| Vite cannot glob/HMR/Tailwind-scan the out-of-repo store | Track B spike criteria (1)–(4) | Decision gate: esbuild compile-on-request fallback | Clear — resolved before dependent tracks |
| An exhibit page writes another exhibit's data | — | Accepted residual (one trust domain across exhibits, named in Track B); events log makes it visible | Clear (documented) |
| Store grows unbounded (captures) | — | Sweep reports per-store size; culling is manual and developer-only | Clear |
| Exhibit name collision on `add` | Track D doctest | CLI refuses and suggests `-2` suffix; never overwrites | Clear |
| Developer answers while agent rewrites the exhibit | — | Disposition lives in `data/`, which `add`/agents never overwrite; content edits don't touch answers | Clear |
| Watching the store burns CPU as it grows | Track B spike criterion (4) | Watcher excludes `data/`, `captures/`, `events.jsonl` | Gate — not claimed until the spike proves it |

## Agent-flow / user-flow edge cases

- **Wrong ask type** (agent tags a real decision `fyi`) — ADDRESSED by
  convention only: Track D's conventions doc, citing the manual-testing
  overuse precedent. No mechanical guard is possible; the queue makes
  mislabeled items visible rather than lost.
- **Stale exhibit** (workstream culled, exhibit persists) — ADDRESSED: URLs
  are store-scoped, so they keep working; the exhibits list marks
  workstreams with no live worktree; sweep reports them (Track A).
- **Two agents, one store** — ADDRESSED: exhibits are directories created by
  `add` (refuse-on-collision); within one exhibit, events are append-safe and
  documents are atomic (Track C). Concurrent edits to one exhibit's content
  files are the same shared-worktree discipline that already governs
  path-scoped commits (`bin/CLAUDE.md`, "Multiple agents sharing one
  worktree") — out of the plan's mechanical scope.
- **Hand-edit drift** (developer edits `exhibit.json` by hand, malformed) —
  ADDRESSED: Zod error page naming the problem (Track B).
- **Fabricated value** (agent invents a flattering caption or a leading ask)
  — ADDRESSED as far as design can: the ask vocabulary is small and the
  disposition is the developer's own words; conventions doc requires the ask
  to state what happens after each answer.
- **Validation error UX in the agent's context** — ADDRESSED: CLI errors
  print the failing field and an example manifest; API 4xx bodies are JSON
  with the Zod issue list (Track C/D doctests assert message content).
- **Partial rollout** — ADDRESSED: tracks are additive; nothing existing
  changes until Track F, which lands only after the story-eval port is
  verified side by side.
- **The developer answers in chat instead of the app** — ADDRESSED: that is
  legitimate (labels make it precise); the agent records the outcome by
  writing `data/disposition.json` itself, so the queue clears either way.

## NOT in scope

- **Moving the repo docs browser** — separate issue
  (`issues/features/2026-08-13-move-dev-docs-into-workstreams-app.md`);
  exhibits are store content, repo docs are repo content. This plan neither
  needs nor advances it.
- **Remote/Tailscale access to the exhibits origin** — loopback only;
  exposing a second origin over the tailnet is its own auth design.
- **Video capture/demo tooling** — different axis
  (`issues/exploration/2026-08-14-proving-it-works-demo-video-plugin.md`).
- **Unifying with the box feedback pipeline** (`cb feedback`,
  `issues/features/2026-08-06-capture-feedback-from-chat.md`,
  `issues/docs-and-chores/2026-07-14-feedback-collection-cadence.md`) — that
  pipeline is box-domain; dispositions are dev-workflow. Revisit only if the
  two visibly converge.
- **Pointing at live app UI** —
  (`issues/features/2026-08-14-agent-can-see-and-point-at-the-interface.md`)
  is the agent pointing at *the box UI's own chrome*; exhibits present
  *agent-made* content. Different problem, noted to prevent vocabulary
  collision.
- **Auto-culling stores** — deletion is always the developer's manual act;
  sweep only reports.
- **A migration of existing `dev/` content** — existing committed `dev/`
  artifacts stay; only story-eval moves (Track F), because it is the one
  scripted app.
- **The box-side counterpart** —
  `issues/exploration/2026-07-28-ad-hoc-agent-views.md` is a *box agent*
  showing something inside the *box UI*. This plan is the development
  environment's medium; the two are separate things (boxholder, 2026-08-15)
  and this plan neither resolves nor blocks that issue.
- **Per-worktree exhibit-app instances** — a worktree could in principle run
  its own copy of the container (from the monorepo) to serve its pages with
  its own in-progress container changes. Deferred: the isolated-port run mode
  the workstreams app already has covers development of the container itself;
  a per-worktree serving mode is designed only if container changes become
  frequent.

## Open design questions

- **The name.** "Exhibit" is the planner's proposal (locked above so the doc
  is consistent); the boxholder may prefer another. Rename is cheap before
  Track B lands, expensive after (URLs, CLI, docs).
- **Does `fyi` expire?** Lean: no auto-expiry; the queue shows `fyi` items in
  a collapsed section so they never compete with `decide`/`confirm`.
- **Port number and origin naming** (3220? `exhibits.localhost`?). Lean:
  plain `localhost:3220`, decided at Track B implementation.

## Knowledge audits

None. Box agents never see this surface — it is dev-workflow
infrastructure (the same rationale as `workstreams-app.md`). The
dev-agent-facing knowledge lands as CLAUDE.md/docs updates in Track D and is
validated by `pnpm --dir callback-box doc-check`.

## Implementation order

1. **A** — store, mount, gitignore, sweep report, lifecycle doctests.
2. **B-spike** — out-of-repo Vite routing proof on an isolated port; decide
   glob vs compile-on-request.
3. **B** — second listener in workstreams-app, auth handshake, default
   renderer, manifest schema, container (Tailwind, typed client stub, lint
   preset, docs skeleton).
4. **C** — documents/events/captures + disposition, containment doctests.
5. **D** — `bin/exhibits` CLI, conventions doc, CLAUDE.md paragraph.
6. **E** — workstreams-app ask-queue panel.
7. **F** — story-eval port, side-by-side verification, remove the scripted
   exemption + save route, close the origin issue.
8. Full lint/typecheck/test at root; browser pass over: a passive exhibit, an
   instrument with all three backend primitives, the queue, a cull/recreate
   cycle, and an unauthenticated request.
9. Cross-model review of the implementation diff; resolve findings.
10. Boxholder acceptance: one router restart (new supervised child), then a
    real exhibit round-trip — agent `add` → browser answer → agent reads the
    disposition.

## Rollout shape

One plan, one merge, additive until Track F. The exhibits surface rides the
workstreams app's existing reversible posture: if the app fails to start,
the supervisor fallback reports it and nothing else degrades — the router
and `dev/` serving are untouched until Track F, whose removal commit is
separately revertible. The store (Track A) is pure addition; rolling it back
orphans directories, which sweep reports.

Tests land with each track as named in the Failure-modes table — the
lifecycle doctests (A), containment doctests (C), and CLI doctests (D) are
the done-when. The Track B spike is a decision gate, not a shippable chunk.
Data-shape migrations: none (all-new storage).
