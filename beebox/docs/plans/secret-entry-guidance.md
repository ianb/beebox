---
title: "Secret entry that explains itself: guided names, grant on add, and a paste that activates"
status: draft
workstream: openrouter-services
issues:
  - ../../../issues/features/2026-09-09-secrets-add-form-hides-the-names-that-work.md
  - ../../../issues/bugs/2026-09-09-hq-transcription-fails-silently.md
---
# Secret entry that explains itself

> When I have an OpenRouter key on my clipboard, I want to open the box's
> Admin page, see that this is the place for it, read what it will turn on and
> where I'd get one if I didn't, paste it, and be done — with search, audio
> questions, the HQ transcript pass, and the Gemini voice all working on the
> next try, and no second step I did not know about.

Today none of that holds. The page leads with a "grant an existing secret"
dropdown that reads as the add form and does not list `openrouter`; the real
add form has a free-text Name with placeholder `e.g. weatherapi`; a saved key
reports success while granted to no box; and a box then configured for a
service that needs the key fails every pass in silence. The boxholder's
verdict on 2026-09-09, filed verbatim: *"It's all pretty bad."*

**Issues addressed:**
[secrets-add-form-hides-the-names-that-work](../../../issues/features/2026-09-09-secrets-add-form-hides-the-names-that-work.md)
in full, and the picker half of
[hq-transcription-fails-silently](../../../issues/bugs/2026-09-09-hq-transcription-fails-silently.md)
(both halves: the picker that offers a choice that cannot work, Track 5, and
the silent 500, Track 6 — the issue says all three of its fixes get done, and
this plan does them). `bin/issues similar`
also surfaced
[write-only-secret-capture-in-chat](../../../issues/features/2026-07-19-write-only-secret-capture-in-chat.md),
which is the chat-side entry path; the guidance registry built here is the
text that flow would show too, but the flow itself is not built.

## Stated preferences this plan trades against

- **Principle 13, a control shows the state the system is in**
  (`docs/engineering-principles.md:151`): *"An affordance may display only what
  is actually true."* "Saved. The provider accepted this credential." was true
  and misleading: the box still could not see the key. The success message
  must state the grant.
- **Principle 4, never silent** (`docs/engineering-principles.md:49`): a typo
  in a secret name today produces a stored secret nothing reads, with no
  signal. A near-miss warns.
- **Principle 8, one way to do each thing** (`docs/engineering-principles.md:95`):
  three server-owned registries already answer per-name questions
  (`uses.ts`, `probe-registry.ts`, `format-registry.ts`), all keyed through
  `name-match.ts`'s `lookupByName`. The guidance this plan adds is a fourth
  entry in that pattern, not a new mechanism — and every "what is it used for"
  string comes from `uses.ts`, never duplicated into the guide.
- **Secret custody's own guidance layer**
  (`docs/implemented-plans/secret-custody.md:439-444`): *"Guidance: the capture
  widget's `description` carries an agent-written walkthrough (where to obtain
  the key, what it looks like, what it will be used for)."* The design already
  named these three things; it assigned the writing to an agent at capture
  time. This plan makes the walkthrough for the names the engine itself
  recognises server-authored and permanent — the same discipline the probe
  registry applies (`probe-registry.ts:6-10`: server-owned because an
  agent-supplied entry would be an exfiltration path; a guide's URL is likewise
  something an agent must not be able to point elsewhere).
- **Precedent, denser than docs**: the Telegram section on the same Admin page
  (`src/frontend/src/components/admin/TelegramSection-views.tsx:86-109`) is
  already the shape the boxholder is asking for — numbered "Setup steps",
  what the token looks like, one paste field, one button. Secrets should look
  like the thing next to it.

## What already exists

- **The add and grant forms.** `SecretsSection-forms.tsx:75-166`
  (`SecretValueForm`: Name with placeholder `e.g. weatherapi`, Value, Note,
  Used for, "Save and verify") and `:174-236` (`GrantExistingForm`: a dropdown
  of machine names not yet granted here, plus an Access select). Reuse both;
  the change is what they offer and in what order.
