# Route-level code splitting — plan and cost/benefit

Status: **proposed, with a conditional-no recommendation** — written 2026-08-01
at the boxholder's request for an honest cost/benefit, after the frontend
load-time work landed (navStatus, chat.bootstrap, streamed batches, immutable
asset caching — `f95eecc1` and siblings). Revised same day after a Codex
review corrected the deploy-cache economics that originally anchored the
recommendation (see "Deploy-cache effect", below).

All byte numbers are **measured**, from a working prototype in a disposable
worktree: lazy `lazyRouteComponent` routes (step 2), plus a
ceiling-measurement that deleted `main.tsx`'s eager renderer registration
(step 3 — not shippable; it made three/p5/d3 unreachable rather than
deferred). Prototype diff and the five `analyze:bundle` report JSONs are
preserved in the analysis worktree's `scratch/` (`route-split-prototype.diff`
— note it omits the new untracked `BrowsePageWrapper.tsx`, which must be
recreated; `route-split-measurements/`).

## Measured results

| | initial JS raw | initial JS gzip | chunks |
|---|---|---|---|
| Today (one eager route tree) | 1467 KB | **457 KB** | 8 |
| Step 2: lazy routes | 922 KB | **287 KB (−37%)** | 31 |
| Step 3: + deleted renderer registry (ceiling only) | 573 KB | **175 KB (−62%)** | 31 |

CSS barely moves. Build time: ~+2 s (+17%).

