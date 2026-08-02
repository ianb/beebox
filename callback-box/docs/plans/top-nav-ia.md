# Top-nav IA revision: two destinations, landmark-centered switching, chat as landing

Revise the app shell's top navigation from eight builtin links to two (Chat,
Landmarks), merge the Chats picker and Landmarks page into one
landmark-centered surface, make Chat the default landing for a box, and
demote the Dashboard to an ops plane reached from the profile menu. The
current nav carries destinations that no user job reaches from cold
navigation, and the default landing (Dashboard) taxes the most frequent job
(get a thought into the box).

Revised 2026-08-02 after a Codex cross-model review; the review's accepted
findings are folded in below (canonical-route inversion, no new overview
procedure, orphan-session bucket as new behavior, older-sessions
preservation, visible landmark parse failures, nav-card compatibility
policy).

## Jobs this serves

- When I open the app on my phone with a thought or a photo to capture, I
  want the composer in front of me immediately, so I can put it down and
  move on. (Today: land on Dashboard, tap Recent, then compose.)
- When I was chatting about trip planning yesterday and want that thread
  back — not the grocery thread from this morning — I want to switch by
  *activity*, so I can resume where that activity left off. (Today: split
  across two pages — Chats groups sessions by landmark, Landmarks shows the
  landmark's content but hides its sessions.)
- When I'm inside the "Recipes" activity, I want its pinned cards and its
  conversations in one place, so I don't have to hold the join in my head.
- When a nightly schedule failed or I want to check what the box did, I
  want an ops view, so I can inspect and re-run — but this is a
  weekly-order job, not a landing page.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — principle tracing for
  design choices; especially reuse-over-rebuild, validate-at-boundaries,
  and resilient-not-silent.
- `callback-box/CLAUDE.md` — "Frontend uses UI primitives and a semantic
  palette. Read frontend.md before writing UI"; "don't add features beyond
  what the task requires."
- `callback-box/frontend.md` — `restrict-component-classes` (pages use
  outer-layout classes only; appearance lives under `components/`);
  primitive-extraction rule (3+ repeats before a new primitive).
- Precedents: the nav-card plan
  (`docs/implemented-plans/nav-card.md`) — the nav is a card-driven surface
  with a builtin fallback; this plan changes the fallback, not the
  mechanism. The chat-header chips plan
  (`docs/implemented-plans/chat-header-chips.md`) — the sibling precedent
  that per-conversation controls live in chat chrome, global switching in
  the shell.
- Boxholder decisions from the planning conversation (2026-08-02):
  Questions leaves the nav (an inline-question concept will replace the
  standalone surface); landmarks are the real activity axis ("the
  different landmarks are the real different activities that you want to
  return to"); the landmark *name* stays; the Dashboard is "almost like an
  admin plane" and should launch History and Browse.

## What already exists

- **Nav resolution.** `src/shared/nav-routes.ts:17-44` — `NAV_ROUTES`
  (href→label table) and `DEFAULT_NAV_HREFS` (the builtin fallback list:
  `"/", "/chat", "/chats", "/questions", "/browse", "/landmarks",
  "/history", "/capture"`). `useNavLinks`
  (`src/frontend/src/hooks/useNavLinks.ts`) resolves a box's `nav.card`
  via `trpc.nav.get` and falls back to this list. `nav.card` href
  validation derives from the same table
  (`src/schemas/nav.ts:30`: `const validHrefs = new
  Set(NAV_ROUTES.map((r) => r.href))`) — so `NAV_ROUTES` entries can be
  relabeled but never removed without invalidating existing cards.
  **Reused** — the plan edits the fallback list and labels; the
  card-driven mechanism is untouched; no `NAV_ROUTES` entry is removed.
- **Chat canonicalization.** `/chat` is the canonical chat URL and the
  client actively enforces it: `ChatPage` rewrites the resolved session
  onto `/chat` (`src/frontend/src/pages/ChatPage.tsx:191`:
  `void navigate({ to: href(\`/${boxSlug}/chat\`), … replace: true })`),
  and new-session assignment and the capture shim also hard-code `/chat`
  (`components/chat/InteractiveChat-ws.ts:234`,
  `pages/capture/CapturePage.tsx:13`). **Constrains the design**: the box
  root cannot *be* the chat route without fighting these; it must
  redirect to `/chat` (Track 1).
- **AppNav shell.** `src/frontend/src/components/AppNav.tsx` — link row,
  box switcher, `QuestionsBadge`/`PlateBadge`/`ErrorBadge`, `ProfileMenu`
  (Settings, Admin, Source View, Debug Log, Reload, Sign out). **Reused**
  — the profile menu gains a Dashboard entry; the Questions badge is
  removed; the fresh-chats badge re-keys (Track 2).
- **Routing.** `src/frontend/src/router.tsx` — `dashboardRoute` is the
  index child (`path: "/"`) of `boxLayoutRoute` (`router.tsx:73-77`), so
  `/$boxSlug` renders `DashboardPage`. `boxCatchAllRoute`
  (`router.tsx:207-213`) redirects unknown paths to `/$boxSlug`.
  **Reused** — routes are re-pointed, not restructured.
- **Chat landing on an empty box.** `chat.bootstrap`
  (`src/webapp/trpc/routers/chat-bootstrap-procedure.ts:41-52`) returns
  `sessionId: null` when the box has no sessions, and `ChatPage` maps
  that to a fresh session (`ChatPage.tsx:162`: `bootstrap.data ?
  bootstrap.data.sessionId ?? "new" : …`) — the composer renders and the
  session is created on first send. **Reused unchanged.**
- **The two halves of the merged surface.**
  - `ChatsPicker` (`src/frontend/src/components/session-pickers/ChatsPicker.tsx:14-51`):
    fresh chats grouped by landmark via `trpc.chat.byLandmark`,
    per-landmark `ChatsLandmarkCard` with visible sessions, a
    collapsible `olderSessions` list
    (`ChatsLandmarkCard.tsx:74`), and New-chat.
  - `LandmarksList` (`src/frontend/src/components/landmarks/LandmarksList.tsx:14-47`):
    every landmark via `trpc.landmarks.list`, per-landmark
    `LandmarkSection` with symbol/label/path, a Chat button (resolves the
    *last* session only, `LandmarkSection.tsx:154-193`), link tiles, and
    collapsible groups.
  - Both are self-sufficient and also serve `view: chat-picker` /
    `view: landmarks` cards (`ChatsPicker.tsx:1-6`,
    `LandmarksList.tsx:1-6`, `src/frontend/src/renderers/view.tsx`).
  - `chat.byLandmark` (`src/webapp/trpc/routers/chat.ts:100-150`) buckets
    sessions by `contextDir` but **emits only buckets that have a
    landmark card** — it maps over `loadLandmarkSummaries` results, which
    contain no synthetic root entry
    (`src/core/landmark/summaries.ts:92-131`). Sessions bound to a
    directory with no landmark (including the root, when no root
    landmark card exists) are currently dropped from the picker.
    **Partially reused** — Track 3 extends `byLandmark` with an explicit
    unassigned bucket (new behavior, not reuse) and keeps
    `olderSessions`.
- **Capture.** Already absorbed: `/capture` is a redirect shim to
  `/chat?capture=1` (`src/frontend/src/pages/capture/CapturePage.tsx:1-13`).
  **Reused** — the route stays as a deep-link target; only the nav entry
  goes.
- **Dashboard.** `src/frontend/src/pages/DashboardPage.tsx` — health,
  attention (questions + inbox), schedules (the app's only schedules UI,
  `components/dashboard/ScheduleOverview.tsx`), recent activity, system
  info. **Reused** — page unchanged except gaining Browse/History links;
  it moves to `/$boxSlug/dashboard` and the profile menu.
- **Semantic "back to Dashboard" links.** Three pages link to the box
  root *meaning* the Dashboard: `SettingsPage.tsx:22-23` ("Back to
  Dashboard"), `AdminPage.tsx:26-27` ("Back"), and
  `pages/card/CardViewPage.tsx:31-32` ("Back to Dashboard"). **Must
  change in Track 1** — after the re-point, a root link means chat.
- **Landmark data.** `src/schemas/landmark.ts:95-102`
  (`LandmarkNavigation`: optional label/symbol/links/expand) and the
  resolver `src/core/landmark/resolve.ts` (expands, dedup, group caps).
  **Reused** — no schema change. The layout chaos ("options to include
  things … but not enough rules that it ends up consistent" — boxholder)
  is fixed at the rendering surface, not the schema. Note: a card whose
  frontmatter fails to parse is silently skipped today
  (`landmark.ts:196-208` returns null; `summaries.ts:113` `continue`s) —
  Track 3 makes that visible.
- **No landmark "full form" exists.** `docs/landmarks.md:119-134`
  describes a tile/full-form rendering design, but the code has no
  landmark-specific full view: the complete link list renders only on
  the current `/landmarks` page itself, and the generic card route
  renders `FileView` (`pages/card/CardViewPage.tsx:38`). The doc is
  aspirational relative to the code. **Constrains the design**: the
  merged surface caps links with an *inline* disclosure, not a
  click-through to a full view that doesn't exist.

## Prior art (external)

- Platform navigation guidance (Material Design navigation bar; echoed by
  [Smashing Magazine's mobile-navigation rules](https://www.smashingmagazine.com/2016/11/the-golden-rules-of-mobile-navigation-design/))
  recommends keeping top-level destinations few — no more than five;
  Material's bars are designed for 3–5. The current builtin nav has 8;
  this plan lands on 2 links + 2 situational badges + a profile menu,
  under that ceiling.
- Job-story framing (situational JTBD) per the project's own convention
  (`issues/CLAUDE.md:142-149`); no further external search needed — the
  method is already adopted.
- No external prior art applies to the landmark/chat merge itself: it is
  an internal vocabulary decision over this project's own concepts.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — Landing and route re-point

**What.** `/$boxSlug` redirects to `/$boxSlug/chat`; the Dashboard moves
to `/$boxSlug/dashboard`. `/chat` stays the canonical chat URL.

**Why.** The most frequent job (capture/chat) pays a navigation tax today;
the landing page is optimized for a weekly-order ops job. The box-selector
tiles already grew Chat/Capture bypass links
(`components/BoxSelectionTiles.tsx:37-63`) — evidence the landing is
wrong. The redirect (rather than making `/` the chat route) is forced by
the client's own canonicalization: `ChatPage` and the session/capture
flows rewrite to `/chat` (`ChatPage.tsx:191`,
`InteractiveChat-ws.ts:234`), so a root chat route would immediately
navigate away from itself and never match the nav's active state.

**Direction.**
- `router.tsx`: the index child of `boxLayoutRoute` becomes a
  `beforeLoad` redirect to `/$boxSlug/chat` (same mechanism as
  `boxCatchAllRoute`, `router.tsx:207-213`); `dashboardRoute` moves to
  `path: "dashboard"`.
- `nav-routes.ts`: `{ href: "/", label: "Dashboard" }` is **relabeled**
  `{ href: "/", label: "Chat" }` (kept — `src/schemas/nav.ts:30` derives
  `nav.card` validation from this table, so removal would invalidate
  existing cards; a card entry for `/` now lands on chat via the
  redirect). Add `{ href: "/dashboard", label: "Dashboard" }`.
- `ProfileMenu` gains a Dashboard `MenuItem` (to `/dashboard`) above
  Settings.
- **Semantic root-link audit:** `SettingsPage.tsx:22` and
  `CardViewPage.tsx:31` ("Back to Dashboard") re-point to `/dashboard`
  with unchanged labels — they mean the Dashboard. `AdminPage.tsx:26`
  ("Back") re-points to `/dashboard` for symmetry with Settings. Grep
  for further `href(\`/${boxSlug}\`)`/`href(\`/${boxSlug}/\`)`
  constructions during implementation; each one is a semantic decision
  (Dashboard vs. landing), not a mechanical rewrite.
- Box-selector tile: the box name link keeps targeting the box root
  (now → chat); the redundant per-tile Chat quick link is removed; the
  Capture quick link stays.

**Vocabulary lock-ins.** `/dashboard` as the Dashboard's route; `/chat`
canonical; `/` = redirect to chat.

**First implementation chunk.** The router + `nav-routes.ts` +
`ProfileMenu` + root-link audit + box-tile change, with route-level
tests. No open questions inside it.

### Track 2 — Nav fallback shrink

**What.** `DEFAULT_NAV_HREFS` becomes `["/chat", "/landmarks"]`; the
`/chat` label changes "Recent" → "Chat". Questions badge leaves AppNav.

**Why.** Per the jobs analysis: Capture duplicates Chat (it is a redirect
into it); Questions is being sidelined as a concept (boxholder decision);
Browse and History are link-following destinations, not cold-navigation
ones; Chats and Landmarks merge (Track 3); Dashboard demotes (Track 1).

**Direction.** Edit `DEFAULT_NAV_HREFS` and the `/chat` label
(`nav-routes.ts:19`). Remove `QuestionsBadge` from AppNav (both mobile
and desktop positions, `AppNav.tsx:170,254-267`); keep `PlateBadge` and
`ErrorBadge`. The fresh-chats badge (`useNavLinks.ts:72`, keyed to
`/chats` today) attaches to `/landmarks` when present, else `/chats`
(covers custom `nav.card`s that keep a `/chats` entry). `NAV_ROUTES`
keeps entries for `/questions`, `/browse`, `/history`, `/chats`,
`/capture` so existing `nav.card` files stay valid — only the *fallback*
shrinks.

**Vocabulary lock-ins.** Builtin fallback nav = Chat, Landmarks. Label
"Recent" retires.

**First implementation chunk.** The whole track is one chunk.

### Track 3 — The merged Landmarks surface

**What.** `/landmarks` becomes the single activity-switching surface:
every landmark rendered in one fixed template — identity (symbol, label,
path link), its recent chat sessions (resume + "Show older" + New chat),
and a capped row of pinned links with an inline show-all disclosure.
`/chats` becomes a redirect to `/landmarks`.

**Why.** ChatsPicker and LandmarksList are the same page projected twice
— both landmark-keyed, each missing the other's payload. The boxholder
uses both, manually joining them. And the landmarks page's layout is
chaotic because it renders whatever each card declares; the surface must
impose consistency the schema deliberately doesn't.

**Direction.**
- **Data: no new procedure.** The page consumes the two existing
  queries — `landmarks.list` (resolved links/groups) and
  `chat.byLandmark` (sessions) — and joins them by `dir` client-side.
  `AppNav` already fetches `chat.byLandmark` on every page
  (`AppNav.tsx`, fresh-count badge), so the join reuses the cached
  query instead of adding a third traversal. (A merged
  `landmarks.overview` procedure was considered and cut on Codex
  review: `byLandmark` is inline router logic, not a reusable
  implementation, and the join is a per-`dir` map lookup.)
- **`chat.byLandmark` extension (new behavior):** add an `unassigned`
  bucket for session groups whose `contextDir` has no landmark card —
  the root bucket when no root landmark exists, and any directory whose
  landmark was deleted after sessions bound to it. Today these sessions
  are silently dropped (`chat.ts:127-145` maps over landmarks only).
  The bucket renders at the end of the page labeled "Other chats", each
  session row showing its `contextDir` when nonempty; "New" in this
  bucket starts a root-bound chat. `olderSessions` is **kept** for
  every bucket — the picker's "Show older" disclosure
  (`ChatsLandmarkCard.tsx:74`) carries over; dropping it would make the
  merged surface strictly less capable than the page it replaces.
- **Page:** extend `LandmarkSection` (per Codex: the smaller change —
  its `LandmarkSymbol`/`LinkTile`/group pieces are private to it, and a
  parallel page-local card would duplicate them, violating
  reuse-over-rebuild) with: a sessions slot (rows + Show older + New
  chat, replacing the single Chat button at
  `LandmarkSection.tsx:154-193`); a link cap (first N=6 tiles, inline
  "Show all N" disclosure for the rest — the same disclosure pattern
  its groups already use, `LandmarkSection.tsx:122-152`); groups stay
  collapsed count-chips. Drop the depth-indent hierarchy
  (`LandmarkSection.tsx:69`) — flat list ordered by latest session
  activity (landmarks with no sessions after, root first then
  alphabetical, matching `byLandmark`'s existing sort). `LandmarksList`
  becomes the merged surface; `view: landmarks` cards therefore gain
  sessions too, which is acceptable — the card embeds the same
  activity-switcher surface.
- **Visible parse failures:** `landmarks.list` (and the summaries path)
  gains a `problems` list — files matching `**/*.landmark.card` whose
  frontmatter failed to parse (`parseLandmarkFields` null,
  `landmark.ts:196-208`). The page renders a warning row per problem
  ("⚠ recipes/Recipes.landmark.card didn't parse — not shown"). Once
  Landmarks is the sole activity switcher, a hand-edit must not make an
  activity silently vanish (resilient-not-silent).
- **Compatibility:** `ChatsPicker` stays for `view: chat-picker` cards;
  the `/chats` route becomes a `<Navigate replace>` shim to
  `/landmarks` (same pattern as `CapturePage.tsx`).

**Vocabulary lock-ins.** "Landmarks" stays the surface name (boxholder
decision); `unassigned` bucket + `problems` list on the wire.

**First implementation chunk.** The `chat.byLandmark` unassigned-bucket
extension + `landmarks.list` `problems` field, with doctest coverage
(route doctests, `makeTestServer()` tier), before any UI. No open
questions inside it.

### Track 4 — Dashboard as ops plane

**What.** Dashboard gains explicit launch links to History and Browse and
becomes the acknowledged ops hub.

**Why.** History and Browse leave the top bar (Track 2); their remaining
cold-navigation entry point is the ops plane, matching their diagnostic /
fallback jobs. The Dashboard keeps its attention strip (including pending
questions) so the sidelined Questions surface stays reachable until the
inline-question concept lands.

**Direction.** Add a compact link row to `DashboardPage` (History →
`/history`, Browse → `/browse`; Questions already links from
`AttentionCards`). No other dashboard change — its redesign (per
`issues/features/2026-07-20-first-run-experience.md`) is out of scope
because it no longer fronts the first-run experience.

**First implementation chunk.** The whole track is one chunk.

### Track 5 — Docs

Update `docs/landmarks.md` (rendering section: the merged surface, caps,
disclosures; delete or mark the never-built tile/full-form description —
it is stale relative to the code), the nav-card doc's fallback description
(`docs/implemented-plans/nav-card.md` gets a pointer, not a rewrite),
`docs/chat-session-lifecycle.md` if it references the Chats page, and a
release-note paragraph covering the `nav.card` behavior changes (a `/`
entry now lands on chat; a `/chats` entry redirects to `/landmarks`).

## Subplans

None. The dashboard/first-run redesign and the inline-questions concept
are adjacent efforts, deliberately not folded in (see NOT in scope).

## Failure modes

**Critical gap:** none unresolved.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A `nav.card` references `/` expecting Dashboard; after Track 1 it lands on chat | Nav resolver doctest updated (Track 1) | Entry stays valid (`/` kept in `NAV_ROUTES`); destination meaning changes | Clear (user sees chat; documented in Track 5 release note) |
| A `nav.card` references `/chats`; after Track 3 it redirects to `/landmarks` | Route doctest for the redirect | Redirect shim | Clear; documented in Track 5 |
| Bookmarked `/$boxSlug/` (old Dashboard) | Track 1 route doctest | Redirects to chat by design | Clear |
| "Back to Dashboard" links still pointing at box root after re-point | Covered by the Track 1 root-link audit + grep | Re-pointed to `/dashboard` | Clear |
| Sessions bound to a dir with no landmark (or deleted landmark) invisible on the sole switcher | Doctest (Track 3 chunk 1) | New `unassigned` bucket | Clear — was silent before this plan |
| Malformed landmark card makes an activity vanish from the switcher | Doctest (Track 3 chunk 1) | `problems` list + page warning row | Clear — was silent before this plan |
| A landmark's links all fail to resolve (moved/archived targets) | Existing resolver behavior; covered in merged-page doctest | Resolver returns `exists: false`; tile renders "Missing" (`LandmarkSection.tsx:215-222`) | Clear |
| Fresh-chat badge on a custom `nav.card` with neither `/landmarks` nor `/chats` | No | Badge doesn't attach (keyed by present hrefs, `useNavLinks.ts:72`) — same as today | Silent but harmless — the count is decoration |
| Empty box lands on chat with `sessionId: null` | Existing behavior (`chat-bootstrap-procedure.ts:46-49`, `ChatPage.tsx:162` maps null → "new") | Fresh composer; session created on first send | Clear |
| Health warnings go unseen because Dashboard is off the bar | No | `ErrorBadge` covers client errors only; server health surfaces only on Dashboard | **Accepted risk** — health checks also run server-side with their own runbooks (`docs/health-checks.md`); the dashboard was never a reliable alert channel (boxholder "almost never" visits it) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: no schema change; landmark
  authoring rules unchanged (`src/schemas/landmark.ts:138` instructions).
- **Stale ref** — ADDRESSED: link resolution already returns
  `exists: false` and the tile renders "Missing"
  (`LandmarkSection.tsx:215`); a deleted *landmark* with surviving
  sessions now surfaces via the `unassigned` bucket (Track 3).
- **Two agents touching the same card** — ADDRESSED (not applicable):
  this plan writes no cards; `nav.card` handling is unchanged.
- **Hand-edit drift** — ADDRESSED: landmark parse failures become
  visible (`problems` list + warning row, Track 3); invalid `nav.card`
  falls back to the builtin list (`useNavLinks.ts`).
- **Fabricated free-form value** — ADDRESSED (not applicable): no new
  agent-written fields.
- **Validation error UX** — ADDRESSED: `nav.card` href validation keeps
  accepting every current href (`NAV_ROUTES` retains all entries;
  `src/schemas/nav.ts:30` derives from it), so no existing box starts
  failing validation. Two entries change *meaning* (`/` → chat, `/chats`
  → redirect); that is a documented behavior change, not a validation
  failure.
- **Partial migration / transition state** — ADDRESSED: there is no data
  migration; each track is internally consistent at its commit boundary.
  Boxes with custom `nav.card`s keep their nav *entries* verbatim
  throughout; the `/` and `/chats` destination changes above are the
  only behavior deltas they see.

## NOT in scope

- **Dashboard redesign / first-run experience**
  (`issues/features/2026-07-20-first-run-experience.md`) — the landing
  change removes the dashboard from the first-run path; redesigning the
  ops plane is its own effort.
- **Inline questions** — the boxholder's replacement concept for the
  Questions surface; this plan only removes Questions from the nav. The
  page, route, badge data (`status.navStatus`), and subsystem stay.
- **Removing the questions subsystem or its `navStatus` fields** — wire
  cleanup follows once inline questions exist.
- **Landmark schema changes** (caps, layout rules in the card format) —
  consistency is imposed by the merged surface; the schema stays
  permissive for agent authoring.
- **A landmark full-form renderer** — `docs/landmarks.md` describes one;
  it was never built. The merged surface's inline disclosures make it
  unnecessary for this plan; building it is a separate decision.
- **`/card/$` vs `/views/$` consolidation** — `LandmarkSection` links into
  `/card/` (`LandmarkSection.tsx:225`) while most of the app uses
  `/views/`; real tension, separate cleanup (filed — see Rollout).
- **The chat header's session menu** — the sibling chat-header work
  (`docs/implemented-plans/chat-header-chips.md`) owns it; pointing its
  "Recent chats" item at `/landmarks` is a one-line follow-up there, not
  here.
- **`PlateBadge` and the plate surface** — stays as-is; it is the one
  situational nav element with a live daily job.
- **Box-selector redesign** (per-box icons etc.,
  `issues/features/2026-07-22-per-box-custom-icon.md`) — only the
  redundant Chat quick link is touched here.
- **Return-visit memory** (remember last box) — none exists today; adding
  it is orthogonal to what the landing page is.

## Open design questions

- **Link cap N.** Lean: 6 (fills the two-column tile grid three rows deep
  on desktop, one screen on mobile). Settle during Track 3 UI review with
  real box data.
- **Unassigned-bucket label.** Lean: "Other chats". Settle at UI review.
- **Does `view: chat-picker` eventually retire** in favor of
  `view: landmarks` (which now includes sessions)? Lean: yes, later; not
  in this plan.

## Knowledge audits

No new agent-facing concept lands: the landmark card format, `nav.card`
format, and all validation are unchanged; the changes are shell rendering
and routing. One existing audit surface is affected: any audit or
instruction text that tells agents "the Chats page" or "the user lands on
the Dashboard" — grep `src/dev/knowledge-audits.yaml`, the agent guide,
and schema instructions for `Dashboard`/`Chats page` references during
Track 5 and correct wording. Skip-with-rationale for new entries: agents
do not navigate the web UI; the UI's IA is not agent-recalled knowledge.

## Implementation order

1. **Track 1** — landing redirect, `/dashboard` move, `NAV_ROUTES`
   relabel/add, ProfileMenu, root-link audit, box tiles + route doctests.
2. **Track 2** — fallback shrink + badge removal/re-key. Depends on
   Track 1's `NAV_ROUTES` edits.
3. **Track 3 chunk 1** — `chat.byLandmark` unassigned bucket +
   `landmarks.list` `problems` field + doctests.
4. **Track 3 chunk 2** — merged `LandmarkSection`/`LandmarksList` UI,
   `/chats` redirect shim.
5. **Track 4** — dashboard launch links.
6. **Track 5** — docs sweep, stale full-form removal, release note,
   agent-text wording greps.

Each chunk is a commit; the plan ships as one unit (worktree → main on
the boxholder's signal).

## Rollout shape

- **Tests.** Route doctests for: `/$boxSlug/` → redirect to chat,
  `/dashboard` → dashboard, `/chats` → redirect to landmarks,
  `/capture` → unchanged shim. `chat.byLandmark` doctests: unassigned
  bucket (root sessions with no root landmark; orphaned `contextDir`),
  `olderSessions` preserved. `landmarks.list` doctest: `problems` on a
  malformed card. Merged-page behavior (cap, disclosures, ordering) is
  verified by a `bin/browse` walk of the worktree box at desktop and
  390px widths — the done-when is the doctests passing plus that walk.
- **Knowledge audits.** None new (see section); wording greps land with
  Track 5.
- **Migration.** None — no data shape changes. Boxes with custom
  `nav.card`s keep validating; the `/` and `/chats` destination changes
  are release-noted (Track 5). The fallback change reaches fallback
  boxes on deploy.
- **Issue filing on completion.** File the `/card/$`-vs-`/views/$`
  tension and a pointer from the first-run-experience issue to the new
  landing reality.