- **`setValue` and `grant` are separate mutations**
  (`src/webapp/trpc/routers/secrets.ts:132-166`). `setValue` returns
  `{ warnings, verified }` and never grants. Reuse `setValue`; extend it.
- **Three registries, one lookup.** `uses.ts:48-93` (12 names, what each
  powers), `probe-registry.ts:92-129` (live verification), `format-registry.ts:50-82`
  (shape hints, served to the UI by `secrets.formatHints`). All resolve through
  `lookupByName` (`name-match.ts:16`). The guide registry uses the same key
  scheme and the same lookup.
- **`openrouter` has a probe and uses but no format entry** — the one
  provider key with no paste-time shape check. Add one.
- **Access default.** `docs/secrets.md:52`: *"`server` (default, and all
  built-in connectors need only this)"*. Grant-on-add defaults to `server`.
- **Stable control ids.** The Secrets scope toggles and add toggle carry
  `bbx-admin-secrets-*` ids; the form's four fields do not (a `bin/browse`
  snapshot shows `ref=e55…e59` only). Add them, so the flow can be driven and
  tested.
- **Availability is already computed once.** `health-model-routes.ts`
  resolves "does this box have a credential that reaches service X" for the
  health line. The pickers can ask the same question; nothing new is derived.

## Prior art (external)

- **Every provider's "create a key" page is a stable URL** — OpenRouter
  `https://openrouter.ai/settings/keys`, OpenAI
  `https://platform.openai.com/api-keys`, Anthropic
  `https://console.anthropic.com/settings/keys`, Google AI Studio
  `https://aistudio.google.com/app/apikey`, Mistral
  `https://console.mistral.ai/api-keys`, Deepgram
  `https://console.deepgram.com/`. These are the "where to get it" links; they
  are provider-owned and will occasionally move, which is a link going stale,
  not a failure (Failure modes).
- **OpenRouter key shape**: `sk-or-v1-` then 64 hex characters, 73 in all
  (observed on the key used throughout this workstream; OpenRouter's `/key`
  endpoint labels keys `sk-or-v1-…`). Format entry: prefix `sk-or-v1-`, min 40,
  max 200 — loose on purpose, per the registry's warn-never-block rule.
- **Did-you-mean on identifiers**: normalise-then-compare (case-fold, strip
  non-alphanumerics) turns `OpenRouter`, `openrouter.ai`, and `open-router`
  into `openrouter`. Edit distance is not needed for the errors actually made
  and would start matching `openai` to `openrouter`, which is worse than no
  suggestion. Searched for an in-repo fuzzy matcher: none — `name-match.ts` is
  exact-or-prefix only.

## Tracks / scope

### Track 1 — paste means "use it here"; granting becomes the advanced case

**What.** From the "This box" tab, saving a new secret makes it this box's in
the same submit, and the message says what is now switched on. The word
"grant" leaves the primary path entirely.

**Why.** The boxholder's framing, 2026-09-10: *"The whole grant thing is
confusing. Like it's an advanced case: multiple boxes, going to a secondary
box and borrowing a token from another box. Granting should be treated as
secondary."* That is the right model. A grant is real machinery — one store,
many boxes — but for the box the boxholder is looking at, pasting a key and
having it work is the whole job, and the machinery should be invisible until
a second box exists. This is also the issue's "honest fix": a verified key
granted to nothing, reported as success, was the failure hit twice.

**Direction.** Extend `setValue` (`secrets.ts:132`) with an optional
`grant?: { box: string; access: SecretAccessLevel }`; when present, the
mutation calls **`setAndGrantSecret`** (`lifecycle.ts:194-235`), which already
exists and does both writes under one store lock — *"there is no window in
which the value exists ungranted"* — rather than `setSecret` then
`grantSecret`. (An earlier draft of this plan claimed the router's `lifecycle()`
wrapper serialised the two; it does not — `secrets.ts:53-62` only maps
`SecretLifecycleError` to a `TRPCError`. Cross-model review caught it.)
`setAndGrantSecret` gains the `uses` and `formatHint` fields `setSecret`
takes, and the router awaits `probeSecret` after it as `setValue` does today
instead of the background probe the lifecycle op fires. The response carries
`granted: { box, access } | null` **from the committed write**, alongside
`warnings` and `verified`.

