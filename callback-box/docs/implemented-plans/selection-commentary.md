---
title: "Selection Commentary — referencing document text in chat input"
status: implemented
workstream: unknown
issues: []
---
# Selection Commentary — referencing document text in chat input

> **Status: Implemented (2026-05).** This document is the original design
> plan, kept as a historical record. The feature shipped on the
> `worktree-commetary` branch; the text below is forward-tense ("this plan
> adds…") but the work is done. Where the code lives:
>
> - **Heading anchors** (Track 1) — `src/shared/markdoc-config.ts`
>   (`makeHeadingNode`), test `test/markdoc-headings.doctest.md`.
> - **Selection capture / position** (Track 2) —
>   `src/frontend/src/lib/selection-position.ts`,
>   `src/frontend/src/components/SelectionCapture.tsx`, `FileView` prop;
>   test `test/selection-position.doctest.md`.
> - **State / pills / serializer / typed wiring** (Track 3) —
>   `src/frontend/src/lib/selection-serialize.ts` (`applySelections`),
>   `InteractiveChat-selections.ts`, `ChatSelections.tsx`; test
>   `test/selection-serialize.doctest.md`.
> - **Voice fold-in** (Track 4) — `InteractiveChat-voice.ts`,
>   `buildSpeechMessage` in `InteractiveChat-helpers.ts`; test
>   `test/speech-message.doctest.md`.
> - **Agent guide + audit** (Track 5) — `src/core/agent-guide/chat.ts`
>   (`selectionsSection`), `knowledge-audits.yaml` (`chat-user-selection-tag`).
> - **Sent-message pill** — `chat/user-message.tsx` (`MessageSelectionPill`).
>
> **Deviations from this plan, decided during implementation:**
> - **Voice positional anchoring was added** beyond the plan. The plan had
>   voice selections *append* after the spoken body; in practice they now
>   anchor to the transcript phrase spoken at grab-time and insert at that
>   point (word-level, case/punctuation-insensitive). When the HQ pass rewords
>   the anchor phrase enough that it no longer matches, the selection falls back
>   to an **estimated** placement — dropped at its rough time-proportional spot
>   (from `spokenWords`/total body words) and tagged
>   `placement="estimated, ~N% through the message"` — so lost selections stay
>   in spoken order instead of piling up at the end. Only a selection with no
>   anchor *and* no timing appends. See `applySelections` and the
>   `SelectionItem.spokenWords` field.
> - **The DOM-doctest harness subplan was deferred, not built.** Per the
>   "test what we can" decision, the pure logic is doctested, `extractSelection`
>   was validated against the live DOM via `bin/browse`, and the irreducibly-
>   browser parts ("+" geometry, voice) are covered by
>   `test/manual/selection-commentary.manual.md` — the natural-language
>   reference script.
> - **Several adjacent fixes rode along** (found while dogfooding): base-prefix
>   on "open in browse" links, paragraphs render as `<div>` not `<p>`,
>   `/auth/me` returns 200 when auth is disabled, the "+" click/dismiss race,
>   and trailing-space padding for inserted tokens.

This plan adds a way to attach a **text selection from an open document**
to a chat message. The user selects text in a document shown in the chat
companion pane, a floating **"+"** appears near the selection, clicking it
inserts a `[selectionN]` token into the composer and a removable/​viewable
pill. On send, the token expands to:

```xml
<user-selection ref="/store/notes/Bread.doc.card" position="body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42">let it rise until doubled in size</user-selection>
```

The feature is deliberately modeled on the existing **image attachment**
flow: per-message numbered items in local state, `[token]` placeholders in
the textarea, pills above the composer, and inline expansion at send time.
Unlike images (which travel as a separate Anthropic content-block channel),
a selection is plain text and is assembled entirely on the frontend — like
the existing `<attachments>` block — so it needs **no backend transport
changes**.

**The composer has three input modalities, and a selection must fold into
each.** Typed text (`<typed>`), live realtime transcription (`<speech>`),
and high-quality after-the-fact transcription (`<speech diarized>`). These
do **not** share a send path: typed goes through `handleSend`, but both
voice paths call `doSend` directly and bypass it. So the selection set is a
*per-message attachment set* (like images/files), serialized by a **single
shared helper** that every send path calls — inline at `[selectionN]` tokens
when the user typed, appended after the `<speech>` body when the user spoke
(no token to position at). This modality fold-in is the load-bearing design
problem this plan solves; getting it wrong silently drops selections on
voice messages.

A secondary, independently-useful change rides along: **headings in
rendered Markdown get stable `id` anchors**, which the position locator
reuses.

---

## Stated preferences this plan trades against

The principles this plan must be evaluated against, in priority order:

- `callback-box/code-style.md:36` — *"**No default parameters**: handle
  defaults explicitly"*; `:37–45` *"**Max 2 positional parameters**"*; `:17`
  NEVER `any`; `:56` *"**`as` type assertions are like Rust's `unsafe`**
  (banned in `.tsx` by lint…)"*. The new selection-capture, position, and
  serialization helpers obey all of these (the DOM→position helper takes a
  single params object; no bare `as` in the `.tsx` capture component).
- `callback-box/CLAUDE.md` (monorepo) — *"**NEVER disable or weaken a lint
  rule to make code pass. Ask first.**"* If the floating-"+" or selection
  capture trips a rule (e.g. `restrict-component-classes`), fix the code, do
  not suppress.
- `callback-box/CLAUDE.md:101` — *"**Read before writing.** Don't guess file
  formats, XML structures, or API shapes."* The `<user-selection>` tag
  shape traces to the existing `<typed>`/`<speech>`/`<attachments>`/`<ack>`
  conventions, not invented defaults.
- `callback-box/CLAUDE.md:105` — *"**Frontend uses UI primitives and a
  semantic palette.** Read frontend.md before writing UI."* The pill and
  the floating "+" use existing primitives and the `components/`-directory
  exemption from `restrict-component-classes`.
- `callback-box/CLAUDE.md` "don't add features beyond what the task
  requires" (Behavioral Notes, paraphrased from the project's scope
  discipline) — the NOT-in-scope section below is the gate.
