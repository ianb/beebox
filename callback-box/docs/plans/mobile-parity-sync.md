# Mobile parity & contract-sync discipline

**Status:** active — process plan for keeping the iOS app, the planned Android app
(`docs/plans/android-companion-app.md`), and the box-side mobile contract in
lockstep. This plan creates artifacts and procedures, not features.

Two native apps against one web/server contract will drift unless drift is made
mechanically visible. This plan layers five mechanisms, cheapest-first: a
canonical contract document, shared golden test fixtures, a parity matrix, a
manual agent checklist that fires on every contract-surface change, and a
periodic re-derivation audit. The deliberate stance is **arrange context for an
agent's judgment, not automate the judgment away**: the hooks and fixtures
detect drift; deciding what to do about it stays an agent/boxholder step.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#4 resilient and never silent** — drift
  between the platforms must fail a test or block a commit, never surface as a
  quietly divergent app; **#8 one way to do each thing** — the platform-neutral
  bridge surface (one posting function, one contract doc) shrinks the area that
  *can* drift; **#10 testability is architectural** — contract shapes live in
  fixtures precisely so each platform's thin parser is the only untested glue.
- Root `CLAUDE.md` "new infrastructure isn't done until it's discoverable" — the
  contract doc and matrix are registered in the Guides table, and the checklist
  lives where an agent touching the surface will be pointed at it.
- Boxholder preference: manual agent steps are acceptable and expected; the
  discipline should bias strict (blocking tripwire with an explicit, signaled
  override, not an advisory warning).

## The artifacts

### 1. `docs/mobile-contract.md` — the canonical contract (exists)

The single source of truth for every native↔box touchpoint: wire shapes,
mirrored string constants, implementation anchors on each side, and loud-vs-
silent drift behavior, indexed in its Contract Surface Index table. Seeded
2026-07-17 from a full code-derived inventory.

**The rule:** any commit that changes a contract surface — a wire shape, a
mirrored constant, a channel name, an endpoint the native apps call, the
`nativeComposer` embedding behavior — updates `docs/mobile-contract.md` in the
same commit. The doc is the contract; the code implements it. A contract change
that skips the doc is the root failure this whole plan exists to prevent.

### 2. `test/mobile-contract/fixtures/` — shared golden fixtures (to build)

Cross-language test vectors, JSON files consumed by all three test suites:

- **TS doctests** (canonical consumer) — a `test/mobile-contract/` doctest
  loads each fixture and runs it through the real web-side code
  (`nativeEmissionFromDetail`, `parseNativeImages`, receipt shapes, the
  pairing deep-link builder).
- **iOS XCTest** — fixtures added to the test bundle by folder reference; a
  thin Swift harness decodes each fixture and asserts the native
  encoder/decoder produces/accepts it.
- **Android JUnit** — a Gradle test-resources `srcDir` pointing at the same
  directory; same thin-harness pattern in Kotlin.

Initial fixture families (each a directory of `<case>.json` with `input` +
`expected`, valid and malformed cases both):

- `emission/` — the native-emission JSON (`{id,text,origin,diarized,images}`),
  including malformed-image cases that must be dropped.
- `receipt/` — the three dispositions (`sent`/`queued`/`rejected`) with their
  per-disposition fields.
- `location/` — request `{id}` and result `{id,success,message}` shapes.
- `pairing-url/` — `callbackbox://pair` parse cases: param aliases, missing
  scheme/host rejection, debug-only `authToken` handling (a fixture flag marks
  debug-gated expectations).
- `redeem/` — request/response bodies for `/api/pairing/redeem`, including the
  fields a client may ignore.
- `speech-keywords/` — the existing mirrored keyword-detection vectors
  (`SpeechKeywordsTests.swift` already hand-mirrors a TS doctest — the
  precedent this generalizes; fold those vectors into fixtures so the mirror
  is a file, not a transcription). **Scoped to the platforms that implement
  voice keywords — web + iOS today; Android v1 deliberately has none**
  (record-and-upload voice, no on-device keyword commands), so Android does not
  consume this family; the parity matrix, not a failing fixture, tracks that
  divergence.

A contract change then has one mechanical shape: edit the fixture(s) once, and
every platform's suite fails **for the cases the fixtures represent** until its
implementation catches up. The residual the fixtures can't catch mechanically —
**additive fields and leniency drift that a permissive decoder swallows
silently** — is named here and assigned to the periodic audit (mechanism 6), not
pretended away. Accordingly, fixtures test the two directions differently:
canonical **encoders** are asserted **strictly** (byte/shape-exact output), while
**decoders** are asserted **per the documented compatibility policy** — lenient
exactly where the contract says lenient (e.g. the native-emission parser,
`docs/mobile-contract.md` §4.1). A platform that can't be updated in-session fails
visibly, not silently.