The add form does **not** gain an Access select. The grant is made at
`server`, which `docs/secrets.md:52` calls the default that *"all built-in
connectors need only"*; raising a key to `agent` for a box-authored view is
the existing Raise-access button on the row, and it stays there. The
Machine-wide tab's add form sends no `grant`.

The post-save line speaks in terms of what the key now does, which is the
truth the boxholder is waiting for (principle 13), and uses `uses.ts` for the
list rather than restating it:

- *Saved and verified. This box now uses it for: embeddings for semantic and
  hybrid card search; the Whisper high-quality transcription pass; …*
- *Saved, but the provider rejected it: … This box will use it once the value
  is fixed — Rotate to replace it.*
- Machine-wide tab only: *Saved and verified. No box uses it yet.*

The grant-existing form becomes the advanced case in fact, not just in order:
collapsed under a disclosure at the bottom of the "This box" tab, labelled
*"Use a key another box already has"*, and rendered only when the machine
holds at least one secret this box does not — on a one-box install it does
not appear at all. Its access select stays inside the disclosure. The "Used
for (optional)" free-text field moves into the same disclosure: for a
registered name the uses are already known, and asking for them again on the
primary path is noise.

**Vocabulary lock-ins.** `setValue.input.grant`, the response field `granted`
(the machinery keeps its name at the API; only the boxholder-facing copy drops
it), the disclosure id `bbx-admin-secrets-advanced`.

**First implementation chunk.** The mutation extension plus its route doctest
(grant present → grant exists; absent → not), then the form change. No
registry work.

### Track 2 — the guide registry

**What.** A server-owned, per-name walkthrough: what the key is, where to get
one, what it looks like — the three things custody's guidance layer named.

**Why.** Nothing in `src/` says where to obtain any key or what any name means
to the engine (the reconnaissance found no such string anywhere). The
boxholder's ask is literally these three things on the page.

**Direction.** `src/core/secrets/guide-registry.ts`:

```ts
export interface SecretGuide {
  /** "OpenRouter API key" — the noun a person would search for. */
  title: string;
  /** One or two sentences: what this credential is, in the boxholder's terms. */
  what: string;
  /** The provider's key-management page. */
  obtainUrl: string;
  /** Numbered steps, in the Telegram section's register. */
  obtainSteps: string[];
}
const guides: Record<string, SecretGuide> = { openrouter: {…}, openai: {…}, … };
export function secretGuideFor(name: string): { key: string; guide: SecretGuide } | null; // via lookupByName
export function listSecretGuides(): Array<{ key: string; guide: SecretGuide }>;
```

Served by a new `secrets.guides` query (read-only, `authenticatedOwnerProcedure`
like its siblings) that returns, per name, the guide **together with**
`builtinSecretUses(name)` — the join happens on the server, because `uses.ts`
imports `mutateSecretStore` (`uses.ts:41`) and cannot be pulled into the client
bundle. **"What it is used for" is still not a guide field**: it is read from
`uses.ts` at query time, so a new call site's use appears without touching the
guide. Entries for every name in
`uses.ts` that a boxholder would paste (the provider keys and the Google OAuth
pair); `telegram-bot/` and `publish/` are provisioned by their own flows and
get a guide that says so and points there.

The OpenRouter guide's `what` makes the consolidation argument in one breath:
one key, one bill, and the list of what it turns on — because that list is the
reason to paste it at all.

**Vocabulary lock-ins.** `SecretGuide`, `secrets.guides`.

**First implementation chunk.** The registry with all entries and a doctest
asserting every `uses.ts` name has a guide (so the two cannot drift apart),
plus the query. No UI.

### Track 3 — the add form offers the names and explains the chosen one

**What.** The Name field becomes a picker of registered names with free text
still allowed; choosing one renders its guide, its uses, and its format hint
above the Value field; a near-miss is caught before save.

**Direction.**

