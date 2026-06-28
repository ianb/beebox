# Prompt Surface Cleanup — IA Review, Batch 1

This plan acts on the boxholder's commentary on the chat/agent **prompt
and output-vocabulary surface** (the `ia-review` box's `store/prompts/`
review). It covers the first reviewed batch: the chat system prompt, the
reactor system prompt, the tier-2 agent-guide sections, and four schema
`instructions` blocks. The through-line is **stop re-stating "how a box
works" in every prompt** — consolidate it into one canonical surface,
delete stale vocabulary (XML, `memo`, dead directory roll-calls), and
trim the always-loaded weight down to what earns its place. A second
batch will follow once a more complete set of prompts is added to the
review surface.

The commentary was authored against extfile snapshots whose git refs
(e.g. `git:8fde2281`, `git:60d8a7aa`) **predate current source**. Some
remarks are already partly addressed (the "make quotes a law" ask landed
as `laws.ts` Law 1). Every track below is reconciled against *today's*
source, cited inline.

---

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — the card format contract: *"The format
  is YAML frontmatter + markdown body (Phase 2)… the legacy XML card
  format… has been removed"* and *"The type is taken from the filename
  (`Foo.<type>.card`) — there is no `type:` field in frontmatter."* The
  XML scrub and the `type: briefing` fix trace directly to this.
- **`callback-box/CLAUDE.md`** — *"Keep source and docs generic — never
  hardcode personal names… Refer to 'the user' or 'the boxholder' in
  shared text."* All prompt edits hold to this.
- **`callback-box/CLAUDE.md`** — *"don't add features beyond what the
  task requires."* The trims are the positive expression of this: prose
  the agent can infer or read on demand doesn't belong in always-loaded
  context.
- **`callback-box/CODE-STYLE.md`** — no default params, max 2 positional
  params, no bare `as` casts, files ≤300 lines. Relevant where tracks
  touch `.ts`/`.tsx` (briefing schema, source-tag renderer).
- **Most recent shipped precedent: `laws.ts` Law 1 + the `{% quote %}`
  work.** The "laws before mechanics" structure and the
  knowledge-audit-per-convention discipline are the densest precedents
  for the quote/source and briefing tracks.
- **The agent guide's own architecture (`agent-guide/index.ts`)** — one
  small section file per concept, concatenated in render order. New/edited
  guide prose follows this; it is the existing home for the canonical
  surface.

---

## What already exists

The canonical "how a box works" surface the boxholder wants is **mostly
already built** — as the always-loaded agent guide. The problem is the
*system prompts* duplicate it instead of relying on it.

- `src/core/agent-guide/index.ts:64-93` — assembles the guide from
  per-concept section files; `@`-included into CLAUDE.md, so **every box
  agent (chat and reactor alike) already loads it**. This is why the
  reactor/chat "About This Box" blocks are redundant, not load-bearing.
- `src/core/agent-guide/laws.ts:19` — *"Law 1 — Never paraphrase the
  user. Quote them verbatim."* The quotes commentary's central ask is
  **already shipped**; `quotes.ts` was not trimmed to match (it still
  duplicates the rules and the "precious" sentiment — `quotes.ts:11`).
- `src/core/agent-guide/box-shape.ts` (`directoryLayoutSection`,
  `howItemsEnterSection`) and `cards.ts` (`cardTypesSection`,
  `creatingCardsSection`) — the existing box-concepts content. Reuse as
  the consolidation target; the system prompts defer to these.
- `src/core/agent-guide/cards.ts:29` — *"Prefer `cb create` with
  templates over writing XML directly"* — an XML leftover **inside the
  guide**, so the scrub is not limited to the two system prompts.
- `src/core/agent-guide/source.ts` — the `{% source %}` guide; carries
  `as`, `ref`, `pos`, `version`, `placement`, `href`. Reused and edited
  (Track: source-tag), not rebuilt.
- `src/schemas/commentary.tsx:108` — *"The `{% source %}` (with inner
  `{% quote %}`) holds the selected span, verbatim"* — the overload the
  commentary flags; reconciled in the quote/source subplan.
