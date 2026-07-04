# The interface as cards — design

Status: design exploration (2026-07), no implementation yet. Grew out of the
"The interface itself as cards" entry in `docs/ideas.md`; this doc supersedes
that entry. Related threads it absorbs or touches: prominence / head cards,
card-aware widgets, agent-editable UI text, backlinks, addressable URIs.

## Motivation

The system treats the filesystem as state and cards as the universal
addressable unit — but the UI is a separate React layer that *reads* cards
without being *made of* them. The dashboard's composition, the nav's entries,
what History filters on: all of it is `.tsx`, changeable only by deploy.

The reason to change this is **modifiability, in the specific sense an
agent-operated system needs it**. Giving every interface surface a card gives
it:

- **An address.** Link to it, embed it, point an agent at it, comment on it —
  the same way as any card.
- **A configuration surface.** Frontmatter is the machine-read shape; editing
  it reconfigures the surface with no deploy. The boxholder agent can make you
  a saved view mid-conversation.
- **A margin.** The card body is free prose: the agent's rationale, "tried
  sorting by modified, boxholder hated it," suggestions not yet acted on.
  LLMs need a place for ad hoc remembering, co-located with the thing it's
  about and versioned with it. A registry entry has nowhere to scribble; a
  card does.
- **Two commit surfaces.** A diff to a card's frontmatter is a reviewable
  *configuration* change with card-validation semantics; a `.tsx` diff is a
  *code* change with typecheck semantics. Different risk profiles, cleanly
  separated by file type.
- **Integrity coverage.** Bindings become refs (not magic strings): validated,
  rewritten by `cb mv`, queryable by backlinks. "Which surfaces show this
  card?" becomes answerable. The interface stops being a blind spot in the
  box's own machinery.

The original framing asked *which* surfaces are declarative-list-shaped enough
to convert. That question dissolved during design: **everything gets a card
anchor; what varies per surface is only how much of its behavior lives in
frontmatter versus in its view's code.** The discriminator is a dial, not a
line through the surface list.

The honest cost, also worth stating up front: coherence erodes (every box can
drift toward looking like a different app — for a personal agent-operated tool,
arguably the point), and the tree gains a population of infrastructure cards
(`/proc`-like — acceptable if every card answers a real question; a card whose
body stays empty and whose frontmatter never diverges from defaults should
have stayed virtual).

## Core factoring: subject, view, binding

Three separate things that must not be conflated:

- A **subject** — the thing a surface is about: a card, a directory, or a
  collection. Every rendered surface has an addressable subject; the path in
  the URL is the subject.
- A **view** — a named rendering function over some subject kind. Views are
  code: builtin renderers in the registry, plus box-authored `.tsx` views as
  the extensible tier. Many views per subject (page/tile/embed already exist).
  Views are not headed by anything; they're functions.
- A **binding** — which view a subject gets by default. Bindings are card
  data: a `view:` ref in frontmatter, cascading card → type → box → builtin,
  with `?view=` as the explicit URL override.

### Two species of view card

- **Query card** — frontmatter *is* the data definition (a query + layout);
  the generic view renders what the card selects. (Saved filters, the
  questions queue, the landmarks page.)
- **Instrument card** — the view is self-sufficient code that loads its own
  data (health, git history, a capture form); the card doesn't feed it, it
  *situates* it: address, binding, frontmatter-as-configuration, body for
  notes. Props with a home. (Health widget, History, Capture, Settings.)

Both species get the same anchor benefits. There is deliberately no `system/`
virtual namespace — system-state surfaces are instrument cards whose views
fetch what they need.

### The layering rule

**View cards do selection and arrangement; card renderers do interaction.**
The questions queue converts even though answering is interactive, because
the answer form is the question card's own renderer — the queue just selects
and orders. When a surface needs presentation logic beyond the vocabulary
(e.g. Chats grouping sessions by nearest landmark), the *selection* stays
declarative and the *presentation* is a named view in code. When someone
wants conditionals or computed columns, the answer is "graduate to a `.tsx`
view," never "grow the frontmatter vocabulary."

### Runtime param overrides, with provenance

