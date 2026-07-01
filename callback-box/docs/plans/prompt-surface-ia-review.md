# Prompt Surface Cleanup — IA Review

This plan acts on the boxholder's commentary on the callback-box chat/agent
**prompt and output-vocabulary surface** (the `ia-review` box review). It now
integrates **two commentary rounds**: round 1 (chat + reactor system prompts,
four schema instructions, four guide sections) and round 2 (the rest of the
agent-guide sections, plus `doc`/`person`/`recipe` schemas and a second pass on
the chat prompt and laws).

The through-line is sharper after round 2: **the guide re-teaches the same core
concepts in a dozen places and never once teaches them canonically.** Cards,
`ref`, `contains:`, naming, the commit/validate discipline — each is redefined
per section, drifts independently, and bloats always-loaded context. The fix is
one canonical **"About Cards / How a Box Works"** surface that everything
cross-references, plus a systematic trim of what the agent can infer or load on
demand.

The commentary was authored against extfile snapshots; some remarks are already
overtaken by shipped source (laws.ts now has Laws 1–3; scrolled card-activity
already carries a read position — `01c63c48`, `a185e70d`). Every track below is
reconciled against *current* main, cited inline.

**Status (partial — plan is still in progress).** Landed on `main` so far:
- **Track 0** — the NAMED_SECTIONS registry (`agent-guide/sections.ts`,
  `UPPER_SNAKE_CASE` tokens + `PROVENANCE`), the named laws
  (`THE_LAW_OF_QUOTING`/`SAVING`/`CARDS`), and the canonical `ABOUT_CARDS`
  section (`agent-guide/cards.ts`) — including `title`/`status`/validation and
  the `content-type` removal (see the `content-type` bullet below).
- **Dedup pass** — `search.ts` (`contains:`), `behavior.ts` (card bullets),
  `doc.tsx`/`person.tsx`/`recipe.tsx` now defer to `ABOUT_CARDS`/`PROVENANCE`;
  `source.ts` converted to the `PROVENANCE` heading + generalized `ref`.
- **Track 5 — `commands.ts`** — restructured (see its bullet below): DONE.
- **Track 5 — `quotes.ts` / `source.ts` / `landmarks.ts` + reactor prompt** —
  quotes trimmed to mechanics (rule deferred to `THE_LAW_OF_QUOTING`, repeat-
  sentence + user-directed-edit patterns added, "mishears" fixed); `source.ts`
  `pos`/`placement` aligned with the selection/activity grammar; `landmarks.ts`
  states the `<Name>.landmark.card` convention + active-structure guidance;
  `reactor/prompts.ts` drops its box-concepts block (defers to `ABOUT_CARDS`,
  scrubs XML).
- **`{% source %}` `as` → `usage`** — renamed (boxholder chose `usage`, "the way
  the source material was used"). Touched the Markdoc tag schema
  (`markdoc-config.ts`), the `Source.tsx` renderer prop, the `source.ts`/`laws.ts`
  guide examples, and the one real card that used it (blast radius was tiny — 1
  card across all boxes). Undefined `as=` now degrades to a lint warning + no
  label, not a crash.
- **`box-shape.ts` audited + fixed** — `box/output/` reframed (cards that make
  something happen *outside* the box, not just "outbound telegram"); the "you do
  NOT manually place items" overstatement corrected; the backwards "inbox jobs =
  legacy" framing fixed (**jobs → reactor is the *active* path** that `cb wakeup`
  runs; the intake→triage pipeline is the newer one *not* wired into wakeup), with
  an explicit job-vs-triaged-item distinction; `<category>` clarified as
  per-box (from triage landmarks). **Audit results:** `_unsure/` and
  `store/reviews/retro/` are real (kept). **`box/pool/` and `store/integrated/`
  were both dead and are now removed** — closer inspection showed `box/pool/` is
  empty in every box (only auto-generated `MAP.md`/`CLAUDE.md`, zero real items)
  and `store/integrated/` has no writers. Removed the `box/pool/` convention from
  its two agent instructions (`intake-job.tsx`, `guide-templates.tsx`), the
  `cb-commands` examples, the maps `precheck-ignore`, and the guide; removed
  `store/integrated/` from `BOX_DIRS` + `cb init` + the guide. Docs
  (`box-layout.md`) and the `box.doctest.md` created-tree assertion updated to
  match. (Empty on-disk `box/pool/` dirs in a few boxes are harmless leftovers,
  left in place.)
- **`behavior.ts` trimmed + audited** — dropped the "meaningful commit"
  non-instruction; trimmed the briefing subsection's stale `<purpose>`/`<key-people>`
  tag enumeration (defers to the briefing schema doc); compressed the personality
  paragraph; trimmed the retrospective detail. **Audits:** the git-trailers table
  is accurate (all 7 emitted), but the `Retro-Run:` trailer claim was aspirational
  (**emitted nowhere**) — removed. The `<destination for="…">` / `<triage-destination>`
  angle-bracket notation was **stale everywhere** — destinations are actually a
  landmark **frontmatter** `destinations: [{ for: [triage], rules, procedure }]`
  list; fixed in `behavior.ts` and `box-shape.ts` (incl. the one I'd introduced).
  (Stale `<triage-destination>` mentions remain in `triage.ts`/`handle.ts` *code
  comments* — internal, not agent-facing; a minor follow-up.)
- **`drive.ts` corrected + trimmed** — the audit found the layout description was
  stale: a Drive card's data (gdoc body `attach/<basename>.md`, sheet tab JSONs,
  comments sidecar, conflict `remote.md`) all live in the card's **attach scope**,
  not a "sibling `.md`" or separate "data directory." So `cb mv` moves everything
  in one step — collapsed the two manual "move both together" bullets to `cb mv`.
  Also fixed the stale `<lossy>` angle-bracket → the `lossy:` frontmatter field.
  (`.sheet` → `.gsheet` rename remains its own subplan.)
