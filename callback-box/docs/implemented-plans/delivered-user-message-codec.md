# Exhaustive delivered-user-message codec

**Status:** implemented 2026-08 — shipped as the closed capture/upload delivery codec

This plan makes the supported server-delivered user-message vocabulary a closed TypeScript codec. It keeps the existing `<capture>` and `<upload>` wire strings, but it makes serialization, transcript parsing, test fixtures, and frontend rendering exhaustive over one discriminated union.

**Issues addressed.**

- `issues/bugs/2026-07-29-capture-chip-raw-tags-when-queued.md`
- Related shipped precedent: `issues/closed/bugs/2026-07-31-upload-message-invisible-in-chat.md`. That issue added upload parsing after production exposed the missing renderer. This plan replaces the independent capture/upload paths with one enforced protocol.

## Stated preferences this plan trades against

- Engineering principle 1, Types are structure. `docs/engineering-principles.md:12-18` says: *"Prefer types that make illegal states unrepresentable: discriminated unions over flat interfaces with correlated optional fields."* The delivery API will accept a discriminated union instead of an unclassified string.
- Engineering principle 2, Exhaustiveness is enforced. `docs/engineering-principles.md:20-34` says: *"Every dispatch over a closed set ... must fail to compile when a member is added."* The parser registry, serializer, and renderer will all dispatch exhaustively. The doctest fixture table pins runtime behavior but is not part of `tsc`'s source include.
- Engineering principle 3, Validate during parsing. `docs/engineering-principles.md:37-46` says: *"Disk reads, LLM output, HTTP bodies, third-party API responses, config files, and env vars each get validated into typed data exactly once, at the boundary."* Persisted transcript text is the parser boundary.
- Engineering principle 8, One way to do each thing. `docs/engineering-principles.md:93-100` says: *"Competing idioms are drift generators."* Capture and upload will share one serialization and parsing path.
- Engineering principle 11, Enforcement beats convention. `docs/engineering-principles.md:128-139` says: *"A rule that matters gets a lint rule or a type, not a paragraph."* Adding a new delivered-message kind must create compile errors at every required dispatch.
- Project testing convention. `CLAUDE.md:11-17` says: *"Tests are doctests (`.doctest.md`) in `test/`"* and *"Run tests before committing."* Pure codec behavior will remain in doctests.
- Mechanical exhaustiveness convention. `code-style.md:57-59` requires exhaustive switches and identifies `Record<Union, Handler> with satisfies` as the wide-dispatch idiom.
- Scope discipline. `CLAUDE.md:107-109` says: *"Read before writing. Don't guess file formats, XML structures, or API shapes."* This plan keeps the current wire vocabulary and does not redesign the full chat envelope.

## What already exists

- `src/core/chat/session/deliver-user-message.ts:107-118` accepts `message: string` and describes it as *"The wrapper message body (`<capture>`, `<upload>`, …)."* The plan leaves this plumbing seam unchanged because self-notes and other user-position messages can bypass it.
- `src/core/chat/session/deliver-user-message.ts:153-169` emits and enqueues the same message string. Existing capture and upload serializers continue to supply that string.
- `src/core/capture/deliver.ts:46-71` builds the exact capture wrapper. The plan retains its domain conversion from seconds and flags, but delegates wire serialization to the shared codec.
- `src/core/bulk-upload/deliver.ts:40-67` builds the exact upload wrapper. The plan retains its domain conversion from bytes, counts, and note, but delegates wire serialization to the shared codec.
- `src/frontend/src/components/chat/capture-message.ts:33-73` parses capture attributes and requires the wrapper to occupy the whole trimmed message. The plan moves the wire parser to the shared codec and removes the whole-message assumption.
- `src/frontend/src/components/chat/upload-message.ts:43-89` parses upload attributes but accepts a match anywhere in the text. The current renderer then returns only the chip. The plan replaces this lossy behavior with ordered parts.
- `src/frontend/src/components/chat/user-message.tsx:149-165` runs capture and upload parsers as independent early returns. The plan replaces these branches with one exhaustive part renderer.
- `src/shared/self-note.ts:33-76` is useful precedent. It recognizes multiple queued structured blocks and rejects mixed text so text is not silently hidden. The new codec differs because delivered messages must coexist with ordinary queued text, so it returns text and structured parts instead of an all-or-nothing result.
- `src/core/chat/session/start.ts:176-180` prepends the `<chat-app>` snapshot before SDK delivery. An actual persisted capture turn inspected during planning had the exact shape `<chat-app …/>\n<capture …>…</capture>`. The codec must strip the display-only snapshot before block recognition, as `src/shared/self-note.ts:45-49` already does.
- `src/webapp/routes/chat-send-routes.ts:373-380` constructs and sends `<self-note>` without `deliverUserMessage`. This proves that typing only `deliverUserMessage` would not enforce the complete user-position vocabulary.
- `test/frontend/capture-message.doctest.md` and `test/frontend/upload-message.doctest.md` already pin the exact wrappers and parsed models. The plan reuses their examples while moving the protocol contract to a shared doctest.

