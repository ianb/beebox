---
title: "Dev-page comments: a communication medium on rendered docs"
status: draft
workstream: dev-comments
issues: []
---

# Dev-page comments

A small client library, injected once into the `/dev/` page shell, that lets the
boxholder comment on any rendered document by selecting text or clicking a
block, by typing or by speaking. Comments are written to a machine-local store
outside git and read back by agents through `bin/comments`. They are messages,
not documents: an agent reads them, acts, and clears them.

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
  (resilient AND never silent), **6** (right-sized defensiveness), **12** (the
  maintainer is usually an agent), and **13** (a control shows the state the
  system is in, never the one it intends).
- `CLAUDE.md` (monorepo root) — "**Treat noisy command output as a bug**", the
  never-disable-lint rule, and the dev-page casualness carve-out: "Dev pages are
  deliberately casual — no lint anywhere on them… That is license for the
  *pages*, not for a shared library other pages depend on." This plan's client
  library is the second kind and is linted and typechecked accordingly.
- `callback-box/code-style.md` — the mechanical rules (max 2 positional
  parameters, no `any`, no default parameters).
- **Precedent: the exhibits store** — `callback-box/docs/plans/workstream-exhibits.md:236`:
  *"There are only two persistence classes today: committed (merges to main) and
  disposable (dies with the cull). Exhibits are a third class — workstream-persistent,
  never merged — and nothing provides it."* This plan uses that third class and
  departs from it in exactly one way (keying), argued in Track 1.

## What already exists

| Thing | Where | Reuse or rebuild |
|---|---|---|
| The single shell every router-rendered dev page passes through | `bin/router-docs.ts:137` — `renderDevShell(title, breadcrumbs, body, extraCss)` | **Reuse, with a signature change.** One injected script tag reaches every page it renders; Track 3 adds a required document-identity argument so each caller declares whether its page is commentable. |
| Inline scripts permitted on `/dev/` | `bin/router-docs.ts:826-853` — the `sandbox` CSP was removed by boxholder decision 2026-08-19 | **Reuse.** A client-side library is viable only because of this. |
| Markdoc rendering for `.md` | `bin/router-docs.ts:291` — `renderMarkdownToHtml` | **Reuse**, with one change: it emits no heading ids except a hardcoded `id="manual-testing"` at line 295. Track 3 adds slug ids and deletes that special case. |
| Text-fragment resolution and non-destructive highlighting | `callback-box/src/frontend/src/lib/selection/quote-anchor.ts:19-33` — `findQuoteRange` via `processTextFragmentDirective`, `highlightRange` via the CSS Custom Highlight API | **Reuse the technique, not the module.** The file imports nothing box-specific, but it lives in the box frontend's Vite graph; the dev client is built separately (Track 3). |
| Text-fragment **generation** | `node_modules/text-fragments-polyfill/dist/fragment-generation-utils.js`, version 6.7.0 — `generateFragment(selection)` returns `{status, fragment}` with status `SUCCESS \| INVALID_SELECTION \| AMBIGUOUS \| TIMEOUT` (`src/fragment-generation-utils.js:43-68`) | **Reuse.** Already an installed dependency; we currently use only the resolving half. |
| HQ transcription | `callback-box/src/core/transcription/index.ts:253` — `transcribeAudioHq`; `TranscribeAudioParams.boxRoot` is optional (`:121-127`) and `loadTranscriptionConfig` returns `{service: "voxtral", hqService: "whisper"}` when no box root is given (`:169-171`) | **Reuse the dispatcher, extend the params.** It runs box-less, but the Whisper path resolves its own key (`index.ts:298` → `openai-thinking-key.ts:45`) and there is no HQ `fake`, so Track 4 adds an optional `apiKey` and an injectable service seam. |
| An OpenAI key readable without a box | `callback-box/src/core/search/embeddings-key.ts:84` — `process.env["CALLBACK_OPENAI_API_KEY"]` | **Reuse the name, by boxholder decision.** Nothing reads it for transcription today — Track 4 wires it. See Track 4 for the collision this accepts. |
| Path containment against traversal and symlink escape | `workstreams-app/src/server/issue-path.ts:13-39` — `assertContained` plus a post-`realpath` re-check | **Reuse the pattern**, not the source. `workstreams-app/src/server/exhibits/store.ts:9-12` states the house rule: *"This deliberately reimplements the shape of src/server/issue-path.ts rather than importing it: the two roots have different vocabularies, and the resident-app precedent is to share patterns, not source."* |
| A store beside the main checkout, with a marker file | `workstreams-app/src/server/exhibits/store.ts:26,46-53` — `STORE_MARKER = ".workstream-exhibits"`, `defaultStoreRoot` derives from the main checkout's parent | **Reuse the shape** with a different root and marker. |
| Worktree symlink mount, self-healing on resume | `bin/lib/worktree-create.sh:135-140,149-151`; root derivation at `bin/lib/worktree-paths.sh:76` | **Reuse.** One more best-effort mount call beside the exhibits one. |
| A mutating surface with an explicit `Origin` check | `workstreams-app/src/server/exhibits/auth.ts:14-20,36-44` — *"SameSite is NOT a boundary here. Every loopback server is one 'site' to a browser regardless of port"* | **Reuse the reasoning.** The write route rides the workstreams origin, whose mutations are already CSRF-classified at `bin/router-auth.ts:228-235`. |
| Restart of the app without restarting the router | `bin/workstreams-app-supervisor.ts:483-499` (source-change watcher) and `bin/router.ts:1046-1058` (`POST /__router/retry/workstreams-app`) | **Reuse.** Why the write path lives in the app. Note the limit: the supervisor runs `MAIN_ROOT/workstreams-app` (`bin/router.ts:1511-1514`), so this buys restart convenience on main, not worktree iteration. |
| Atomic file replacement | `workstreams-app/src/server/issues-mutation-service.ts:206` — write to a temporary, then rename | **Reuse the pattern.** |
| A read-back CLI whose output a later session consults | `bin/exhibits list`, contract in `workstreams-app/docs/exhibits.md` | **Reuse the shape** for `bin/comments`. |

