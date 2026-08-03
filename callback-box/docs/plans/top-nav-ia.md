# Unified app bar: one nav for chat and everything else

Replace the two stacked header rows (the AppNav link bar + the chat header
chips row) with a single unified app bar, navigate by place (box ▸ landmark)
through a split-pill chip, make chat the default landing, merge the Chats
picker into the Landmarks page, and demote the Dashboard to a box-tools
submenu. The current eight-link nav carries destinations no user job reaches
by cold navigation; the landing page (Dashboard) taxes the most frequent job;
and Chats/Landmarks are two halves of one activity-switching surface.

Designed interactively with the boxholder 2026-08-02 (mockups:
`scratch/nav-unified.html`, gitignored); supersedes the earlier two-link-nav
revision of this plan. The earlier revision's Codex findings that still apply
(canonical `/chat`, no new overview procedure, unassigned-session bucket as
new behavior, `olderSessions` preservation, visible landmark parse failures,
`NAV_ROUTES` compatibility) are carried forward.

## Jobs this serves

- When I open the app on my phone with a thought or a photo to capture, I
  want the composer in front of me immediately, so I can put it down and
  move on. (Today: land on Dashboard, tap Recent, then compose.)
- When I was chatting about trip planning yesterday and want that thread
  back — not the grocery thread from this morning — I want to switch by
  *activity*: tap the place name, tap the landmark, land in its chat.
- When I'm chatting inside "Recipes" and want its pinned cards (the bread,
  Knife Skills), I want them one tap away — they are the curated heart of
  the landmark, not buried fiddling.
- When a schedule failed or I want to inspect the box (files, history,
  health), I want box-scoped tools findable behind the box's own name —
  not behind an avatar, which reads as account settings everywhere else.

## The design (converged with the boxholder)

One bar, all pages, no second header row:

```
[ test1 ▸ 🍳 Recipes ▾ │ 📁 recipes/ ▾ ]      [Sourdough timing ▾] [🎙 ▾] [◎ 4] [avatar]
  └─ switch menu          └─ here menu          └─ session chip    voice   plate  meta
```

Category → control (the boxholder's taxonomy):

- **Place (box | landmark)** — the split pill. Left half (box prefix +
  landmark name) opens the **switch menu**; right half (folder + dir
  basename) opens the **here menu**. Split pill follows the VoiceChip
  split-face idiom (`docs/implemented-plans/chat-header-chips.md`).
- **I/O** — the voice chip, unchanged (mic + narration pooled for target
  size). Chat pages only.
- **Chat fiddling** — the session chip: face is the session title
  (truncated), menu is New session / Model / Advanced. "Recent chats"
  drops out — the switch menu owns finding sessions. Replaces the `⋯`
  ChatMenu face; an unlabeled `⋯` stops working once every other menu
  face names its object. Phone face: a sliders icon, no title.
- **Landmark fiddling** — the here menu: today's ContextChip root
  verbatim (Open dir/, pinned links at root level, Recent files ›). The
  bookmarks are deliberately NOT in a sub-panel.
- **Meta** — avatar menu: Settings, Admin, Source View, Debug Log, Sign
  out. Nothing content-shaped remains here.
- **Attention** — the plate badge (nonzero only), with a real icon (a
  plate-rim SVG + count) replacing the `☑` text glyph. The Questions
  badge and nav entry are removed (boxholder decision; an inline-question
  concept will replace the standalone surface).

Menu layouts (stable rows above variable lists — boxholder rule; list
continuations at the bottom):

```
switch menu                    Box submenu (web only)      here menu
┌───────────────────┐          ┌──────────────────┐        ┌──────────────────┐
│ Box: test1      ▸ │ stable   │ ‹ Box: test1     │        │ Open recipes/    │
│ All landmarks   → │ stable   │ Overview         │        │ ── links ──      │
│ ── Switch to ──   │          │ Browse           │        │ 🍞 the bread     │
│ 🍳 Recipes      1 │ variable │ History          │        │ 🔪 Knife Skills  │
│ ✈ Trips         2 │          │ ──               │        │ Images       134 │
│ 🛒 Groceries      │          │ Other boxes    → │        │ ──               │
│ 🏠 Box root       │          └──────────────────┘        │ Recent files   ▸ │
└───────────────────┘                                      └──────────────────┘
```

- Tapping a landmark resumes its most recent session or starts one (the
  existing `LandmarkSection` ChatButton logic).
- "Other boxes →" navigates to the front page (the box selector). No box
  list is ever rendered in-menu — rare operation, and the iOS app's
  native chrome owns box picking, so the web menu and iOS menu stay
  structurally identical except the Box row, which is suppressed in the
  native shell.
- Fresh-chat counts render per-landmark in the switch menu; the
  bar-level fresh badge is retired with the link row.

Responsive rules (explicit, not emergent): the bar keeps exactly one
flexible member — the pill's landmark label. Sacrifice order as width
shrinks: (1) box prefix on the pill, (2) dir label on the folder half
(icon-only), (3) session title (chip becomes the sliders icon). The bar
never wraps and never grows a hamburger.

Non-chat pages: same bar; chat-only chips (session, voice) absent; the
pill's left half shows the page as the place (`test1 ▸ All landmarks`,
`test1 ▸ Browse: store/recipes/`); the here half renders when a landmark
context exists (Browse inside a landmarked dir), else hides.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — reuse-over-rebuild,
  validate-at-boundaries, resilient-not-silent.