## Prior art (external)

- The TypeScript handbook documents discriminated unions and `never`-based exhaustive checking: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking. This matches engineering principles 1 and 2.
- TypeScript 4.9 documents `satisfies Record<Union, ...>` as a way to require exactly the keys of a union without losing narrow inference: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator. The fixture table will use this pattern.
- No external XML parser is appropriate. The current wire is an internal pseudo-XML vocabulary whose free-form bodies are deliberately not a general XML document. A third-party parser would expand scope without establishing provenance or exhaustiveness.

## Tracks / scope

### Track 1 — Shared delivered-message codec

**What.** Add `src/shared/delivered-user-message.ts`. It will define:

```ts
type DeliveredUserMessage = CaptureUserMessage | UploadUserMessage;

type DeliveredUserMessagePart =
  | { kind: "text"; text: string }
  | DeliveredUserMessage;

serializeDeliveredUserMessage(message: DeliveredUserMessage): string;
parseDeliveredUserMessageParts(text: string): DeliveredUserMessagePart[];
```

**Why this needs to change.** The current generic delivery function accepts any string. A new first-class wrapper can therefore ship without a corresponding parser or renderer. Capture and upload already demonstrated this drift in separate production bugs.

**Direction.** `CaptureUserMessage` and `UploadUserMessage` will contain canonical wire-level values. For example, a silent capture keeps `audio: "0:00"`; the chip derives the empty display segment from that value. A `Record<DeliveredUserMessageKind, Codec>` with `satisfies` will require every kind to provide its tag name and parse arm. Serialization will dispatch exhaustively over the same closed kind set. The parser will first strip `<chat-app>` snapshots. It will then recognize valid `<capture>` and `<upload>` elements only when each element occupies its own line block. It will return every unmatched user-visible byte as a text part. It will preserve order and support multiple delivered blocks in one combined queue turn. An invalid matched block remains text while scanning continues, so a later valid block still becomes a chip.

**Vocabulary lock-ins.** The `<capture>` and `<upload>` names, attributes, attribute omission rules, body layout, and serialized bytes remain unchanged. `kind: "capture" | "upload"` is an internal TypeScript discriminator and does not enter the transcript.

**First implementation chunk.** Add a red shared doctest that documents a fixture for every current kind with `satisfies Record<DeliveredUserMessageKind, ...>`. Assert exact serialization and canonical parse/serialize/parse equality. Also assert a sanitized snapshot-prefixed production turn, ordinary text, malformed wrappers beside valid wrappers, mixed queued text, same-line prose mentions, and multiple delivered blocks. Source typechecking, rather than the doctest file, enforces the closed kind dispatches.

### Track 2 — Centralized production

**What.** Move capture and upload wire construction behind the shared codec. Keep the delivery APIs string-based.

**Why this needs to change.** Generation and parsing currently live in separate backend and frontend modules. Co-locating the supported codecs makes their relationship discoverable and gives each union kind a required parse arm. `deliverUserMessage` is not a universal chokepoint, so changing only its type would promise enforcement it cannot provide.

**Direction.** Preserve the existing capture and bulk domain helper signatures or thin re-exports so call-site churn stays small. Their exact wrapper output will come from `serializeDeliveredUserMessage`. The at-most-once probes continue to search by `docPath`; the event-bus payload, session queue, storage, and agent input remain strings.

