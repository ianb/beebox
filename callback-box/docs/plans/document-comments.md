---
title: "Document comments: a communication medium in the workstreams app"
status: draft
workstream: dev-comments
issues:
  - ../../../issues/code-quality/2026-08-22-rename-drive-comments-sidecar-to-gcomments.md
---

# Document comments

A comment **capability** in the workstreams app: on any surface that carries
`data-cb-source` provenance tags, select text or click a block and leave a
remark, typed or spoken. Comments are written to a machine-local store outside
git, routed to the workstream they concern, and read back by that workstream's
agent through `bin/comments`. They are messages, not documents — an agent reads
them, acts, and clears them.

It is a capability rather than a page because the boxholder wants it in more
than one place and wants the existing places kept: *"issues should still be the
interface we have now. Hopefully we can just use these markup features on the
issues app!"* A surface gains commenting by tagging its content, not by being
rebuilt.

## Job to be done

*When I am reading a plan document an agent wrote, on my own machine, and I
disagree with one paragraph of it, I want to say so at that paragraph — out
loud, because I am reading and not typing — so the next agent that opens this
document knows exactly which claim I objected to without me re-explaining it in
chat.*

Two more situations that shape the design:

- *When I skim a long design doc and three separate things bother me, I want to
  leave three separate short remarks as I go, rather than composing one summary
  message at the end.* Comments must be cheap to make and must not require me to
  hold a list in my head.
- *When an agent picks up work days later, I want it to find my remarks without
  me remembering to paste them.* The agent's discovery path matters as much as
  my capture path.

- *When I have left three remarks across two files, I want to wake the workstream
  that owns them and talk about them, and I want its agent to already know what I
  said.* The capture is only half; the delivery is the other half.

Neither situation involves maintaining the comments over time. They are consumed
and cleared.

## Issues addressed

None filed. The queue was searched for `comment`, `annotat`, and `feedback`;
three adjacent items exist and none is resolved by this plan:

- `issues/exploration/2026-08-01-questions-as-inline-annotations.md` — inline
  annotations on **box cards**, stored in the card and committed to git. Related
  vocabulary, opposite persistence class. This plan must not claim its ground;
  see NOT in scope.
- `issues/features/2026-08-06-capture-feedback-from-chat.md` — feedback on a
  chat conversation, routed to the existing feedback pipeline. Different target,
  different store.
- `issues/features/2026-07-08-selection-provenance-canonical-anchors.md` — the
  standing design thinking on canonical anchors. This plan adopts its
  recommendation and closes part of its question space, but the issue is about
  the box frontend's selection capture, which this plan does not touch.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — principles traced below by
  number. The load-bearing ones here are **3** (validate at boundaries), **4**
  (resilient AND never silent), **6** (right-sized defensiveness), **8** (one way
  to do each thing), **12** (the maintainer is usually an agent), and **13** (a
  control shows the state the system is in, never the one it intends).
- `CLAUDE.md` (monorepo root) — "**Treat noisy command output as a bug**" and the
  never-disable-lint rule. The dev-page casualness carve-out does **not** apply
  to anything here: this is workstreams-app code, which is linted and
  typechecked like any other app code (`workstreams-app/package.json` —
  `lint:backend`, `lint:frontend`, `typecheck:backend`, `typecheck:frontend`).
- `callback-box/code-style.md` — the mechanical rules (max 2 positional
  parameters, no `any`, no default parameters).
- **Precedent: the exhibits store** — `callback-box/docs/plans/workstream-exhibits.md:236`:
  *"There are only two persistence classes today: committed (merges to main) and
  disposable (dies with the cull). Exhibits are a third class — workstream-persistent,
  never merged — and nothing provides it."* This plan uses that third class and
  departs from it in one way (keying), argued in Track 1.

## Where this lives, and why that changed

An earlier draft of this plan put a client library on the **dev router's**
`/dev/` pages, injected once into `renderDevShell` (`bin/router-docs.ts:137`).
The boxholder redirected it into the workstreams app on 2026-08-22: *"You could
build this directly into the workstream app too… Then it doesn't need special
cases, it IS the app (or at least a feature of it)."*

That is the better shape, and the code says so. The app already renders
repository markdown in React — `workstreams-app/src/frontend/components/Markdown.tsx`
transforms Markdoc to React nodes, and `IssuesPane.tsx:97` renders an issue body
with it. What the app cannot do is show a **plan**: `PlansPage.tsx:9` lists plans
and links each one *out* to the router's doc browser
(`/main/dev/docs/${plan.relPath…}`, with `main` hardcoded). So the app already
has the reading surface, the renderer, the auth, and the mutation transport —
and a gap where reading a plan should be.

Building comments into the app therefore **removes** the work rather than moving
it. Gone from the plan entirely: the injected script tag, the `renderDevShell`
signature change and its four call sites, the document-identity union, the shadow
DOM isolation, the separately-built client bundle, and the "the injected client
failed and the page cannot say so" failure mode. What replaces them is a document
viewer route the app was already missing.

## What already exists