- **Track 3 — calendar + drive moved to skills** — the `calendar` and `drive`
  guide sections were **removed from the always-loaded agent guide** and
  repackaged as on-demand box skills (`CALENDAR_SKILL`/`DRIVE_SKILL` in
  `box-skills-content.ts`, registered in `box-skills.ts`, installed by `cb init`
  into `.claude/skills/<name>/SKILL.md`). Each carries a trigger `description` so
  it loads only when a task touches the calendar / Drive. Deleted `calendar.ts`
  and `drive.ts`. **Note:** existing boxes need `cb init` re-run to install the
  new skills. (Extensibility load-timing — procedures/guides/schedules — is still
  open under Track 3.)
- **`search.ts` finished** — added concrete example queries, documented the
  **output shape** (path + `#fragment` locator, title, the `contains:` sentence,
  a matched excerpt, "N of total" on truncation) and that it's **relevance-ranked
  with no keyword/quoted-phrase mode** (all verified against `commands/search.ts`).
  Moved the `contains:` *maintenance* (`cb contains list --missing`/`--stale`) out
  of search and into the ABOUT_CARDS `contains:` bullet — search now covers only
  *finding*, ABOUT_CARDS covers *making findable*. (`CONTAINS_DOC_APPENDIX`
  per-type duplication is still the noted follow-up.)