**Vocabulary lock-ins.** `chat-user-message.message` remains a string. `ChatSendInput.text` remains a string. No persisted transcript, HTTP, tRPC, WebSocket, or native bridge shape changes.

**First implementation chunk.** Delegate both existing wrapper builders to the shared serializer after the codec doctest is red. Update their exact-wrapper doctests to share the exhaustive fixtures where practical.

### Track 3 — Exhaustive, lossless frontend rendering

**What.** Parse each user text block into ordered parts. Render text through `UserMessageText`, capture through `CaptureChip`, and upload through `UploadChip`.

**Why this needs to change.** `user-message.tsx:149-165` currently returns one chip or one text view for the whole block. It cannot retain both. The upload parser's current substring match can also swallow surrounding text.

**Direction.** Add a small component with an exhaustive switch over `DeliveredUserMessagePart.kind`. The text case will keep existing tag stripping and inline selection/send pills. Capture and upload chips keep their existing visual components. Empty separator-only text parts will not add visible blank elements.

**Vocabulary lock-ins.** No chip copy, link, badge, color, or interaction changes. Only composition changes.

**First implementation chunk.** Replace the two independent parser branches in `UserEntryContent` after Tracks 1 and 2 pass their focused doctests.

## Could this be simpler?

The smallest fix is to strip `<chat-app>`, remove capture's whole-message guard, and render one chip plus two text spans. That fixes capture. It does not prevent the next supported delivered wrapper from missing a parse arm. It also leaves upload's substring parser able to swallow surrounding queued text. The closed codec adds one shared module, but it buys compile-time enforcement across the supported parse registry, serializer, fixtures, and renderer. That additional structure is justified by principles 1, 2, 8, and 11.

A larger design would parse every chat pseudo-XML tag into one AST. That includes `typed`, `speech`, `user-selection`, `attachments`, self-notes, schedules, and SDK-local command tags. Those tags have different owners, nesting, trust, and display lifecycles. A universal parser does not help this delivery bug enough to justify that rewrite. This plan therefore stops at server-delivered first-class user messages, per right-sized defensiveness and scope discipline.

## Subplans (when a sub-question needs its own design step)

No subplan is needed. The wire vocabulary is unchanged, and the closed scope has two existing variants and one shared delivery seam.

## Failure modes (the load-bearing section)

There are no unresolved critical gaps.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A normal persisted capture is prefixed by `<chat-app>` | Planned sanitized real-transcript fixture | Codec strips the display-only snapshot before scanning | Clear: capture renders as a chip |
| A capture is queued beside ordinary text | Planned shared codec doctest using the same blank-line shape as `combineQueuedInputs` | Parser returns text then capture parts | Clear: prose and chip both render |
| An upload is queued beside ordinary text | Planned shared codec doctest | Parser returns ordered parts instead of replacing the whole block | Clear: no prose is swallowed |
| Two delivered wrappers share one queued turn | Planned multiple-block doctest | Parser emits one part per block in source order | Clear: both chips render |
| A known wrapper is malformed or lacks `doc` beside a valid wrapper | Planned mixed malformed/valid doctest | Only the invalid matched block remains text; scanning continues | Clear: raw invalid input and valid chip both remain visible |
| Ordinary prose includes `<capture>` or `<upload>` on the same line | Planned prose-mention doctest | Standalone-block boundary rejects it | Clear: prose remains literal |
| A new union member is added without parsing, serialization, or rendering | Source typecheck is the test; the doctest separately pins current runtime fixtures | Codec record plus exhaustive serializer and renderer switches fail compilation | Clear: build fails |
| A rejected or unterminated opener precedes a valid delivered block | Shared codec regression doctest | Scanner resumes inside rejected spans and rejects candidates containing a nested standalone delivered opener | Clear: malformed/prose bytes stay text and the later delivery remains a chip |
| A user types bytes identical to a valid standalone delivered wrapper | No reliable provenance test is possible from transcript text alone | Parser treats identical bytes identically | Clear but ambiguous: it renders as structure; see NOT in scope |
| A chip's `doc` target later moves or disappears | Existing behavior; not introduced by this plan | Chip link can become stale | Clear on navigation failure, but unchanged |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** The supported codec record requires a parser for every union kind. Parser validation leaves malformed historical or manually typed wrappers visible as text. Arbitrary user-position strings outside this codec remain possible and are explicitly out of scope.
- **Stale ref — DEFERRED.** Chip target resolution is unchanged. This plan does not add document relocation or stale-link handling.
- **Two agents touching the same card — DEFERRED.** The codec does not modify cards or their concurrency behavior.
- **Hand-edit drift — ADDRESSED.** Transcript text with a malformed wrapper remains visible and is not partially swallowed.
- **Fabricated free-form value — DEFERRED.** Capture summaries and upload notes retain their current producers and trust model.
- **Validation error UX — ADDRESSED.** Runtime parse failure degrades to the original visible text. Backend construction errors remain invariant failures in the existing domain builders.
- **Partial migration / transition state — ADDRESSED.** Existing transcript strings use the same wire format and parse through the new codec. No data migration is required.