- Most recent shipped precedent: the **image attachment** flow
  (`InteractiveChat-actions.ts` + `InteractiveChat-attachments.ts` +
  `ChatAttachments.tsx`) and the **`{% source %}` / `{% quote %}`** body tags
  (`markdoc-config.ts`). These are denser preferences than prose docs and are
  reused directly.

Every design choice below ends with a one-sentence trace to one of these.

> **Citation note.** A `main` merge (2026-05) split the former monolithic
> `InteractiveChat.tsx` into siblings under
> `src/frontend/src/components/chat/`: `-actions.ts` (typed `handleSend`),
> `-voice.ts` (realtime + HQ speech send), `-attachments.ts`
> (`useChatAttachments`), `-composer.tsx` (textarea), plus the
> `useRealtimeTranscription` hook. Citations below point at the post-merge
> layout.

---

## What already exists

The image-attachment flow is a near-complete template. Each piece below is
**reused as a pattern** (re-implemented for text, not literally shared)
unless noted.

- **Per-message numbered item state + token insert + reset, already
  factored into a hook.**
  `src/frontend/src/components/chat/InteractiveChat-attachments.ts`
  (`useChatAttachments`) owns the `attachments` state, the sequential id
  counter, cursor token-splice, and `resetAttachments`. The selection
  feature adds a sibling `useChatSelections` hook in the same shape. *Reuse
  pattern — a hook already exists to mirror.*
- **`AttachmentItem` shape.**
  `src/frontend/src/components/ChatAttachments.tsx:16–26` (`id`, `mimeType`,
  `dataBase64`, `objectUrl`, `byteLength`). The selection analog
  (`SelectionItem`: `id`, `ref`, `position`, `text`, plus a display label)
  mirrors it. *Reuse pattern.*
- **Pill panel + remove.**
  `ChatAttachments.tsx:28–60` (`AttachmentPanel`) / `62–102` (`ThumbTile`);
  removal strips the `[imageN]` token via regex and drops the item. A
  `SelectionPanel`/`SelectionPill` mirrors this; the remove regex changes to
  `\[selection(\d+)]`. *Reuse pattern.*
- **Typed send path.**
  `InteractiveChat-actions.ts:67` (`handleSend`) wraps text as
  `<typed local-time=…>…</typed>` (`:80`) and appends a **sibling
  `<attachments>` block** (`:84–89`) built purely on the frontend, then
  `resetAttachments()` + `setInput("")` (`:91–92`). The typed selection
  expansion hooks in here. *Reuse — proof that text-only references need no
  backend channel.*
- **Voice send paths — these bypass `handleSend`.**
  `InteractiveChat-voice.ts:56–58` (`submit`) calls `doSend("<speech …>…
  </speech>")` directly for the realtime path; `:60–84` is the HQ two-phase
  flow (`postAudioForHqTranscription` → `submit(hqText, { diarized })`).
  Neither touches `handleSend` or the textarea, so **attachments/selections
  are silently absent from voice messages today**. This is exactly the seam
  the modality fold-in must close. *Reuse the shared serializer here too.*