- `callback-box/CLAUDE.md` — "Frontend uses UI primitives and a semantic
  palette. Read frontend.md before writing UI"; components own their
  appearance under `components/`.
- `callback-box/frontend.md` — `restrict-component-classes`; primitive
  extraction only at 3+ uniform repeats; coral is app-nav-gradient-only.
- `callback-box/src/frontend/src/components/chat/CLAUDE.md` — composer
  input store isolation; companion-pane memo stability (the bar mounts
  above both; new bar state must not re-render chat internals per
  keystroke).
- Precedents: `docs/implemented-plans/chat-header-chips.md` (chip/menu
  idiom, split-pill face, one-flexible-member rule, panel-swap submenus)
  and `docs/implemented-plans/nav-card.md` (card-driven nav — this plan
  relocates its rendering surface, see Track C3).
- Boxholder decisions (2026-08-02, this conversation): unified single
  bar; place chip as switcher; stable-above-variable menu layout; list
  continuations at menu bottom; bookmarks never in a sub-panel; no
  in-menu box list; Questions sidelined; "Landmarks" name stays; phone
  diet as specced.

## What already exists

- **Chat header chips (merged to main).** `ContextChip`
  (`src/frontend/src/components/chat/ContextChip.tsx`) — face = landmark
  label, menu = Open dir/ + `LandmarkLinksPanel` + Recent files ›, with
  the panel-swap submenu mechanism (`ContextChipPanel`,
  `ContextChip.tsx:34`, `panelIndex` on `Dropdown`). **Reused**: the here
  menu is this menu, moved into the bar. `VoiceChip` (split-pill face
  precedent) and `ChatMenu` (New session / Recent chats / Advanced;
  model selection) — **reused**: voice unchanged; ChatMenu becomes the
  session chip's menu minus Recent chats.
- **AppNav** (`src/frontend/src/components/AppNav.tsx`) — gradient bar,
  box `<select>`, link row from `useNavLinks`, QuestionsBadge
  (`AppNav.tsx:254`) / PlateBadge (`AppNav.tsx:276-289`: `☑` + count →
  `store/plate.todo-view.card`), ErrorBadge, ProfileMenu, mobile
  hamburger. **Rebuilt** as the unified
  bar: gradient, ErrorBadge, ProfileMenu (trimmed), PlateBadge (new
  icon) survive; link row, box `<select>`, hamburger, QuestionsBadge are
  removed.