### 3. `docs/mobile-parity.md` — the parity matrix (to build)

A feature × platform table: `web-contract | iOS | Android`, each cell one of
`done | planned(<issue link>) | divergent(<reason>) | n/a`. Deliberate
divergences are first-class entries with their rationale, e.g.:

- Live dictation partials + voice keyword commands: iOS `done`, Android
  `divergent` (SpeechRecognizer mic exclusivity; record→HQ-transcribe instead).
- Token storage: Android Keystore-encrypted, iOS `divergent` until
  `issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md` lands.
- Loud pairing-failure UI: whichever platform ships it first, the other gets a
  `planned` cell pointing at a parity issue.

The matrix is the answer to "what does the other platform do here?" without
re-reading both codebases, and the work-queue for closing gaps.

## The procedures

### 4. The contract-change checklist (manual agent step, every time)

Recorded at the top of `docs/mobile-contract.md` so any agent sent to a
contract surface sees it. When a change touches a contract surface **or**
implements a mobile feature on one platform:

1. Identify which Contract Surface Index rows the change touches.
2. Update `docs/mobile-contract.md` (shapes, anchors, constants) in the same
   change.
3. Update the affected fixtures under `test/mobile-contract/fixtures/` in the
   same change.
4. Implement on both platforms if in scope for the session. Otherwise file
   `issues/features/YYYY-MM-DD-<platform>-parity-<slug>.md` listing exactly
   what to mirror (index rows, fixtures, UX notes), and set the parity-matrix
   cell to `planned` with the issue link.
5. Run what runs here: the TS doctests and `./gradlew test` run on any dev
   machine/CI; XCTest needs a Mac with Xcode — run it when available, and when
   it can't be run, say so in the commit/summary rather than implying it
   passed.
6. Update `docs/mobile-parity.md` if any cell changed.

### 5. Two-hook tripwire: pre-commit path check + commit-msg trailer override (to build, small)

A check in the family of `doc-check`/`path-leak-check`: the anchor manifest —
the file list distilled from the Contract Surface Index (the bridge, auth,
pairing, and native-shell files on all three sides, deliberately small) — is
checked against the staged file list. If a commit touches an anchor file but not
`docs/mobile-contract.md`, that is a violation.

**The mechanism spans two hooks, because a pre-commit hook runs before the commit
message exists and so cannot read a `Contract-Unchanged:` trailer.** The path
check stays in **pre-commit**: a staged anchor file with no staged
`docs/mobile-contract.md` records the pending violation to a temp state file (and
lets the commit proceed to the message step). A **new `.husky/commit-msg` hook**
(the repo currently has none — this adds the first one) then validates the
override: if a violation is pending, the commit **passes only if the message
carries a `Contract-Unchanged: <reason>` trailer**, and is **blocked** otherwise
with a message naming the touched anchors and the two ways out — update the
contract doc, or add the trailer for a change that genuinely doesn't alter the
wire surface (refactors, comments). Blocking-with-signaled-override rather than
advisory, per the strict bias; the trailer leaves an audit trail `git log --grep`
can review.

(A simpler variant checks a `CB_CONTRACT_UNCHANGED=<reason>` env-var directly in
pre-commit, logged into the commit as the trailer by convention. **Decision: the
commit-msg-hook variant** — it is auditable in the commit itself and can't be left
set in a shell to silently bypass every future commit.)

The manifest lives in the contract doc itself (a fenced list the check parses),
so adding a surface and adding its tripwire are one edit. **Residual gaming
risk:** touching `docs/mobile-contract.md` trivially (a whitespace edit) satisfies
the path check without a real doc update — this is assigned to the periodic audit
(6), which compares the doc against the code rather than trusting that it changed.

### 6. Periodic parity audit (manual agent procedure)

After any burst of mobile work, and otherwise on the `docs/maintenance.md`
cadence: an agent re-derives the contract from the code — exactly the exercise
that produced the 2026-07-17 inventory — and diffs it against
`docs/mobile-contract.md` and `docs/mobile-parity.md`. This is the backstop for
what the tripwire cannot see: semantic drift inside an anchor file whose doc
update was wrong, new surfaces added outside the manifest, and fixtures that
were updated to match a bug rather than the intent. The audit prompt is short
and stable:

> Read `docs/mobile-contract.md`. Independently map every touchpoint between
> `ios-app/`, `android-app/`, and the box (pairing, auth, webview embedding,
> bridge channels, direct HTTP, server mobile-awareness) from the code alone.
> Report every disagreement with the doc, every mirrored constant that no
> longer matches across platforms, and every parity-matrix cell that misstates
> reality. Do not edit anything; report.

Findings route through the normal issue queue.