| Thing | Where | Reuse or rebuild |
|---|---|---|
| Markdown rendering to React | `workstreams-app/src/frontend/components/Markdown.tsx:28` — Markdoc `parse`/`transform`/`renderers`, with a link-safety wrapper | **Reuse as-is.** The viewer renders through it, so a comment anchors against the same output an issue body already produces. |
| An in-app document reading surface | `workstreams-app/src/frontend/components/IssuesPane.tsx:97` — issue bodies render in-app today | **Reuse the pattern.** The document viewer is the same shape at a different route. |
| The gap this fills | `workstreams-app/src/frontend/pages/PlansPage.tsx:9` — links to `/main/dev/docs/…` to read a plan, with the worktree hardcoded to `main` | **Replace that link** with the in-app viewer. |
| Frontend routing | `workstreams-app/src/frontend/router.tsx` — TanStack Router, `basepath: "/workstreams"`, Zod-validated search params | **Reuse.** One new route. |
| tRPC mutation transport, already CSRF-classified | `bin/router-auth.ts:228-239` — POST is `control` for `/workstreams/api/trpc[/*]`; everything else returns `{kind: "unknown"}` and is denied | **Reuse.** See the constraint note in Track 2. |
| Path containment against traversal and symlink escape | `workstreams-app/src/server/issue-path.ts:13-39` — `assertContained` plus a post-`realpath` re-check | **Reuse the pattern**, not the source. `workstreams-app/src/server/exhibits/store.ts:9-12` states the house rule: *"This deliberately reimplements the shape of src/server/issue-path.ts rather than importing it… the resident-app precedent is to share patterns, not source."* |
| Worktree root resolution | `workstreams-app/src/server/issues-mutation-service.ts:81` — `options.overlay.worktreeRoots.get(worktree)` | **Reuse.** The viewer resolves a document inside a named worktree the same way. |
| A store beside the main checkout, with a marker file | `workstreams-app/src/server/exhibits/store.ts:26,46-53` — `STORE_MARKER`, `defaultStoreRoot` derives from the main checkout's parent | **Reuse the shape** with a different root and marker. |
| Atomic file replacement | `workstreams-app/src/server/issues-mutation-service.ts:206` — write to a temporary, then rename | **Reuse the pattern.** |
| Worktree symlink mount, self-healing on resume | `bin/lib/worktree-create.sh:135-140,149-151`; root derivation at `bin/lib/worktree-paths.sh:76` | **Reuse.** One more best-effort mount call beside the exhibits one. |
| Text-fragment resolution and non-destructive highlighting | `callback-box/src/frontend/src/lib/selection/quote-anchor.ts:19-33` — `findQuoteRange` via `processTextFragmentDirective`, `highlightRange` via the CSS Custom Highlight API | **Reuse the technique, not the module.** It lives in the box frontend's Vite graph; the app has its own. The technique matters: it mutates no DOM, so it cannot fight React's ownership of the rendered document. |
| Text-fragment **generation** | `node_modules/text-fragments-polyfill/dist/fragment-generation-utils.js`, version 6.7.0 — `generateFragment(selection)` returns `{status, fragment}` with status `SUCCESS \| INVALID_SELECTION \| AMBIGUOUS \| TIMEOUT` (`src/fragment-generation-utils.js:43-68`) | **Reuse.** Already installed; we currently use only the resolving half. |
| HQ transcription | `callback-box/src/core/transcription/index.ts:253` — `transcribeAudioHq`; `TranscribeAudioParams.boxRoot` is optional (`:121-127`) | **Reuse the dispatcher, extend the params.** It runs box-less, but the Whisper path resolves its own key (`index.ts:298` → `openai-thinking-key.ts:45`) and there is no HQ `fake`, so Track 4 adds an optional `apiKey` and an injectable service seam. |
| An OpenAI key readable without a box | `callback-box/src/core/search/embeddings-key.ts:84` — `process.env["CALLBACK_OPENAI_API_KEY"]` | **Reuse the name, by boxholder decision.** Nothing reads it for transcription today — Track 4 wires it. |
| Services object with real and fake implementations | `workstreams-app/src/server/services.ts` | **Reuse.** Where the transcription seam lands. |
| A read-back CLI whose output a later session consults | `bin/exhibits list`, contract in `workstreams-app/docs/exhibits.md` | **Reuse the shape** for `bin/comments`. |

## Prior art (external)

Five searches, all of which returned findings that changed the design.

- **`generateFragment` reports AMBIGUOUS in cases where a handcrafted fragment
  works.** Fragments identified by a prefix only or a suffix only fail
  generation, although Blink itself generates them.
  <https://github.com/GoogleChromeLabs/text-fragments-polyfill/issues/72>
  Consequence: `fragment` must be an optional field. This is the direct reason
  the design does not make in-page highlighting load-bearing.
- **The `./dist/fragment-generation-utils.js` subpath has an export-map
  history.** <https://github.com/GoogleChromeLabs/text-fragments-polyfill/issues/95>
  Verified against the installed copy: `node_modules/text-fragments-polyfill/package.json`
  version 6.7.0 exports `"./dist/fragment-generation-utils.js"` explicitly, so
  the import specifier must be that exact path, not a bare
  `text-fragments-polyfill/fragment-generation-utils`.
- **Hypothesis stores three selectors and tries four anchoring strategies**, and
  its fuzzy quote anchoring "can be very inefficient in long documents for
  short, generic quotes", to the point of blocking execution.
  <https://web.hypothes.is/blog/fuzzy-anchoring/> and
  <https://github.com/hypothesis/client/issues/3919>. Consequence: this plan
  does exact-match-or-nothing. Fuzzy re-anchoring is the expensive half of an
  annotation system and it buys nothing here, because the stored `quoted` text
  already carries the meaning to the only reader that matters.
- **Annotations can fail to anchor yet not be reported as orphans.**
  <https://github.com/hypothesis/product-backlog/issues/954>. This is principle 4
  as an external bug report: the failure mode of an anchoring system is a comment
  that quietly attaches to nothing. Addressed by rendering unresolved comments in
  a visible list rather than dropping them.
- **`getUserMedia` is available only in a secure context**; `navigator.mediaDevices`
  is `undefined` otherwise, and a private IP over plain HTTP is not a secure
  context. <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
  Consequence: spoken comments work on `http://localhost:3210` and over
  `tailscale serve` (HTTPS), and are unavailable if the router is reached at a
  bare `http://<ip>:3210`. Track 4 requires the control to say which case it is
  in rather than silently disappearing.

No prior art was found for the specific combination of "comment file keyed by
repository-relative document path, outside version control" — this appears to be
a local composition of the exhibits store idea and the W3C `TextQuoteSelector`
shape rather than an established pattern.

## Tracks / scope

Ordered by implementation dependency. Track 1 is usable by an agent before any
UI exists, which is deliberate: the agent-read path is the half that justifies
the feature.

### Track 1 — The store, and `bin/comments`

**What.** A machine-local store holding one YAML file per commented document,
plus a CLI that reads it.