- **Nav-card mechanism.** `useNavLinks`
  (`src/frontend/src/hooks/useNavLinks.ts`) resolves `nav.card` via
  `trpc.nav.get` with `DEFAULT_NAV_HREFS` fallback
  (`src/shared/nav-routes.ts:35-44`); `nav.card` validation derives from
  `NAV_ROUTES` (`src/schemas/nav.ts:30`). **Relocated**: with no link
  row, custom `nav.card` entries render as a section in the switch menu
  (Track C3); `NAV_ROUTES` keeps every entry (validation compatibility);
  `DEFAULT_NAV_HREFS` is retired from rendering (fallback boxes get the
  builtin switch menu, which needs no card).
- **Chat canonicalization.** `ChatPage` rewrites the resolved session
  onto `/chat` (`src/frontend/src/pages/ChatPage.tsx:191`); new-session
  assignment and the capture shim hard-code `/chat`
  (`components/chat/InteractiveChat-ws.ts:248`,
  `pages/capture/CapturePage.tsx:13`). **Constrains Track A**: the box
  root must redirect to `/chat`, not be the chat route.
- **Chat landing on an empty box.** `chat.bootstrap` returns
  `sessionId: null` (`src/webapp/trpc/routers/chat-bootstrap-procedure.ts:46-49`);
  `ChatPage.tsx:162` maps null → `"new"` — fresh composer, session
  created on first send. **Reused unchanged.**
- **Landmark data for the switch menu.** `chat.byLandmark`
  (`src/webapp/trpc/routers/chat.ts:100-150`) — per-landmark fresh
  sessions + `olderSessions` + `freshCount`; buckets sessions by
  `contextDir` but emits only buckets that have a landmark card
  (`loadLandmarkSummaries`, `src/core/landmark/summaries.ts:92-131`, no
  synthetic root); landmark-less sessions are dropped today. AppNav
  already fetches this query on every page (fresh badge). **Reused** for
  the switch menu's landmark list + counts; **extended** (Track B) with
  an unassigned bucket.
- **Resume-or-start logic.** `LandmarkSection`'s ChatButton
  (`src/frontend/src/components/landmarks/LandmarkSection.tsx:154-193`):
  `chat.lastSessionForDirectory` → navigate with `session` or
  `session=new&contextDir=`. **Reused** as the switch-menu row action.
- **Here-menu data.** `trpc.landmarks.forDir`
  (`ContextChip.tsx:172-175`) and `LandmarkLinksPanel`. **Reused
  unchanged.**
- **Semantic root links.** `SettingsPage.tsx:22`, `AdminPage.tsx:26`,
  `pages/card/CardViewPage.tsx:31` link to the box root meaning
  Dashboard. **Re-pointed** in Track A.
- **Landmarks page / Chats page.** `LandmarksList` + `LandmarkSection`
  (links, groups, depth indent) and `ChatsPicker` + `ChatsLandmarkCard`
  (sessions, Show older) — same landmark-keyed page, projected twice.
  **Merged** (Track D) by extending `LandmarkSection`; `ChatsPicker`
  survives for `view: chat-picker` cards.
- **Silent landmark parse failures.** `parseLandmarkFields` → null
  (`src/schemas/landmark.ts:196-208`), skipped without warning
  (`summaries.ts:113`). **Made visible** (Track B `problems`).
- **No landmark full form exists.** `docs/landmarks.md:119-134`
  describes one; the code renders full link lists only on the Landmarks
  page; `CardViewPage` renders `FileView` (`CardViewPage.tsx:38`).
  **Constrains Track D**: caps use inline disclosures, no click-through
  to a nonexistent view. The stale doc section is corrected in Track E.
- **Native/embed chrome.** `embed=1` already hides the entire bar
  (`app-shell.tsx:53`); `nativeComposer=1` (`router.tsx:94`) is the
  native mode that keeps web chrome. **Used**: the Box-row suppression
  gates on `nativeComposer`.