## NOT in scope

- A universal parser for all chat pseudo-XML. The composer envelope and system annotations have different contracts and do not pass through `deliverUserMessage`.
- Making `deliverUserMessage`, `ChatSession.send`, or `ChatSession.enqueue` accept only the closed union. These are not exclusive to delivered wrappers; self-notes and ordinary composer messages also use or bypass them. A universal typed session-input protocol is a separate design.
- A lint rule that bans handcrafted wrapper template literals. Such a rule may become useful if more delivered kinds appear, but it is not needed to fix or centralize the two current codecs.
- Cryptographic or persisted provenance for delivered wrappers. Identical transcript bytes cannot reveal who produced them. Adding metadata would change storage and event contracts.
- New wrapper kinds. This plan makes future additions exhaustive but adds no vocabulary.
- Wire-format changes, wrapper escaping changes, or transcript migration. Existing bytes remain canonical.
- Chip redesign, copy changes, stale-link resolution, or card relocation handling.
- Native Swift changes. The plan changes no endpoint, bridge, query parameter, auth, or JSON contract. iOS displays the same web transcript and existing wire strings.

## Open design questions

There are no open questions in the first implementation chunks. A future protocol expansion must decide whether it belongs in this server-delivered union or in a separate composer-envelope codec; that decision is intentionally deferred until a concrete new message kind exists.

## Knowledge audits

No knowledge audit is needed. The agent-facing `<capture>` and `<upload>` vocabulary does not change. The new union and codec are internal developer enforcement, verified by TypeScript and doctests rather than box-agent recall.

## Implementation order

1. Add `test/shared/delivered-user-message.doctest.md` with exhaustive fixtures, a sanitized snapshot-prefixed production shape, and red mixed-message assertions.
2. Add the shared union, closed codec registry, canonical serializer, and lossless part parser. Make the shared doctest pass.
3. Delegate capture and upload wrapper builders to the shared serializer. Keep the string delivery seam and update focused wrapper doctests.
4. Replace frontend independent parser branches with the exhaustive part renderer. Keep only thin compatibility delegates where focused tests or the dev harness still consume a single model.
5. Run focused doctests, typecheck, lint, and the full test suite. Use the dev capture harness or a controlled transcript fixture to inspect desktop and narrow browser rendering with no console errors.
6. Run a cross-model diff review. Address verified findings before declaring completion.

## Rollout shape

- **Test posture.** Tests land first. The shared doctest covers exact wire bytes, every union variant, canonical parse/serialize/parse behavior, a snapshot-prefixed persisted turn, queue-combined text, multiple blocks, malformed wrappers beside valid wrappers, and prose mentions. Existing capture and upload delivery tests continue to cover their domain construction and delivery behavior.
- **Browser posture.** Inspect a mixed text-plus-capture message and a mixed text-plus-upload message at desktop and 375-pixel widths. Confirm both text and chip remain visible and links remain operable. Check the client debug log for errors.
- **Knowledge audits.** None, because the agent-facing vocabulary is unchanged.
- **Migration.** No migration. Historical and new messages use the same strings.
- **Deployment.** Normal main-only deployment after the worktree is explicitly finished and merged. Source verification, merge/deploy status, and browser verification remain separate evidence.