## Prior art (external)

Four searches, all of which returned findings that changed the design.

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
  the import specifier must be that exact path and not a bare
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
  `tailscale serve` (HTTPS), and are unavailable if the router is ever reached at
  a bare `http://<ip>:3210`. Track 3 requires the control to say which case it is
  in rather than silently disappearing.

No prior art was found for the specific combination of "companion comment file
keyed by repository-relative document path, outside version control" — this
appears to be a local composition of the exhibits store idea and the W3C
`TextQuoteSelector` shape rather than an established pattern.

## Tracks / scope

Ordered by implementation dependency. Track 1 is usable by an agent before any
browser code exists, which is deliberate: the agent-read path is the half that
justifies the feature.

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
<parent-of-main-checkout>/dev-comments/          # marker file: .dev-comments
  callback-box/docs/plans/foo.md.comments.yaml
  dev/skill-tree.html.comments.yaml
```

The store mirrors the repository-relative path of the commented document. Root
derivation follows `defaultStoreRoot` (`workstreams-app/src/server/exhibits/store.ts:46-53`):
the parent of the **main** checkout, overridable by `CALLBACK_COMMENTS_ROOT` for
tests, with `WT_COMMENTS_ROOT` added to `wt_paths_init` beside `WT_EXHIBITS_ROOT`
(`bin/lib/worktree-paths.sh:76`).

**The departure from the exhibits precedent: keying by document, not by
workstream.** A comment is about a document, and a *tracked* document is present
in every checkout at the same repository-relative path. Keyed by workstream, a
comment left while reading a plan in one worktree is invisible when the same plan
is opened from main — which is a weaker form of the loss the store exists to
prevent. Keyed by repository-relative path, the comment is found wherever the
document is next opened. The cost is that a comment can attach to a version of
the file that has diverged between checkouts; that cost is small because
resolution is best-effort by design and `quoted` carries the meaning regardless.

**Where that claim stops: untracked documents.** The doc browser deliberately
lists untracked markdown — `git ls-files --cached --others --exclude-standard`
(`bin/router-docs.ts:348-356`) — and then re-admits ignored `scratch/*.md`
because *"scratch/ is exactly where agents leave deliverable orientation docs the
boxholder wants to browse"* (`:360-364`). Those files are frequently
worktree-local, and two worktrees can hold entirely different documents at the
same relative path. Path keying would silently merge their comments.

Each record therefore carries `origin`, the worktree the comment was made in,
and `bin/comments show` prints it. For a tracked document this is provenance
noise the reader can ignore; for `scratch/notes.md` it is the difference between
"my comment moved with the document" and "these are two different documents".
The store does not try to separate them — separating would need content
identity, which is a document-medium mechanism this feature is not — it makes
the collision visible. Principle 4: never silent.

This keying also removes machinery rather than adding it. Nothing is ever written
through the checkout, so the exhibits teardown guard — "if `<worktree>/exhibits`
exists and is a **real directory**… `wt_remove_now` moves its contents into the
store (or refuses) instead of trashing them with the tree"
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
    origin: dev-comments
    fragment: ":~:text=so%20the-,router%20picks%20this%20up,-on%20reload"
```

`origin` is the worktree the comment was made in; it is what makes a same-path
collision between two untracked documents visible rather than silent (see below).
`body` is what the boxholder said. `quoted` is the selected text verbatim, and is
the field that makes the comment legible to an agent reading the file with `cat`.
`section` is the enclosing heading as plain text. `fragment` is
`generateFragment`'s output serialized, and is **optional**: absent on `AMBIGUOUS`
or `TIMEOUT`, and absent for a whole-document comment. No `state` field, no
`audio` field, no reply threads — see NOT in scope.

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
`.dev-comments`; the file suffix `.comments.yaml`; the field names above,
`origin` included; the `kind` values `typed` and `spoken`.

**First implementation chunk.** The store module (root derivation, marker guard,
path containment, YAML read/write with a Zod schema) plus `bin/comments show`
and `bin/comments list`, with a doctest that writes a store by hand and reads it
back. No browser, no HTTP.

### Track 2 — The write API

**What.** A tRPC mutation on the workstreams app that appends a comment to a
document's store file.

**Why this needs to change.** `/dev/` is read-only serving; nothing POSTs today.

**Direction.** `comments.add` on the existing router
(`workstreams-app/src/server/api/router.ts`), input Zod-validated: the
repository-relative document path, `body`, `kind`, `quoted`, `section`,
optional `fragment`. Output is the stored record.

**Everything mutating goes through tRPC — this is a constraint, not a
preference.** `bin/router-auth.ts:228-239` classifies a POST under
`/workstreams/` as `control` only when it is `/workstreams/action/*`,
`/workstreams/issues/action/*`, or `/workstreams/api/trpc[/*]`; *"return { kind:
"unknown" }"* on line 238 denies everything else before it is proxied. A raw
`POST /workstreams/api/comments` would be refused by the router. Routing both the
comment write and the audio upload (Track 4) through tRPC keeps the router's
share of this plan to the script tag and the heading ids, and adds no new
classification to a fail-closed auth table.

The app is the host rather than the router because the supervisor restarts it on
its own: it watches the app source and requests a restart on change
(`bin/workstreams-app-supervisor.ts:483-499`), with `POST
/__router/retry/workstreams-app` (`bin/router.ts:1046-1058`) as the manual lever.
A `bin/router.ts` or `bin/router-docs.ts` change instead needs the boxholder to
restart the shared router, which a worktree session must not do.

**But the app is main-checkout code, exactly like the router.** The supervisor is
pointed at `path.join(MAIN_ROOT, "workstreams-app")` (`bin/router.ts:1511-1514`),
so a worktree's copy of the app is never what the shared router serves. Track 2's
code reaches the boxholder the same way Track 3's does: merge to main. See
Rollout shape for the test posture this forces.

Writes are read-modify-write under an in-process per-path lock, then an atomic
temporary-plus-rename (`issues-mutation-service.ts:206`). One process owns
writing, so an in-process lock is the right size; principle 6.

**First implementation chunk.** The mutation, its Zod input schema, the lock and
the atomic write, plus a doctest that posts two comments concurrently to the same
document and asserts both survive.

### Track 3 — The client library and shell injection

**What.** A small script that gives every rendered dev page a comment affordance.

**Why this needs to change.** Selecting text is the input device for this
feature. It cannot be done from a CLI.

**Direction.**

- `renderDevShell` (`bin/router-docs.ts:137`) gains one script tag pointing at
  a client bundle served by the workstreams app. Hand-written `dev/*.html` files
  are served as-is and opt in with the same one tag.
- **Document identity is an explicit required argument, not an inference.**
  `renderDevShell(title, breadcrumbs, body, extraCss)` has no document parameter
  today, and its four callers render four different things: the manifest
  (`:343`), the doc browser (`:716`), a directory index (`:788`) and a markdown
  artifact (`:795`). Only the last two are documents. The signature takes a
  discriminated union — a repository-relative document path, or a marker that
  this page is not commentable — so a caller that forgets is a compile error
  rather than a page that writes comments under the wrong key or under `""`.
  Principle 2: exhaustiveness is enforced, not hoped for. Each of the four call
  sites gets a test asserting which identity it passes.

  This also right-sizes the scope decision: commenting turns on for markdown
  documents, and the manifest and directory listings are deliberately excluded.
  There is nothing on a directory index worth commenting on.
- `renderMarkdownToHtml` (`:291`) gains slug ids on headings, and the hardcoded
  `id="manual-testing"` replacement at `:295` is deleted as redundant.
- Capture: a selection produces `quoted` from the selection's text and
  `fragment` from `generateFragment`. A click on a block produces the block's
  `innerText` as `quoted`. Both write the same record; the two affordances are
  two ways to point, not two record types.
- Display: existing comments for the document are fetched and resolved with
  `processTextFragmentDirective`, highlighted through the CSS Custom Highlight
  API — the `quote-anchor.ts:19-33` technique, which mutates no DOM and so
  cannot break a page's own scripts. A comment whose fragment is absent or does
  not resolve is rendered in a visible list at the foot of the page with its
  `quoted` text, never dropped.
- The UI renders inside a shadow root with namespaced globals, so it cannot
  collide with a dev page's own CSS or scripts.

**Why a bundle and not an inline script:** the client is a shared library other
pages depend on, which `CLAUDE.md` explicitly separates from the unlinted-page
carve-out. It is TypeScript, linted and typechecked, built by the app's existing
Vite config.

**Vocabulary lock-ins.** The data attribute name carrying the document path; the
shadow-root host element id.

**First implementation chunk.** The heading-id change and the script tag, with
the client doing display only — fetch and render existing comments, no writing.
This is exercisable against a store populated by Track 1's CLI.

### Track 4 — Spoken comments

**What.** Record in the browser, transcribe on the server, discard the audio.

**Why this needs to change.** The boxholder's stated capture situation is reading
with attention on the document, not on a keyboard.

**Direction.** `MediaRecorder` in the client; the audio is base64-encoded into a
`comments.transcribe` tRPC mutation (raw POST paths are refused by the router —
see Track 2); the app transcribes it; the transcript becomes `body` with `kind:
spoken`; the audio is discarded as soon as the transcript returns. Base64 in a
tRPC body is acceptable here only because these recordings are short — the
client caps a comment recording at two minutes, which is well inside Fastify's
body limit even with base64's overhead, and refuses to start a longer one rather
than failing at upload.

**Transcription is an injected service, not a direct call.** Two things make the
direct call the plan first described unworkable, both found in cross-model
review:

1. **The key does not arrive by reusing the call as written.**
   `transcribeAudioHq` dispatches to Whisper (`index.ts:253,274`), and the
   Whisper path resolves its key through `getOpenAiThinkingKey`
   (`index.ts:298`), which with no `boxRoot` reads `THINKING_OPENAI_API_KEY` and
   nothing else (`core/openai-thinking-key.ts:45`). It never reads
   `CALLBACK_OPENAI_API_KEY`. The boxholder's reuse decision therefore needs a
   small change in `callback-box`, not zero: `TranscribeAudioParams` gains an
   optional `apiKey`, which the Whisper path prefers over the resolver. That is
   the minimal honest way to let a box-less caller supply its own key.
2. **`fake` is not an HQ service.** `HQ_TRANSCRIPTION_SERVICES`
   (`index.ts:142`) is whisper/voxtral only; the `fake` branch exists in
   `transcribeAudio` (`index.ts:231-233`) and has no counterpart in
   `transcribeAudioHq`. A doctest cannot force the fake through the HQ path.

So the app takes a `transcribe` function through its existing services object
(`workstreams-app/src/server/services.ts`) — real is `transcribeAudioHq` with
`apiKey` supplied from the environment, fake is canned text. This is the
house pattern: *"Every external dependency is wrapped in a typed interface with
real + fake implementations"* (`callback-box/CLAUDE.md`, Key Concepts).

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
the HQ pass is the only attempt, which is why the route calls `transcribeAudioHq`
and not a streaming service.

**The blob is held client-side until the write is acknowledged.** Discarding on
upload rather than on acknowledgement would make a transcription failure destroy
the comment. See the critical gap below.

**First implementation chunk.** The transcription route and its failure surface
(missing key, transcription error), with a doctest driving the route with a
fixture audio file against the `fake` transcription service.

### Track 5 — Discoverability and guidance

**What.** The paths and prompts that make an agent find comments without being
told each time.

**Why this needs to change.** The boxholder's constraint: *"It's important that an
agent can easily see/find the accompanying comments for a document."* A store
outside the checkout is invisible unless something points at it.

**Direction.** Four layers, weakest dependency first.

1. A gitignored `comments` symlink in every checkout pointing at the store root,
   mounted beside the exhibits mount (`bin/lib/worktree-create.sh:135-140`), so
   `cat comments/callback-box/docs/plans/foo.md.comments.yaml` works from
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

**The simplest version that could work:** no browser code at all. `bin/comments
add <path> --quote "…" --body "…"`, typed in a terminal. The store, the YAML
shape, and the agent-read path are unchanged; Tracks 2, 3 and 4 disappear, which
is most of the plan.

**What the fuller version buys, concretely:**

- *Selection as the input device.* The job story is "I am reading a document and
  one paragraph is wrong." Retyping the paragraph into a terminal to identify it
  is the work the feature exists to remove, and it is the step at which the
  boxholder stops bothering — the comment is then not made at all.
- *Voice.* `MediaRecorder` needs a browser. The stated situation is attention on
  the document, not the keyboard. This is Track 4's entire justification and it
  cannot be had any other way.

**The thinnest part of the plan, named honestly:** the `fragment` field and the
in-page highlighting it powers. Everything an agent needs is in `quoted`;
`fragment` only lets the boxholder see which spans they have already commented
on while still on the page. It survives because `generateFragment` and
`processTextFragmentDirective` are both already installed dependencies, so the
cost is an optional field and roughly twenty lines — not because the benefit is
large. If the field proves noisy in practice, deleting it removes no capability
that an agent depends on.

**What was cut by asking this question:** an earlier draft had a four-rung
"drift ladder" (exact match → matched elsewhere → heading only → orphaned), a
re-anchor button, and a `state: open | addressed | dropped` field. All three
served maintaining comments as documents. Once the boxholder said "this is a
communication medium not a document medium", they became defense against a
failure that does not need defending — principle 6, and the
`stop-over-engineering-rare-failures` posture. They are gone.

## Subplans

None. Each track's decisions are settled inline; no sub-question needs its own
research or vocabulary pass. The transcription key was the one candidate, and it
was decided rather than deferred.

## Failure modes

> **Critical gap (resolved in the design, stated here because it is the one that
> destroys user data):** *the spoken-comment path.* The audio is discarded by
> design. If the client discarded it on upload and transcription then failed —
> missing key, API error, network — the boxholder's spoken comment would be
> gone, with nothing to retry from and no way to reconstruct it. The design
> requires the blob to be held in the page until the store write is
> acknowledged, and the failure to be shown with the recording still retryable.
> Any implementation that releases the blob earlier reintroduces this. Principle
> 4: resilient and never silent.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Transcription fails after the audio was released | Doctest: route returns an error with the `fake` service forced to fail | Blob retained client-side until write acknowledged; error shown with retry and a fall back to typing | Clear |
| `CALLBACK_OPENAI_API_KEY` unset | Doctest on the route's refusal path | Route returns a message naming the variable; the comment is not accepted and discarded | Clear |
| `getUserMedia` unavailable (insecure context, or permission denied) | Not automatable in a doctest; manual check | The mic control renders disabled with the reason ("microphone needs https or localhost"), rather than being absent | Clear |
| `generateFragment` returns `AMBIGUOUS` or `TIMEOUT` | Doctest over a document with a repeated phrase | `fragment` omitted; `quoted` still written; comment fully usable | Clear |
| A stored `fragment` no longer resolves (the document changed) | Doctest resolving a fragment against edited text | Comment rendered in the unresolved list with its `quoted` text | Clear |
| Two browser tabs comment on the same document at once | Doctest posting concurrently | In-process per-path lock plus atomic rename | Clear |
| An agent hand-edits the YAML while a tab writes | No | None — last writer wins for that read-modify-write window | **Silent** (accepted; see below) |
| The YAML fails to parse (hand-edit, truncation) | Doctest with a malformed file | `bin/comments` and the read API report the file and the parse error; they do not silently return "no comments" | Clear |
| The document path escapes the store root (`..`, absolute, symlink) | Doctest per escape shape | Containment check plus post-`realpath` re-check, refusing rather than clamping | Clear |
| The store root exists without its marker | Doctest | Refuse to write, naming the path — the exhibits posture (`store.ts:39-44`) | Clear |
| The `comments` symlink is missing or broken | Doctest on the mount helper | Reads through the CLI still work (it derives the root itself); the mount self-heals on resume | Clear |
| The workstreams app is down when a comment is submitted | Doctest on the client's error path | The composed text stays in the page with the failure shown; it is not swallowed | Clear |
| The injected client fails to load, or throws on a page with unusual markup | Doctest forcing the bundle to fail | Shadow root plus a top-level guard so a client failure cannot break the page it is on, **and** a visible "comments unavailable" marker in the page | Clear |
| The commented document is later deleted or renamed | Doctest on `bin/comments list` | Listed as pointing at a missing file; not auto-deleted | Clear |
| Two untracked documents in different worktrees share one repository-relative path | Doctest writing the same path from two origins | Both comments kept in one file, each carrying `origin`; `bin/comments show` prints it | Clear |
| A recording runs long enough to exceed the tRPC body limit | Doctest on the client's cap | Client caps at two minutes and refuses to start a longer recording, rather than failing at upload with the audio already gone | Clear |
| The CSS Custom Highlight API is unavailable | Existing behavior at `quote-anchor.ts:29` — *"No-op where the API is unavailable"* | Highlighting is skipped; comments still listed | Clear |

**The one accepted silent failure.** An agent hand-editing the YAML at the exact
moment a browser tab appends can lose one comment. Closing it needs cross-process
file locking for a window of milliseconds, on a single-user machine, where the
agent's normal interaction is `bin/comments clear` after reading. This is the
case the `stop-over-engineering-rare-failures` posture is about: reachable only
by deliberate contention, cheap to recover from (the comment is re-made), and
expensive to prevent. Documented rather than defended — principle 6.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED.* The only authoring surface is the
  client, which fills every field mechanically. An agent writing a store file by
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
  comments" would hide the boxholder's words, which is the same reasoning
  `exhibits/disposition.ts:25-31` uses for a disposition that does not parse.
- **Fabricated free-form value** — *ADDRESSED by guidance.* An agent that
  "transcribes out" a comment into the document could paraphrase it into
  something the boxholder did not say. The store keeps `body` and `quoted`
  verbatim until an agent clears them, so the original is checkable, and the
  Track 5 guidance says to quote rather than paraphrase when folding a comment
  into a document.
- **Validation error UX** — *ADDRESSED.* Every refusal names the concrete thing:
  the environment variable, the file path, the escape attempt. Principle 4.
- **Partial migration / transition state** — *ADDRESSED.* Nothing existing
  changes shape; the store is net-new. The only transition is worktrees created
  before the mount exists, which self-heal on resume exactly as the exhibits and
  private-issues mounts do (`bin/lib/worktree-create.sh:136-138`).

## NOT in scope

- **Threads and replies.** A comment is one remark. A conversation belongs in
  chat, where it already works.
- **Resolution state.** No `state` field. Git is not the record here and neither
  is a status column; an agent reads a comment, acts, and clears it.
- **Re-anchoring, fuzzy matching, and comment maintenance.** Cut on the
  boxholder's framing and on the Hypothesis performance evidence.
- **Retaining audio.** Discarded on transcription. Accepted consequence stated
  in Track 4.
- **Comments on box cards.** That ground belongs to
  `issues/exploration/2026-08-01-questions-as-inline-annotations.md`, which is
  committed-to-git annotations inside cards, with a thread model and an agent
  resolver. Different persistence class, different vocabulary. This plan
  deliberately does not name its records "annotations" or "questions" to keep
  that space clear.
- **Comments anywhere but router-rendered dev surfaces.** Not the box frontend,
  not the exhibits origin, not chat.
- **Any path to git or to main.** The store never merges. `*.comments.yaml`
  never becomes a tracked pattern.
- **Multi-user.** One boxholder, one machine, no identity field.
- **Syncing comments between machines.** Explicitly local.

## Open design questions

- **The `SessionStart` line (Track 5, layer 4).** It is what makes discovery
  automatic instead of documented, and it is also a new hook on every session
  start. Lean: include it, gated to print only when the store is non-empty. The
  boxholder has not weighed in.
- **Should `bin/comments clear` exist as a verb, or should agents edit the file
  directly?** Lean: the verb, because it makes "I have handled this" a single
  legible action rather than a hand-edit that can corrupt the file (which is the
  one accepted silent failure above).
- **Should the doc browser sidebar show a comment count per document?** Lean:
  not in the first implementation. It is a second discovery surface, and Track 5
  already has four.

## Knowledge audits

**Skipped, with rationale.** Knowledge audits test what a **box agent** recalls,
by prompting a real box agent (`callback-box/docs/knowledge-audits.md`). Every
agent-facing concept this plan introduces — `bin/comments`, the store path, the
`comments` symlink — lives in the **dev repository's** guidance, which a box
agent never loads. An audit could not test it in either direction. The
equivalent verification here is Track 5's own doctests plus using the feature:
if an agent working in a worktree does not find the comments, layer 4 is the
answer, not an audit.

## Implementation order

1. **Store module and CLI** (Track 1). Root derivation, marker guard,
   containment, Zod schema, `bin/comments show|list|clear`. Independently
   useful; unblocks everything.
2. **Mount and gitignore** (Track 5 layers 1–2). Small, and makes chunk 1
   reachable from any checkout.
3. **Write API** (Track 2). The `comments.add` tRPC mutation. Depends on chunk
   1's store module.
4. **Document identity, heading ids and the script tag** (Track 3, router half).
   The only `bin/router-docs.ts` change in the plan, and the one that changes a
   shared signature — do it in one commit so no call site is left inferring an
   identity.
5. **Client library, display only** (Track 3). Renders comments written by
   chunk 1's CLI. Depends on chunks 3 and 4.
6. **Client library, typed capture** (Track 3). Depends on chunk 5.
7. **The transcription seam** (Track 4, server half). The `apiKey` field on
   `TranscribeAudioParams` in `callback-box`, the injected `transcribe` service
   in the app, and the `comments.transcribe` mutation. Independent of chunks
   5–6.
8. **Spoken capture** (Track 4, client half). Depends on chunks 6 and 7.
9. **Guidance** (Track 5 layers 3–4). The `CLAUDE.md` sentence, the reference
   doc, the `docs/secrets.md` line, and the `SessionStart` line if the boxholder
   wants it. Last, because it documents what the earlier chunks actually did.

## Rollout shape

**Where this code runs, and what that costs.** Both surfaces this plan touches
are main-checkout code. The router is (`bin/router.ts`), and so is the app — the
supervisor is pointed at `path.join(MAIN_ROOT, "workstreams-app")`
(`bin/router.ts:1511-1514`). A worktree's copy of either is never what the shared
router serves, so **nothing in this plan is exercisable end-to-end against the
shared router from a worktree**. Two consequences, both of which must be true
before the plan is called done:

- Development and testing run against an **isolated router** — `CALLBACK_STATE_DIR`
  plus `ROUTER_PORT`, with `CALLBACK_MAIN_ROOT` (`bin/router.ts:106`) pointed at
  the worktree so the supervisor picks up the worktree's app.
- The shared router picks the work up only after a merge to main, plus a router
  restart the boxholder performs. The plan's final verification happens there,
  not in the worktree.

**Test posture.** Doctests, named per codepath as part of designing it, in
`workstreams-app/test/` beside the existing suites (`exhibits-api.doctest.md`,
`server-boundary.doctest.md`) and in `bin/` for the CLI:

- `comments-store.doctest.md` — root derivation, marker refusal, containment
  against `..`/absolute/symlink escapes, Zod round-trip, malformed-file
  reporting.
- `comments-cli.doctest.md` — `show` with all three path spellings, `list`
  ordering, `clear` by id, a document that no longer exists.
- `comments-api.doctest.md` — the mutation's validation, concurrent writes to
  one document, the app-down client path, and two origins writing one
  repository-relative path.
- `comments-transcribe.doctest.md` — driven through the **injected** transcribe
  service, not `transcribeAudioHq` (which has no fake — `index.ts:142`): the
  success path, the missing-key refusal naming `CALLBACK_OPENAI_API_KEY`, and
  the transcription-error path that must leave the recording retryable.
- `comments-shell.doctest.md` — each `renderDevShell` caller passes the document
  identity the store keys on, and a non-commentable page passes the marker.
- `comments-anchor.doctest.md` — `generateFragment` `AMBIGUOUS` handling, and
  resolving a stored fragment against edited text.

**Done-when**, as checkable assertions rather than a feeling: those six suites
pass; `bin/comments list` in a fresh worktree finds a comment written from a
browser in a different worktree; a spoken comment survives a forced
transcription failure and can be retried.

**Not covered by tests, by decision:** the `getUserMedia` secure-context path and
the actual microphone, which need a real browser and a real device. Checked by
hand once, and the control states its own state (principle 13) so a later failure
is visible rather than mysterious.

**Migration.** None. Nothing existing changes shape; the store is net-new and
starts empty.

**Cross-model review.** This plan touches more than one surface (router, app,
CLI, shell scripts) and introduces a vocabulary, so it gets a `/cross-model`
review before implementation starts, per the monorepo `CLAUDE.md` rule.