## What keeps the surface small (design stance, not procedure)

The cheapest contract to sync is the one with the least platform-specific
area. Two standing rules, enforced in review rather than by tooling:

- **Platform glue lives in the native-authored startup script.** The web-side
  JS calls one neutral surface (`window.callbackboxNativePost`, the queue
  globals); how a message physically crosses (WKScriptMessageHandler vs
  WebMessageListener) is each platform's startup-script problem. Web code that
  mentions a platform by name is a review flag.
- **Native code touches only stable contracts** (the umbrella plan's design
  invariant): the contract doc's index is the complete list of what native may
  call; a native feature that needs a new box surface adds it to the index
  first.

## Failure modes

| What can fail | Caught by | Handling | Clear-or-silent? |
|---|---|---|---|
| Contract change lands without doc update | Tripwire (5): pre-commit flags, commit-msg blocks | Update doc or `Contract-Unchanged:` trailer | Clear at commit time |
| Contract change, doc updated, one platform not updated | Fixture edit fails that platform's suite (2); checklist step 4 files a parity issue | Parity issue + matrix `planned` cell | Clear — red test or tracked issue |
| Semantic drift inside an anchor file with a wrong/stale doc edit | Periodic audit (6) | Issue filed from audit report | Clear at audit cadence, silent between audits (accepted) |
| New surface added outside the anchor manifest | Audit (6); review of the "index first" rule | Add to index + manifest | Silent until audit — the known weakest point; kept acceptable by the small-surface rules |
| Fixture updated to match a bug, both platforms "pass" | Audit (6) compares against intent, not fixtures | Issue + fixture fix | Silent until audit (accepted; fixtures are still reviewed diffs) |
| XCTest not runnable in a Linux/CI session | Checklist step 5 requires saying so | Deferred run, stated plainly | Clear — never implied-passed |
| Tripwire trailer abused as a routine bypass | `git log --grep 'Contract-Unchanged'` reviewed in the audit | Raise with boxholder | Clear in audit |
| Anchor file touched, doc "updated" trivially to pass the path check | Periodic audit (6) compares doc to code | Issue filed from audit report | Silent until audit (accepted; matches the trailer-abuse residual) |
| Android app changes wire behavior in a release build only (R8) | Fixture suites run on release-mode CI build (Android plan, Rollout) | kotlinx.serialization codegen; keep rules | Clear if the release-build test lane exists; silent without it — the Android plan owns that lane |

## NOT in scope

- **Automating the judgment.** No bot that auto-edits the contract doc or
  auto-generates platform code from the fixtures. The fixtures pin shapes;
  humans and agents decide semantics.
- **A shared cross-platform code layer** (KMP, codegen from a schema IDL).
  Revisit only if the index grows well past its current ~17 rows; at this
  size, discipline is cheaper than a toolchain.
- **Syncing UI look-and-feel.** The matrix tracks capabilities and contract
  behavior, not pixel parity; each platform follows its own idiom.
- **Server API versioning/negotiation.** Both apps ship from this repo against
  the current contract; the capture-mode plan's capability-advertisement
  pattern (`capabilities.acceptedAudioFormats`) is the model *when* a surface
  needs staged rollout, adopted per-surface, not globally here.

## Open design questions

- **Should the tripwire also watch `android-app/` and `ios-app/` bridge files,
  or only box-side files?** Lean: all three sides' anchor files — the manifest
  is per-file, and native bridge files change rarely enough that the friction
  is low.
- **Fixture format: one JSON per case vs one file per family?** Lean: one file
  per case — smaller diffs. A malformed-payload case is **not** a
  deliberately-broken file: each case is a well-formed JSON file with `input` +
  `expected`, so a malformed payload lives as the `input` value — a **string**
  carrying the malformed payload (or an escaped embedded document) — and
  `expected` records the lenient decoder outcome.
- **Where does the audit cadence live?** Lean: a one-line entry in
  `docs/maintenance.md` pointing here, rather than a scheduler artifact.

## Implementation order

1. `docs/mobile-contract.md` (done 2026-07-17) + Guides-table registration.
2. `docs/mobile-parity.md` seeded from the contract index + the Android plan's
   deliberate divergences (can land with the Android plan, before any Kotlin).
3. Fixtures: extract `speech-keywords/` from the existing mirrored tests, then
   `emission/`, `receipt/`, `pairing-url/`; wire the TS doctest consumer and
   the XCTest harness. (Android's consumer lands with the Android app's first
   test chunk.)
4. The pre-commit tripwire + anchor manifest.
5. `docs/maintenance.md` entry for the periodic audit.

Steps 1–2 are documentation; 3–4 are small code; each is independently
useful — this plan does not block the Android plan's Track 0, which only needs
the contract doc to exist.
