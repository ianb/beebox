# Open chat from a card browse page

**Status:** Implemented (2026-06). Shipped in `OpenChatControl` on `CardViewPage`,
`chat.openForCard` + the `card.get` boundary guard, and `src/core/landmark/nearest.ts`;
covered by `test/landmark-nearest.doctest.md`. This doc is the frozen design record
(codex review folded in); the code and doctests are the living reference.

Add an "open chat" affordance to the full-page card viewer (`/:boxSlug/card/<splat>`).
Clicking it navigates to the existing chat layout with this card pre-attached as the
companion document, bound to the chat for the nearest enclosing landmark directory.
This is the inverse of the existing chat→document companion flow: today you can open a
document from inside chat; this lets you open chat from inside a document.

## Review outcomes folded in (codex pass + boxholder decisions)

A cross-model (codex) review ran against the real source. What changed, and why:

- **Path-traversal claim was wrong — fixed.** The original Failure Modes row called a
  crafted `..`/leading-`/` card path "harmless because `/api/files` owns safety." False:
  `.card` paths go through `card.get`, which did `path.join(boxRoot, input.path)` +
  `fs.readFile` with **no** boundary check (`card.ts:171`). Folded in: `openForCard`
  validates `cardPath` via `isBoxRelativeCardPath` (rejects `..`/leading-`/`), **and**
  `card.get` now mirrors the `/api/files` boundary guard (defense in depth). See the
  corrected Failure Modes row.
- **Malformed-landmark contradiction — resolved in favor of "filename defines the dir."**
  The resolver globs `*.landmark.card` filenames only (no parse), so a hand-created landmark
  with a malformed body still anchors its directory. This is simpler than reusing the
  parse-and-warn `loadLandmarkSummaries` and removes the contradiction codex flagged.