- **`chat.ts` (external tools / attachments / selections / views) rewritten** —
  crisp, and corrective where the default is wrong. External Tools → a one-liner
  naming the guaranteed tools (`pandoc`, `imagemagick`, `poppler-utils` — verified
  installed in `deploy/setup-server.sh`). Chat Attachments compressed to the
  kernel (land in `tmp/`, which **isn't storage** — keep-into-box or `rm`).
  Selections now **defer `ref`/`pos`/`placement` to PROVENANCE** (closes the loop
  with source.ts's "identical to `<user-selection>`") and simplify the
  inline-vs-appended framing. **Views gutted** — dropped the URL form,
  metadata/deps, read/write API, and `adapterFetch`, and made it corrective:
  the preferred use is a view targeting a **card type** (`rendersCardTypes`); a
  standalone dashboard is the unusual case, not the default.
- **`extensibility.ts` trimmed + examples added** — **schedules** cut from a wall
  of system-admin detail (daemon, launchd, 60s tick, JSONL logs, `cb tick`/
  `cb scheduler status`) to the kernel, and reframed on the boxholder's stated
  intention: agent-created schedules **serve the user** (a check on a cadence, a
  decision revisited at intervals, or a one-off further out than a chat
  `<schedule>` reaches) — with a **grounded example** card (real fields: `cron`,
  `not-before`, `runs: cb procedure run …`, `description`, `source`) that does
  double duty. **Tricks** reframed on the boxholder's intention — *not* "box-
  specific" (too narrow: real tricks include general utilities like
  `generate-image`) but **a reusable script for anything worth doing repeatedly
  in a formalized way** (`cb trick <name>`), with the repeat-recognition instinct
  modeled inline. **Guides** intro tightened. **Decision:** procedures + guides
  stay always-loaded (compact per-box indexes), unlike calendar/drive — resolves
  the last of Track 3's load-timing question.

Everything else below is still future work.

---

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — card format contract: *"YAML frontmatter +
  markdown body… the legacy XML card format… has been removed"*; *"The type is
  taken from the filename… there is no `type:` field in frontmatter."* The XML
  scrub, the `type: briefing` fix, and the About-Cards framing trace here.
- **`callback-box/CLAUDE.md`** — *"Keep source and docs generic — never
  hardcode personal names."* Constrains the calendar-timezone and recipe/person
  example edits (resolve real values, don't bake in a sample).
- **`callback-box/CLAUDE.md`** — *"don't add features beyond what the task
  requires."* The positive form of the always-loaded weight trims and the
  "drop what the agent can infer" cuts.
- **Memory: "Bias toward strict in all things"** — turn the strictness dial up
  by default (types, validation, fail-closed). Drives the schema-field
  redesigns: `person.contact:` → structured `email:`/`phone:`/`address:`;
  `recipe.source:`/`hero-image:` → typed `ref`/`href`, not freeform.
- **`callback-box/CODE-STYLE.md`** — no default params, ≤2 positional params, no
  bare `as`, files ≤300 lines. Relevant to every `.ts`/`.tsx` edit, especially
  the string→template-literal normalization and the schema changes.
- **Shipped precedent: `laws.ts` Laws 1–3 + the `{% quote %}` work.** The
  laws-before-mechanics structure, all-caps section-name convention, and
  knowledge-audit-per-convention discipline are the densest precedents.

---

## What already exists

The canonical surface the boxholder wants is **mostly not built** — that's the
central gap. The pieces that exist are scattered and duplicative.

- `src/core/agent-guide/index.ts:64-93` — assembles the guide from per-concept
  section files, `@`-included into CLAUDE.md; **every box agent loads it**
  (chat and reactor). This is why the system prompts' box-concepts blocks are
  redundant. `calendarSection()` and `driveSection()` are included
  **unconditionally** (`:74-75`) — the always-loaded-weight problem.
- **No "About Cards" / shared-frontmatter surface exists** (grep confirms).
  `cards.ts` is a sparse three-subsection stub; the shared fields (`title`,
  `contains:`, refs), the naming convention, and the no-Git-metadata rule live
  nowhere canonical and are redefined in `search.ts`, `doc.tsx`, `person.tsx`,
  `recipe.tsx`, `behavior.ts`. This section is Track 0.
- `src/core/agent-guide/laws.ts` — **Laws 1–3 shipped this session** (never
  paraphrase; chat-is-not-a-record; cards-are-how-things-are-recorded). Round-2
  refinements remain: name them (THE LAW OF QUOTING/SAVING/CARDS), Law 2 "file"
  → "card" (`:56`), Law 3 → pointer to About Cards, a working
  `{% source %}`+`{% quote %}` example under Law 1.
- **Scrolled card-activity already carries a quantized read position**
  (`01c63c48`) and the prompt already describes it (`a185e70d`) — the round-2
  "give scrolled a position" suggestion is **done**. No work.
- `src/core/agent-guide/behavior.ts:79` — landmark filing uses
  `<destination for="triage">` angle-bracket notation; commentary flags it as
  possibly-stale XML. Audit whether the landmark schema takes a `{% destination %}`
  Markdoc tag now (Track 1 / audit).
- `src/schemas/registry.ts` — `SheetSchema` type is **`sheet`** (bare), while
  the Doc side is `gdoc`. The `.sheet.card` → `.gsheet.card` rename is a real
  card-type migration (subplan). `drive.ts:17,27` shows each Drive card pairs
  with a data dir / `.md` — the "move both together" mechanic the commentary
  wants collapsed to `cb mv`.
- `src/webapp/routes/proxy-image.ts:127` — `/api/proxy-image?url=`, SSRF-guarded.
  The external-image capability (recipe `hero-image` href, chat image display)
  already exists; reuse.

**Round-1 runtime-wiring audit (unchanged, still valid):** `user`, `calendar`,
`health`, `last-activity`, `time` (UTC-ISO), todo-acks, `zoomed-view`, and
`version`-drift-via-`cb extfile sync` are all wired (`session-context.ts`,
`chat-helpers.ts:122`, `structured-output-parsing.ts:24`, `extfile-sync.ts:59`).
`card-activity` is companion-pane-only (`chat-card-activity.ts:28`). `health`
gating is first-message-only — the round-2 "health behavior changed, audit it"
remark resolves to: **the change is planned here (Track 4), not yet shipped.**

---

## Prior art (external)

Almost entirely internal prose engineering. Narrow externals:

- **Markdoc tag attribute vs. body modeling** (quote/source subplan, and the
  `{% destination %}` audit) — https://markdoc.dev/docs/tags covers custom tag
  `attributes` vs `children`. Relevant when deciding how `{% source %}` carries
  a selected span and whether landmark destinations become a Markdoc tag. No
  external pattern dictates the choice.
- **iCalendar `X-` extension headers** (calendar section) — the `X-CB-*` headers
  are custom; standard `.ics`/RFC 5545 structure is what the agent can look up,
  the CB headers are what it can't. This *confirms* the commentary's point that
  the example should foreground the `X-CB-*` bits. No external limitation blocks
  it.

No external bug searches apply. Empty is expected here.

---

## Tracks / scope

Ordered by dependency then surface size. **Track 0 is the keystone** — most trim
tracks resolve "define once, cross-reference here," so it lands first. Three
subplans (7–9) carry their own decisions.

### Track 0 — "How a Box Works": About Cards + glossary + named laws

**What.** Build the single authoritative surface the whole guide leans on, and
finish the laws. Three coupled pieces:

**(a) The About Cards section** — a new leading section (near the Laws; Law 3
points at it), tight and expanded, owning everything currently redefined
per-section:
- **What a card is** — markdown with **required YAML frontmatter**; type comes
  from the filename (`Name.type.card`), *never* a `type:` field. No XML.
- **The body** — plain markdown plus the standard Markdoc tags (`{% quote %}`,
  `{% source %}`) that work everywhere.
- **The shared frontmatter envelope** — `title:`, `contains:` (the retrieval
  sentence — moved here from `search.ts`), and refs. Candidates to hoist
  pending the shared-vs-per-schema decision: `description:`, `tags:` (see
  Open Questions).
- **The glossary** (round 1) — `ref`, `pos`, `placement` defined **once**;
  `pos` everywhere (not `position`). Path shape: absolute `/`-from-box-root vs
  bare-relative, avoid `../../` (moved from `behavior.ts:14`).
- **Naming convention** — `First_Last` form (capitalized words, underscores;
  not dashes, not lowercase slugs) as the **preferred (not required)** box-wide
  convention (hoisted from `person.tsx:32`).
- **The no-Git-tracked-metadata principle** — no `created`/`modified` in
  frontmatter, Git tracks both (generalized from `doc.tsx:100`).
- **Attachments** — the `<basename>.attach/` scope, attaching arbitrary files,
  embedding an image example.
- **Card manipulation** — `cb create`/`mv`/`rm` with the **raw-tool nudge**
  (use `cb mv`/`cb rm`, not `git mv`/`mv`/`rm` — they rewrite refs and route
  trash). **JSON as the default** for machine-set structured frontmatter values
  (settle the current "repeat-key *or* JSON" inconsistency on JSON).
- **Cards are the primary user-visible thing** — what the user sees in the
  browser, what views render. Frame the stakes up front.
- **Card-types index** — a real reference (each type's short description), not a
  name-list-with-"see-docs". Drive/others point here instead of re-describing.

**(b) Named laws** — rename Law 1/2/3 to **THE LAW OF QUOTING** / **THE LAW OF
SAVING** / **THE LAW OF CARDS** (all-caps, referable by name); adopt all-caps
section names generally so cross-references land in scan. Law 2: "file" → "card"
(`laws.ts:56`) + add short criteria for when a query-answer needn't be saved
(routine lookups, Law-1 errands) while **erring toward saving** (including
half-formed ideas). Law 3 → pointer to About Cards. Add a working
`{% source %}`-wraps-`{% quote %}` example under Law 1.

**Why.** The duplication is the disease; every other trim is a symptom. Search
redefines `contains:`; doc/person/recipe redefine fields and naming; behavior
re-lists briefing tags; drive re-describes card types. Defining each once and
cross-referencing is what makes the per-section trims *safe* (they defer rather
than delete knowledge). Traces to *"don't add features beyond what the task
requires"* and the weight discipline.

**Vocabulary lock-ins.** `ref`/`pos`/`placement` (`pos`, decided). Law names
(QUOTING/SAVING/CARDS). Naming convention: `First_Last`. JSON as machine-set
frontmatter default.

**First implementation chunk.** Write the About Cards section + glossary (no
consumer edits yet) and the laws rename/refinements. Grep `position`→`pos`,
settle it. No open question inside this chunk except the shared-vs-per-schema
field set (`description`/`tags`), which is decided *before* the consumers hoist,
not inside this chunk — see Open Questions.

### Track 1 — XML + dead-card-type scrub (continued)

**What.** Finish hunting stale format vocabulary across the whole prompt
surface. Round-2 additions to round-1's list: `cards.ts:29` (*"writing XML
directly"*), `chat-session-prompts.ts:14` (still *"XML card files"*), and the
`behavior.ts:79` `<destination for="…">` **audit** (resolved: stale — destinations
are frontmatter; fixed).

**CORRECTION — `memo` is NOT retired.** The commentary claimed `.memo.card` is
gone; it is not. `memo` is a live, registered, actively-**produced** type — the
UI's voice-memo recorder (`POST /api/actions/create-voice-memo`, the `voice-memo`
template) writes `box/inbox/Voice_Memo_<ts>.memo.card` and the `transcribe`
preaction (`appliesTo: ["memo", "feedback"]`) transcribes it; `doc.tsx:95`
correctly points captured notes/voice memos at `.memo.card`. So **do NOT scrub
memo** anywhere (`doc.tsx:95`, `chat-session-prompts.ts:112`'s `Trip.memo.card`,
the source/laws examples) — those references are valid.

**Direction.** Grep-driven: `rg -rni "xml" src/core src/schemas` over the prompt
surface; fix each to frontmatter/markdown language. (No memo scrub — see the
correction above.)

**First chunk.** The grep + known sites in one commit; the `<destination>` audit
resolved separately (may become a Track-6/landmark-schema change).

### Track 2 — Discipline cleanups: implicit-validate + raw-tool nudges (new)

**What.** Two cross-cutting corrections the commentary raised 3× each:
- **`cb validate` is implicit on edits — stop telling the agent to "always" run
  it.** Remove from `behavior.ts:11`, `cards.ts:40`, and the commands section;
  reframe (in About Cards / commands) as "runs implicitly; reach for it
  explicitly only when debugging a surfaced error."
- **Prefer `cb mv`/`cb rm` over raw `git mv`/`mv`/`rm`** — add the nudge in the
  commands section and collapse the Drive "move both together" mechanics
  (`drive.ts:17,27`) to `cb mv`. (The canonical statement lives in About Cards;
  these sites cross-reference.)

**Why.** Repeated empty/misleading instruction is context cost and actively
misleads (routine `cb validate` calls; hand-moving drive pairs and breaking the
`drive-id` link). Traces to the weight discipline and *bias-toward-strict*
(the safe tool as default).

**First chunk.** Both cleanups across all sites, after Track 0 gives them a
canonical home to point at.

### Track 3 — Always-loaded weight architecture (new, structural)

**What.** Stop always-loading sections most runs never touch. Not prose edits —
a change to the guide's *loading model*:
- **Calendar** and **Drive** → out of the always-loaded guide. Repackage as
  **on-demand** (a rule attached to `store/calendar/` / `store/drive/`, or a
  triggered procedure) or as **Claude skills** loaded on invocation. Both are
  structured-authoring surfaces (`.ics` with `X-CB-*`; Drive card mechanics) —
  good skill candidates.
- **Extensibility** (procedures, guides, schedules, tricks) — reconsider
  load-timing. The procedures/guides lists are generated per-box and may bloat;
  guides could become "guides exist; list them with `cb search`/`cb ls`" rather
  than an inlined generated list. Schedules: trim the launchd/JSONL/daemon
  system-operational detail to a referenced admin doc, keep one line.

**Why.** Always-loaded context is the scarcest resource; a heavy `.ics` example
or a full per-box procedure list on every run is pure cost when the run is a
recipe edit. Traces to the weight discipline. **This interacts with Track 5's
per-section trims** — decide load-model first, then trim what remains.

**First chunk.** Decide the mechanism (on-demand rule vs skill) for calendar +
drive — that's the open design question gating this track; prototype one
(calendar) end-to-end before converting drive.

### Track 4 — Chat system prompt overhaul (rounds 1 + 2 merged)

**What.** One file (`chat-session-prompts.ts`), the largest remark cluster.
Merged and de-duplicated across both rounds:
- **Box-concepts block** — drop the XML line (`:14`), replace the directory
  roll-call (`:15-20`) with a pointer to a **real `store/MAP.md`** (the roll
  still names the "legacy reactor path" — it's a half-map that goes stale), and
  drop the four-verb `cb` name-drop (`:21`) in favor of pointing at the now-real
  commands surface.
- **Capabilities vs behavior vs personality** — the `BEHAVIOR:` block (`:24-30`)
  mashes a capability claim (*"read and modify any files"*), personality
  (*"concise and conversational"*), and chat mechanics (voice-in/out,
  speak-before-tools). Split into a real capabilities surface + defer
  personality to the personality card. Drop `CALLBACK_BOX_CHAT_MODE` (`:9`,
  decided).
- **Triage fragment** (`:27`) — the "large tasks → job card" bullet is a
  fragment of the real intake→triage→handle design. Route to the triage surface
  or lift it properly; don't half-express it. (Recalibrate: job-card hand-off is
  rarer than implied.)
- **Commit line** (`:22`) — "meaningful messages" is a non-instruction; teach
  how/when to commit or drop.
- **Images/linking** — drop the `api/files/` back-compat mention (`:69`), add
  the external-image proxy; **refactor the SHOWING FILES section** (`:71-82`):
  lead with cards (a `doc` example), add plain markdown links, move `zoomed-view`
  up into STATE SNAPSHOT (near `open-card`), drop the "Do NOT use `view:`" scar,
  and steer views toward **card-type-targeted views** (standalone dashboards are
  the unusual choice, not the default).
- **State snapshot** — **drop the `calendar` attribute** (round 2: if the agent
  needs calendar it can fetch it) — reconciles with round-1's keep-lean lean;
  **`health` gating** → surface whenever something is failing, not
  first-message-only (the code change in `session-context.ts:206-243`); drop
  `time`, keep `local-time`. Card-activity scrolled-position is **already
  shipped** — no work; keep the "low-confidence attention hints" framing.
- **Self-notes / "user-position"** — bikeshed the "user-position/user-role"
  term (`:86`): the concept is "arrives in the user slot but isn't from the
  user." Compress SELF-NOTES.
- **Voice/transcription** (round 1) — pointing guidance, homophones + dropped
  negatives, diarization "can't be assumed the same person."
- **Narration overlay** — inline it, lead with *why* silence is the default.
- **Carbonara example** — trim; audit stray backticks.

**Why.** Each is a concrete misdescription, stale example, or always-loaded
prose the agent can't act on. Depends on Track 0 (box-concepts cut, commands
surface) and Track 1 (XML). The `health` change carries a test.

**First chunk.** Settled prose edits (XML, roll-call→MAP pointer, scar removal,
`time` drop, calendar-attr drop, term fixes, carbonara trim). The `health` code
change is its own chunk (test + mid-session gate). Voice-out-default stays an
open question.

### Track 5 — Agent-guide per-section trims + string normalization (rounds 1+2)

**What.** Per-section edits, most deferring shared concepts to Track 0. Plus a
cross-cutting refactor: **normalize each section from string-array to a single
template literal** so it reads as prose (round-2 whole-file note, applies to all
of `src/core/agent-guide/`).

- ~~**commands.ts**~~ — **DONE.** Restructured into "reach for these"
  (`cb feedback` promoted to the top with its rationale; search/calendar/
  procedure/the `cb chat` family), "job/procedure lifecycle" (`cb finish`
  scoped), and "system-run — you don't invoke these" (`cb reactor`/`finalize`/
  `health`). Card ops (`cb create`/`mv`/`rm`) defer to ABOUT_CARDS; `cb validate`
  (implicit), `cb answer` (rare), and `cb scenario` (dev tooling) dropped from the
  surface.
- **behavior.ts** — drop the three duplicated non-instructions (validate,
  cb-create-over-hand, meaningful-commit); **keep** the git-trailers table (and
  audit it against emitted trailers) and the memory-vs-box rule (check for a
  supported in-box per-agent scratch to make it constructive); compress the
  personality-card paragraph to one line; trim the retrospective detail to
  "they exist; `source: inferred` are hypotheses" (rest → retro procedure doc);
  remove the duplicated briefing-tag enumeration (briefing schema owns it);
  audit `store/archive` purpose.
- **box-shape.ts** — reframe `box/output/` as "cards that cause something
  outside the box to happen" (not message-specific); rephrase "you do NOT
  manually place items" (manual `cb create`/`mv` **is** how the agent
  operates — the rule is about *users*); resolve the "legacy" inbox-jobs vs
  intake→triage vocabulary (is a "job" ≠ a triaged item? name or converge);
  **audits**: `_unsure/`, `box/pool/`, `store/integrated/`, `store/reviews/retro/`
  existence + purpose, recipes/todos-as-top-level weight; enumerate the actual
  triage `<category>` list.