- **The registered names are the first thing on the tab**, as a row of
  buttons the box does not yet hold a key for — *OpenRouter*, *OpenAI*,
  *Gemini*, … — plus *Something else*. That is the Telegram section's shape
  generalised: one affordance per thing you can connect. Choosing one opens
  the add form with the name fixed and the guide panel above the Value field:
  title, `what`, "Used for:" (from `uses`), numbered `obtainSteps` with
  `obtainUrl` as a link, and the format hint moved up from the Value field's
  helper. Value placeholder derives from the format entry (*"sk-or-v1-…"*).
  (An earlier draft used a `<datalist>`; review pointed out that a datalist's
  option labels are browser-dependent and a free-text path still lets
  `OpenRouter` save as an ignored name if the warning is missed. For the
  primary path the name should not be typeable at all.)
- *Something else* opens the same form with a free-text Name, which is where
  the near-miss check applies.
- Near-miss: a pure `suggestSecretName(typed, knownNames)` — normalise both
  sides (lower-case, strip everything but `[a-z0-9]`), return the registered
  name on a normalised match that is not an exact match. The form shows
  *"Did you mean `openrouter`? Nothing reads a secret named `OpenRouter`."*
  with a one-click accept. Warn, never block: `openrouter2` saves as typed.
- `bbx-admin-secrets-add-name`, `-value`, `-note`, `-uses`, `-access`,
  `-submit` ids on the form controls.

**Vocabulary lock-ins.** `suggestSecretName`, the six control ids.

**First implementation chunk.** `suggestSecretName` and its doctest (the
three realistic typos, an exact match returning null, a genuine new name
returning null). Then the form.

### Track 4 — `openrouter` gets a format entry

One line in `format-registry.ts`: prefix `sk-or-v1-`, min 40, max 200, hint
*"An OpenRouter API key, starting with `sk-or-v1-`."* Its own track only so
the doctest that walks the registry has a named home for the assertion.

### Track 5 — pickers show what the box can actually use

**What.** The HQ-transcription and TTS pickers in the voice menu mark options
the box has no credential for, instead of offering a choice whose only outcome
is a 500 on every pass.

**Why.** The boxholder, 2026-09-09: *"Even being able to select the model
without the key is wrong."* And it is the other half of "pasting it in should
make all that stuff active": after Track 1 the grant exists; this track is what
makes the pickers reflect it.

**Direction.** A per-name `secrets.boxHas` is the wrong seam — the question is
per service, not per name. A new `core/model-capabilities.ts` answers it:
`serviceCapabilities(boxRoot)` returns, for every HQ transcription service and
every TTS backend, `{ usable: boolean; needs: SecretName[] }`, derived from the
same key-per-service facts the dispatchers use (`transcription/index.ts`
`dispatchHqTranscription`, `tts/resolve.ts` `credentialFor`). It is **not**
built on `health-model-routes.ts`, whose `modelRoutesCheck` returns nothing at
all when the box has no OpenRouter key (`:31-34`) and so cannot describe an
unavailable state — review caught that reuse claim as false.

It is served by a new **`ownerProcedure`** query, `voice.capabilities`, not
folded into `transcription.config` / `tts.config`: those are `publicProcedure`
(`transcription.ts:24`, `tts.ts:21`) because the chat shows the selected
service to everyone, and whether this box can resolve a provider credential is
not public metadata. `ownerProcedure` (box owner, `trpc.ts:39`) is the right
tier — it is box-scoped grant metadata, not the store.

The pickers render unavailable options disabled with *"needs the `openrouter`
secret — Admin → Secrets"*. The server keeps accepting an unusable value (a
grant may arrive later, and refusing would make the setting order-dependent)
**but the `setHqService` / `setBackend` mutations return `{ warning }` when the
chosen service is not usable right now, and the client shows it** — the
issue's stated floor (*"save it with a warning the boxholder has to
acknowledge"*, `hq-transcription-fails-silently.md:88-90`), so a stale client
or a script cannot persist an impossible setting silently.

**Vocabulary lock-ins.** `serviceCapabilities`, `voice.capabilities`, the
`warning` field on the two set mutations.

**First implementation chunk.** `serviceCapabilities` with a doctest against a
tmp box with and without an `openrouter` grant.

### Track 6 — a permanent HQ failure is shown, once

**What.** When the HQ pass fails with a permanent error, the boxholder sees it
— once, on the voice chip — instead of silently getting realtime-quality text.