**Mostly shipped 2026-07**: `resolveViewParams` + per-view codecs in
`src/shared/named-views.ts` (the resolved shape also retains the card
layer for diff/reset); URL params thread from `/views/…` and Browse;
history chips emit diffed override-URLs and a marker names overridden
keys with reset. Still future: the embed-site origin. (A
"save override into the card" affordance was floated during design but
not adopted — an assistant suggestion, not a boxholder ask; revisit only
if the need shows up in practice.)

View-card `params` (shipped with `view: history`) want the same cascade as
bindings: **view defaults < card frontmatter < embed-site args < URL query
string.** Frontmatter is the durable, validated configuration; the query
string is the ephemeral, shareable overlay —
`Feedback_Commits.view.card?session=abc` is "the feedback card, scoped to
this session, right now." Interactions inside a card (e.g. history's
session/connector chips) then stay on the card's address as override-URLs
instead of escaping to the page. Committing an override into the card is
just an edit to its frontmatter (the agent's job when asked); no dedicated
"save" affordance is planned.

Requirements settled in discussion:

- **Per-key provenance.** The merge layer emits `{ values, origins }`
  (`default | card | url | embed | …`, open-ended; an embed origin can name
  the embedding card). Consumers: the shell renders a generic
  "modified from card · reset" marker; views may treat card-recorded vs injected params as
  different in kind (a saved filter vs an ad hoc slice; declining expensive
  or sensitive params unless durably recorded); the `<card-activity>`
  snapshot reports overrides without misattributing them to the card.
  Precedent: config provenance (`git config --show-origin`, CSS origin).
- **One assembly point.** Views never read `location.search` themselves;
  params arrive only through the resolver, or configuration becomes
  unattributable.
- **Codec per view.** Typed params need a params↔query-string codec next to
  each param schema in the named-views table (`history-filter.ts` is
  already this for history; generalize, zod coercion covers most). Merge is
  per-key overlay.
- `RendererProps.params` (query params from `view:` URLs on the chat-embed
  path, e.g. figure `?molecule=`) is this pattern already growing one-off —
  bless it as the convention and thread page/Browse query params through.

## The can't-break invariant

Safety does not come from keeping surfaces out of the card system; it comes
from a property of the view resolver:

- Builtin views are immutable and always enumerable. Box-provided views only
  ever *add*; bindings only ever *choose*.
- `?view=<builtin>` explicitly overrides any binding, on any subject, always.
  "What am I not seeing?" always has the same answer: `?view=raw`.
- The shell wraps every view render in an error boundary that **names the
  culprit card** ("this surface is defined by `Foo.view.card`, which failed:
  …") with two affordances: revert to builtin (one click) and open the card.
  A broken surface is a broken card — comment on it, point the agent at it,
  diff its history. Embeds need this at embed granularity, not just page
  granularity.

What remains shell, permanently: the resolver/binding machinery itself, the
view implementations, the frame (below), and **permission-boundary surfaces**
— Admin stays out not aesthetically but on principle: cards are box-writable
by construction, and nothing box-writable may sit upstream of OAuth grants or
permissions. That rule will recur (deploy controls, secrets).

## Vocabulary

The query/config vocabulary stays deliberately small; its smallness is the
health metric. Current inventory (~7 primitives, covering every surface that
converts):

- **Patterns** — include/exclude file lists, tsconfig-shaped named keys
  (`refs:` explicit list — real refs, validated and mv-rewritten;
  `include:` / `exclude:` glob patterns). Pattern grammar: `,` for
  alternation, `!` for exclusion, leading `/` anchors to box root, otherwise
  positional (relative to the card's directory) — per-pattern anchoring, no
  card-level `cwd`. Patterns are **type-aware**: the `*.type.card` segment is
  parsed with the same name grammar the schema loader uses, so it matches
  both `Name.type.card` and bare positional `type.card`. A first-class
  `type:` selector exists for queries that were never really about paths.
- `order` (as landmark `expand` today)
- `group-by: <field>` — computed grouping by frontmatter value (distinct from
  landmark `expand`'s static `group:` label)
- a modified-within/freshness filter
- `view` + `params` on entries (view is a ref)
- badges: **not** vocabulary — see nav below; badge logic lives in the target
  type's renderer.

## Identity and structure

### Positional identity

**Shipped 2026-07**: the grammar below is implemented in
`src/shared/card-name.ts` (one canonical parser, backend + frontend).

Cards have two identity modes. **Nominal**: `Name.type.card`, identity from
the name. **Positional**: bare `type.card` ("the ‹type› of this directory"),
identity from location — landmarks, briefings, chat-session organs.
The stuttering names (`briefing.briefing.card`) were the format forcing
nominal identity onto positional cards. Basename uniqueness gives positional
cards at-most-one-per-directory for free, which is the semantics they want.

### Beside claims, inside annotations

Cards are primary; **directories are never objects** — they are either a
card's extension or plain space. Two relations, distinguished by the grammar
itself:

- **Claiming** ("this directory *is* a trip") — exclusive, at most one, and
  it carries a name: a nominal card beside a same-named directory.
  `Yosemite.trip.card` + `Yosemite/`. The card is the object; the directory
  is where it keeps its stuff.
- **Annotating** ("this spot is navigationally notable" / "agent context" /
  "present it this way") — non-exclusive, stackable, nameless: positional
  cards inside. `landmark.card`, `briefing.card`, and a
  presentation/view-binding card (type name unsettled; "lens" floated —
  see Open questions).

Positional cards have no name to pair with a directory, so an annotation is
*structurally incapable* of claiming. Beside = "is a"; inside = "has a". No
blessed type lists needed.

The decisive property of beside-claims: **growth without an identity event.**
`Foo.memo.card` grows a workspace by `mkdir Foo/` — the card never moves;
path, refs, comments, git history are continuous from one-line memo to
sprawling project. (Inside-identity — the index.html convention — would make
growth a `cb mv` with ref rewriting. That convention assumes
directory-primacy, which fits the web but not this system.)

**Debated, not concluded:** whether `.attach` retires into this pattern — an
attach bag becoming an ordinary claimed directory whose claiming *schema*
declares ownership semantics (private bag vs. peer namespace). The
beside-claim grammar above stands on its own; folding attachments into it is
the open fork. Known costs if it proceeds:

- Path-keyed machinery (gitignore, asset-manifest globs, `attach/` ref
  prefix) loses its static marker. gitignore can't run schema logic —
  either `cb` generates those sections, or a residual marker survives for
  the private-bag case. Decide early.
- Pair fragility widens (manual `mv` divorces pairs); wants a lint for
  dangling claims/divorced pairs. `cb mv` already moves pairs.
- Basename uniqueness flips from forbidding to *blessing* the pairing: at
  most one card may share a basename with a sibling directory, and that
  pairing is a claim. Two same-basename cards + a directory = lint error.
- Canonical address is the card; a `Foo/` URL redirects to the claiming
  card's view. Claiming a directory doesn't require writing into it (matters
  for synced/generated content).

If it proceeds, it's an on-disk shape change over existing boxes — needs a
real migration plan. Either way, interface-as-cards work should avoid
hardcoding `.attach` assumptions while the fork is open.

### Directory addressability

**Addressing is free and virtual; assertions require materialization.** Every
directory is addressable with zero files — synthesized identity, builtin
directory view. The moment someone has something to *say* about it (symbol,
custom view, prominence, a comment anchor), a card materializes to hold the
assertion: an annotation inside, or a claim beside. Plain containers stay
plain.

### `?create` — addressing the not-yet-existing

`path/to/Card.type.card?create` = "act as if this exists" (wiki red links).
The type rides the filename, so the URL alone determines the schema and a
create view can derive its form. Card filenames are already idempotency keys,
so the created-meanwhile race resolves as "show it." Creation is a verb aimed
at a place; capture is its media-specialized case; the primary creation
interface remains the agent.

Refs may carry `?create`: meaning "may not exist yet" (harmless once it
does). `cb validate` treats them as intentionally dangling but still
name-parses and type-checks them (a typo'd future ref fails now); `cb mv`
rewrites them like any ref; a lint pass offers to strip stale markers rather
than fanning creation out into edits of every anticipating card. Views render
`?create` as a visible threshold, not an empty card.

## The surfaces (from the code)

Today `browse/$`, `card/$`, and `views/$` are three path-shaped routes, each
a hardcoded subject→view binding; `ViewPage.tsx` already contains the
proto-resolver (`looksLikeFilePath`). These collapse into **one resolver
route** implementing the binding cascade — which also centralizes the
loading/error/empty chrome every page currently hand-rolls, and derives live
refresh from the subject (resolver subscribes once, matches file-change
events against the view card's include patterns, instead of per-page
bespoke `useBusSubscription` lists).

| Surface | Becomes | Notes |
|---|---|---|
| Landmarks page | query card (`type: landmark`) | Trivial; machinery proof. **Shipped 2026-07 as an instrument card** (`view: landmarks` on a `view` card; src/schemas/view.ts + renderers/view.tsx). The query-card form is **parked** (`docs/plans/query-cards.md` — too complex, too contextless; anchored queries are landmark `expand`'s job). |
| Questions | query card + `group-by: status` | `QuestionForm` promotes to the question type's renderer — the layering rule cashed in. **Ported as-is 2026-07** (`view: questions` instrument card, page body extracted). The query-card form is **parked** (`docs/plans/query-cards.md`); the renderer promotion (tile registry + question tile) still stands on its own. |
| Browse | directory subject + builtin master-detail view | Delete/context-menu are view affordances; a positional presentation card parameterizes (order, grouping, prominence, tiles vs rows). |
| Chats | query card over chat husks + named `chat-picker` view | Freshness filter declarative; landmark-proximity grouping stays code. Blocked on husks. **Shipped 2026-07 as an instrument card** (`view: chat-picker`); the husk-based query form is still future. |
| History | instrument card over the timeline view | Filter state (already URL-encoded) becomes frontmatter params; **saved filters = more instrument cards** with frozen params + notes body. Subject is git, never a card query. **Shipped 2026-07** (`view: history` + params — the first configurable instrument card; filter interactions inside a card escape to the History page). |
| Nav | curated `refs` card + per-entry overrides — **shipped 2026-07** (`docs/implemented-plans/nav-card.md`; nav form/badges still future) | Each target renders its **nav form** — a third form beside tile/full (label, symbol, optional badge). Badges computed by the target's own renderer (questions card shows pending count), not by nav vocabulary. Anything can go in the nav. Minimal hardcoded fallback nav per can't-break. |
| Dashboard | markdown card transcluding other cards | Prose + embedded health instrument, questions query, activity instrument. Reuses embedding instead of a layout schema. Accepts a document-flow layout ceiling; stresses embed machinery (embed-level error boundaries, live-updating embeds) — the right work. Non-singleton: any such card is *a* dashboard; the root binding picks *the* dashboard. |
| Capture, Settings | instrument cards | View stays code; card holds destination defaults / exposed config + notes. |
| Admin | stays shell | Permission boundary. |
| Chat | husk card per session + chat view + the slot | Below. **Husks shipped 2026-07** (`docs/plans/chat-husks.md`): a `chat` card per web session, created at id-assignment + one-shot backfill; renderer opens the live session; the Chats picker enumerates husks (title/deletion are editorial). Path-addressed chat and the slot still future. |

Order of attack: Landmarks → Questions → resolver unification → directory
presentation/Browse → chat husks, then Chats → History saved-filters, Nav,
Dashboard.
Each step ships something usable. The `.attach`/claiming migration should be
*planned* before this work hardcodes assumptions, even if executed later.

## Chat

### Husks

Web chat sessions are currently JSON bookkeeping + JSONL transcripts — not
addressable — while Telegram threads *are* cards. Fix the asymmetry: a small
**husk card per session** (topic, status, `contains`, transcript pointer;
plausibly `<slug>.chat.card` + `<slug>/` holding the transcript — the claim
pattern). The husk is the noun; the session is the verb. Chats then appear in
search, refs, backlinks; "as we discussed in [chat]" is a ref;
cards-about-cards is just edges in the existing ref graph (commentary is
precedent), and a card's "discussed in…" panel is an ordinary query. The URL
becomes the husk path; "Recent" is a redirect to the most-active husk.

### Frame state vs. subjects

**Paths address subjects; frame state belongs to the shell.** Chat's current
URL struggle (`session`/`contextDir`/`companion`/`card` params) is carrying
both at once because sessions aren't nouns. After husks: the URL carries the
subject; which-panes-are-open is frame state (URL params when shareable,
user-session state when personal, like slot stickiness).

### The companion slot: a role, not a region

The frame has three primitives: **nav** (jump between subjects),
**arrangement** (splits/tabs of subjects), and the **companion slot** — a
persistent, exclusive, singular presence that survives navigation. Chat's
specialness is not its data (that's the husk) but **persistence of
attention**: it is the standing *witness*, subscribed to the frame across
everything you do.

Slot **occupancy** (which husk is attached) and **embodiment** (docked pane /
mobile bottom-sheet / minimized badge / fully ambient voice — zero pixels)
are independent axes; today's implementation conflates them ("chat is present
iff you're on the chat page"). The slot's occupant is a binding (default:
most-active husk); the same husk can also open full-screen as an ordinary
subject; the slot can in principle hold any card (a scratchpad while
researching). This inverts today's architecture: instead of the chat page
hosting a companion card pane, the shell hosts both and chat becomes the
sidekick of everything.

### Reifying the frame: per-tab frames with fork-on-open (noted 2026-07)

Boxholder direction: the page layout must survive reloads and be
well-specified — "card path in the URL" doesn't scale to multiple
tabs/panes/contexts. The answer is a persisted **frame** (deliberately
not "session" — chat sessions own that word): each browser tab has one,
holding the arrangement and nothing else. The boxholder wants a proper
name for it; candidates: **tableau** (solitaire's word for the
arrangement of cards in play — the lean) or **spread** (tarot's word;
collides with the JS spread operator). Similarly the companion "slot"
needs a real name; candidates: **shotgun** (riding shotgun — the lean),
**perch**, sidecar (Apple collision). Unpicked as of this note.

- **URL split.** The path keeps addressing the focal subject (the
  standing rule survives); a `?frame=<id>` rides along carrying the
  arrangement. A bare path URL (no frame id) mints a fresh frame seeded
  with that subject — every existing link keeps working and quietly
  upgrades. Chat's `companion`/`card` params dissolve into the frame.
- **Fork-on-open.** The frame id in a URL is a seed, not a live handle:
  same-tab reload resumes (per-tab identity via sessionStorage; a
  duplicated tab is detected by the copied token and forks with a fresh
  id, URL rewritten); a shared URL gives the recipient a *copy* of the
  arrangement, never a live view. tmux minus shared-attach.
- **Contents: arrangement only.** Panes/tabs (each: subject path,
  view?, params?), the active pane, companion-slot occupancy. Explicitly
  NOT: the input's emission (the instrument follows the person, not the
  arrangement — a fork must not duplicate a half-typed draft),
  transcripts, preferences, scroll positions.
- **Storage: server-side runtime state** (`.callback-box/`, like session
  history), with stale-frame GC — client-only storage would break
  fork-on-share (the recipient lacks your localStorage). Never a card,
  per the standing rule; but a frame someone wants to *name and keep* is
  the materialization door (a saved-layout card, later, if ever —
  address-free/assertions-materialize applied to layouts).

### The input is its own frame primitive — and a true singleton

Noted 2026-07 (boxholder aside, recorded for later): the **input** —
voice, typing, attachments, accumulated selections — is independent of
chat. It *attaches* to a chat when you send, but it lives between chats
(switch conversations and the draft stays), and it is genuinely singular
in the system: one boxholder, one input. It is the natural receiver of
frame signals like card selections (today's implementation already agrees
— a selection becomes supplementary text on the next message, i.e.
composer state, not session state).

This splits what the witness section below conflates: the slot's occupant
is *who is attending*; the input is *what you speak through*, aimed at the
occupant but not owned by it. Frame primitives are therefore four: nav,
arrangement, the companion slot, and the input. And unlike everything
else in this design (dashboards, navs, views — all de-singleton'd into
bindings), the input is correctly a **complete singleton**: it extends
the person, not the content. Its state (draft, attachments, pending
selections) is frame state per the standing rule — never a card, never in
the URL.

Like the slot (occupancy × embodiment), the input has two orthogonal
axes:

- **Target** — an *interlocutor* (a chat session; a reply is expected),
  a *place* (a directory; a deposit, receipt at most), or *unaddressed*
  (the triage-memo idea: fire-and-forget, the box routes it).
- **Embodiment** — full composer, camera-first capture screen,
  voice-only, or the OS share sheet (an embodiment the phone owns).

**Capture is the input, place-targeted, camera-first** — not a separate
instrument. Its "less interactive" feel is a property of the target kind,
not the widget: aimed at a person the input is a dialogue instrument;
aimed at a place it is a deposit chute. One consequence to preserve when
building: accumulated content can be re-aimed across target kinds
(photos gathered for a chat can flip to a plain inbox deposit without
loss). The triage memo is just the unaddressed target, not a fourth
thing. (Conceptual unification only so far — capture's device/upload
apparatus is separate code today.)

### Signals: the frame bus

Inter-surface communication is **frame traffic, not card traffic** — no
card-to-card wiring in frontmatter (the reactive-framework-in-YAML cliff).
The shell owns a bus scoped to the current arrangement; views emit a small
standard vocabulary upward: selection, focus/activity, navigate-intent
(`onNavigate` is already this pattern; `reportActivity`/`<card-activity>` is
the agent-facing digest of the same traffic). Co-present views declare
interest; the witness is the standing subscriber.

**The bus is ephemeral; persistence requires a card write.** Anything worth
remembering is converted — mostly by the agent — into durable assertions:
refs on the husk, commentary, status changes. Materialize-on-assertion,
applied to events. The signal vocabulary gets the same discipline as the
query vocabulary: tiny, typed; anything richer is a custom view talking to
its own backend, outside the protocol.

### Callouts: the down direction

Callouts are the witness projecting into the frame when its embodiment can't
carry a response (voice can't render a picker; a minimized chat can't show a
diff). Discipline: **the agent doesn't draw UI; it points at cards** — a
callout is a card ref + view hint (a question card, a confirmation, a freshly
materialized card, a `?create` threshold), and the *shell* chooses embodiment
per modality: desktop insets it in the slot, mobile raises a sheet, voice
reads it and asks. The question answered by voice is the same card you'd
answer on the queue page. Pending callouts are cards with pending status (the
questions queue already models the discipline), so an ambient witness queues
rather than stacking sheets.

Voice-only is the proof case: the embodiment where everything must flow
through callouts. If the protocol works there, mobile overlay and desktop
pane are progressively richer embodiments of the same traffic. Test: nothing
about mobile or voice chat should exist that isn't "the same witness,
differently embodied."

## Open questions

- **Naming.** "View" is already four things (the `?view=` param, box
  `views/` `.tsx`, `ViewPage`/`view:` scheme, and now view cards). Either
  the new thing takes the word while the others rename out from under it,
  or a fresh word. "Lens" was floated (assistant suggestion, not agreed):
  short, "a way of looking," zero collisions, and `recipes/lens.card` reads
  well positionally — but the name is wide open.
- **The `.attach` fork itself** (debated, unresolved): whether attachments
  fold into beside-claims at all — and if so, ownership marker mechanics
  (generated gitignore/manifest sections vs. a residual path marker for
  private bags).
- **Head/annotation precedence details**, and whether `landmark.card`
  eventually dissolves into claiming cards carrying a navigation/prominence
  role (the prominence-unification thread).
- **Freshness-filter syntax** and the exact pattern grammar spelling.
- **Embed-granularity error boundaries** and live-updating embeds — the
  dashboard-as-markdown prerequisite.
- **Slot/callout state model** (occupant, embodiment, pending queue) as
  user-session frame state.
- **Migration sequencing** for `.attach`→claims and husk backfill over
  existing boxes.