- `src/webapp/routes/proxy-image.ts:127` — `/api/proxy-image?url=<url>`,
  SSRF-guarded. The external-image capability the chat prompt should
  mention already exists; reuse, don't build.

**Runtime-wiring audit (resolves the commentary's "verify this is
actually wired" remarks).** Verified against current source:

| Claim | Verdict | Citation |
|---|---|---|
| `user` attr on messages | WIRED — keep | `webapp/routes/chat-helpers.ts:122` `injectUserAttr` |
| `calendar` snapshot attr | WIRED — keep | `core/session-context.ts:224`, gated `sessionStart` |
| `time` is UTC-ISO | TRUE | `core/session-context.ts:187` `now.toISOString()` |
| `health` first-msg-only | CONFIRMED (so the mid-session concern is a real **design** gap, not a bug) | `core/session-context.ts:206-243` |
| `last-activity` gating + other long-idle handling | first-msg-only; **no other long-idle handling exists** | `core/session-context.ts:214-221` |
| `todo-added`/`todo-completed` acks | WIRED | `frontend/src/lib/structured-output-parsing.ts:24-31` |
| `card-activity` on todo edits | **NO** — card-activity kinds are `scrolled/navigated/explored/modified`, companion-pane only; todos are *ack* kinds | `core/chat-card-activity.ts:28` |
| `version`/sha256 drift | WIRED, but only via explicit `cb extfile sync` (not auto at agent-runtime) | `core/extfile-sync.ts:59-62` |
| external image proxy | EXISTS (`/api/proxy-image?url=`), undocumented in prompt | `webapp/routes/proxy-image.ts:127` |
| `zoomed-view` attr | WIRED | `frontend/src/components/chat/InteractiveChat.tsx:128` |

The upshot: **fewer "drop the line" edits than the commentary feared** —
most claims are real. The aspirational-schema worry only fires on one
example (the card-activity todo example, which must be swapped for a
*companion-pane* example, not a todo).

---

## Prior art (external)

This batch is almost entirely **internal prose engineering** — no
third-party API surface is in play, so external prior art is mostly
N/A by design. Two narrow exceptions:

- **Markdoc tag-attribute vs. inner-tag modeling** (Track 7 / quote-
  source subplan). The question "should a selected span live as a tag
  attribute or as tag body" is a Markdoc schema-design choice. Markdoc's
  own docs cover custom tag `attributes` vs. `children`
  (https://markdoc.dev/docs/tags) — relevant when the subplan decides
  whether `{% source %}` carries the span as an attribute or as escaped
  body. Searched; no project-external pattern dictates the choice — it's
  ours to set. Recorded as a subplan input, not a blocker.
- **Prompt-as-context-budget discipline.** The "always-loaded prose must
  earn its weight" principle is general LLM-context hygiene; no specific
  external source needs citing. Skip-with-rationale: purely internal
  judgment call about *our* guide.

No external bug/limitation searches apply — nothing here leans on a
third-party tool's edge behavior.

---

## Tracks / scope

Ordered by implementation dependency, then surface size. Track 0 is the
keystone; the trim tracks (2–5) reference its output, so it lands first.
Two questions are large enough to be **subplans** (Tracks 6, 7).

### Track 0 — The canonical "How a Box Works" surface + shared glossary

**What.** Consolidate the scattered box-concepts prose into one
authoritative surface that every prompt references instead of restating:
cards are `Name.type.card` (type in the **filename**, not frontmatter);
the core `cb` verbs and when to reach for each; the shared **glossary**
of cross-cutting vocabulary — `ref`, `pos`, `placement` — defined once;
and the framing that **all of this lives inside Markdown**, including
card-tag bodies. This is the "new prompt used everywhere" the boxholder
named.

**Why this needs to change.** The same "how cards work" paragraph is
re-authored in `chat-session-prompts.ts:13-22`, `reactor/prompts.ts:16-24`,
and re-explained per-schema (`recipe.tsx:62` redefines `ref`;
`source.ts`/`chat.ts`/`commentary.tsx` each re-describe `ref`/`pos`/
`placement` with slightly different framing). Every copy drifts
independently — the directory roll-calls already describe the *legacy
reactor path* as if current. One canonical surface kills the drift.

**Direction.**
- The home is the **agent guide** (already always-loaded for all box
  agents). Add/strengthen a glossary section (likely fold into
  `cards.ts` or a new `glossary.ts` slotted into `index.ts`) that defines
  `ref`, `pos`, `placement` **once**. Per-section prose then assumes
  familiarity and stops redefining.
- The chat and reactor system prompts **drop their box-concepts blocks**
  and rely on the guide (it's in their context). Where a system prompt
  needs a one-line pointer ("cards are `Name.type.card`; see the guide"),
  keep a pointer, not a restatement.
- Vocabulary settled (boxholder): **`pos` everywhere** — rename any
  `position` use to `pos`. The first chunk's grep finds the sites; the
  name is decided.

**Vocabulary lock-ins.**
- Glossary term names: **`ref`**, **`pos`**, **`placement`** (`pos`, not
  `position` — decided).
- The canonical glossary lives in the agent guide; nothing else
  *defines* these terms — they only *use* them.

**First implementation chunk.** Grep the whole prompt/guide/schema
surface for `position`/`pos` and `ref`/`placement` definitions
(`rg -n "\bpos\b|\bposition\b|\bplacement\b" src/core/agent-guide
src/schemas src/core/*prompts*`), decide `pos` vs `position`, and write
the single glossary section (no edits to consumers yet — that's the
trim tracks). No open question inside this chunk: the grep settles the
name.

### Track 1 — XML scrub + dead card-type references

**What.** Hunt every "XML" in the prompt surface and every `memo`/
example using a removed card type, and fix to the current shape.

**Why this needs to change.** Cards are frontmatter + markdown body;
*"the legacy XML card format… has been removed"* (`CLAUDE.md`). Stale
"XML" in `chat-session-prompts.ts:14`, `reactor/prompts.ts:16` & `:30`,
and `cards.ts:29` actively misdescribes the format to the agent.
`memo` is gone, but `Meeting.memo.card` (`reactor/prompts.ts:24`) and
`Trip.memo.card` (`chat-session-prompts.ts:112`) persist in examples.

**Direction.** Mechanical replace: "XML card files" → "card files
(frontmatter + markdown body)"; "writing XML directly" → "writing card
files by hand"; "job XML" → "job card content"; example card types
`memo` → a current type (`doc`/`recipe`). Grep-driven so nothing is
missed: `rg -rni "xml" src/core src/schemas` over the prompt surface.

**First implementation chunk.** The grep + the four known sites + any
others it surfaces, in one commit. No open questions.

### Track 2 — Chat system prompt overhaul

**What.** Act on the ~30 per-line remarks against
`chat-session-prompts.ts`. Grouped:

- **Role & structure.** Replace generic *"conversational assistant"*
  (`:11`) with a framing that names the distinctive role (works the
  box's filesystem, voice-first when spoken to). **Drop
  `CALLBACK_BOX_CHAT_MODE`** (`:9`) — decided: a mode-label pattern the
  codebase never follows through on (nothing branches on it).
  Move the BEHAVIOR block (`:24`) toward the **personality card** /
  a capabilities framing (the *"you can read and modify any files"*
  capability claim, `:26`, belongs in capabilities, not behavior).
  Drop the directory roll-call (`:15-20`) — Track 0 + landmarks own it.
- **Voice / transcription.** Add **pointing** guidance — when
  substantive content goes display-only, speech should refer to it
  (`:37`). Add transcription failure modes: **homophones** and **dropped
  negatives** (`:65`). Rephrase diarization (`:66`) from *"are different
  people"* to *"can't be assumed to be the same person"* (the labels are
  unstable; we don't know identity). Revisit the voice-in→voice-out
  default's instability (`:29`) — decide tighten vs. accept variance.
- **Showing files / images.** Rename `<box-root-path>` →
  `<path-from-box-root>` (`:69`). Drop the back-compat `api/files/`
  mention (`:69`) and add the **external-image proxy** capability
  (`/api/proxy-image?url=`, verified to exist). Lead the view-link
  examples with **cards (a `doc` example)** and add **plain links**
  (no `view:`) as an encouraged form (`:73`). Drop the *"Do NOT use
  `view:` links for custom views"* scar (`:82`) — it re-creates the
  confusion it warns about. Move the canonical `zoomed-view` description
  **up into STATE SNAPSHOT** (`:79` → near `:107`).
- **State snapshot.** Drop `time`, keep `local-time` (`:101-102`) framed
  as "the time as the user experiences it." **Fix `health` gating**
  (`:106`) — decided: surface health **whenever something is currently
  failing**, not only on the first message of a session (the snapshot
  already computes it cheaply; the first-message gate is the only
  blocker). This is a code change in `core/session-context.ts:206-243`,
  not just prompt prose. Re-examine
  `last-activity` design (`:104`) — note there is **no other long-idle
  handling**, so whatever we want lives here. Swap the obscure
  `card-activity kind="explored"` boat example (`:114`) for a legible
  **companion-pane** example (a `modified` with a path — **not** a todo;
  todo edits don't emit card-activity). Drop `Trip.memo.card` (`:112`).
- **Output vocabulary.** Reframe `prose`/`callout` (`:118-120`, `:141`)
  around the real rule: **in `prose="off"` and narration mode, prose
  isn't shown — `<callout>`/`<speech>` are the only way to reach the
  user.** Loosen ack inner-text guidance (`:138`) — include it when it
  adds a real detail, omit only when it restates the action. Fix the
  thin `context="calendar conflict"` callout example (`:144`) to name
  the situation that prompted it. Reframe `<schedule>` (`:149`) as **the
  mechanism for responding proactively** (timers fall out as a use case).
  Compress SELF-NOTES (`:84-95`) to ~half. Inline the NARRATION_OVERLAY
  (`:179`, it's always appended anyway) and lead with **why** silence is
  the default (the user is speaking at length and may talk over a reply).
- **Cosmetic.** Space before self-closing `/>` in examples (`:127`).

**Why this needs to change.** Each remark is a concrete
misdescription, a stale example, or always-loaded prose that
under/over-explains. Per `CLAUDE.md`'s "don't add features beyond what
the task requires," the prompt should teach what the agent can't infer
and nothing more.

**Direction.** One file of prose edits plus one code change (the
`health` gating fix in `session-context.ts`); depends on Track 0 for the
box-concepts cut and Track 1 for the XML/`memo` fixes (sequence after
both). Only the voice-out-default question remains open; everything else
is a settled edit.

**First implementation chunk.** The settled prose edits: role framing
(incl. dropping `CALLBACK_BOX_CHAT_MODE`), directory-roll-call cut,
`<box-root-path>` rename, scar removal, `time` drop, example swaps,
cosmetic. The `health`-gating code change is its own chunk (it carries a
test). The voice-out-default question lands last, after it's decided.

### Track 3 — Agent-guide tier-2 trims

**What.**
- **`briefing-tags.ts`** — stop always-loading it; this is
  authoring-time guidance better delivered as a card-type rule
  (`.claude/rules/card-briefing.md`) loaded on demand. Trim the
  self-explaining tag/attribute prose. (Coupled to Track 6 — the
  briefing redesign changes what this guidance even says.)
- **`quotes.ts`** — trim to **pure mechanics** now that Law 1 carries
  the rule. Remove the duplicated rules and the *"precious"* sentiment
  (`:11`); fix *"mishears"* (`:41`) → clearer term; add the
  **user-directed-edit** exception (a user-driven edit to quoted text
  keeps it authentic) either here or as a Law 1 rider.
- **`chat.ts` sections** — `externalToolsSection` → a tight
  "always available: pandoc, imagemagick, …" one-liner (drop
  descriptions). `chatAttachmentsSection` → compress to the kernel
  (*attachments land in `tmp/`, which is not storage — decide what to do
  with the file after*). `selectionsSection` → simpler placement framing
  ("best-effort placement where the user made it; end as fallback"),
  defer `ref`/`pos` to the Track 0 glossary. `viewsSection` → **gut** to
  "views exist; see `docs/generated/views.md`; the preferred way to give
  a card type a custom interface is a view targeting that type" — drop
  URL forms, metadata/deps, read/write API, `adapterFetch`.
- **`source.ts`** — rename the `as` attribute (candidate: `derivation`/
  `how`/`kind`; bikeshed, but `as` goes); drop the `#m12`/`#step-3`
  **fragment** mention (`:32-33`, unsupported); trim `ref` to a
  one-liner deferring to the glossary; state that `pos` is **identical**
  to the `<user-selection>`/`<card-activity>` `pos` grammar rather than
  re-describing; align `placement` likewise; normalize the section to a
  single template literal; emphasize "everything is inside Markdown."

**Why this needs to change.** Tier-2 is always-loaded for *all* agents;
self-explaining prose and per-section vocabulary re-definitions are pure
context cost (`CLAUDE.md` weight discipline). `briefing-tags.ts` is
authoring guidance masquerading as always-on context.

**Direction.** Depends on Track 0 (glossary) for the `ref`/`pos`/
`placement` defer-targets, and on Track 6 for `briefing-tags.ts`. The
`as` rename is a **vocabulary lock-in** that escapes prose (see below) —
sequence its code parts carefully.

**Vocabulary lock-ins.** Renaming `as` touches the `{% source %}`
renderer, any schema/validation that reads the attribute, the guide, and
**existing cards** that already use `as=`. Pick the new name in this
track's first chunk and grep all uses before committing
(`rg -n 'as=' src` plus box cards). If the rename's blast radius is
larger than expected, it folds into Track 7 (both touch `{% source %}`).

**First implementation chunk.** `quotes.ts` trim (no dependencies, no
lock-in) + the `chat.ts` section compressions (depend only on Track 0's
glossary). The `as` rename and `source.ts` `pos`/`placement` alignment
come after the glossary and the rename-name decision.

### Track 4 — Reactor + commit-nudge system prompts

**What.** Trim `reactor/prompts.ts` `buildReactorSystemPrompt` to rely
on the always-loaded guide: drop the XML mentions (Track 1), the
directory roll-call (`:18-22`), the generic *"Cards are named…"*
explanation (`:24` — Track 0 owns it), and the Edit-tool Read-precondition
note (`:32`, generic Claude Code mechanics). **Keep and make prominent**
the reactor-specific closing contract: `cb finish <job-file-path>`
(`:24`, `:40`) and "commit before finishing." Keep the "already loaded,
don't re-read" signal (`:30`) — just don't call the content "XML."

**Why this needs to change.** The reactor agent loads the same agent
guide as chat; its "About This Box" block is duplication that drifts
(it still calls the inbox the *"legacy reactor path"* inline). Stripping
the noise makes `cb finish` — the one thing the reactor *must* do —
stand out.

**Direction.** Commit-nudge (`agent.ts:31` `COMMIT_NUDGE_PROMPT`) drew
**no remarks** — leave it, but the chat commentary's "teach how/when to
commit, not 'meaningful messages'" (`chat:22`) suggests a shared
**commit-discipline** note worth a one-line pointer rather than per-prompt
re-invention. Note as a candidate, not a commitment.

**First implementation chunk.** The reactor trim in one commit (after
Tracks 0 and 1). No open questions.

### Track 5 — Schema instruction trims

**What.**
- **`doc.tsx`** — drastically shorten. A doc card is title + markdown
  body; the extension is self-evident. Keep ~one paragraph: title
  (required, frontmatter), body is markdown, standard tags work, attach
  scope is `<basename>.attach/`. Cut the rest.
- **`recipe.tsx`** — drop the internal *"Track 4's body ref-walker"*
  reference (`:62`, meaningless to the agent) and remove the inline `ref`
  redefinition (defer to Track 0 glossary).
- **`commentary.tsx`** — drop the *"no `defaultHref`/`defaultRef`/
  `targets`"* rebuttal (`:90-92`) — it argues against a design the agent
  never saw. Lead with a **concrete worked example** (comments on
  `Trip_Report.doc.card` go in
  `Trip_Report.attach/comments.commentary.card`) instead of the abstract
  `<host-basename>` template. (The `{% quote %}`/`{% source %}` overload
  in this file is Track 7.)

**Why this needs to change.** Tier-3 instructions load per card-type;
over-explaining a self-evident type and re-defining glossary terms is the
same weight problem one tier down. `CLAUDE.md` weight discipline.

**First implementation chunk.** `doc.tsx` + `recipe.tsx` (independent of
everything except Track 0's glossary for the `ref` defer). `commentary.tsx`
non-overload edits can land here too; the overload waits on Track 7.

### Track 6 — Briefing schema redesign (SUBPLAN)

**What.** Redesign the briefing card from "all semantic content as inline
Markdoc body tags" to **frontmatter-first**: `purpose` as a frontmatter
string; `key-people` as a frontmatter list of `{ref, description}`;
decide `corrections` and `property` as frontmatter-list vs. body-section
(each carries a `test`/structured field); audit whether `project-phase`
earns its keep; general prose (Legal, Finances) stays as plain markdown
headings. Preserve the **compiled `**Label:** …` output** that lands in
`@`-included CLAUDE.md (`compileBriefing`, `briefing.tsx:99`). Migrate
existing briefings (agent-driven, output unchanged).

**Why a subplan.** This is a real **card-shape migration** with its own
decisions (per-field frontmatter vs body, the `project-phase` audit) and
its own blast radius: `briefing.tsx` schema + `compileBriefing` +
`src/core/markdoc-emit.ts` + `frontend/src/components/BriefingTags.tsx` +
`createBriefingTemplate` + `briefing-tags.ts` guide + existing box cards.
It needs the `/cb-migration` discipline. Also fixes the standalone bug:
the template/instructions write `type: briefing` frontmatter, which
`CLAUDE.md` says must not exist (type comes from the filename).

**Dependency.** Track 3's `briefing-tags.ts` trim waits on this — the
guidance changes meaning. Both ship with the parent.

### Track 7 — Reconcile `{% quote %}` vs `{% source %}` overload (SUBPLAN)

**What.** Resolve the conceptual clash: `{% quote %}` means **sacrosanct
verbatim user words** (Law 1), but `commentary.tsx:108` and the source
guide reuse it inside `{% source %}` to mean **"the selected span this
comment anchors to"** — which is arbitrary document text, not the user's
words. Decide the new shape: `{% source %}` carries the selected span
itself (as an attribute, or as escaped tag body) **without** an inner
`{% quote %}`, so `{% quote %}` keeps its single meaning.

**Why a subplan.** It's a **vocabulary decision** that must be reconciled
across `source.ts` (guide), `commentary.tsx` (schema instructions +
`validate` hook), `shared/markdoc-config.ts` (tag definitions/validation),
the composer/source-editor that *emits* these anchors, and the renderer —
and it intersects the `as` rename (Track 3). It needs its own
decision-table and a knowledge audit. The legitimate "verbatim from
there" composition in `source.ts:58-66` must survive the change (that one
*is* user words); only the **selection-anchor** misuse is retargeted.

**Dependency.** Sequence with/after Track 3's `source.ts` edits to avoid
churning the same file twice; the `as` rename may merge in.

---

## Failure modes

New/changed codepaths in this batch are mostly **prose** (no new runtime
branch), so the failure surface is "agent reads stale/contradictory
guidance." The two subplans introduce real codepaths.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `as`→new-name rename misses an existing card using `as=` | No | `cb validate` ref/attr checks | Clear (validation error) **if** the renderer rejects the old name; **silent** if it just ignores it |
| Briefing migration drops a field's content (e.g. a `{% property %}` body) | Must add | `scripts/migrate/_warnings.ts` noisy field-loss detection (`CLAUDE.md`) | Clear if migrator runs in noisy mode; silent otherwise |
| Briefing redesign changes compiled CLAUDE.md output (downstream contract break) | Must add (golden-output doctest) | None yet | **Silent** until an agent reads a subtly-different CLAUDE.md |
| Quote/source retarget leaves old `{% source %}{% quote %}` anchors in existing commentary cards orphaned/mis-validated | Must add | `commentaryErrors` validate hook | Clear (validation) if the hook is updated in lockstep; silent if not |
| Trimmed guide drops a term the agent still needs, now defined only in the glossary | knowledge audit (below) | Glossary section | Silent — agent just doesn't know it |

**Critical gap:** *Briefing redesign — compiled-output drift.* If
`compileBriefing` emits even slightly different markdown after the
frontmatter-first move, every box's CLAUDE.md changes silently and no
test catches it. **Resolution: a golden-output doctest comparing
`compileBriefing` before/after on a representative briefing is a
done-when for Track 6** (encoded in the subplan, not deferred).

**Critical gap:** *`as` rename — silent ignore.* If the renderer ignores
an unknown attribute rather than erroring, renamed-but-unmigrated cards
lose their derivation label with no signal. **Resolution: the rename
chunk must verify the renderer/validation rejects (or migrates) the old
name before the rename lands.**

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** (`{% quote %}` vs `{% source %}`) —
  **ADDRESSED** by Track 7: the whole point is to stop the overload that
  makes the wrong choice *look* right. Until Track 7 lands, the existing
  ambiguity persists (DEFERRED to the subplan).
- **Stale ref** — the `as` rename and glossary moves don't change ref
  resolution; `cb validate`/`cb mv` ref-tracking (`source.ts:34-36`)
  still applies. **ADDRESSED** (unchanged behavior).
- **Two agents touching the same card** — briefing redesign: chat agent
  and reactor could both edit a briefing. No new concurrency introduced;
  existing file-lock discipline (`CLAUDE.md` file-lock rule) unchanged.
  **ADDRESSED** (no regression) — but the migration must be **atomic per
  card** (subplan note).
- **Hand-edit drift** — boxholder writes `{%quote%}` no-space or an old
  `as=` after the rename. **GAP** for the rename window — flagged in
  Failure Modes; the rename chunk decides reject-vs-migrate.
- **Fabricated free-form value** — `key-people` descriptions and `as`/
  derivation text are free-form. The source guide already says *"write
  the truth… Honest description beats enum-fitting"* (`source.ts:53`);
  the briefing redesign should carry the same honesty framing into
  `key-people` descriptions. **ADDRESSED** (carry existing framing).
- **Validation error UX** — Track 7 changes what `commentaryErrors`
  validates; the message must read well in agent context. **DEFERRED** to
  the subplan (its validate-hook change owns the message text).
- **Partial migration / transition state** — briefings and commentary
  cards exist in old shape during rollout. **DEFERRED** to the two
  subplans; each owns its migration window. Per cb-plan, a migration that
  expects to stop midway would be its own subplan — these complete.

---

## NOT in scope

- **Prompts not yet in the review surface.** The boxholder explicitly
  scoped this to the reviewed batch; a second round follows once more
  prompts are added. Personality card, behavior.ts internals, and the
  many guide sections without commentary are untouched except where a
  track explicitly moves content *into* them (e.g. BEHAVIOR → personality).
- **Commit-nudge rework.** No remarks; left as-is (Track 4 notes a
  possible shared commit-discipline note as a *candidate*, not work).
- **The voice-in→voice-out stability problem as an engineering fix.**
  The plan surfaces it as a design question; actually re-architecting
  voice-mode selection is its own effort, deferred.
- **A new `engineering-principles.md`.** cb-plan anticipates one; not
  created here.
- **Auditing `version`/drift end-to-end.** Verified it's wired via
  `cb extfile sync`; the commentary's "audit the runtime" worry is
  resolved by the wiring audit above — no further work this batch.

---

## Open design questions

**Decided by the boxholder (no longer open):**
- **`health` gating** → surface whenever something is currently failing,
  not first-message-only. (Track 2, code change)
- **`pos` vs `position`** → **`pos`** everywhere. (Track 0)
- **`CALLBACK_BOX_CHAT_MODE`** → **drop** — a mode-label pattern the
  codebase never follows through on. (Track 2)

**Still open:**

1. **Voice-in → voice-out default** — tighten the rule, or document the
   variance as accepted? *Lean: accept-and-document* unless the boxholder
   wants determinism. (Track 2)
2. **`as` new name** — `derivation`, `how`, `kind`, or other? Bikeshed;
   decided in Track 3's first chunk by grep + one call. (Track 3)
3. **`{% source %}` selection-span carrier** — attribute vs. escaped
   body? Decided in the Track 7 subplan's decision-table. (Track 7)
4. **`corrections`/`property` shape in the briefing redesign** —
   frontmatter list vs. body section. Decided in the Track 6 subplan.

---

## Knowledge audits

New/changed agent-facing concepts that warrant
`src/dev/knowledge-audits.yaml` entries (precedent: the four `{% quote %}`
audits):

- **The `ref`/`pos`/`placement` glossary** (Track 0) — one `knows_directly`
  audit per term that the agent can recall the meaning from the guide
  without re-reading. The whole point of consolidating is that the agent
  *retains* these; an audit proves it.
- **`as` → new name** (Track 3) — an audit that the agent uses the new
  attribute name (and doesn't reach for `as`). A rename without an audit
  is a name the agent forgets after compaction.
- **`{% quote %}` is user-words-only; `{% source %}` carries the anchor
  span** (Track 7) — an audit that the agent picks the right tag for "a
  span I'm commenting on" vs "the user's verbatim words." This is the
  core behavioral payoff of the subplan.
- **Briefing frontmatter-first shape** (Track 6) — an audit that the
  agent writes `purpose`/`key-people` in frontmatter, not as body tags.
- **Skip-with-rationale:** the pure trims (doc/recipe/reactor/chat prose
  cuts) don't need audits — they remove content, they don't add a
  convention to recall.

Audits land **run**, not just written:
`pnpm knowledge-audit run --box <test-box> --filter <tag>` and the status
recorded before the parent plan completes.

---

## Implementation order

1. **Track 0** — glossary + box-concepts consolidation (unblocks the
   trims). Includes the `pos`/`position` decision.
2. **Track 1** — XML + `memo` scrub (independent, mechanical; do early so
   later prose edits don't re-touch the same lines).
3. **Track 5** (doc/recipe) + **Track 4** (reactor) — schema/system-prompt
   trims that only need Track 0's glossary.
4. **Track 3** — agent-guide trims (quotes/chat first; `as` rename and
   `source.ts` `pos` alignment after the rename-name decision).
5. **Track 2** — chat system prompt overhaul (settled edits first; the
   two design questions after they're decided).
6. **Track 7 (subplan)** — quote/source reconciliation; sequence with the
   tail of Track 3 (`source.ts`) and Track 5 (`commentary.tsx`) so each
   file is touched once.
7. **Track 6 (subplan)** — briefing redesign + migration; Track 3's
   `briefing-tags.ts` trim lands with it.

Chunks are commit boundaries within the worktree, not ship boundaries.
The plan completes when all tracks (and both subplans) are done; **it
ships as one unit only on the boxholder's explicit signal** (`/finish`),
not when an early track feels done.

---

## Rollout shape

- **Tests first, as a design tool.** Golden-output doctest for
  `compileBriefing` (the critical-gap guard) authored as part of Track 6,
  before the field shape settles. A doctest for the updated
  `commentaryErrors` validate hook (Track 7). The `as`-rename rename-safety
  check (renderer rejects/migrates old name). The prose-only trims
  (Tracks 1–5 text) don't get per-edit tests — they're not substantial
  codepaths; the knowledge audits are their behavioral check.
- **Knowledge audits** (above) land with their tracks, run and recorded.
- **Migration approach.** Two migrations, each agent-driven and atomic
  per card, each owned by its subplan: briefings (frontmatter-first,
  compiled output unchanged) and commentary anchors (quote→source-span
  retarget). Both run in noisy field-loss mode
  (`scripts/migrate/_warnings.ts`) so dropped content is loud, not silent.
  No "stop midway" — both complete within the plan.
- **No deploy from the worktree.** All work lands on the worktree branch;
  merge to `main` (which auto-deploys) is the boxholder's call at
  `/finish`.