**Why.** This was NOT in the first draft, and review was right to flag that
leaving it out contradicted the issue's own priority — the boxholder's words:
*"The silent failure is the more serious of the two."* It also directly
undermines the requirement this plan exists for: if the key is pasted, the
service selected, and the pass still fails silently, nothing has become
"active" in any way the boxholder can see.

**Direction.** `POST /api/chat/transcribe-audio` already returns the error's
message as a 500; it additionally returns `{ error, code, permanent }` from the
`TranscriptionError` it caught (`chat-audio-routes.ts`, the `transcribeAudioHq`
catch). `postAudioForHqTranscription` (`api-chat.ts:160-173`) keeps returning
`null` — the fallback is correct — but first surfaces a permanent failure
through a small `hqFailure` store the voice chip reads, showing the server's
message with a link to Admin → Secrets. Shown once per distinct `code` per
session; a transient failure (network, 5xx without `permanent`) stays a
console warning as today.

**Vocabulary lock-ins.** The `{ error, code, permanent }` body shape on that
route; `hqFailure`.

**First implementation chunk.** The route body change with its route doctest
(a `MissingOpenRouterKeyError` yields `permanent: true` and the code), then
the client surface.

## Could this be simpler?

**Simplest version:** Track 1 alone — paste-means-use-it-here, an honest
message, the grant form folded away. Under fifty lines. It fixes the failure
that actually cost the boxholder two debugging sessions.