- **Resolver is self-contained — `loadLandmarkSummaries`/`landmarks.ts` untouched.** Dropped
  the planned `landmarkDirs` extraction (codex #5). `src/core/landmark/nearest.ts` owns its
  own glob; no half-shared helper, no cross-router refactor. Boxholder: that refactor "isn't
  sensible" for this feature.
- **Root fallback is intended (codex #2 declined).** When no non-root landmark encloses the
  card, the chat binds to the root (`""`), reusing the most-recent root session (including
  legacy unbound ones). Boxholder: "defaulting to the root is fine, that's what is expected …
  if there's no root landmark it should stop there, not go further up." The walk clamps at box
  root; box-relative paths can't escape upward.
- **Control has a visible error state (codex #4).** The `OpenChatControl` uses the `Button`
  primitive (auto loading-state on the awaited click) and renders the error inline on failure —
  unlike the `ChatButton` precedent, which silently swallows.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file formats, XML
  structures, or API shapes."* The plan reuses verified shapes (`?card=` param,
  `lastSessionForDirectory`) rather than inventing parallel ones.
- `callback-box/CLAUDE.md` (HTTP endpoints) — *"HTTP endpoints go in tRPC by default.
  Add a procedure under `src/webapp/trpc/routers/`, validate input with Zod."* The new
  resolver is a tRPC query on the existing `chat` router.
- `callback-box/CLAUDE.md` ("don't add features beyond what the task requires"). The
  user chose navigate-to-chat over a second sidebar surface specifically to avoid net-new
  layout; the plan honors that — no new panel component.
- `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional params (the new
  resolver takes `(boxRoot, { cardPath })`), `as never` only at the TanStack router
  boundary (the established pattern, `InteractiveChat-card-hooks.ts:66`,
  `LandmarkSection.tsx:87`).
- `callback-box/FRONTEND.md` — UI primitives + semantic palette, `className` only for
  outer layout. The new control reuses the `ChatButton` styling already in
  `LandmarkSection.tsx:100-108`.
- Most recent precedent: `LandmarkSection.tsx`'s `ChatButton` (the landmark→chat
  navigation) is the direct template for this control. Following it is denser than any doc.

## What already exists

- **Card browse page** — `src/frontend/src/pages/card/CardViewPage.tsx:17-37`. Reads
  `_splat` as `cardPath`, renders `FileView` in a `Card` shell. Has `boxSlug` and
  `cardPath` in scope; no chat affordance today. **Reuse** — add a control here.
- **Card companion param** — `router.tsx:84-88` defines `card?: string` on the chat route:
  *"The card live-open in the companion pane (serialized view URL, no `view:` prefix).
  Persisted so a reload restores it."* **Reuse** — we navigate with `&card=<cardPath>`.
- **Card restore-on-mount** — `InteractiveChat-card-hooks.ts:44-50`: `useCardUrlPersistence`
  parses `initialCard` via `parseViewUrl` and calls `onZoomView({ target, label })`, opening
  the companion tab. **Reuse, unchanged** — this is exactly the auto-attach mechanism.
- **View-URL serialization** — `lib/view-url.ts:64-73`: `serializeViewUrl({ path, viewer:
  null, params: {}, zoom: false })` returns just `path`. So a card path *is* a valid `?card=`
  value with no transformation. **Reuse** — the navigate sets `card: cardPath` directly.
- **Most-recent-session lookup** — `chat.ts:185-190` (`lastSessionForDirectory`) →
  `chat-session-history.ts:213-251` (`getLastSessionForDirectory`), which already walks
  newest→oldest and **skips ghost entries** (history rows whose JSONL never landed). **Reuse**
  — the new resolver calls this once it knows the dir.
- **New-chat-bound-to-dir navigation** — `LandmarkSection.tsx:78-98` (`ChatButton`): fetches
  `lastSessionForDirectory`, navigates to `?session=<id>` if found, else
  `?session=new&contextDir=<dir>`. **Reuse the pattern**; the only delta is the dir comes from
  a walk-up resolver instead of being the landmark's own dir, and we add the `&card=` param
  plus a "New" affordance.
- **Landmark discovery glob** — `chat.ts:89-128` (`loadLandmarkSummaries`) globs
  `**/*.landmark.card` (ignoring `node_modules`, `.git`, `tmp`, `.callback-box`) and maps each
  to its `dir` (`"" ` for root). **Reuse the glob/ignore list** — the walk-up resolver needs the
  set of landmark directories; this already computes it.
- **ChatPage param forwarding** — `ChatPage.tsx:104-112` forwards `card` to `InteractiveChat`,
  and `contextDir` only when `rendered === "new"`. **Reuse, unchanged** — our navigations land
  here.

**Rebuild (justified):** the *closest-landmark-to-a-path* resolver. There is no such function
today — landmarks are discovered as a flat globbed list and chats bind to an explicit
`contextDir` chosen at the call site (`LandmarkSection.tsx:96`). `docs/landmarks.md` (per the
explore pass) lists "the landmark for this directory" as deferred. We add the smallest
resolver that closes this gap.

## Prior art (external)

This is internal UI/state wiring over TanStack Router and tRPC — both already load-bearing in
the repo. Specific searches considered:

- **TanStack Router search-param preservation** — the spread-previous + `replace: true`
  pattern is already settled in-repo (`InteractiveChat-card-hooks.ts:52-67`, `ChatPage.tsx:52-70`)
  and documented inline as the guard against the search-param sync loop. No external search
  needed; the repo precedent is authoritative.
- **"Open a chat about this document" product pattern** — a common UX (Notion, Google Docs
  side-chat), but no external library or API is in play; nothing to import. No prior art worth
  recording.

No external prior art found that changes the design — the task is purely internal wiring. This
is the skip-with-rationale case the skill allows ("purely internal; no external dependency is in
play").

## Tracks / scope

Single-track, two backend-then-frontend chunks. Order is dependency-driven: the resolver must
exist before the control can call it.

### Track 1 — closest-landmark resolver + open-chat-from-card control

**What.** A tRPC query that, given a card path, returns the directory of the nearest enclosing
landmark (walking up to box root) *and* the most-recent existing session bound to that
directory. A control on `CardViewPage` consumes it to navigate into chat with the card attached.

**Why this needs to change.** Today the only path into a landmark-bound chat is the Landmarks
page (`LandmarkSection.tsx`). A user reading a card deep in the tree has no way to start the
"closest" conversation about it without navigating away to find the landmark. The card is the
natural place to start that chat.

**Direction.**

*Backend — one new tRPC query on the existing `chatRouter` (`chat.ts`).* Prefer a single
endpoint over two round-trips so the ghost-skip logic in `getLastSessionForDirectory` isn't
duplicated client-side:

```ts
// chat.ts
openForCard: publicProcedure
  .input(z.object({ cardPath: z.string().min(1) }))
  .query(async ({ ctx, input }): Promise<{ contextDir: string; sessionId: string | null }> => {
    const contextDir = await nearestLandmarkDir(ctx.boxRoot, { cardPath: input.cardPath });
    const sessionId = await getLastSessionForDirectory(ctx.boxRoot, contextDir);
    return { contextDir, sessionId };
  }),
```

*The resolver itself* — a new exported function. Reuse the existing landmark glob rather than a
filesystem walk, so the ignore-list and parse-guards stay in one place:

```ts
// src/core/landmark/nearest.ts  (new file)
// Returns the deepest landmark dir that is an ancestor-or-self of the card's
// directory, or "" (root) when none encloses it.
export async function nearestLandmarkDir(
  boxRoot: string,
  { cardPath }: { cardPath: string },
): Promise<string> {
  const cardDir = path.posix.dirname(cardPath); // "" when card is at box root
  const dirs = await landmarkDirs(boxRoot);      // globs **/*.landmark.card → Set of dirs ("" for root)
  let best = "";
  for (const dir of dirs) {
    const encloses = dir === "" || cardDir === dir || cardDir.startsWith(`${dir}/`);
    if (encloses && dir.length >= best.length) best = dir;
  }
  return best;
}
```

`landmarkDirs` factors the glob currently inlined in `loadLandmarkSummaries`
(`chat.ts:89-94`) — same `cwd`, `nodir`, and ignore list. `loadLandmarkSummaries` should call
the shared helper so the two glob sites can't drift.

*Frontend — a control on `CardViewPage`.* Modeled on `ChatButton` (`LandmarkSection.tsx:78-108`),
but with two affordances and the resolver call:

```tsx
function OpenChatControl({ boxSlug, cardPath }: { boxSlug: string; cardPath: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const open = async (mode: "recent" | "new") => {
    const { contextDir, sessionId } = await utils.chat.openForCard.fetch({ cardPath });
    const card = cardPath; // serializeViewUrl of a bare path is the path itself
    if (mode === "recent" && sessionId) {
      navigate({ to: href(`/${boxSlug}/chat`), search: { session: sessionId, card } as never });
      return;
    }
    navigate({ to: href(`/${boxSlug}/chat`), search: { session: "new", contextDir, card } as never });
  };
  // "Chat" → open("recent"); "New chat" → open("new")
}
```

- **"Chat"** opens the most-recent session for the resolved dir, or a new one if none exists
  (the recent-falls-through-to-new branch mirrors `LandmarkSection.tsx:84-97`).
- **"New chat"** always starts a fresh session bound to the resolved `contextDir`.
- Both attach the card via `&card=`. On the new-chat path the card is also forwarded by
  `ChatPage.tsx:104-112`; on the recent path `useCardUrlPersistence` opens it on mount.

**Vocabulary lock-ins.** Param names are all pre-existing (`session`, `contextDir`, `card`); no
new vocabulary. New identifiers: `chat.openForCard` (tRPC procedure) and `nearestLandmarkDir`
(core function) — both descriptive, neither agent-facing.

**First implementation chunk.** `nearestLandmarkDir` + the `landmarkDirs` extraction + a
pure-function doctest for the walk-up (cases below). No open questions inside it: the matching
rule is "deepest dir that is ancestor-or-self of `dirname(cardPath)`, else `""`".

## Subplans

None. The closest-landmark resolver is small and fully specified here (one function, one
matching rule); it does not warrant its own design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Card is under no landmark (deep `shared/` path, no landmark ancestor) | Add doctest | Yes — resolver returns `""` → root chat (the chosen fallback) | Clear (root chat opens; expected) |
| Card is at box root (`Foo.card`, `dirname` = `""`) | Add doctest | Yes — `cardDir === ""`, only `""` encloses → `""` | Clear |
| Two landmark dirs both enclose (root `""` and `class/activities/`) | Add doctest | Yes — deepest wins via `dir.length >= best.length` | Clear |
| `getLastSessionForDirectory` returns a ghost id | Covered by existing `chat-session-history.doctest.md` | Yes — ghost-skip at `chat-session-history.ts:230-249` | Clear (skips ghost, falls to new) |
| Resolved dir has a landmark but no chat yet | Reuse landmark→chat doctest pattern | Yes — `sessionId === null` → new-chat branch | Clear |
| Attached card file was deleted between browse and chat open | No (low value) | Partial — companion `FileView` renders its own missing-file state | Clear (pane shows missing; card path still recorded) |
| Landmark card unparsable/unreadable mid-glob | Existing `loadLandmarkSummaries` swallows + warns (`chat.ts:100-108`); `landmarkDirs` inherits it | Yes | Clear (warns, that dir absent from candidate set) |
| `cardPath` contains `..` or leading `/` (crafted URL) | `isBoxRelativeCardPath` doctest | **Two layers:** `openForCard` rejects it via `isBoxRelativeCardPath` (Zod refine); independently, `card.get` now resolves+bounds-checks against box root before any read (`card.ts`, mirroring `api-files.ts:69-73`) | Clear (rejected at the query; even if a hand-crafted `?card=` skips the query, `card.get` refuses to read outside the box) |

No critical gaps (none are `no test AND no handling AND silent`). The deleted-card case is the
only one without a dedicated test, and it is non-silent (the pane shows a missing-file state) —
documented risk, not a gap. The path-traversal row was the original plan's one real defect
(it asserted safety that did not exist); it is now closed at two layers.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A. This plan adds no card tags or schema fields; it only wires
  navigation params that already exist.
- **Stale ref** — **ADDRESSED.** The only "ref" is the attached card path. If the card was moved
  or deleted, the resolver still returns a valid `contextDir` (it matches on the *directory*, and
  a missing file just yields no landmark match → root), and the companion pane shows its
  missing-file state. No crash, no silent wrong chat. See Failure Modes rows 1 and 6.
- **Two agents touching the same card** — N/A. This is a read-only navigation; it opens a chat,
  it does not write the card or the session history. No concurrent-write surface.
- **Hand-edit drift** — **ADDRESSED (decided in favor of filename).** A hand-created landmark with
  a malformed body still defines its *directory*: `nearestLandmarkDir` globs `*.landmark.card`
  filenames and never parses them (it only needs directories). So a malformed landmark still
  anchors its dir rather than silently falling through to an ancestor/root chat. (The earlier draft
  contradicted itself by also claiming unparsable landmarks are dropped — that was the
  `loadLandmarkSummaries` behavior, which the resolver deliberately does *not* reuse. Covered by
  the `nearestLandmarkDir` doctest, which seeds a garbled-body landmark and confirms it still
  anchors.)
- **Fabricated free-form value** — N/A. No agent free-text is generated by this feature; the
  user clicks a button.
- **Validation error UX** — N/A. No card validation path is touched.
- **Partial migration / transition state** — N/A. No data-shape change; nothing to migrate. Legacy
  unbound sessions (no `contextDir`) are already handled by `getLastSessionForDirectory`'s
  `contextDir === "" && entry.contextDir === undefined` clause (`chat-session-history.ts:233-234`),
  so a resolved root dir still finds pre-landmark chats.

## NOT in scope

- **A second chat sidebar on the browse page.** The user explicitly chose navigate-to-chat
  (card becomes the companion doc in the existing layout) over rendering chat alongside the card
  on `/card/...`. Rationale: avoids a net-new layout surface and reuses the proven companion
  pane; CLAUDE.md's "don't add features beyond what the task requires."
- **A session picker / dropdown of recent chats.** The user chose "open recent + button for new,"
  not "always ask." Recent-other-than-newest stays reachable from the Chats/Landmarks pages.
- **Preserving the active viewer/zoom in the attached card.** `CardViewPage` renders the default
  viewer; we attach the bare path. Carrying a `?view=` override would require threading the
  viewer through `CardViewPage` (it doesn't track one today). Deferred — bare path is the common
  case and matches what the companion pane renders anyway.
- **"Closest landmark" breadcrumb on the browse page itself.** `docs/landmarks.md` lists this as a
  separate deferred idea. This plan builds the resolver it would need but does not surface a
  breadcrumb; that's a follow-up that can reuse `nearestLandmarkDir`.
- **Caching the resolver result.** Each click does one glob; landmark counts are small (tens).
  If it ever shows up in profiling, memoize then — not now.

## Open design questions

- **Where the "New chat" affordance lives, and its exact shape.** The plan places both "Chat" and
  "New chat" on the `CardViewPage` control (a two-button group or a primary button + small "New").
  Note: the option preview the user saw for "open recent + button for new" depicted a `[+ New]` in
  a *panel header* — that mock assumed the sidebar-on-browse layout, which the user then declined in
  favor of navigate-to-chat. So the `+ New` naturally moves to the card-page control. Lean: a
  primary **Chat** button with a secondary **New** button beside it, styled per
  `LandmarkSection.tsx:100-108`. This is a presentation detail, settle it during implementation;
  it does not affect the resolver or param contract. *(Not inside the first chunk — the first chunk
  is backend-only.)*
- **Should "Chat" attach the card on the recent-session path even when that session already has a
  different `?card=` persisted?** Lean: yes — the user clicked from *this* card, so this card is the
  intent; `useCardUrlPersistence` will sync it and the prior card is replaced. Matches the existing
  one-card companion model. Flag only because it overwrites a persisted card; acceptable.

## Knowledge audits

**Skip — with rationale.** This feature introduces no agent-facing concept: no new card tag, no
new convention an agent must recall, no "this is how you do X" rule. It is UI navigation wiring
plus one internal resolver. Per the skill's default ("each new *agent-facing* concept gets an
audit"), there is nothing here an agent needs to remember across compaction, so no
`knowledge-audits.yaml` entry lands with it. (If a later breadcrumb feature surfaces landmarks to
agents, revisit then.)

## Implementation order

1. **Chunk 1 — resolver (backend, no UI).** Add `src/core/landmark/nearest.ts` with
   `nearestLandmarkDir` + `landmarkDirs`; refactor `loadLandmarkSummaries` (`chat.ts:89-94`) to
   call `landmarkDirs`. Add a pure-function doctest covering: no enclosing landmark → `""`; card at
   root → `""`; nested card under a mid-tree landmark → that dir; root + nested both present →
   deepest wins; `..`/leading-`/` crafted path → no match → `""`. Commit.
2. **Chunk 2 — tRPC query.** Add `chat.openForCard` (`chat.ts`) calling `nearestLandmarkDir` +
   `getLastSessionForDirectory`. Add a route doctest (`makeTestServer()` tier) asserting the
   `{ contextDir, sessionId }` shape for a seeded landmark + session. Depends on Chunk 1. Commit.
3. **Chunk 3 — frontend control.** Add `OpenChatControl` to `CardViewPage.tsx` (`page` is subject
   to `restrict-component-classes`; if the control needs appearance classes, put it under a
   `pages/card/components/` child per the CLAUDE.md page-component rule, mirroring
   `pages/landmarks/`). Wire `utils.chat.openForCard.fetch` + the two navigations. Depends on
   Chunk 2. Commit.

The plan completes when all three chunks land; nothing ships until then (and the merge to `main` is
a separate, user-initiated signal).

## Rollout shape

- **Test posture.** One pure-function doctest for the resolver (Chunk 1) and one route doctest for
  `openForCard` (Chunk 2) land *with* the code — the resolver's walk-up has enough branch logic to
  warrant tests at ship, not deferred. The frontend control (Chunk 3) follows the default deferral:
  dogfood the click-through manually (`bin/browse`), add a frontend test only if the shape proves
  fiddly. This overrides the "dogfooding precedes tests" default for the two backend codepaths
  because the matching rule is exactly the kind of off-by-one (ancestor-or-self, deepest-wins) that
  a doctest pins cheaply.
- **Knowledge-audit entries.** None (see Knowledge audits).
- **Migration.** None — no existing data shape changes. Legacy unbound sessions are already handled
  by the existing root-binding clause; no backfill needed.
- **Manual verification before complete.** From a worktree, open a deep card URL (e.g. the
  `workshop/.../Logprobs_Explorer.sandbox.card` case), click **Chat**, confirm it lands in
  `/chat?session=…&card=…` with the card in the companion pane and the session bound to the nearest
  landmark dir; click **New chat**, confirm a fresh `session=new&contextDir=…` chat with the card
  attached.