## Prior art (external)

- Navigation-destination count guidance (Material navigation bars are
  designed for 3–5 destinations; [Smashing Magazine's mobile-navigation
  rules](https://www.smashingmagazine.com/2016/11/the-golden-rules-of-mobile-navigation-design/)
  warn against more than five): the unified bar carries two navigation
  menus + three utility controls, under the ceiling.
- Split-button / split-pill controls are an established pattern
  (toolbar split buttons; this repo's own VoiceChip). No further search
  needed — the in-repo precedent is denser than external guidance.
- The "current-location control opens a location switcher" convention
  (breadcrumb menus, workspace/channel switchers) is ubiquitous;
  adopted here as the switch menu. No external citation needed beyond
  the convention's ubiquity.

## Tracks / scope

### Track A — Routes: chat landing, /dashboard, root-link audit

**What.** `/$boxSlug/` redirects to `/$boxSlug/chat`; Dashboard moves to
`/$boxSlug/dashboard`; root-meaning-Dashboard links re-point.

**Direction.**
- `router.tsx`: index child of `boxLayoutRoute` becomes a `beforeLoad`
  redirect to `/chat` (mechanism of `boxCatchAllRoute`,
  `router.tsx:207-213`); `dashboardRoute` → `path: "dashboard"`.
- `nav-routes.ts`: relabel `{ href: "/", label: "Chat" }` (entry kept —
  `src/schemas/nav.ts:30` derives validation from the table; removal
  would invalidate existing `nav.card`s); add
  `{ href: "/dashboard", label: "Dashboard" }`.
- Re-point: `SettingsPage.tsx:22` + `CardViewPage.tsx:31` ("Back to
  Dashboard") and `AdminPage.tsx:26` ("Back") → `/dashboard`. Grep for
  other `href(\`/${boxSlug}\`)`-family constructions; each is a semantic
  decision (Dashboard vs landing).
- `BoxSelectionTiles.tsx`: box-name link keeps targeting the root (now →
  chat); the redundant Chat quick link is removed; Capture stays.

**First chunk.** All of the above + route doctests. No open questions.

### Track B — Backend: unassigned bucket + visible parse problems

**What.** `chat.byLandmark` gains an `unassigned` bucket; `landmarks.list`
(and the summaries path) gains `problems`.

**Direction.**
- `byLandmark`: session groups whose `contextDir` has no landmark card
  (root with no root landmark; deleted-landmark dirs) emit as one
  trailing bucket (label "Other chats"; per-session `contextDir` shown
  when nonempty; "New" starts a root-bound chat). `olderSessions` kept
  for every bucket. Today these sessions are silently dropped
  (`chat.ts:127-145` maps over landmarks only).
- `byLandmark` per-bucket fields (Codex rev-2 finding 3): the picker's
  visible-session capping (`chat.ts:128-145`: non-root buckets show one
  fresh session inline, the rest fold into `olderSessions`) makes bucket
  fresh counts unrecoverable client-side, and the sort uses only the
  visible session. Add explicit `freshCount` and `latestActivity` per
  bucket (caps unchanged for the picker's rendering); the switch menu
  and the merged page's ordering consume these.
- `loadLandmarkSummaries` returns `{ summaries, problems }` — files
  matching `**/*.landmark.card` whose frontmatter fails to parse
  (`summaries.ts:113` silently `continue`s today) — and both
  `landmarks.list` and `chat.byLandmark` pass `problems` through (the
  switch menu consumes `byLandmark` only, so problems must ride it).
  Consumers render a warning row (Tracks C/D). (Resilient-not-silent:
  once the switch menu is the sole activity switcher, a hand-edit must
  not make an activity vanish without trace.)
- `chat.bootstrap` gains the session's display `label` (from the husk
  card, the same source the pickers read) — the session chip's face
  needs it and no chat-page query carries a title today (Codex rev-2
  finding 7; `chat-bootstrap-procedure.ts:26-32` returns only
  id/history/status). Refreshes with bootstrap's existing invalidation.

**First chunk.** All extensions + doctests (`makeTestServer()` tier):
unassigned bucket with root sessions and orphaned `contextDir`;
`olderSessions` preserved; per-bucket `freshCount`/`latestActivity`;
`problems` on a malformed card through both procedures; bootstrap
`label`. No open questions.

### Track C — The unified bar

**C1 — place pill (works standalone before chat-chip integration).**
New `PlacePill` in `components/` (bar-owned): split pill; left half =
box prefix (`sm:` up) + landmark symbol/label + caret; right half =
folder icon + dir basename (`sm:` up). Switch menu: `Box: <name> ▸`
(submenu: Overview → `/dashboard`, Browse → `/browse`, History →
`/history`, divider, Other boxes → `/`), `All landmarks →`
(`/landmarks`), divider, landmark rows from `chat.byLandmark` (symbol,
label, per-bucket fresh count; current highlighted; resume-or-start on
tap; the unassigned bucket's sessions are reachable on the Landmarks
page, not in this menu — the menu lists landmarks only, plus Box
root), and a parse-problem warning row when `problems` is nonempty.
Dropdown submenus use the existing `panelIndex` swap mechanism
(`ContextChip.tsx:194-199`).

**Switch-menu data is fetched lazily on first open** (query `enabled`
by dropdown open, cached across opens), NOT mounted globally: AppNav's
own comment rejects broad always-on queries in a bar that mounts on
every page (`AppNav.tsx:103`, the slim `status.navStatus` rationale),
and `byLandmark` globs every landmark and enumerates every session
(`chat.ts:104-108`). The bar's current always-on `byLandmark` fetch
(the fresh badge, `AppNav.tsx:94`) is removed with the badge, so this
is a net reduction in resting cost. Open-latency is checked in the
browse walk; cached data renders immediately on re-open.

**Here menu (two providers).** On chat pages, the full ContextChip body
(Open dir/, `LandmarkLinksPanel`, Recent files ›) requires chat-owned
state — `messages` for Recent files and `onZoomView` for companion-pane
zoom (`ContextChip.tsx:108-126,181-192`) — so the chat page supplies
the menu body via the chrome slot (C2); `{dir, label}` context alone
cannot carry it (Codex rev-2 finding 1). On non-chat pages the bar
renders a reduced here menu itself: Open dir/ + landmark links as
plain navigations (`/views/…`), no Recent files, no zoom. The reduced
form is also the fallback while the chat slot hasn't mounted.

**C2 — chrome slot: chat chips into the bar, chat header row removed.**
The bar is global (`AppLayout`); the session/voice chips and the full
here menu are chat-page state. Mechanism: a chrome module
(`app-bar-chrome.tsx`) provided by `AppLayout`, designed for render
stability (Codex rev-2 findings 6, 9 — a portal relocates DOM, it does
NOT isolate renders; `InteractiveChat`'s root re-renders on every
streaming token, `chat/CLAUDE.md`):
- **Split read/write contexts**: the writer context (stable setter
  functions, `[]`-dep) is what pages consume; the reader context is
  consumed only by the bar. A publish during streaming must not exist
  at all: publications happen on navigation/session-change effects with
  primitive deps (`dir`, `label` strings), never per-render.
- `useAppBarPlace({ dir, label })`: pages publish their place (chat:
  session `contextDir`; Browse: current path; others: static label).
  Each publication carries an owner token (the hook instance);
  cleanup clears only its own publication, so a stale unmount cannot
  erase a newer page's value. Bar fallback = route-derived label.
- **Two portal slots** rendered by the bar: `chipSlot` (session chip +
  voice chip) and `hereSlot` (the full ContextChip menu body). Chat
  renders into both via `createPortal`; state ownership stays in
  `InteractiveChat`. Every portaled component is memoized with stable
  props (the `CompanionViewPanel` discipline, `chat/CLAUDE.md`), so the
  root's per-token re-renders reconcile to no-ops in the bar.
- **Render-count assertions** extend the existing probe: on a streamed
  turn, AppNav and the portal subtrees must not tick (not just the
  companion pane).
The chat header row (`InteractiveChat-layout.tsx:27` — h1, ContextChip,
VoiceChip, ChatMenu) is removed; a visually-hidden `h1` preserves the
page heading semantics (Codex rev-2 finding 10; `CaptureChip`/
`UploadChip` are transcript renderers and `TargetStrip` sits below the
list — none are orphaned). The session chip (face: bootstrap `label`,
truncated, desktop / sliders icon `sm:` down; menu: New session,
Model ›, Advanced ›) replaces ChatMenu.

**C3 — bar cleanup + nav.card relocation + native suppression.**
Remove: link row, box `<select>`, mobile hamburger + current-page
label, QuestionsBadge, and `DEFAULT_NAV_HREFS` (no remaining runtime
consumer once fallback rendering is gone — verified by Codex rev-2
finding 4). Keep: ErrorBadge; ProfileMenu minus Dashboard (Settings,
Admin, Source View, Debug Log, Sign out). PlateBadge: plate-rim SVG +
count (same target, `/browse/store/plate.todo-view.card`).

`useNavLinks` retires, but two of its responsibilities transfer
explicitly (finding 4): the `nav.get` **file-change invalidation
subscription** (`useNavLinks.ts:58`) moves to the switch menu's
nav-section consumer so an edited `nav.card` still reshapes the menu
live; the `/chats`+`/questions` **badge map** (`useNavLinks.ts:72`)
retires with the badges.

**nav.card rendering policy** (finding 2 — `nav.get` resolves both
`href:` and `ref:` entries, `core/nav.ts`): the switch menu's custom
section renders (a) every `ref:` entry (box-card destinations — these
have no builtin home), and (b) `href:` entries whose target is NOT
already a builtin menu row. Dedup table: `/` and `/chat` → duplicate of
the chat landing (skip); `/landmarks`, `/browse`, `/history`,
`/dashboard` → duplicates of builtin rows (skip); `/chats` → duplicate
of `All landmarks` post-redirect (skip); `/settings`, `/admin`,
`/questions`, `/capture` → render (still-real destinations with no
other menu presence; a box that pinned Questions keeps its entry until
inline questions land). Labels from the card, fallback `NAV_ROUTES`.
Boxes without a `nav.card` get no section.

Native shell: AppLayout already omits the whole bar under `embed=1`
(`app-shell.tsx:53`), so the Box-row suppression keys on
**`nativeComposer=1`** — the native mode that keeps web chrome
(`router.tsx:94`; Codex rev-2 finding 8). Release-note the nav.card
relocation (Track E).

**Vocabulary lock-ins.** "PlacePill", switch menu / here menu; session
chip; `problems`; unassigned bucket label "Other chats".

### Track D — Landmarks page merge + /chats redirect

As previously planned, adjusted to the unified design: extend
`LandmarkSection` with a sessions slot (rows + Show older + New chat,
replacing the lone ChatButton), link cap (first 6 tiles + inline "Show
all N" disclosure — the group-disclosure pattern at
`LandmarkSection.tsx:122-152`), groups stay collapsed count-chips, drop
the depth indent (`LandmarkSection.tsx:69`), order by latest session
activity (no-session landmarks after, root first then alphabetical —
`byLandmark`'s sort), render the unassigned bucket last and
parse-problem warning rows. `view: landmarks` cards gain sessions too
(acceptable — same surface). `/chats` → `<Navigate replace>` shim to
`/landmarks` (CapturePage pattern). `ChatsPicker` stays for
`view: chat-picker` cards.

### Track E — Docs + release note

`docs/landmarks.md`: rendering section rewritten (merged surface, caps,
disclosures; delete the never-built tile/full-form description).
`docs/implemented-plans/nav-card.md` + `chat-header-chips.md`: pointer
notes (rendering surface relocated / header row absorbed into the app
bar). `docs/chat-session-lifecycle.md` if it references the Chats page.
Release note: `nav.card` entries render in the switch menu now; `/`
lands on chat; `/chats` redirects. Grep agent-facing text
(`src/dev/knowledge-audits.yaml`, agent guide, schema instructions) for
stale "Dashboard landing"/"Chats page" wording.

## Subplans

None. Inline questions, dashboard redesign, per-box icons, dir-scoped
History are adjacent efforts (see NOT in scope).

## Failure modes

**Critical gap:** none unresolved.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `nav.card` box: entries no longer render as a link row | Nav resolver doctest updated (C3) | Entries render in the switch menu; validation unchanged | Clear; release-noted |
| `nav.card` referencing `/` (was Dashboard) lands on chat | Route doctest (A) | Entry valid; meaning changes | Clear; release-noted |
| Bookmarked `/$boxSlug/` or `/chats` | Route doctests (A, D) | Redirects (chat / landmarks) | Clear |
| Root-meaning-Dashboard links become "back to chat" | Root-link audit + grep (A) | Re-pointed to `/dashboard` | Clear |
| Chip/here slot element not yet mounted when chat renders | Covered by conditional render (portal only when slot non-null); reduced here menu is the interim | One-frame absence, then content appears | Clear (visual only) |
| `place` stale after leaving chat (pill shows old landmark on Browse) | Automated nav-sequence check (chat→Browse→Landmarks) in C2's done-when | Owner-token cleanup: a hook instance clears only its own publication | Clear |
| Bar/portal subtree re-renders per streaming token (perf regression) | Render-count probe extended to AppNav + portals (C2) | Split read/write contexts; memoized portal content; primitive-dep publications | Clear if probe run — in C2's done-when |
| Switch menu open is slow on a large box (byLandmark globs all landmarks + sessions) | Browse-walk timing check (E) | Lazy fetch on first open + cache; resting cost drops (always-on badge fetch removed) | Clear |
| Custom `nav.card` resurrects `/questions` or duplicates builtin rows | Nav-section doctest (C3) | Dedup policy table (C3) | Clear |
| Edited `nav.card` no longer live-updates the menu | Covered by transferred file-change subscription (C3) | Subscription moves with the consumer | Clear |
| Sessions bound to dirs with no landmark invisible in the switch menu | Doctest (B) for the data; Landmarks page renders the bucket (D) | Menu lists landmarks only (deliberate); "All landmarks →" reaches the bucket | Clear — was silent before this plan |
| Malformed landmark vanishes from the switcher | Doctest (B); warning rows (C1, D) | `problems` surfaced in both surfaces | Clear — was silent before |
| Empty box lands on chat, no sessions | Existing (`bootstrap` null → `"new"`) | Fresh composer | Clear |
| Native shell shows web Box row over native box picker | `nativeComposer` gate (C3) | Row suppressed under `nativeComposer`; `embed` already hides the whole bar (`app-shell.tsx:53`) | Clear |
| Health warnings unseen (Dashboard off all bars) | No | Server-side runbooks (`docs/health-checks.md`); Overview reachable via Box submenu | **Accepted risk** (boxholder: dashboard was never the alert channel) |
| Voice/session chips regress companion-pane memo stability (bar re-renders on chat state) | Render-count probe (chat CLAUDE.md procedure) run in C2 | Chips portal from `InteractiveChat` (state ownership unchanged) | Clear if probe run — explicitly in C2's done-when |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: no schema changes; landmark
  authoring instructions unchanged.
- **Stale ref** — ADDRESSED: link tiles render "Missing"
  (`LandmarkSection.tsx:215-222`); deleted-landmark sessions surface via
  the unassigned bucket (B/D).
- **Two agents touching the same card** — not applicable: no card
  writes.
- **Hand-edit drift** — ADDRESSED: parse failures become visible
  (`problems`, B/C1/D); invalid `nav.card` degrades to the builtin
  switch menu (no custom section).
- **Fabricated free-form value** — not applicable.
- **Validation error UX** — ADDRESSED: `NAV_ROUTES` retains all hrefs;
  no box starts failing validation; meaning changes release-noted.
- **Partial migration / transition state** — ADDRESSED: no data
  migration; tracks are internally consistent at commit boundaries. The
  bar and the chat header swap in one track (C2) — no intermediate
  double-header state ships.

## NOT in scope

- **Inline questions** (replacement concept) — this plan only removes
  the Questions nav presence; page/route/subsystem stay.
- **Dashboard/Overview redesign** — it demotes; redesign is the
  first-run-experience effort's problem, which this plan makes
  non-blocking (new users land in chat).
- **Dir-scoped History** — the symmetry slot exists in the here menu for
  later; new backend capability, not built now.
- **Landmark full-form renderer** — inline disclosures suffice; the
  stale doc section is corrected instead.
- **`/card/$` vs `/views/$` consolidation** — separate cleanup; filed on
  completion.
- **Per-box icons / box-selector redesign** — only the redundant Chat
  tile link is touched. (If per-box emoji faces land later, the pill's
  box prefix can carry them — the whole pill stays one target class.)
- **Return-visit memory** — orthogonal.
- **Retiring `view: chat-picker`** in favor of session-bearing
  `view: landmarks` — later decision.
- **Removing questions subsystem wire fields** — after inline questions.

## Open design questions

- **"Overview" vs "Dashboard"** as the Box-submenu label. Lean:
  "Overview" (the page's new role); recognition argues "Dashboard".
  Settle at browse-walk.
- **Sliders icon** for the phone session chip: exact glyph (SVG, not
  `⋯`, not an emoji). Settle in C2.
- **Link cap N=6** on the merged Landmarks page. Settle at browse-walk
  with real box data.

## Knowledge audits

No new agent-facing concept: card formats, schemas, and validation are
unchanged; changes are shell rendering and routing. Track E greps
agent-facing text for stale UI wording. Skip-with-rationale for new
entries: agents do not navigate the web UI.

## Implementation order

1. **B** — backend extensions + doctests (independent of all UI).
2. **A** — routes/landing + doctests.
3. **C1** — place pill + menus (bar still has the old link row beside it
   momentarily in-branch; removed in C3).
4. **C2** — chrome slot, chat chips into bar, chat header row removed,
   render-count probe.
5. **C3** — link row/box-select/hamburger/QuestionsBadge removal,
   nav.card switch-menu section, plate icon, native suppression.
6. **D** — Landmarks merge + /chats redirect.
7. **E** — docs, release note, wording greps, full `bin/browse` walk
   (desktop + 390px) as the acceptance pass.

Each chunk commits; the plan ships as one unit on the boxholder's
signal.

## Rollout shape

- **Tests.** Doctests: byLandmark unassigned/olderSessions,
  landmarks.list problems (B); route redirects `/`→chat,
  `/dashboard`, `/chats`→landmarks, `/capture` unchanged (A, D); nav
  resolver with custom card → switch-menu section (C3). Behavioral/
  layout verification via `bin/browse` walk at desktop + 390px: pill
  menus, truncation order, chip portal, badge, non-chat pill labels
  (E). Render-count probe after C2 per chat CLAUDE.md.
- **Migration.** None. `nav.card` boxes keep validating; rendering
  relocation + `/`/`/chats` meaning changes release-noted.
- **Issue filing on completion.** `/card/$`-vs-`/views/$` tension;
  pointer from first-run-experience issue to the new landing.