**What it leaves broken, specifically:** the boxholder still cannot find where
the key goes or what to call it. The issue's own account is that the wrong
belief was formed *before* the grant step — at "which of these is the add
form" and "what name" — so Track 1 alone fixes the second trap and leaves the
first two. Tracks 2–3 are the ask as stated ("what it is, where to get it,
what it is used for"). Track 4 is one line.

**Tracks 5 and 6 are the cuttable ones** — a different surface (the voice
menu and chip) and a different issue. Recommend keeping both, because they are
the visible proof that pasting the key worked: without 5 the boxholder pastes,
opens the picker, and sees the same list as before; without 6 a wrong setting
fails forever in silence. If cut, that issue stays open and says so.

**One over-build avoided:** a semantic "did you mean" (edit distance) would
match `openai` ↔ `openrouter`; normalisation catches the errors that were
actually made and none that were not.

## Subplans

None. The guide registry is a decision about wording, not shape; the shape is
the three existing registries'.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Value saved but grant fails | to write (route doctest) | cannot happen: `setAndGrantSecret` does both in one locked write, and a refused write (e.g. another box owns the name) throws before either lands | clear |
| HQ pass fails permanently after the setting was saved | to write (Track 6 route doctest) | Track 6: `{ code, permanent }` through the body, chip notice once | clear once built; **silent today** |
| Near-miss suggests the wrong name (`openai` for `openaikey`) | to write (pure doctest) | warn-only; the typed name still saves | clear — a suggestion, not a rewrite |
| Registered name typed with no guide entry (registry drift) | to write: doctest asserts `uses.ts` ⊆ guides | form degrades to today's plain fields | clear-enough: nothing hidden, just less help |
| Provider moves its key page; `obtainUrl` 404s | none possible | — | silent to us, visible to the boxholder as a dead link — **accepted**; static text, provider-owned URL |
| Picker marks a service unavailable that would in fact work (e.g. a key granted at `agent` when `server` suffices) | to write (Track 5 doctest) | availability uses the same resolver the service does, so they cannot disagree | clear |
| Boxholder grants at `server`, later needs `agent` for a view | exists (`setAccess`) | Raise access button on the row | clear |

No critical gap: the one silent row is an external link going stale.

## Agent-flow / user-flow edge cases

- **Wrong field / wrong name** — ADDRESSED (Track 3 near-miss; datalist).
- **Stale ref** — not applicable; no card refs.
- **Two writers** — ADDRESSED by `setAndGrantSecret`'s single
  `mutateSecretStore` (`lifecycle.ts:203`): value and grant land in one locked
  write, so a concurrent resolve sees the old state or the new one, never a
  value with no grant.
- **Hand-edit drift** — n/a; the store is written only through the CLI and UI.
- **Fabricated free-form value** — ADDRESSED for names (warn on near-miss,
  free text kept); the value is opaque by design.
- **Validation error UX** — ADDRESSED: format warnings already return with
  success; the guide moves the hint to where the boxholder reads before
  pasting.
- **Transition state** — none: no data shape changes; existing secrets and
  grants are untouched. A box that already holds a machine-wide-only
  `openrouter` (the boxholder's actual state on 2026-09-09) is served by the
  grant-existing form, which now says what it is for.
- **The agent's path** — `bbx secrets declare` and chat capture are unchanged.
  The guide text is available to a future chat-capture flow but this plan does
  not wire it.

## NOT in scope

- **Chat-side write-only capture** (07-19 issue): the guide registry is the
  text it would show; the flow is its own work.
- **Merging Telegram's bespoke section into the secrets UI**: the precedent is
  right and the duplication is real, but folding it in is a connector-setup
  redesign.
- **Machine-wide tab changes** beyond keeping its add form grant-free. It is
  the multi-box view and therefore also "advanced", but it is a separate tab
  the primary path never enters, so it is left as is; if it still reads as
  confusing after this ships, that is its own item.
- **Retiring `GrantExistingForm`**: it still serves the multi-box case; demoted
  and retitled, not removed.
- **Edit-distance suggestions** — see Could this be simpler.

## Open design questions

- **Should the OpenRouter guide sell the consolidation, or only describe it?**
  Lean: one sentence of why ("one key and one bill instead of four") then the
  list of what it turns on. The list is the argument; a paragraph would be
  marketing on an admin page.
- ~~**Access select in the add form, or fixed at `server`?**~~ **Settled
  2026-09-10 by the boxholder's framing** (granting is the advanced case):
  fixed at `server`, no select on the primary path; Raise access stays on the
  row.

## Knowledge audits

Skip-with-rationale: this is boxholder-facing UI and server-owned prose; the
agent-facing secrets surface (`bbx secrets declare/describe`, the
`<secret-request>` flow) is unchanged, and no audit tests it today either.

## What will hold this after it ships

- `suggestSecretName` and the guide lookup are pure functions → pure-function
  doctests. The registry-completeness assertion (`uses.ts` names ⊆ guides) is
  what stops the two drifting; it lives in the same doctest.
- `setValue` with `grant` → the existing `secrets.ts` route doctest tier
  (`makeTestServer` + a tmp store via `BBX_SECRETS_FILE`, the pattern
  `test/core/secrets-key-readers.doctest.md` uses).
- `available` maps → filesystem doctest with `makeTmpBox` + `grantSecret`.
- The form itself has no unit tier (no frontend component tests); it is
  verified by driving it on test1. **The browse key cannot do this**: the
  Secrets panel is `authenticatedOwnerProcedure`, which deliberately excludes
  `source: "browse"` even on a box that opts agent browsing in as owner
  (`server-box-scope.ts:263-269`; `test/webapp/auth-required.doctest.md:150-178`
  proves the 403). The driven walkthrough therefore needs a real owner login
  (`bin/browse auth save owner …` with a credential the boxholder supplies —
  never one an agent invents or resets), or the boxholder drives it. Review
  caught this; the first draft assumed the key would do. The voice-menu
  pickers (Track 5) *are* reachable with the key, since they sit behind plain
  `ownerProcedure`.
- The before/after screenshots go in one exhibit with `ask: react`, since how
  the guide *reads* is the boxholder's judgement.

## Implementation order

1. Track 4 (one line) and Track 2's registry + completeness doctest.
2. Track 1: mutation extension + doctest, then the form and its message.
3. Track 3: `suggestSecretName` + doctest, then the picker and guide panel.
4. Track 5: `available` on both config queries + doctest, then the pickers.
5. Track 6: route body + doctest, then the chip surface.
6. Drive the whole path on test1 — with an owner login, see above: add an
   OpenRouter key from a fresh state, confirm the box uses it, confirm the HQ
   picker now offers `mai-diarized` enabled. Exhibit.

## Rollout shape

Tests named above; done-when is those passing plus the driven walkthrough
producing the intended end state on test1 (`openrouter` granted at `server`,
`transcription.config.available["mai-diarized"] === true`). No migration. No
audits. Ships as one piece.