- **landmarks.ts** — reframe around the mechanic: a `.landmark.card` in a
  directory makes it a navigation/trails destination; **nail down + state the
  filename convention** (audit the runtime); add active guidance ("as you create
  structure, drop landmarks so it's navigable"); keep the "earn their spot" tone.
- **extensibility.ts** — reframe **tricks** as "box-local scripts the agent
  reaches for like `cb` commands, scoped to this box"; schedules/procedures/
  guides load-timing handled in Track 3.
- **calendar.ts** — resolve the **real box timezone** at prompt-build time (not
  `e.g. America/Chicago`); give a **calendar-id discovery** path; add concrete
  `X-CB-REASON`/`X-CB-REF` examples; rework the `.ics` example to foreground the
  `X-CB-*` headers (the only part the agent can't look up). (Moves on-demand per
  Track 3.)
- **drive.ts** — collapse Move mechanics to `cb mv` (Track 2); point at the
  card-types index for `.sheet`/`.gdoc` shape; heading updates ride the
  `.gsheet.card` rename (subplan 9).
- **search.ts** — **split searching from `contains:`-authoring**: keep a short
  search entry (add concrete example queries, clarify result/output shape,
  document any keyword flag); move the `contains:` field definition and
  write-rule (and kill `CONTAINS_DOC_APPENDIX`'s per-type duplication) to About
  Cards.
- **quotes.ts** (round 1 + 2) — trim to pure mechanics now Law 1 carries the
  rule; drop "precious"/duplicated rules; fix "mishears"; add the
  **repeat-sentence self-correction** pattern (user re-speaks a mis-transcribed
  line clearer; treat as one self-correction, use the second); add user-directed-
  edit exception.
- **source.ts** (round 1) — rename `as`; drop `#m12`/`#step-3` fragments; trim
  `ref` (defer to glossary); state `pos` == selection/activity grammar; align
  `placement`; single template literal; emphasize "inside Markdown."
- **briefing-tags.ts** — stop always-loading (→ card-type rule); fix the
  `type: briefing` prose; couples to the briefing subplan.

**Why.** Tier-2 is always-loaded for all agents; self-explaining prose and
per-section re-definitions are pure cost. Depends on Track 0 for defer-targets.

**First chunk.** `quotes.ts` + `commands.ts` restructure + string-normalization
of the already-trimmed sections (no cross-deps). `search.ts`/`doc`-style hoists
follow About Cards.

### Track 6 — Schema instruction trims + field redesigns (rounds 1+2)

**What.** Per-card-type instructions, deferring shared concepts to About Cards
and **tightening loose fields toward typed shapes** (bias-toward-strict):
- **doc.tsx** — drastically shorten; prefer the `.doc.card` **filename form** in
  prose over "doc card"; hoist `title:`/no-timestamps to About Cards (leave
  one-liners); expand the "when not a doc" list (READMEs, skills scaffolding,
  embedded-in-code markdown; **keep** the `.record.card` alternative prominent;
  **keep** the `.memo.card` line too — memo is live/produced, so "captured note
  or voice memo → `.memo.card`" is correct guidance).
- **recipe.tsx** — drop the italian/desserts subdir taxonomy (organization is a
  user conversation); **type `source:`** as `href`/`ref` (not freeform
  "cookbook, person, URL"; enables a future frozen-`.webpage.card` link);
  **type `hero-image:`** as `ref`(attach)/`href`(external) with both examples;
  clarify `description:`'s purpose (and whether it's shared); decide `tags:`
  shared-vs-recipe; drop the internal "Track 4 ref-walker" phrase + inline `ref`
  redef (round 1).
- **person.tsx** — break freeform `contact:` into structured
  `email:`/`phone:`/`address:` (each optional); **add a participant flag**
  (`participant: true` or an enum) distinguishing people who act in the box
  (connectors/chat) from people merely referenced; hoist the `First_Last`
  naming convention to About Cards (cross-ref).
- **commentary.tsx** (round 1) — drop the `defaultHref/defaultRef/targets`
  rebuttal; lead with a concrete worked example. (Overload → subplan 8.)
- **briefing.tsx** — → subplan 7.

**Why.** Tier-3 loads per type; over-explaining + freeform-where-typed-is-usable
is cost and lost actionability. `person.contact:` freeform "can't render or
search a blob" — structuring it makes views/connector-matching work. Traces to
bias-toward-strict and the weight discipline.

**First chunk.** `doc.tsx` + `recipe.tsx` non-field trims (need only About
Cards' hoist targets). The field-redesigns (person contact/participant, recipe
source/hero-image) each carry a schema change + migration consideration — their
own chunks.

### Track 7 — Briefing schema redesign (SUBPLAN, round 1)

Frontmatter-first briefing (`purpose` string, `key-people` list, decide
corrections/property shape, audit `project-phase`, prose as headings), preserve
compiled CLAUDE.md output, migrate existing briefings. Fixes the `type: briefing`
frontmatter bug. Own `/cb-migration` discipline; `briefing-tags.ts` trim + the
behavior.ts briefing-tag dedup land with it.

### Track 8 — `{% quote %}` vs `{% source %}` overload (SUBPLAN, round 1)

`{% quote %}` = sacrosanct user words (Law 1); stop reusing it inside
`{% source %}` to mean "the selected anchor span." Decide the span carrier
(attribute vs escaped body). Reconciled across `source.ts`, `commentary.tsx`
(+ `validate`), `markdoc-config.ts`, the composer/source-editor, renderer.
Intersects the `as` rename (Track 5).

### Track 9 — `.sheet.card` → `.gsheet.card` rename (SUBPLAN, new)

**What.** Rename the `sheet` card type to `gsheet` for naming consistency with
`gdoc` (both Google-synced, both should wear the `g` prefix).

**Why a subplan.** A card-type rename is a migration touching the schema
(`sheet.tsx`), the registry, every `.sheet.card` on disk in existing boxes,
`drive.ts` guide prose + headings, any renderer/view keyed on the type, and
`drive-id`-linked data dirs. Needs `/cb-migration` discipline (atomic rename,
noisy field-loss guard). Small in concept, real in blast radius.

---

## Failure modes

Prose changes don't add runtime branches; the schema redesigns, the health
change, the load-model change, and the three migrations do.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `as`→new-name misses an existing card using `as=` | No | `cb validate` attr checks | Clear if renderer rejects old name; **silent** if ignored |
| `person.contact:` restructure orphans existing freeform-contact cards | Must add | migrate `_warnings.ts` noisy field-loss | Clear in noisy mode; silent otherwise |
| `recipe.source:`/`hero-image:` retype breaks existing freeform values | Must add | schema validate + migration | Clear if validate tightens in lockstep |
| `.sheet`→`.gsheet` rename leaves `.sheet.card` on disk / stale views | Must add | `cb mv`-style rename migration | **Silent** — old cards just stop matching the schema |
| Briefing redesign changes compiled CLAUDE.md output | Must add (golden) | None yet | **Silent** until an agent reads a changed CLAUDE.md |
| Health surfaced mid-session floods every message when a task stays failing | Must add | needs de-dup / on-transition gate | **Noisy** (opposite failure) if ungated |
| Calendar/Drive moved on-demand but the trigger never fires when needed | Must add | rule/skill trigger condition | **Silent** — agent lacks the guidance it needed |
| About Cards defined a term but a trimmed section dropped a nuance only it had | knowledge audit | About Cards | Silent |

**Critical gap — briefing compiled-output drift:** a golden-output doctest on
`compileBriefing` is a done-when for Track 7.

**Critical gap — `.sheet`→`.gsheet` silent non-match:** the rename migration
must find and convert every `.sheet.card` (and its data dir) atomically; a
missed card silently stops validating. Migration in noisy mode + a
post-migration "no `.sheet.card` remain" assertion.

**Critical gap — health mid-session flood:** surfacing health on *every* message
while a task stays failing is the opposite failure. The change needs a gate
(once per session per distinct failure, or on transition to failing) — a design
point for Track 4's health chunk, not an afterthought.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED by Track 8 (quote/source); DEFERRED
  until it lands.
- **Stale ref** — unchanged resolution; `cb validate`/`cb mv` still apply.
  ADDRESSED.
- **Two agents on one card** — briefing/person edits: no new concurrency;
  file-lock discipline unchanged; migrations atomic per card. ADDRESSED.
- **Hand-edit drift** — old `as=`/`.sheet.card`/freeform `contact:` after the
  respective changes. GAP in each rollout window → each migration decides
  reject-vs-migrate (flagged in Failure Modes).
- **Fabricated free-form value** — typing `contact`/`source`/`hero-image` and
  structuring `key-people` *reduces* fabrication surface (fields are checkable).
  Carry the source-guide honesty framing (*"write the truth"*) into
  `key-people` descriptions. ADDRESSED (improves).
- **Validation-error UX** — the tightened schemas (person/recipe) and Track 8's
  `commentaryErrors` change must read well in agent context. DEFERRED to each
  schema chunk.
- **Partial migration / transition state** — three migrations (briefing, person
  contact, sheet→gsheet). Each owns its window; each completes (no
  stop-midway). DEFERRED to subplans/chunks.

---

## NOT in scope

- **Prompts not yet in the review surface** — the box now cards the full
  surface, but only the reviewed subset has commentary. A round 3 may follow.
- **The `store/` top-level restructure** — box-shape commentary questions the
  whole `store/` split (archive vs integrated vs reviews/retro; recipes/todos as
  top-level). That's a box-*information-architecture* redesign, larger than the
  prompt surface; this plan only clarifies/audits the *descriptions*, and flags
  the structure question for a separate effort.
- **The inbox-job vs intake-pipeline convergence** — resolving whether a "job"
  is a distinct concept from a triaged item is a pipeline-design decision; this
  plan surfaces the ambiguity and fixes the misleading "legacy" wording, but
  doesn't re-architect routing.
- **Building the calendar/drive skills themselves** — Track 3 decides the
  load-model and moves the content; authoring polished skills is follow-on.
- **`cb scenario` CLI removal** — the commentary suggests removing it from the
  CLI entirely; this plan only removes it from the agent-facing guide. CLI
  surgery is separate.
- **Commit-nudge rework** — no remarks; unchanged.

---

## Open design questions

**Decided (boxholder):** health surfaces mid-session (Track 4); `pos` everywhere
(Track 0); drop `CALLBACK_BOX_CHAT_MODE` (Track 4); JSON default for machine-set
frontmatter (Track 0); `.sheet`→`.gsheet` rename (Track 9); named laws (Track 0).

**Still open:**
1. **Shared-vs-per-schema fields** — which of `contains`, `title`, `description`,
   `tags` are truly universal (→ About Cards) vs per-type? *Lean: `title` +
   `contains` universal now; `description`/`tags` hoist only if genuinely
   box-wide (decide before consumers hoist).* (Track 0/6)
2. **Calendar/Drive load-model** — on-demand rule vs Claude skill? *Lean: skill*
   (structured-authoring shape fits). Prototype calendar first. (Track 3)
3. **Health mid-session gate** — once-per-session-per-failure, or
   on-transition-to-failing? *Lean: on-transition + not-again-until-recovered.*
   (Track 4)
4. **Voice-in → voice-out default** — tighten or accept variance? *Lean:
   accept-and-document.* (Track 4)
5. ~~**`as` new name**~~ — **DECIDED: `usage`** (renamed; see Status). Was in Track 5's first
   chunk. (Track 5)
6. **`{% source %}` span carrier** — attribute vs escaped body. (Track 8)
7. **`person.participant`** — boolean vs enum (referenced / participant /
   self)? *Lean: enum (room to grow).* (Track 6)
8. **briefing corrections/property** — frontmatter list vs body section.
   (Track 7)
9. **landmark filename convention** — bare `landmark.card` vs
   `<Name>.landmark.card`; audit the runtime, then state it. (Track 5)
10. **`{% destination %}`** — is the angle-bracket `<destination>` a stale form
    to convert to a Markdoc tag, or current? Audit. (Track 1)

---

## Knowledge audits

New agent-facing concepts warranting `src/dev/knowledge-audits.yaml` entries
(precedent: the four `{% quote %}` audits):

- **About Cards core** — `knows_directly` that a card is markdown + required YAML
  frontmatter, type-from-filename; that `ref`/`pos`/`placement` mean X; the
  `First_Last` naming convention; the no-Git-metadata rule. The payoff of
  consolidating is retention — audits prove it.
- **Named laws** — the agent can name THE LAW OF SAVING and act on it (save to a
  card before the turn ends). (These are the Laws 2/3 audits deferred last
  session.)
- **`cb feedback` reflex** — after promotion, the agent reaches for it on
  tooling friction.
- **Raw-tool avoidance** — the agent uses `cb mv`/`cb rm`, not `git mv`/`rm`.
- **`{% quote %}` vs `{% source %}`** (Track 8) — picks the right tag for
  "a span I'm commenting on" vs "the user's words."
- **Typed schema fields** (Track 6) — the agent fills structured
  `email:`/`phone:` and typed `source:`/`hero-image:`, not freeform blobs.
- **Skip-with-rationale:** pure deletions (validate-nag removal, section trims)
  don't add a convention to recall.

Audits land **run** (`pnpm knowledge-audit run --box <test-box> --filter <tag>`)
and recorded before the plan completes.

---

## Implementation order

1. **Track 0** — About Cards + glossary + named laws (unblocks everything;
   settle shared-field set + `pos`).
2. **Track 1** — XML scrub + `<destination>` audit (no `memo` scrub — memo is live).
3. **Track 2** — validate-nag removal + raw-tool nudges (need Track 0's home).
4. **Track 3** — calendar/drive load-model (prototype calendar), then the
   extensibility load-timing trims.
5. **Track 5** — per-section trims + string normalization (quotes/commands
   first; hoists after Track 0). `source.ts` sequenced with Track 8.
6. **Track 6** — schema trims (doc/recipe non-field) then field redesigns
   (person, recipe) — each with its migration.
7. **Track 4** — chat prompt (settled edits; then the health chunk with its
   mid-session gate + test).
8. **Track 8** — quote/source reconciliation (with `source.ts`/`commentary.tsx`).
9. **Track 9** — sheet→gsheet rename migration.
10. **Track 7** — briefing redesign + migration (briefing-tags + behavior dedup
    ride along).

Chunks are commit boundaries in the worktree. The plan completes when all tracks
+ subplans are done; **ships as one unit only on the boxholder's `/finish`.**

## Candidates to move into ABOUT_CARDS (found during the dedup pass)

Things elsewhere that re-teach card concepts and may belong in the canonical
surface — noted, not yet moved:

- ~~**`title:` as a shared field**~~ — **DONE.** `title` is in `GLOBAL_CARD_FIELDS`
  (`src/cards/schema.ts:87`, alongside `contains` and `content-type`); documented
  in ABOUT_CARDS' shared envelope.
- **`content-type:` — REMOVED.** It was vestigial: the XML loader was already
  gone (`LoadedCard = FrontmatterLoadedCard`; `XmlLoadedCard` doesn't exist —
  CLAUDE.md was stale, now fixed), and no schema declared a non-markdown body, so
  `content-type` + the `kind: "xml"` branches were dead code. (My earlier
  "load-bearing / 4,438 cards" alarm was wrong: 97% of those cards are stale
  fixtures in two scratch boxes — `hearth-test`, `ledger-shrink-test`; real
  boxes have a handful of dead inbox demo-scans.) Dropped `content-type` from
  `GLOBAL_CARD_FIELDS`, removed `BodyKind`/`BodyFieldOptions`/`kind`,
  `CARD_XML_CONTENT_TYPE`, and the XML validate/serialize branches; `body()` now
  takes just a schema. The seam is documented for re-adding if a non-markdown
  body is ever needed.
- **`status:` — no misuse; nothing to rename.** Correction to an earlier
  mis-survey: the enums that looked misfiled are already correctly named —
  `text`/`voice` is `feedback.source:`, `query-response`/`comment`/`brief` is
  `feedback.type-of-feedback:`, `normal`/`low` is `intake-job.priority:`. The
  actual `status:` fields are all legitimate domain statuses (lifecycle
  `new`→`processed`; entity `active`/`archived`; Drive sync `synced`/`error`/
  `conflict`; experiment `proposed`/…). They aren't one concept, so a single
  normalized vocabulary still doesn't fit — but there's no misuse to fix.
  ABOUT_CARDS just notes `status` is common and type-specific.
- **`CONTAINS_DOC_APPENDIX`** (`search.ts`) — the per-card-type generated-doc
  appendix now duplicates ABOUT_CARDS' `contains:` rule; replace it with a
  cross-reference (a `generate-docs` change, so deferred).
- ~~**`commands.ts` card commands**~~ — **DONE.** `commands.ts` now defers card
  ops to ABOUT_CARDS and dropped the `cb validate` nag.
- **reactor + chat system prompts** — both still re-teach "cards are
  `Name.type.card` + `cb` commands"; since they load the guide, defer to
  ABOUT_CARDS (Track 4 / the reactor trim).
- **"which card type to reach for"** — `doc.tsx`'s `.doc.card` vs `.record.card`
  vs loose `.md` guidance is partly a general choosing-a-type question that could
  anchor in ABOUT_CARDS / CARD_TYPES.
- **person-creation nudge** in `behavior.ts` `whereToRecordSection`
  (`create a person card at people/First_Last...`) re-states naming — minor.

## Rollout shape

- **Tests first, as a design tool.** Golden-output doctest for `compileBriefing`
  (Track 7); doctests for the tightened `person`/`recipe` schemas + their
  migrations; the sheet→gsheet "no `.sheet.card` remain" assertion; the `as`
  rename-safety check; the health mid-session gate (asserting it doesn't flood).
  Prose-only trims get no per-edit test — the knowledge audits are their
  behavioral check.
- **Knowledge audits** land run with their tracks.
- **Migrations** (briefing, person-contact, sheet→gsheet) — agent-driven, atomic
  per card, noisy field-loss mode; each completes within the plan.
- **No deploy from the worktree** — merge to `main` is the boxholder's call at
  `/finish`.