Per-route cold-navigation closure (route chunk + its statically-imported
non-initial chunks) after step 2: ChatPage 419/**137 KB** gzip, AdminPage
74/24, SettingsPage 34/12, DashboardPage 27/9, rest ≤14/5. The sub-1 KB
History/Questions/Landmarks/Chats chunks are hollow in step 2 — their bodies
stay pinned in the initial chunk by `renderers/view.tsx` (see below).

## What the split buys — corrected

**Chat (the primary path): nothing, possibly slightly negative.** Chat entry
today: 457 KB gzip, one fetch stage. After step 2: 287 + 137 = 424 KB
(−7%) plus one extra serial fetch stage on a cold direct load (no hover
exists to preload from; the added RTT roughly cancels the bytes on a good
connection and can exceed them on a high-latency one). Chat keeps markdoc
(message rendering is eagerly wired through `ChatMessages` →
`markdown-rendering` → `Markdown.tsx` — deferring it would mean building a
Suspense boundary inside message rendering, out of scope here), all six
machines, audio/capture, the UI kit, and the provider stack.

**Secondary cold entries: the real, and only large, benefit.** Dashboard,
browse, settings, questions, history as a cold entry drop 457 → ~290–300 KB
gzip (−35%). How much that's worth depends entirely on how often those pages
are a *cold entry* rather than an in-app navigation — for the boxholder
today, chat is the usual entry and the dashboard is "a corner of the app".

**Deploy-cache effect: modest, not the headline.** (Corrected — the original
draft claimed a one-page deploy would re-download "a few tens of KB"; that
was wrong.) Backend-only deploys never invalidate the content-hashed bundle,
split or not. A frontend change re-hashes the changed route chunk **and the
entry chunk that references it by filename**, so a typical one-page deploy
re-downloads ≈287 KB entry + the changed closure — versus 457 KB today.
Unchanged sibling closures (e.g. chat's 137 KB when a dashboard-only change
ships) do stay cached. Real, but a ~35% reduction on frontend-deploy
re-downloads, not an order of magnitude.

**Dev-mode side benefit:** each route's on-demand module graph shrinks the
436-request dev load for whichever route you open.

**What pins the remaining 287 KB initial (step 2), in order:**
1. `renderers/setup` eager-imported by `main.tsx` — ~349 KB raw / ~112 KB
   gzip: markdoc (151 KB raw) via the markdown renderers, the
   **`renderers/view.tsx` hub** (statically imports `LandmarksList`,
   `ChatsPicker`, `QuestionsList`, `HistoryViewCard` — why those pages'
   step-2 chunks are hollow), and `text-fragments-polyfill` + `fraction.js`
   via commentary/recipe renderers.
2. zod (86 KB raw) — pinned by route-level `validateSearch` (eager by
   design: params validate before any chunk loads) and the upload libs.
   (In principle search validation needn't use zod; replacing it is its own
   project and not proposed.)
3. tRPC + react-query provider stack (~106 KB raw) — the shell needs it.
4. react-dom, router-core, tailwind-merge — irreducible shell.

Only (1) is attackable, and it's the expensive part: a lazy renderer
registry needs a new registration contract (sync stub + lazy component —
`ConceptMapView`'s internal lazy split is a precedent for the component
half, though not for the registry contract), a rework of the
`renderers/view.tsx` hub, and Suspense states in `FileView`. It still can't
take markdoc off chat. Step 3's 175 KB is a ceiling, not a target.

## Costs

- **Implementation (step 2 + hardening): small.** ~120-line prototype;
  `lazyRouteComponent(() => import(...), "ExportName")` per route with zero
  TypeScript friction (types live on the route object; `tsc` passed
  unmodified). `BrowsePageWrapper` moves out of `app-shell.tsx` (it
  statically imports `BrowsePage`). Hardening on top:
  - **Chunk-load failure: mostly free.** `lazyRouteComponent` (installed
    1.170.8) already detects dynamic-import failure, reloads once keyed by
    the failed module (not a global flag), and defers preload errors until
    render. Do NOT build custom sessionStorage retry machinery; add only a
    route-level error UI + telemetry for the unrecoverable case, and test
    the built-in behavior's boundaries.
  - **Deploy non-atomicity is the residual risk**: `deploy.sh` rsyncs with
    `--delete` into the live package (`deploy/deploy.sh:283,327`), so
    during the sync window old chunks are gone and HTML/entry/chunks can be
    mutually incoherent — a once-only reload landing in that window strands
    an error screen. Mitigation options, one required before shipping the
    split: retain prior-build hashed assets for a window, publish via
    versioned release dirs (atomic symlink flip), or a delayed retry in the
    error UI. This is a deploy-pipeline change, not a frontend one.
  - **Pending UI, two distinct semantics** (they are not the same thing):
    direct boot keeps the static app-boot fallback; child-route transitions
    must preserve `AppLayout`/nav and swap only the `Outlet` region. Router
    core activates the pending path only when a pending component is
    configured; pin `defaultPendingMs`/`defaultPendingMinMs` deliberately
    and test both semantics under throttling.
  - `defaultPreload: "intent"` so in-app navigation warms chunks on
    hover/touch. **No unconditional idle-preload of ChatPage** — that would
    re-download the 137 KB chat closure for every secondary-page visitor,
    spending away the very benefit the split buys; add it later only with
    evidence, gated on visibility + connection (`saveData`) conditions.
  - Dev-only routes: the route objects AND their `import()` expressions
    must both live inside the build-time `import.meta.env.DEV` branch —
    the prototype's shape shipped all three dev pages as production async
    chunks (verified in step2.json). Assert their absence from a production
    build.
- **Ongoing complexity: moderate but bounded.** 31 chunks; one line of
  boilerplate per new route; the pending/preload configuration is new
  surface. Build +2 s.
- **Chat cold load**: the extra serial stage, as above. (Route-aware
  `Link: rel=modulepreload` response headers could in principle remove it —
  the server knows `request.url` when serving index.html — but that needs a
  build manifest wired into the server; noted as a possible follow-on, not
  in scope.)

## Recommendation

**Conditional no — don't schedule this now.** The measured case for step 2
is real but narrow:

- It does not improve the primary path (chat) at all, and slightly risks it
  on high-latency connections.
- Its large win (−35%) applies only to *cold* entries on secondary pages,
  which today are rare for the boxholder (chat-first usage, dashboard "a
  corner").
- The deploy-cache benefit, once computed correctly, is a ~35% reduction in
  frontend-deploy re-downloads — nice, not decisive.
- Shipping it properly requires a deploy-pipeline change (non-atomic rsync
  window) that is its own small project.

**Trigger conditions that would flip this to yes** (any one suffices):
phone/secondary-entry cold loads become a felt complaint; a PWA/offline
push makes per-chunk caching structural; the renderer-registry rework gets
justified independently (at which point routes-first is the right sequence);
or deploys become frequent enough that the re-download reduction matters.

If it flips: implement step 2 + hardening exactly as sketched below; skip
the renderer-registry rework regardless until phone cold loads demand it.

## Implementation sketch (if/when triggered)

1. `router.tsx`: `lazyRouteComponent` for the 15 page components;
   Login/Setup/AppLayout/RootLayout stay eager; dev-only route objects and
   imports both inside the DEV branch (assert absent from prod build).
2. Recreate `pages/browse/BrowsePageWrapper.tsx` (the preserved prototype
   diff omits this untracked file); point the index route at
   `pages/BoxSelection` directly.
3. Router options: `defaultPreload: "intent"`; `defaultPendingComponent`
   with the two-semantics design above; explicit
   `defaultPendingMs`/`defaultPendingMinMs`.
4. Rely on `lazyRouteComponent`'s built-in failure reload; add route error
   UI + telemetry (client-debug-log) for the unrecoverable case.
5. Deploy atomicity: pick and land one mitigation (asset retention window /
   versioned release dirs / delayed-retry UI) BEFORE enabling the split.
6. Land the prototype's `CB_ANALYZE_FINE=1` per-file attribution mode for
   `bundle-analysis-report.ts` (useful independent of this plan — could land
   any time).
7. Verify: full suite; every route via the dev router; throttled pending
   states (both semantics); stale-chunk recovery with TWO coherent builds
   (load v1 → replace with v2 → navigate → confirm reload lands on v2), plus
   the unrecoverable-404, offline, and preload-failure cases; re-measure
   `analyze:bundle` (initial gzip ≤300 KB gate) and the dev-mode per-route
   request count.

## Rollback

Confined to `router.tsx` + two shell files + router options (+ whatever
deploy mitigation was chosen, which is independently valuable). Reverting
restores the eager tree. No data, schema, or server surface touched.