**Why this needs to change.** There is no persistence class that survives a
worktree cull and never reaches git. Committed is wrong (the boxholder: comments
"should never go in git"). Disposable is wrong (the boxholder: "I'm worried
about losing them with the worktree"). The exhibits store provides the right
class but keys by workstream.

**Direction.**

```
<parent-of-main-checkout>/dev-comments/               # marker file: .dev-comments
  tracked/callback-box/docs/plans/foo.md.comments.yaml
  worktree/dev-comments/scratch/notes.md.comments.yaml
```

Root derivation follows `defaultStoreRoot` (`workstreams-app/src/server/exhibits/store.ts:46-53`):
the parent of the **main** checkout, overridable by `CALLBACK_COMMENTS_ROOT` for
tests, with `WT_COMMENTS_ROOT` added to `wt_paths_init` beside `WT_EXHIBITS_ROOT`
(`bin/lib/worktree-paths.sh:76`).

**The departure from the exhibits precedent: keying by document, not by
workstream.** A comment is about a document, and a tracked document is present in
every checkout at the same repository-relative path. Keyed by workstream, a
comment left while reading a plan in one worktree is invisible when the same plan
is opened from main — a weaker form of the loss the store exists to prevent.
Keyed by path, the comment is found wherever the document is next opened.

**Tracked and untracked documents key differently, and the app knows which.**
Untracked documents are worktree-local: two worktrees routinely hold entirely
different files at `scratch/notes.md`. A single path-keyed namespace would merge
their comments silently. Because the viewer's route names the worktree
explicitly (Track 2), the server knows at write time whether the document is
tracked, and keys it accordingly: `tracked/<repo-relative-path>` follows the
document everywhere, `worktree/<name>/<repo-relative-path>` stays where it was
written. This closes the collision rather than reporting it — a cheaper answer
than the earlier draft's, and available only because the app owns the route.

Each record also carries `origin`, the worktree it was written in. For a tracked
document that is provenance an agent can use ("this objection came from the
worktree doing the work"); it is not load-bearing for keying.

This keying removes machinery rather than adding it. Nothing is ever written
through a checkout, so the exhibits teardown guard — *"if `<worktree>/exhibits`
exists and is a **real directory**… `wt_remove_now` moves its contents into the
store (or refuses) instead of trashing them with the tree"*
(`workstream-exhibits.md:256-259`) — has no analogue here. A failed mount costs a
read convenience, never data.

**The file.**

```yaml
version: 1
comments:
  - id: c-4f2a
    at: 2026-08-22T14:03:11Z
    kind: spoken            # typed | spoken
    body: "This assumes the router restarts, which it doesn't here."
    quoted: "so the router picks this up on reload"
    section: "The write path"
    workstream: scanner-ingest      # routing target; null when unrouted
    origin: dev-comments            # where it was written
    fragment: ":~:text=so%20the-,router%20picks%20this%20up,-on%20reload"
```

`body` is what the boxholder said. `quoted` is the selected text verbatim, and is
the field that makes the comment legible to an agent reading the file with `cat`.
`section` is the enclosing heading as plain text. `workstream` is the routing
target — which agent this remark is for — and `origin` is the worktree it was
written in; they are usually but not always the same, and conflating them would
lose the case where the boxholder comments from main on another branch's file. `fragment` is `generateFragment`'s output serialized, and is
**optional**: absent on `AMBIGUOUS` or `TIMEOUT`, and absent for a whole-document
comment. No `state` field, no `audio` field, no reply threads — see NOT in scope.

The shape is a deliberate flattening of the W3C Web Annotation
`TextQuoteSelector` (exact/prefix/suffix). The full vocabulary is not adopted
because the file's primary reader is an agent running `cat`, and JSON-LD nesting
makes that worse. Principle 12: the maintainer is usually an agent.

**`bin/comments`.**

- `bin/comments show <path>` — accepts an absolute, repository-relative or
  worktree-relative path; prints the comments as readable text.
- `bin/comments list` — every document with comments waiting, newest first. The
  `bin/exhibits list` shape: the verb a later session runs to find what came in.
- `bin/comments clear <path> [--id <id>]` — removes handled entries.

The CLI derives the store root itself and never reads through the checkout
symlink, matching the posture `workstream-exhibits.md:262-264` requires of
`bin/exhibits`: *"never writes through the checkout symlink — it derives the
store path itself (fail-closed), so a broken mount cannot redirect exhibit writes
into the doomed tree."*

**Vocabulary lock-ins.** The store directory name `dev-comments`; the marker
`.dev-comments`; the `tracked/` and `worktree/` namespaces; the file suffix
`.comments.yaml`; the field names above; the `kind` values `typed` and `spoken`.

**First implementation chunk.** The store module (root derivation, marker guard,
path containment, the two namespaces, YAML read/write with a Zod schema) plus
`bin/comments show` and `bin/comments list`, with a doctest that writes a store
by hand and reads it back. No UI, no HTTP.

### Track 2 — The document viewer

**What.** A route in the workstreams app that renders any markdown document in a
named worktree, and the tRPC procedures behind it.

**Why this needs to change.** The app lists plans but cannot show one
(`PlansPage.tsx:9` links out to the router's doc browser, hardcoding `main`).
Comments need a rendered document under the app's own control to attach to, and
the app needs a document viewer regardless. These are the same piece of work.

**Direction.**

- `documents.read` — a tRPC query taking `{worktree, relPath}`, returning the
  source text plus whether the file is tracked. Path resolution reuses the
  `issue-path.ts:13-39` containment pattern against the worktree root from
  `overlay.worktreeRoots` (`issues-mutation-service.ts:81`), refusing traversal
  and symlink escape rather than clamping.
- The document viewer route, which is **defined by `general-browser.md`**, not
  here: `/workstreams/browse?file=<repo-relative>&workstream=<name>`. An earlier
  draft of this plan specified `/workstreams/docs/$worktree/$path`; that predates
  the browser plan and contradicts its addressing rule by putting the worktree
  back in the path. There is one address, and it is the browser's.
- `PlansPage` links here instead of to `/main/dev/docs/…`. **This fixes less than
  it looks like:** `listPlans` reads only the main checkout's
  `callback-box/docs/{plans,implemented-plans,unimplemented-plans}`
  (`documents-service.ts:149-152`), so a plan authored in a worktree and not yet
  merged is not in the list at all — including, at the time of writing, this one.
  The link fix makes listed plans readable in-app; making unmerged plans
  *appear* is the browser's recency feed, not this chunk.
- `comments.list` / `comments.add` / `comments.clear` — the tRPC procedures over
  Track 1's store, Zod-validated at the boundary (principle 3).

**Everything mutating goes through tRPC — a constraint, not a preference.**
`bin/router-auth.ts:228-239` classifies a POST under `/workstreams/` as `control`
only for `/workstreams/action/*`, `/workstreams/issues/action/*`, and
`/workstreams/api/trpc[/*]`; line 238 returns `{kind: "unknown"}` for everything
else, and unknown is denied. A raw `POST /workstreams/api/comments` would be
refused by the router before it reached the app. Routing the comment write and
the audio upload (Track 4) through tRPC adds no new entry to a fail-closed auth
table.

Writes are read-modify-write under an in-process per-path lock, then an atomic
temporary-plus-rename (`issues-mutation-service.ts:206`). One process owns
writing, so an in-process lock is the right size; principle 6.

**Vocabulary lock-ins.** The tRPC procedure names `documents.read`,
`comments.list|add|clear`. The route shape belongs to `general-browser.md`.

**First implementation chunk.** `documents.read` plus the viewer route rendering
a plan, with no comment affordance at all. This is independently useful — it
closes the `PlansPage` link-out — and it is the surface Track 3 attaches to.

### Track 3 — Capture and display

**What.** Selecting or clicking produces a comment; existing comments show on the
document.

**Why this needs to change.** Selection is the input device for this feature; it
cannot be done from a CLI.

**Direction.**

**What `data-cb-source` does here, stated plainly so it is not over-read.** It
answers *which document this chunk came from* — nothing more. The convention is
provenance: `data-cb-source-item` is explicitly *"free-form text — not a
structured identifier"* (`callback-box/docs/data-source-tagging.md:28`), and
`SourceViewOverlay.tsx:105` does no more than walk up, read the attributes, and
display them. It is **not** an anchoring system and this plan does not make it
one. The anchor is the selection: `quoted` plus an optional `fragment`. Source
tags pick the document; the selection picks the place in it.

- Capture: a selection produces `quoted` from the selection text and `fragment`
  from `generateFragment`. A click on a block produces the block's `innerText` as
  `quoted`. Both write the same record — the two affordances are two ways to
  point, not two record types.
- Display: comments for the document are resolved with
  `processTextFragmentDirective` and highlighted through the CSS Custom Highlight
  API — the `quote-anchor.ts:19-33` technique, which mutates no DOM and so does
  not fight React's ownership of the rendered markdown. A comment whose fragment
  is absent or does not resolve is rendered in a visible list beside the
  document with its `quoted` text, never dropped.

**Comment mode is a toggle, not an always-on click handler.** Selecting text
never conflicts with a page's own behaviour, but click-to-comment-on-a-block
does — the issues app has buttons and controls on the very elements that would
be comment targets. So capture follows the precedent already in the codebase:
`SourceViewOverlay.tsx` toggles with Ctrl+Shift+S and only then treats tagged
elements as targets. Off, every surface behaves exactly as it does today.

**Which surfaces gain commenting, and what each costs:**

| Surface | What it needs | Cost |
|---|---|---|
| The browser (`general-browser.md`) | `file:` source tags on rendered content | Part of that plan |
| The issues app | `data-cb-source` on `IssuesPane`'s rendered issue | A few attributes; the interface is unchanged |
| Exhibits | The header component (`general-browser.md`, exhibits boundary) | Free on two of three tiers |

This is the whole reason the capability hangs off `data-cb-source` rather than
off a page: a surface opts in by describing where its content came from, which is
a thing worth doing anyway.

Because this is app code rather than an injected library, isolation is ordinary
component scoping and a failure is ordinary app error handling. Both were
separate design problems in the earlier draft.

**First implementation chunk.** Display only — render the comments Track 1's CLI
can already write. Typed capture follows.

### Track 4 — Spoken comments

**What.** Record in the browser, transcribe on the server, discard the audio.

**Why this needs to change.** The boxholder's stated capture situation is reading
with attention on the document, not on a keyboard.

**Direction — two steps, not one bundled mutation.** `MediaRecorder` in the
viewer; the audio goes to `comments.transcribe`, which returns **text and nothing
else**; the client puts that text in the comment composer, where it can be
edited; submitting goes through the ordinary `comments.add` with `kind: spoken`.

This is the boxholder's shape (2026-08-22): *"It would also be acceptable for the
client to contact an endpoint to transcribe text, then submit the transcribed
text. That might result in better UI."* It is better on three counts:

- **The transcript is reviewable before it is committed.** Whisper mishears names
  and jargon; a bundled mutation would write the mishearing into the store and
  leave the boxholder to correct a file. Here the correction happens in the
  composer, before anything is stored.
- **It largely dissolves the critical gap below.** An earlier draft required the
  audio blob to be held client-side until the *store write* was acknowledged,
  because a transcription failure would otherwise destroy the comment. Split, the
  blob only has to survive until the transcript returns; after that the comment
  is text in a composer, in exactly the state a typed comment is in, with nothing
  left to lose.
- **It matches existing precedent.** `POST /api/chat/transcribe-audio`
  (`callback-box/src/webapp/routes/chat-audio-routes.ts`) is already a stateless
  "upload audio, get text back" endpoint. This is the same shape, so it is not a
  new pattern to maintain.

`kind: spoken` records how the text arrived, not that it is verbatim — the
boxholder may have edited it in the composer, which is the point.

Both steps are tRPC mutations, because `bin/router-auth.ts:238` refuses any
non-tRPC POST under `/workstreams/`. That constrains the transport, not the
design.

**The mic control states its own availability.** `navigator.mediaDevices` is
`undefined` outside a secure context, so on a bare-IP HTTP origin the control
renders disabled with the reason rather than silently vanishing. Principle 13: a
control shows the state the system is in.

**Transcription is an injected service, not a direct call.** Two things make a
direct call unworkable, both found in cross-model review:

1. **The key does not arrive by reusing the call as written.**
   `transcribeAudioHq` dispatches to Whisper (`index.ts:253,274`), and the
   Whisper path resolves its key through `getOpenAiThinkingKey`
   (`index.ts:298`), which with no `boxRoot` reads `THINKING_OPENAI_API_KEY` and
   nothing else (`core/openai-thinking-key.ts:45`). It never reads
   `CALLBACK_OPENAI_API_KEY`. The boxholder's reuse decision therefore needs a
   small `callback-box` change: `TranscribeAudioParams` gains an optional
   `apiKey`, which the Whisper path prefers over the resolver. That is the
   minimal honest way to let a box-less caller supply its own key.
2. **`fake` is not an HQ service.** `HQ_TRANSCRIPTION_SERVICES` (`index.ts:142`)
   is whisper/voxtral only; the `fake` branch exists in `transcribeAudio`
   (`index.ts:231-233`) with no counterpart in `transcribeAudioHq`. A doctest
   cannot force the fake through the HQ path.

So the app takes a `transcribe` function through its services object
(`workstreams-app/src/server/services.ts`) — real is `transcribeAudioHq` with
`apiKey` from the environment, fake is canned text. This is the house pattern:
*"Every external dependency is wrapped in a typed interface with real + fake
implementations"* (`callback-box/CLAUDE.md`, Key Concepts).

The key is `CALLBACK_OPENAI_API_KEY`. This collides with the embeddings key
(`core/search/embeddings-key.ts:84`), and the codebase keeps transcription and
embeddings keys separate on purpose — `core/openai-thinking-key.ts:13-16`: *"a
transcription key is not consent to pay for embeddings, and boxes may hold
different keys for each."* The boxholder was shown the collision and chose reuse
on 2026-08-22, on the grounds that a dev-surface key on their own machine is low
cost. The box-side distinction between `openai` and `openai-thinking` is
unchanged; only this dev surface reuses the name. `callback-box/docs/secrets.md`
gains a line recording this, so a later reader does not read it as the
distinction having eroded.

**Discarding the audio is a knowing trade.** It makes retranscription impossible
by construction — the gap
`issues/bugs/2026-08-18-first-message-audio-not-retranscribable.md` documents at
length. For a communication medium consumed within days that is the correct
trade, and it removes the storage and privacy questions entirely. It does mean
the HQ pass is the only attempt, which is why the seam calls `transcribeAudioHq`
and not a streaming service.

**The blob is held client-side until the transcript returns** — not until the
store write, which the split makes unnecessary. See the gap note below.

**First implementation chunk.** The `apiKey` field, the injected service, and the
`comments.transcribe` mutation with its failure surface — testable with the fake
before any recording UI exists.

### Track 4a — Routing, and waking the workstream

**What.** Every comment knows which workstream it is for, and the boxholder can
wake that workstream from the comment.

**Why this needs to change.** A comment that does not reach the agent doing the
work is a comment the boxholder has to re-explain in chat, which is the cost this
whole feature exists to remove.

**Direction — the routing ladder, applied at write time, which never guesses:**

1. **Viewing through a lens** (`?workstream=X` in the browser) → target `X`.
   Explicit beats inferred.
2. **The file is modified in exactly one workstream** → that one. Unambiguous.
3. **Modified in several** → take the most recent modifier, show which one was
   picked, and let it be changed. An earlier draft made this a mandatory choice;
   the boxholder's correction (2026-08-22) is that two workstreams touching one
   file is *"very uncommon… usually something I'd want to avoid"*, so the case
   gets a visible default rather than elegant handling. Principle 6, and the
   `stop-over-engineering-rare-failures` posture: the cost of the rare
   mis-route is one re-route, and the state is shown rather than assumed
   (principle 13).
4. **Modified in none** → `workstream: null`, unrouted. The comment stays on the
   file and any session that opens the file sees it. Commenting on a file nobody
   is working on is how new work starts, not an error.

Step 2 and 3 read the same changed-files data the browser's cross-workstream lens
computes (`general-browser.md`, Track 3a), so routing adds no new mechanism.

**Two reads, one store.** The store stays keyed by file, and both questions fall
out of scanning it — the store is small enough that scanning is the right answer:

- `bin/comments show <path>` — what is on this document. The reader's question.
- `bin/comments list --workstream <name>` — what is addressed to me, newest
  first. The agent's question, and the answer to *"the workstream agent should be
  able to easily see what comments I've made, both specifically what I might have
  touched last, and very possibly there could be multiple comments on multiple
  things."*

**Waking the workstream.** `focus` is already an action verb
(`workstreams-app/src/shared/actions.ts:7`; button at `WorkstreamsPage.tsx:40`),
implemented at `bin/workstreams:267` as bringing the live session's Terminal tab
to the front, with `resume` for a removed session. The comment UI offers the same
action against the routed workstream. What it does **not** do is inject text into
a live session — nothing in the codebase does that, and inventing it here would
be a large mechanism for a case the boxholder described as *"as simple as the
focus button already in the workstreams app."* The agent's side of the handoff is
the pull: `bin/comments list --workstream`, surfaced by Track 5's guidance.

**First implementation chunk.** The `workstream` field, the ladder, and
`bin/comments list --workstream` — routing and the agent read, before any wake
button exists.

### Track 4b — Asks on files: DEFERRED to its own plan

**The idea, kept because the boxholder asked for it.** An agent should be able to
point at a file it produced and say *"please look at this, I made it for you to
look at"* — with the restraint that most changes do not get one, and issues and
plans never do because they are standing queues already.

**Why it left this plan.** The earlier draft claimed a file ask could join the
existing ask queue by giving `askQueueEntrySchema` a discriminated subject. That
underestimated the work by enough to be wrong. The queue is exhibit-shaped
through and through:

- `askQueueEntrySchema` (`workstreams-app/src/shared/exhibits.ts:74-89`) requires
  `slug`, `permanent`, and a `path` documented as *"Path on the exhibits origin,
  joined to the queue's `origin`"*.
- `AsksPage` links every row with `queue.origin + entry.path`
  (`AsksPage.tsx:14-16`) — every row is an exhibits-origin URL.
- Answering is deliberately not possible from this origin:
  `workstreams-app/src/server/api/router.ts:71` — *"Read-only: answering an ask
  happens on the exhibits origin, never here."*

A file ask has no exhibits-origin path, no `disposition.json`, and no way to be
answered where the queue says answering happens. That is a real design question —
where a file ask is answered, and what "answered" means for one — not a schema
tweak. Filed as `issues/features/2026-08-22-file-asks-agent-flagged-attention.md`
with these three obstacles recorded, so the next session starts from them rather
than rediscovering them.

Nothing else in this plan depends on it.

### Track 5 — Discoverability and guidance

**What.** The paths and prompts that make an agent find comments without being
told each time.

**Why this needs to change.** The boxholder's constraint: *"It's important that an
agent can easily see/find the accompanying comments for a document."* A store
outside the checkout is invisible unless something points at it.

**Direction.** Four layers, weakest dependency first.

1. A gitignored `comments` symlink in every checkout pointing at the store root,
   mounted beside the exhibits mount (`bin/lib/worktree-create.sh:135-140`), so
   `cat comments/tracked/callback-box/docs/plans/foo.md.comments.yaml` works from
   anywhere. Read convenience only; writes never traverse it.
2. `bin/comments show <path>` and `bin/comments list` (Track 1).
3. One sentence in the root `CLAUDE.md` pointing at `bin/comments show` when
   working from a document, with the mechanism in a reference doc. This is the
   altitude the feature earns: a pointer in the prompt, details in docs.
4. A `SessionStart` line naming documents with waiting comments, printed **only
   when the store is non-empty**. Silent otherwise, which keeps it out of the
   category `CLAUDE.md` calls a bug: *"Warnings, deprecation notices… cost real
   agent context every time they appear."*

Layer 4 is what makes discovery automatic rather than documented; it is listed as
an open question because it adds a hook the boxholder may not want.

**First implementation chunk.** The mount, the `.gitignore` entry (`/comments`,
no trailing slash — the symlink lesson recorded at `workstream-exhibits.md:250`),
and the `CLAUDE.md` sentence.

## Could this be simpler?

**The simplest version that could work:** no UI at all. `bin/comments add <path>
--quote "…" --body "…"`, typed in a terminal. The store, the YAML shape, and the
agent-read path are unchanged; Tracks 2, 3 and 4 disappear, which is most of the
plan.

**What the fuller version buys, concretely:**

- *Selection as the input device.* The job story is "I am reading a document and
  one paragraph is wrong." Retyping the paragraph into a terminal to identify it
  is the work the feature exists to remove, and it is the step at which the
  boxholder stops bothering — the comment is then not made at all.
- *Voice.* `MediaRecorder` needs a browser. The stated situation is attention on
  the document, not the keyboard. This is Track 4's entire justification and it
  cannot be had any other way.
- *A document viewer the app was missing anyway.* Track 2 is not overhead this
  plan invents; it removes `PlansPage`'s link-out to a different surface with a
  hardcoded worktree.

**The thinnest part of the plan, named honestly:** the `fragment` field and the
highlighting it powers. Everything an agent needs is in `quoted`; `fragment` only
lets the boxholder see which spans they have already commented on while still on
the page. It survives because `generateFragment` and
`processTextFragmentDirective` are both already installed dependencies, so the
cost is an optional field and roughly twenty lines — not because the benefit is
large. If it proves noisy, deleting it removes no capability an agent depends on.

**What was cut by asking this question:** an earlier draft had a four-rung "drift
ladder" (exact match → matched elsewhere → heading only → orphaned), a re-anchor
button, and a `state: open | addressed | dropped` field. All three served
maintaining comments as documents. Once the boxholder said "this is a
communication medium not a document medium", they became defense against a
failure that does not need defending — principle 6, and the
`stop-over-engineering-rare-failures` posture. A later draft also carried a
router-injected client library; the boxholder's redirect into the app deleted
that whole apparatus (see "Where this lives").

## Subplans

None. Each track's decisions are settled inline; no sub-question needs its own
research or vocabulary pass. The transcription key was the one candidate, and it
was decided rather than deferred.

## Failure modes

> **The gap that used to be critical, and what shrank it.** The audio is
> discarded by design, so a transcription failure with the blob already released
> would destroy a spoken comment outright — nothing to retry from, nothing to
> reconstruct. Splitting transcription from submission (Track 4) reduces this to
> a short, ordinary window: the blob must survive until `comments.transcribe`
> returns, and the failure must be shown with the recording still retryable.
> After the transcript lands in the composer there is no blob left to lose,
> because the comment is text like any other. An implementation that releases
> the blob before the transcript returns reintroduces the original gap.
> Principle 4: resilient and never silent.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Transcription fails after the audio was released | Doctest: fake service forced to fail | Blob retained until the transcript returns; error shown with retry and a fall back to typing | Clear |
| The transcript is wrong (misheard name or jargon) | Not automatable | It lands in the composer, editable, before anything is stored — the reason transcription and submission are separate steps | Clear |
| `CALLBACK_OPENAI_API_KEY` unset | Doctest on the refusal path | `comments.transcribe` returns a message naming the variable; the recording is kept and typing still works | Clear |
| `getUserMedia` unavailable (insecure context, or permission denied) | Not automatable in a doctest; manual check | The mic control renders disabled with the reason, rather than being absent | Clear |
| `generateFragment` returns `AMBIGUOUS` or `TIMEOUT` | Doctest over a document with a repeated phrase | `fragment` omitted; `quoted` still written; comment fully usable | Clear |
| A stored `fragment` no longer resolves (the document changed) | Doctest resolving a fragment against edited text | Comment rendered in the unresolved list with its `quoted` text | Clear |
| Two browser tabs comment on the same document at once | Doctest posting concurrently | In-process per-path lock plus atomic rename | Clear |
| An agent hand-edits the YAML while a tab writes | No | None — last writer wins for that read-modify-write window | **Silent** (accepted; see below) |
| The YAML fails to parse (hand-edit, truncation) | Doctest with a malformed file | `bin/comments` and `comments.list` report the file and the parse error; they do not silently return "no comments" | Clear |
| The document path escapes the worktree root (`..`, absolute, symlink) | Doctest per escape shape | Containment check plus post-`realpath` re-check, refusing rather than clamping | Clear |
| The requested worktree does not exist | Doctest | `documents.read` returns NOT_FOUND naming the worktree | Clear |
| The store root exists without its marker | Doctest | Refuse to write, naming the path — the exhibits posture (`store.ts:39-44`) | Clear |
| The `comments` symlink is missing or broken | Doctest on the mount helper | Reads through the CLI still work (it derives the root itself); the mount self-heals on resume | Clear |
| Two untracked documents in different worktrees share a repository-relative path | Doctest writing the same path from two worktrees | Keyed under `worktree/<name>/…`, so they never share a file | Clear |
| A tracked document becomes untracked, or vice versa, after comments exist | Doctest on both transitions | `comments.list` reads both namespaces for a path and shows what it found in each | Clear |
| A comment routes to a workstream that is culled before its agent reads it | Doctest on a routed comment whose workstream is gone | The comment survives on the file, shown as routed-to-a-gone-workstream and re-routable, never deleted with the tree | Clear |
| Two workstreams modify a file | Doctest on the ambiguous branch | Ladder step 3 defaults to the most recent modifier and shows which one it chose, changeable in place | Clear |
| The changed-files data is unavailable when a comment is written | Doctest with the diff failing | The comment is written unrouted rather than mis-routed, and says so | Clear |
| A recording exceeds the tRPC body limit | Doctest asserting the client byte cap sits under the app's explicit `bodyLimit` | Client caps on bytes (not duration), stops at the cap and keeps the partial recording submittable; the app sets `bodyLimit` explicitly rather than inheriting Fastify's 1 MiB | Clear |
| The workstreams app is down | Existing app-level error handling | The viewer shows the failure; composed text stays in the page rather than being swallowed | Clear |
| The commented document is later deleted or renamed | Doctest on `bin/comments list` | Listed as pointing at a missing file; not auto-deleted | Clear |
| The CSS Custom Highlight API is unavailable | Existing behavior at `quote-anchor.ts:29` — *"No-op where the API is unavailable"* | Highlighting skipped; comments still listed | Clear |

**The one accepted silent failure.** An agent hand-editing the YAML at the exact
moment a browser tab appends can lose one comment. Closing it needs cross-process
file locking for a window of milliseconds, on a single-user machine, where the
agent's normal interaction is `bin/comments clear` after reading. This is the
case the `stop-over-engineering-rare-failures` posture is about: reachable only
by deliberate contention, cheap to recover from (the comment is re-made), and
expensive to prevent. Documented rather than defended — principle 6.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED.* The only authoring surface is the
  viewer, which fills every field mechanically. An agent writing a store file by
  hand is validated on read against the Zod schema (Track 1), which names the
  file and the issue.
- **Stale ref** — *ADDRESSED.* This is the anchoring case. The document changes,
  the fragment stops resolving, and the comment appears in the unresolved list
  with its `quoted` text (Track 3). No fuzzy re-anchoring, on the Hypothesis
  evidence cited in Prior art.
- **Two agents touching the same card** — *ADDRESSED for the machine case*
  (in-process lock, Track 2), *accepted for the hand-edit case* (see Failure
  modes).
- **Hand-edit drift** — *ADDRESSED.* A malformed file is reported with its path
  and parse error rather than read as empty. Reading a corrupted file as "no
  comments" would hide the boxholder's words, which is the reasoning
  `exhibits/disposition.ts:25-31` uses for a disposition that does not parse.
- **Fabricated free-form value** — *ADDRESSED by guidance.* An agent that
  "transcribes out" a comment into the document could paraphrase it into
  something the boxholder did not say. The store keeps `body` and `quoted`
  verbatim until an agent clears them, so the original is checkable, and the
  Track 5 guidance says to quote rather than paraphrase when folding a comment
  into a document.
- **Validation error UX** — *ADDRESSED.* Every refusal names the concrete thing:
  the environment variable, the file path, the worktree, the escape attempt.
  Principle 4.
- **Partial migration / transition state** — *ADDRESSED.* Nothing existing
  changes shape; the store is net-new. The only transition is worktrees created
  before the mount exists, which self-heal on resume exactly as the exhibits and
  private-issues mounts do (`bin/lib/worktree-create.sh:136-138`).

## NOT in scope

- **Threads and replies.** A comment is one remark. A conversation belongs in
  chat, where it already works.
- **Resolution state.** No `state` field. An agent reads a comment, acts, and
  clears it.
- **Re-anchoring, fuzzy matching, and comment maintenance.** Cut on the
  boxholder's framing and on the Hypothesis performance evidence.
- **Retaining audio.** Discarded on transcription. Consequence stated in Track 4.
- **Retiring the router's `/dev/docs/` browser.** The app's viewer overlaps it,
  and the doc browser has features this plan does not reproduce — `Cmd-P`
  quick-open, the grouped sidebar, recent-sort, and untracked/`scratch`
  inclusion. Two reading surfaces is a real cost; see Open design questions.
- **Comments on box cards.** That ground belongs to
  `issues/exploration/2026-08-01-questions-as-inline-annotations.md`, which is
  committed-to-git annotations inside cards, with a thread model and an agent
  resolver. Different persistence class, different vocabulary. This plan
  deliberately does not name its records "annotations" or "questions" to keep
  that space clear.
- **Comments outside the three surfaces named in Track 3.** The browser and the
  issues app are the first two and land with this plan; exhibits are third and
  depend on the header component in `general-browser.md`. Not the box frontend,
  not chat, not `/dev/` pages. (An earlier draft said "any surface but the
  document viewer", which contradicted the capability framing; the capability is
  real, its rollout is bounded.)
- **Any path to git or to main.** The store never merges. `*.comments.yaml` never
  becomes a tracked pattern.
- **Commenting on diffs.** The boxholder expects to want this later and said
  plainly that it is not important yet — *"we don't have to overthink that part."*
  Designing for it now would put a second addressing scheme (two file versions,
  not one) into a store that has no need of it. Left out deliberately, and the
  file-keyed store does not foreclose it.
- **Injecting text into a live agent session.** Waking a workstream is `focus`;
  what the agent then reads is `bin/comments list --workstream`. No mechanism for
  pushing a prompt into a running session exists in this codebase, and this
  feature is not the place to invent one.
- **A separate comments UI for issues.** Issues keep the interface they have; they
  gain source tags and nothing else.
- **File asks.** Deferred to their own plan (Track 4b) — the ask queue cannot
  take them without deciding where a file ask is answered.
- **Multi-user.** One boxholder, one machine, no identity field.
- **Syncing comments between machines.** Explicitly local.

## Open design questions

- **Two reading surfaces.** The app's viewer and the router's `/dev/docs/`
  browser will both render repository markdown, and only one takes comments. The
  boxholder may want the doc browser eventually retired into the app (porting
  quick-open, the sidebar, and scratch inclusion), or may want it kept as the
  fast, no-cold-start reader. Lean: keep both for now, revisit once the viewer
  has been used. This is the one question whose answer could grow the plan.
- **The `SessionStart` line (Track 5, layer 4).** It is what makes discovery
  automatic instead of documented, and it is also a new hook on every session
  start. Lean: include it, gated to print only when the store is non-empty.
- **Should `bin/comments clear` exist as a verb, or should agents edit the file
  directly?** Lean: the verb, because it makes "I have handled this" a single
  legible action rather than a hand-edit that can corrupt the file (which is the
  one accepted silent failure above).

## Knowledge audits

**Skipped, with rationale.** Knowledge audits test what a **box agent** recalls,
by prompting a real box agent (`callback-box/docs/knowledge-audits.md`). Every
agent-facing concept this plan introduces — `bin/comments`, the store path, the
`comments` symlink — lives in the **dev repository's** guidance, which a box
agent never loads. An audit could not test it in either direction. The equivalent
verification here is Track 5's own doctests plus using the feature: if an agent
working in a worktree does not find the comments, layer 4 is the answer, not an
audit.

## Implementation order

1. **Store module and CLI** (Track 1). Root derivation, marker guard,
   containment, the `tracked/` and `worktree/` namespaces, Zod schema,
   `bin/comments show|list|clear`. Independently useful; unblocks everything.
2. **Mount and gitignore** (Track 5 layers 1–2). Small, and makes chunk 1
   reachable from any checkout.
3. **`documents.read` and the viewer route** (Track 2). Renders a plan in-app and
   replaces `PlansPage`'s link-out. Depends on nothing above; independently
   shippable value.
4. **Comment procedures** (Track 2). `comments.list|add|clear` over chunk 1's
   store. Depends on chunk 1.
5. **Display** (Track 3). Renders comments written by chunk 1's CLI. Depends on
   chunks 3 and 4.
6. **Typed capture** (Track 3). Depends on chunk 5.
7. **The transcription seam** (Track 4, server half). The `apiKey` field on
   `TranscribeAudioParams` in `callback-box`, the injected `transcribe` service,
   and the `comments.transcribe` mutation. Independent of chunks 5–6.
8. **Spoken capture** (Track 4, client half). Depends on chunks 6 and 7.
9. **Guidance** (Track 5 layers 3–4). The `CLAUDE.md` sentence, the reference
   doc, the `docs/secrets.md` line, and the `SessionStart` line if the boxholder
   wants it. Last, because it documents what the earlier chunks actually did.

## Rollout shape

**Where this code runs, and what that costs.** The workstreams app is
main-checkout code: the supervisor is pointed at
`path.join(MAIN_ROOT, "workstreams-app")` (`bin/router.ts:1511-1514`), so a
worktree's copy is never what the shared router serves. Consequences, both of
which must hold before the plan is called done:

- Development and testing run against an **isolated router** — `CALLBACK_STATE_DIR`
  plus `ROUTER_PORT`, with `CALLBACK_MAIN_ROOT` (`bin/router.ts:106`) pointed at
  the worktree so the supervisor picks up the worktree's app.
- The shared router picks the work up after a merge to main. On main the
  supervisor restarts the app on source change by itself
  (`bin/workstreams-app-supervisor.ts:483-499`), with `POST
  /__router/retry/workstreams-app` (`bin/router.ts:1046-1058`) as the manual
  lever — so unlike a router change, this needs no action from the boxholder
  once merged.

**This plan changes no `bin/router*.ts` file.** That is a consequence of the
boxholder's redirect into the app, and it is worth stating as a property to
preserve: a change that starts needing router edits has drifted back toward the
draft this replaced.

**Test posture.** Doctests, named per codepath as part of designing it, in
`workstreams-app/test/` beside the existing suites (`exhibits-api.doctest.md`,
`server-boundary.doctest.md`, `markdown.doctest.md`) and in `bin/` for the CLI:

- `comments-store.doctest.md` — root derivation, marker refusal, containment
  against `..`/absolute/symlink escapes, both namespaces, Zod round-trip,
  malformed-file reporting.
- `comments-cli.doctest.md` — `show` with all three path spellings, `list`
  ordering, `list --workstream` scoping and recency order, `clear` by id, a
  document that no longer exists.
- `comments-routing.doctest.md` — each rung of the ladder: lens-explicit,
  single-workstream inference, the ambiguous case defaulting visibly to the most
  recent modifier, the unrouted case, and a routed comment whose workstream was
  culled.
- `documents-read.doctest.md` — tracked and untracked documents, an unknown
  worktree, and each path-escape shape.
- `comments-api.doctest.md` — mutation validation, concurrent writes to one
  document, and the same relative path written from two worktrees.
- `comments-transcribe.doctest.md` — driven through the **injected** transcribe
  service, not `transcribeAudioHq` (which has no fake — `index.ts:142`):
  `comments.transcribe` returning text only, the missing-key refusal naming
  `CALLBACK_OPENAI_API_KEY`, the transcription-error path leaving the recording
  retryable, and an over-cap body being refused with the cap named.
- `comments-anchor.doctest.md` — `generateFragment` `AMBIGUOUS` handling, and
  resolving a stored fragment against edited text.

**Done-when**, as checkable assertions rather than a feeling: those seven suites
pass; `bin/comments list` in a fresh worktree finds a comment written from the
viewer in a different worktree; a spoken comment survives a forced transcription
failure and can be retried; a comment left on a file changed in one workstream is
found by `bin/comments list --workstream <that name>` with no argument beyond the
name; and an issue can be commented on with the issues interface unchanged.

**Not covered by tests, by decision:** the `getUserMedia` secure-context path and
the actual microphone, which need a real browser and a real device. Checked by
hand once, and the control states its own state (principle 13) so a later failure
is visible rather than mysterious.

**Migration.** None. Nothing existing changes shape; the store is net-new and
starts empty.

**Cross-model review.** The previous draft was reviewed with Codex on 2026-08-22;
five factual corrections from that pass are carried into this one (tRPC-only
mutations, the transcription key resolver, the missing HQ fake, the app being
main-checkout code, and untracked-path collisions). The rehost into the app is
new since that review and gets its own pass before implementation starts.