- **Open-document reference, already emitted.**
  `zoomedViewAttr()` already serializes the active companion view onto every
  message (`zoomed-view="view:<serialized>"`) — in both `-actions.ts` and
  `-voice.ts`. The companion tab's `target.path` (`PanelTab.target:
  ViewTarget`) is exactly the box-relative path we want for `ref`. *Reuse —
  `ref` is the active tab's `target.path`.*
- **Companion document viewer.**
  `InteractiveChat.tsx` renders `<FileView mode="companion" …>` for the
  active tab; `FileView` (`src/frontend/src/components/FileView.tsx`) loads
  card `frontmatter`+`body` via tRPC (`:79–82`, `:124–126`) or raw text via
  `/api/files/*` (`:85–93`). The selection-capture wrapper attaches here.
  *Reuse — add an optional callback prop, don't rebuild the viewer.*
- **Markdown rendering.**
  `src/frontend/src/components/Markdown.tsx:270–298` → Markdoc
  parse/transform/`renderers.react`. Headings currently use Markdoc's
  default `heading` node — **no `id`, no source-line data attributes**
  (verified: `src/shared/markdoc-config.ts:258–276` registers `tags` and
  only an `item` node override; no `heading` override). Adding heading ids
  is *net-new* (Track 2).
- **Tag + `ref` + escaping conventions.**
  kebab-case tags/attributes throughout (`<self-note>`, `<schedule-fired>`);
  `ref` = box-relative path, used by `<ack>` (`chat-session.ts:357–358`) and
  `<self-note>` (`chat.ts:514–518`); `escapeXmlAttr`
  (`src/webapp/routes/chat.ts:90–96`). The new tag follows all three.
  *Reuse conventions.*
- **Source-position precedent.**
  `src/core/body-refs.ts:46–68` walks the Markdoc AST and records
  `body:<line>:<tag>.<attr>` — proof the project already speaks
  "body line N" as a locator idiom. The `position` value borrows that
  vocabulary. *Reuse idiom.*

No existing text-selection toolbar, floating "+", or `window.getSelection`
handling exists anywhere in the frontend — that part is net-new.

---

## Prior art (external)

- **`window.getSelection()` → bounding rect for a floating toolbar** is the
  standard "medium-style inline toolbar" technique:
  `selection.getRangeAt(0).getBoundingClientRect()` positions a floating
  button. Well-trodden; no library needed. (MDN: Selection API,
  https://developer.mozilla.org/en-US/docs/Web/API/Selection — confirms
  `getRangeAt`/`getBoundingClientRect` availability.)
- **Mapping a DOM selection back to source offsets is the hard, fragile
  part.** Libraries exist for robust anchoring (W3C Web Annotation /
  `dom-anchor-text-quote`, used by Hypothesis,
  https://github.com/hypothesis/client) — they fuzzy-match the *quoted text*
  rather than trusting offsets, precisely because rendered DOM ↔ source is
  lossy. Takeaway that shapes this plan: **don't try to compute an exact
  source range; capture the rendered text verbatim and emit a *rough*
  locator.** This matches the user's stated tolerance ("agents don't need to
  be exact").
- **Markdoc heading ids:** Markdoc has no built-in heading-slug/anchor
  generation — confirmed by community threads asking how to add anchors
  (e.g. Markdoc GitHub discussions on heading IDs,
  https://github.com/markdoc/markdoc/discussions). The documented approach
  is exactly what Track 2 does: a custom `heading` node `transform` that
  slugifies the heading text into an `id`. No empty-search surprise here.
- **Slug collision** (two headings with the same text) is a known
  static-site-generator problem; the standard fix is a per-render seen-set
  that suffixes `-1`, `-2`. Adopted in Track 2.

No prior art found *inside* this repo for selection capture; the external
search confirms the "verbatim text + rough locator" posture rather than an
offset-mapping approach.

---

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — Heading anchors in rendered Markdown (prerequisite, smallest)

**What.** Add a `heading` node `transform` to `src/shared/markdoc-config.ts`
that slugifies heading text into a stable `id` (collision-suffixed) and
carries the source line from `node.lines` onto the rendered element as a
`data-line` attribute.

**Why this needs to change.** The position locator's most useful, most
stable signal is "which heading is this under." Headings have no `id` today
(`markdoc-config.ts:258–276` has no `heading` override), so there is nothing
to anchor to. The user explicitly asked for this ("Do headers get ids? I
would like them to!"). It is also independently useful — heading anchors
enable in-page linking later.

**Direction.** A Markdoc `Schema` for `heading` whose `transform` returns a
`Tag("h{level}", { id: slug, "data-line": line }, children)`. Slug =
lowercased text, non-alphanumerics → `-`, collapsed, trimmed; a render-scoped
`Set<string>` suffixes duplicates. `node.lines` is `[start, end]` 0-indexed
(`body-refs.ts:76–81` reads it the same way) → emit `start + 1`. Because
`markdoc-config.ts` is **shared backend+frontend+SSR** (its header comment:
*"Pure TypeScript only. No React, no fs/Node-only APIs, no DOM imports"*),
the transform stays pure; the slug helper lives in the same file or a pure
`@shared` helper.

**Vocabulary lock-ins.** Heading `id` slug algorithm (lowercase, `-`
separated, numeric collision suffix). `data-line` attribute name on block
elements (1-indexed source line).

**First implementation chunk.** The `heading` transform + slug helper + a
pure-function doctest over a few heading strings (including a collision
pair). No open questions inside it.

### Track 2 — Selection capture in the companion document viewer

**What.** When a document is shown in the chat companion pane, selecting
text surfaces a floating "+" near the selection; clicking it computes a
`SelectionItem` (`ref`, `position`, verbatim rendered `text`) and hands it to
chat via a callback.

**Why this needs to change.** There is no selection affordance anywhere
today; this is the core new capability.

**Direction.**
- Add an optional prop to `FileView`:
  `onAddSelection?: (selection: AddSelectionInput) => void`. When present
  (companion mode inside chat), `FileView` wraps the rendered body in a
  `SelectionCapture` container that owns a `mouseup`/`selectionchange`
  handler and renders the floating "+". When absent (browse panel, card
  page), behavior is unchanged — no "+", per the rule that the affordance
  only exists where there's a composer to add to.
- `InteractiveChat` passes `onAddSelection` down through the companion panel
  (the `FileView mode="companion"` render site) alongside the existing
  `onNavigate`.
- On click, compute from the DOM (renderer-agnostic, no source re-parse):
  - **`ref`** — the active companion tab's `target.path`, absolutized with a
    leading `/` to match the `<ack ref>` convention.
  - **`text`** — `selection.toString()`, trimmed (the *rendered* text the
    human saw, normalized of markdown syntax — see Failure Modes).
  - **`position`** — a single freeform locator string assembled from DOM
    traversal: `section` (is the common ancestor inside the frontmatter table
    vs the body container — distinguishable because `MarkdownCardView`
    renders frontmatter as a separate key/value table), nearest preceding
    `h1–h6` (its text + `#id` from Track 1), paragraph index within that
    section, and `~line N` taken from the nearest ancestor/preceding element
    carrying `data-line`.
- `position` is **one freeform attribute**, not discrete sub-attributes.
  Rationale: the user said the scheme will be refined; nothing parses it
  rigidly (the agent reads it as a hint), so its contents can evolve without
  a vocabulary migration. `ref` stays discrete (matches convention).

**Vocabulary lock-ins.** Tag name `user-selection`; attributes `ref`
(discrete, box-relative absolute path) and `position` (freeform locator).
Token form `[selectionN]`.

**First implementation chunk.** `SelectionCapture` component (handler +
floating "+" positioned via `getBoundingClientRect`) and the DOM→`position`
computation as a pure-ish helper taking the `Selection`/`Range` and the
container element, returning `{ ref-less } position string + text`. Wired
into `FileView` behind the optional prop, but **not yet connected to chat
state** (that's Track 3). Manually verifiable by logging the computed
`SelectionItem`. No open questions inside it.

### Track 3 — Selection state, pills, and the shared serializer

**What.** Hold `SelectionItem`s in a `useChatSelections` hook, render pills,
insert/strip `[selectionN]` tokens, and provide **one pure serializer** that
every send path uses to fold selections into a message string. Then wire the
**typed** path.

**Why this needs to change.** Track 2 produces selections; they need a home
in the composer and a single, modality-agnostic path into the outgoing
message. Putting the serializer in `handleSend` (as a first draft would)
would silently exclude voice — see the modality framing in the header and
the `-voice.ts` citation above.

**Direction.**
- **Hook.** `useChatSelections` mirrors `useChatAttachments`
  (`InteractiveChat-attachments.ts`): `selections` state, sequential id ref,
  `addSelection` (push + insert `[selectionN]` token at caret via the same
  splice helper attachments use), `removeSelection` (strip token via
  `\[selection(\d+)]` regex + drop item), `resetSelections`.
- **Shared serializer (the load-bearing piece).** A pure function:

  ```ts
  function applySelections(body: string, { selections }: ApplySelectionsArgs): string
  ```

  It (a) replaces each `[selectionN]` token found in `body` with
  `<user-selection ref="…" position="…">escaped text</user-selection>`
  (inline, preserving sentence context — same semantics as image token
  replacement); (b) appends any selection whose token is **not present in
  `body`** as a `<user-selection>` element after `body`. XML-escape `ref`,
  `position`, and inner text with a small frontend helper (the decode
  counterpart already exists at `structured-output-parsing.ts:55–61`).
  Returns `body` unchanged when `selections` is empty.

  This single function is the entire reason voice "just works": typed bodies
  contain tokens (inline replacement dominates); spoken bodies contain **no
  tokens** (every selection is appended). Same code, both behaviors, no
  branching on modality.
- **Pills.** `SelectionPanel` (sibling to `AttachmentPanel`) renders one
  `SelectionPill` per item: source doc basename + truncated snippet; **click
  → view** (popover showing full `text` + `ref` + `position`, plus an "open
  source" affordance that points the companion pane at `ref`); **trash →
  remove**. The panel shows in **all** modalities (it's the only selection
  feedback while a read-only transcript occupies the textarea).
- **Typed wiring.** In `handleSend` (`InteractiveChat-actions.ts:67`),
  replace the current `const typed = \`<typed …>${text}</typed>\`` (`:80`)
  with `const typed = \`<typed …>${applySelections(text, { selections })}
  </typed>\``, then `resetSelections()` alongside `resetAttachments()`
  (`:91`).

**Vocabulary lock-ins.** `<user-selection>` placement: inline within the
message tag at the token site when a token exists, appended after the body
otherwise (nesting is already legal — `<speech>` nests `<instructions>`).
Token form `[selectionN]`.

**First implementation chunk.** `useChatSelections` + `applySelections` +
its doctest (one typed case with tokens, one tokenless "append" case, one
escaping case) + pill render/remove + typed-path wiring. No open questions
inside it. (Voice wiring is Track 4 — deliberately separated so the
serializer is proven before the harder timing work.)

### Track 4 — Folding selections into the two voice modalities

**What.** Make the realtime and HQ speech send paths call the Track 3 shared
serializer, with correct snapshot timing for the HQ two-phase flow.

**Why this needs to change.** `-voice.ts` builds and sends `<speech>`
strings directly, never touching `handleSend`. Without this track,
selections work when typed and vanish when spoken — the exact failure the
user flagged.

**Direction.**
- **Plumb selections into the voice send.** `runKeywordSend`
  (`InteractiveChat-voice.ts:46`) and its `submit` (`:56–58`) gain access to
  the current `selections` (passed through the existing opts object — already
  the pattern there, e.g. `doSend`, `zoomedViewAttr`). `submit` becomes:

  ```ts
  const body = applySelections(finalText, { selections: selectionsForThisUtterance });
  doSend(`<speech${diarizedAttr} local-time="${localTime()}"…>${body}</speech>`);
  ```

  Spoken bodies have no `[selectionN]` tokens, so every pending selection is
  **appended** after the speech text. Then `resetSelections()`.
- **HQ snapshot timing (the real decision).** The HQ path is two-phase: the
  utterance "commits" when the send-keyword fires (`onKeywordSend`, `:119`),
  but `submit` runs later, after `postAudioForHqTranscription` resolves
  (`:60–77`). **Snapshot the selection set at keyword-fire time** (phase 1)
  and serialize *that* snapshot in phase 2 — and clear it at phase 1. This
  gives the intuitive rule: *the selections pending when you finished
  speaking are the ones attached to that utterance.* Selections added during
  the HQ finalization window belong to the **next** message, not this one. A
  late-arriving snapshot from phase 1 is captured in a ref/closure so the
  deferred `submit` reads a stable value, not live state.
- **Realtime (fast path) timing.** Snapshot == clear == send, all
  synchronous at keyword fire; no window, no ambiguity.
- **Edit-before-send.** The composer's "edit" button cancels transcription
  and moves the transcript into `input`. Selections already in state stay in
  state; once the text is in `input`, the message becomes a *typed* send and
  Track 3's path handles it. No special case — verify the pills survive the
  transition.
- **Build the seam to generalize (forward-looking).** Images and files will
  ultimately fold into voice the same way (see NOT in scope). So the voice
  plumbing here should not be selection-specific: thread a *per-message
  attachment snapshot* (today: just `selections`) and a single
  "fold-pending-attachments-into-this-message" step, rather than hard-coding
  `applySelections` as the only thing the speech path knows about. Concretely
  — the phase-1 snapshot mechanism and the `resetSelections()` call should sit
  where a future `resetFiles()` / image-channel snapshot can join without
  re-threading. Don't *build* the file/image fold-in now; just don't wall it
  out.

**Vocabulary lock-ins.** None beyond Track 3 (same serializer, same tag).

**First implementation chunk.** Thread `selections` + `resetSelections`
through `runKeywordSend`/`submit`; apply the serializer in the realtime
path; add the phase-1 snapshot for HQ. A route/pure doctest over `submit`'s
string assembly for both speech paths (with one appended selection) locks
it. No open questions inside it.

### Track 5 — Agent knowledge: guide section + knowledge audit

**What.** Document `<user-selection>` for the agent and add a knowledge
audit.

**Why this needs to change.** A new agent-facing tag the agent never sees
explained will be misread; CLAUDE.md's "improving these instructions" loop
and the knowledge-audit precedent both require it.

**Direction.** Add a "Selections" subsection to the chat agent guide
(`src/core/agent-guide/chat.ts`, alongside `chatAttachmentsSection` at
`:17–38`) explaining: the tag wraps text the user selected from a document
they were looking at; `ref` is the source doc; `position` is a *rough*
locator (heading/paragraph/line) for finding the original if exact markup is
needed; the wrapped text is what the human saw (rendered), so trust it as the
quote. Note that a `<user-selection>` can appear **inside `<typed>` at a
`[selectionN]` site, or appended after a `<speech>` body** (the user spoke
the message and attached the selection separately) — the agent treats both
the same. Add one `knows_directly` entry to
`src/dev/knowledge-audits.yaml`.

**First implementation chunk.** Guide section + audit entry (lands with the
plan; see Knowledge audits).

---

## Subplans

None. The two sub-questions that could each warrant their own design step —
the **position locator scheme** and the **modality fold-in** — are resolved
inline (Track 2 and Tracks 3–4 respectively). The position scheme is resolved
in Track 2 with a concrete
first example and a deliberately freeform value that can evolve without a
migration. Spinning a subplan would over-formalize a string the agent reads
as a hint. The open *refinements* to it are listed under Open Design
Questions, not deferred to a separate plan.

---

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Selected rendered text ≠ source markdown (e.g. `**bold**`→`bold`, `> q`→`q`, list bullets dropped) | No (doc note) | By design: `text` is the rendered quote; `position` points at source for exact markup | Clear (documented in guide) |
| `data-line` missing on the nearest block (custom tag, deep nesting) | Track 1 doctest covers headings | `position` omits `~line N`, keeps heading/paragraph | Clear (locator degrades) |
| Heading slug collision (two "Notes") | Track 1 doctest (collision pair) | seen-set suffix `-1`/`-2` | Clear |
| Selection spans frontmatter table **and** body | No | `section` reflects the common-ancestor side; if mixed, label `mixed` | Silent-ish → make it `mixed` explicitly (handling) |
| Selection before any heading / in frontmatter | No | nearest-heading absent → omit heading clause; keep `section`+line | Clear |
| `[selectionN]` token hand-deleted from textarea but item kept | Track 3 serializer doctest | unreferenced item appended after the body (mirrors images) | Clear |
| Inner text contains `<`, `&`, `]]>` | Track 3 serializer doctest | XML-escape inner text + attrs at serialization | Clear |
| **Selection silently dropped on a spoken (`<speech>`) message** | Track 4 voice doctest | both voice paths call the shared `applySelections`; tokenless body → appended | Clear — but this is the headline gap if Track 4 is skipped |
| **HQ window race**: user adds/removes selections during after-the-fact transcription | Track 4 doctest (snapshot) | snapshot the set at keyword-fire (phase 1); phase-2 `submit` reads the frozen ref; new selections belong to the next message | Clear |
| Realtime send-keyword fires mid-selection (user still adjusting) | No | only selections already in state at fire time fold in; the user selects before saying "send" | Clear (documented UX) |
| Stale ref: doc edited/moved/archived between select and send | No | verbatim `text` preserved regardless; `ref`/`position` may be stale — acceptable, agent still has the quote | Clear (documented) |
| Empty / whitespace-only selection | No | no "+" shown when `selection.toString().trim()` is empty | Clear |
| Selection in browse panel / card page (no composer) | No | `onAddSelection` absent → no "+" | Clear |
| Very long selection (whole document) | No | none initially; text is just large | Silent — see NOT in scope |

**Critical gap:** none *if Track 4 lands*. The headline risk is exactly the
one the boxholder raised — a serializer wired only into `handleSend` drops
selections on every spoken message **silently**. Track 4 closes it by routing
all three modalities through one `applySelections`. The secondary closed gap
is *selection spans frontmatter+body* → Track 2 emits `section=mixed` rather
than guessing.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED.* There's a single tag with a
  single required reference (`ref`) and a free `position`; no
  `quote`-vs-`source`-style fork for the agent to get wrong. The agent never
  *writes* `<user-selection>` (it's user→agent only), so misuse-on-write
  doesn't apply. (Guide section, Track 5.)
- **Input modality (typed vs spoken)** — *ADDRESSED.* The same selection set
  folds into a `<typed>` body (inline at tokens) or a `<speech>` body
  (appended) through one shared serializer; the agent sees an identical
  `<user-selection>` either way. HQ's two-phase timing is pinned by a
  phase-1 snapshot. (Tracks 3–4; Failure Modes rows.)
- **Stale ref** — *ADDRESSED.* The verbatim rendered `text` is captured at
  selection time and survives any later edit/move of the source; `position`
  is explicitly a rough hint. Documented in the guide (Track 5) and Failure
  Modes.
- **Two agents touching the same card** — *ADDRESSED (n/a).* Selections are
  read-only references created by the human in the UI; no card mutation, no
  concurrent-write reconciliation.
- **Hand-edit drift** — *ADDRESSED (n/a).* The boxholder doesn't hand-author
  `<user-selection>`; it's generated by the composer at send time. If they
  did type a malformed one, the model tolerates loose tags as it does for the
  unescaped `<typed>` body today.
- **Fabricated free-form value** — *ADDRESSED.* The only free-form field
  (`position`) is computed from the DOM, not authored, so it can't be
  fabricated. `text` is `selection.toString()`, not retyped. The design makes
  honesty automatic.
- **Validation error UX** — *ADDRESSED (n/a).* No new card schema, no
  `cb validate` surface; nothing new to fail validation. The message is plain
  text to the model.
- **Partial migration / transition state** — *ADDRESSED.* No data-shape
  migration. Track 1 changes render output only; old messages already sent
  are unaffected (the tag only appears in newly-composed messages). During
  rollout, a frontend without the change simply never produces the tag.

No GAPs.

---

## NOT in scope

- **Selection capture outside the chat companion pane** (browse detail panel,
  full card page, dashboard). Rationale: the "+" only makes sense where a
  composer exists to receive it; adding it elsewhere is feature creep beyond
  the task.
- **Exact source-range mapping / re-anchoring** (offset math,
  `dom-anchor-text-quote`-style fuzzy matching). Rationale: prior art shows
  this is the fragile part and the user explicitly accepts rough locators.
- **Selecting across multiple documents / multiple tabs into one selection.**
  Rationale: a selection belongs to one rendered document; cross-doc is a
  different feature.
- **Editing/annotating the selection** (highlights persisted on the doc,
  margin notes). Rationale: this is input commentary, not document
  annotation.
- **Length caps / truncation of huge selections.** Rationale: defer until
  dogfooding shows it matters; premature limit. (Flagged in Failure Modes so
  it isn't silently assumed handled.)
- **Non-text documents** (image/audio/PDF binary viewers). Rationale: there's
  no text DOM to select; out of the analogy.
- **Backend awareness/validation of `<user-selection>`.** Rationale: it's
  frontend-assembled text like `<attachments>`; no transport or validation
  change is needed, and adding one would be unused machinery.
- **Extending *image/file* attachments to the voice modalities — deferred to
  a later pass, not abandoned.** Today `[imageN]`/`[fileN]` also only flow
  through `handleSend` and are absent from spoken messages. The end state is
  that images and files fold into voice *just like selections*; this first
  pass simply doesn't ship that, to keep scope bounded. Two different sizes of
  work, which is why they're deferred rather than bundled:
  - **Files** are box-relative text refs (the `<attachments>` block). They
    fold in through the *same* text-append mechanism as selections — once
    Track 4 routes spoken messages through a shared "append my pending
    attachments" step, files are a near-trivial follow-on.
  - **Images** travel as a separate Anthropic **content-block** channel
    (`images: ChatImageAttachment[]` on the SEND event), not text. The voice
    send currently calls `doSend(wrapped: string)` with no image channel;
    folding images into voice means giving the voice path a
    `doSendWithImages` equivalent and snapshotting the image set with the
    same phase-1 timing. Larger, but mechanical.
  **Design obligation for this plan:** Track 4 should plumb the per-message
  attachment snapshot (and its phase-1 HQ timing) in a way that is *not
  selection-specific* — so adding files/images later is "carry one more set
  through the same seam," not a redesign. See the note in Track 4.

---

## Open design questions

- **`position` value format.** Lean: one freeform readable string
  (`"body; heading: X (#x); paragraph 2; ~line 42"`). Alternative: discrete
  kebab-case attributes (`section=`, `heading-id=`, `line=`) matching the
  rest of the tag vocabulary. The freeform form wins for chunk 1 because the
  scheme is expected to evolve and nothing parses it rigidly; revisit if the
  agent turns out to want machine-parseable fields. *Not blocking — decided
  for the first chunk.*
- **Inline expansion vs sibling `<selections>` block.** Lean: inline at the
  token site (preserves sentence context, faithful to the user's
  "[selection1] becomes the tag" description). Alternative: a sibling block
  like `<attachments>` keeping `<typed>` as pure typed text. Decided inline
  for chunk 1; the alternative is a localized change if it reads better in
  practice.
- **"View" pill interaction depth.** Lean: popover showing full text + ref +
  position, plus a button that points the companion pane at `ref`.
  "Scroll-to-and-highlight the exact original location" is a richer
  refinement deferred (it needs the re-anchoring this plan excludes).
- **Should non-card plain-text/`.md` files get the same locator richness?**
  They have no frontmatter/body split and easier line numbers. Lean: same
  `SelectionCapture` wrapper works (DOM-based); `section` is simply always
  `body` and heading ids apply if rendered as Markdown. No separate path.
- **HQ-window selection ownership.** Decided: selections pending when the
  send-keyword fires belong to *that* utterance (phase-1 snapshot); ones
  added during the after-the-fact transcription window belong to the next
  message. Alternative considered and rejected: re-read live state at phase-2
  `submit`, which would let a selection the user made *after* finishing
  speaking attach retroactively — surprising. *Decided for chunk 1; revisit
  only if dogfooding shows the snapshot feels wrong.*
- **Should the "+" be suppressed during active transcription?** A selection
  made mid-utterance can't show a textarea token (the box is read-only with
  the live transcript), only a pill. Lean: keep the "+" enabled; the pill is
  sufficient feedback and selecting-while-speaking is a real use. Alternative:
  disable it to avoid the race in Failure Modes. *Not blocking — keep enabled,
  watch during dogfooding.*

---

## Knowledge audits

This plan introduces one agent-facing concept: the `<user-selection>` input
tag. Per the `{% quote %}` precedent (four audits verifying recall), add **at
least one `knows_directly` entry** to
`src/dev/knowledge-audits.yaml`:

```yaml
- id: user-selection-tag
  prompt: >
    A chat message contains:
    <user-selection ref="/store/notes/Bread.doc.card"
      position="body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42">
    let it rise until doubled in size</user-selection>
    What is this and how should you treat the position attribute?
  expected_level: knows_directly
  watch_for: >
    Recognizes it as text the user selected from a document they were viewing;
    treats the wrapped text as a verbatim quote; treats position as a rough
    locator (heading/paragraph/line), not an exact offset.
  correct_contains_any: ["selected", "selection", "highlighted"]
  tags: [chat, input-format]
  notes: >
    Failure mode is treating position as exact, or ignoring the ref and
    re-deriving the quote. The text IS the quote (rendered); ref+position
    locate the original if exact markup is needed.
```

Skipping further audits is fine — one concept, one direct-recall check.

---

## Implementation order

1. **Track 1 — heading anchors** (`markdoc-config.ts` heading transform +
   slug helper + doctest). No dependencies. Unblocks the `#id` clause of the
   locator.
2. **Track 2 — selection capture** (`SelectionCapture` + DOM→position helper,
   wired into `FileView` behind the optional prop). Depends on Track 1 for
   heading ids; degrades without it. Verifiable by logging the computed item.
3. **Track 3 — selection state, pills, shared serializer + typed wiring**
   (`useChatSelections`, `applySelections`, `SelectionPanel`, `handleSend`
   hook-in, serializer doctest). Depends on Track 2 producing
   `SelectionItem`s. This proves the serializer before the harder timing work.
4. **Track 4 — voice fold-in** (thread `selections` through `-voice.ts`,
   apply the serializer in both speech paths, phase-1 HQ snapshot, voice
   doctest). Depends on Track 3's serializer. Separated deliberately so a
   regression here can't break the proven typed path.
5. **Track 5 — agent guide section + knowledge audit.** Depends on the final
   tag shape + the fact that selections ride on both `<typed>` and `<speech>`.

Each track is one or a few commits on the worktree. The plan ships as one
unit when all five land; nothing merges to `main` until the boxholder asks.

---

## Rollout shape

- **Test posture.** Dogfood first. Three doctests land with the plan because
  they guard real serialization logic, not UI: (1) Track 1 heading slug +
  collision; (2) Track 3 `applySelections` — inline-token replacement,
  tokenless append, and escaping; (3) Track 4 voice `submit` string assembly
  for the realtime and HQ paths with an appended selection (this is the
  regression guard for the boxholder's concern). The DOM selection-capture
  itself is verified manually via `bin/browse` against the running app during
  dogfooding; a doctest is added once the position-computation shape settles
  (per the default deferral).
- **Knowledge-audit entries.** The single `user-selection-tag` entry above
  lands with Track 5.
- **Migration.** None — no existing data shape changes. Track 1 alters render
  output (adds `id`/`data-line` to headings); already-sent messages are
  untouched; a frontend without the change simply never emits the tag.
- **Docs.** The chat agent-guide "Selections" section (Track 5) is the
  agent-facing doc; this plan file is the design record. Per
  `CLAUDE.md:112–114`, if any convention here surprises a future agent, add a
  one-line note to the relevant doc.
