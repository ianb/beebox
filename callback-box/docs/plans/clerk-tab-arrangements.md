# Clerk tab arrangements

**Status:** partially implemented 2026-08 — the explicit one-transfer experiment landed; fuller recovery and review UX remain planned

## Landed slice (2026-08-05)

The experimental first slice keeps one latest transfer in Clerk, adds an extension-owned second
confirmation before Apply or Undo, binds numeric Chrome IDs to a
`chrome.storage.session` browser-session marker, rejects stale layouts before
mutation, verifies again before explicit closes, and attempts rollback when a
failure happens before closes.

It also adds current-window/all-normal-windows capture, grouped-tab rejection,
idempotent box intake, a `tab-arrangement` card schema and renderer, the
one-response box relay, explicit organizer opening, identity-preserving moves,
explicit closes, and best-effort Undo.

Intentional lean deviations from the fuller design below:

- Closed-tab Undo reopens the captured URL with `chrome.tabs.create`, avoiding
  the additional `sessions` permission. The replacement loses history and is
  not the original live tab instance.
- There is no live progress stream, event subscription, automatic recovery, or
  force path. An interruption that cannot be classified safely becomes a
  visible partial state and requires inspection/share-again.

Tab groups remain excluded and are tracked in the linked follow-up issue.

The fuller plan is not complete. Remaining work includes:

- durable `sending`/Retry/Discard intake state instead of retaining only a
  successfully accepted latest transfer;
- a richer review surface that separately shows the source layout, validation
  details, stale reasons, and a direct Share-again recovery path;
- event-aware concurrent-edit detection and the before/target/unknown
  worker-loss classification described in Track 4;
- a pure compiled-operation layer and the full table-driven Chrome boundary
  suite described below;
- more granular partial-close and partial-Undo reporting; and
- a real-Chrome Share → confirm → Apply → Undo exercise. Automated and browser
  rendering checks do not substitute for that final extension test.

The tracks below describe the fuller target. Where they exceed the landed slice
above, they remain prospective requirements rather than descriptions of current
behavior.

This plan lets a boxholder explicitly share the tabs in one normal Chrome window, or in all normal Chrome windows, with a box. The box agent edits a card that describes a proposed arrangement. The card viewer can then ask Callback Clerk to apply that arrangement to the original tab instances.

The design is closed-world and fail-closed. The extension applies only to the exact tab set that it recorded. It never treats omission as permission to close a tab.

## Job to be done

When my current window has become hard to navigate, I want to hand its tabs to my box, discuss a better arrangement, and apply the result, so I can recover an organized workspace without reopening every page.

When several normal browser windows have become one mixed workspace, I want to share all of them in one explicit action, so my box can propose an arrangement across the whole workspace.

When time has passed since I shared the tabs, I want Apply to stop before it changes anything if the browser no longer matches the shared snapshot, so an old proposal cannot damage newer work.

## Stated preferences this plan trades against

- Engineering principle 1, **Types are structure**, applies to transfer IDs, tab UUIDs, proposal states, and apply results. `callback-box/docs/engineering-principles.md:14`: *"Prefer types that make illegal states unrepresentable: discriminated unions over flat interfaces with correlated optional fields."*
- Engineering principle 3, **Validate at boundaries and during parsing**, applies to extension messages, HTTP payloads, card files, and agent edits. `callback-box/docs/engineering-principles.md:39`: *"Disk reads, LLM output, HTTP bodies, third-party API responses, config files, and env vars each get validated into typed data exactly once, at the boundary, with loud, localized failure."*
- Engineering principle 4, **Resilient AND never silent**, applies to stale state, partial Chrome mutations, intake retries, and imperfect Undo. `callback-box/docs/engineering-principles.md:51`: *"Degradation is allowed for failures that can genuinely happen; invisible degradation is not."*
- Engineering principle 5, **Failure paths visible in signatures**, applies to the relay and apply executor. `callback-box/docs/engineering-principles.md:66`: *"When callers genuinely dispatch on why something failed, return a discriminated Result."*
- Engineering principle 8, **One way to do each thing**, favors extending Clerk's existing box relay and generated contract instead of adding a custom protocol or a second hand-written client. `callback-box/docs/engineering-principles.md:97`: *"Competing idioms are drift generators."*
- Engineering principle 9, **Formal structure for essential complexity**, applies to the multi-step apply and undo state machines. `callback-box/docs/engineering-principles.md:108`: *"Where hard code can't be made simple, make it explicit rather than implicit."*
- Engineering principle 10, **Testability is architectural**, requires a pure snapshot comparator and a pure operation compiler around a small Chrome API shell. `callback-box/docs/engineering-principles.md:118`: *"Seams — clock injection, fs/agent injection points, a pure decision core extracted from an IO shell — are built into production code deliberately."*
- The card schema is the validation contract. `callback-box/src/cards/schema.ts:192`: *"A parse-time cross-field refinement applied to the whole frontmatter object"* is *"fail-closed for invariants that must never reach interior code."*
- Clerk remains a surface, not an engine. `callback-clerk/CLAUDE.md:3`: *"Clerk is a surface, not an engine: it routes content ... into a box's clerk API; the box does the thinking."* The extension owns browser identity and safe execution. The box owns the proposed organization.
- This is an experiment. Prefer an explicit user step and an honest limitation over durable orchestration or extra box writes. The box-side addition is one card schema, one Clerk intake mutation, one renderer, and extensions to the existing relay vocabulary. Apply and Undo state stays local to Clerk.
- Scope stays narrow. This plan adds explicit sharing, normal Chrome windows, Apply, and a limited Undo. It does not add tab-group support, background synchronization, live collaboration, or general browser automation.

Each design choice below ends with the principle that governs it.

## What already exists

### Clerk already sends authenticated content into a box

`callback-clerk/src/platform/clerk-api.ts:104`: *"Call a tRPC query/mutation on the box (non-batched form)."* `callback-clerk/src/platform/clerk-api.ts:170`: *"export async function getCommentaryDestinations"* and `callback-clerk/src/platform/clerk-api.ts:174`: *"export async function postCommentary"* are its current public operations. Reuse its enabled-box URL, host permission, cookie-auth, and tRPC conventions.

`callback-box/src/webapp/trpc/routers/clerk.ts:26`: *"Default filing spot when no commentary destination is chosen."* The next line sets `DEFAULT_COMMENTARY_DIR` to `box/inbox`. Reuse `box/inbox`; do not add a destination picker in the first version.

`callback-box/src/webapp/trpc/routers/clerk.ts:85`: *"Open the webpage card in a chat companion pane, chat scoped to the dest dir."* Reuse that destination shape. The share action creates the card and returns the URL. Clerk shows **Open organizer** as a separate user step. That action opens a fresh chat with the card in the companion viewer. Do not add automatic chat-message delivery in this version.

`callback-clerk/src/platform/open-box.ts:10`: *"Reuses a tab already sitting on that box rather than piling up duplicates."* Do not reuse `openBox` for this feature. Navigating or creating a normal tab after capture would immediately stale an all-windows transfer. When requested, open the organizer chat in a dedicated Chrome `popup` window, which is outside the normal-window capture scope.

This reuse follows principles 8 and 10.

### The box page already has a guarded route into the extension

`callback-clerk/src/domain/relay-messages.ts:4`: *"Two transports, three message families"* introduces page-to-content-script `window.postMessage` and content-script-to-background `chrome.runtime.sendMessage`. The relay currently supports screenshots only.

`callback-clerk/src/entrypoints/box-relay.content.ts:48`: *"Full gate: URL under an enabled box AND a valid same-origin identity meta."* `callback-clerk/src/entrypoints/background.ts:121`: *"Re-reads the live tab record."* The following comment says never to trust `sender.tab.url` for authorization. Reuse both authorization checks for Apply and Undo.

`callback-clerk/CLAUDE.md:77`: *"It holds no authority"* describes the content script. Keep that rule. The background service worker remains the only component that can read the local transfer record or call mutating Chrome APIs.

This reuse follows principles 3 and 8.

### Clerk already uses the correct JSON request seam

`callback-clerk/src/platform/clerk-api.ts:117`: *"async function trpcMutation<T>"* is the extension-side JSON mutation helper. `callback-box/src/webapp/trpc/routers/clerk.ts:29`: *"export const clerkRouter = router"* is the matching box-side surface. Add `clerk.tabArrangement` here instead of adding a raw Fastify route or a second HTTP client convention.

`callback-box/src/webapp/trpc/trpc.ts:10`: *"Requires a box-authorized request: a valid session (or auth disabled)."* Use `authedProcedure` for tab intake. The existing commentary procedures remain unchanged.

This choice follows principles 3 and 8.

### Card schemas already support hard cross-field validation

`callback-box/src/cards/schema.ts:174`: *"Self-contained validation a Zod schema can't express — cross-field rules, body parsing, format refinements."* Use both Zod field schemas and `superRefine` so every captured UUID occurs exactly once in the source and exactly once in either the proposed layout or the explicit close list.

`callback-box/src/schemas/registry.ts:104`: *"// synced & captured"* is the correct registry category. Register `TabArrangementSchema` with the capture and upload schemas.

`callback-box/src/schemas/upload-batch.tsx:103`: *"instructions: `# Upload Batch Cards"* is the precedent for a server-produced operational card with detailed agent duties. Follow that shape. Do not add a `cb create` template because users and agents must not manufacture a transfer without an extension-held identity map.

This choice follows principles 1 and 3.

### Type-specific card viewers already refresh on file changes

`callback-box/src/frontend/src/file-type-registry.ts:120`: *"export function registerFileType"* registers a type-specific renderer. `callback-box/src/frontend/src/components/FileView.tsx:180`: *"const fileChange = busEventData(event, \"file-change\");"* already refetches a viewed card after an agent edit. Add a tab-arrangement renderer through this registry.

This reuse follows principles 8 and 10.

### Clerk has no general tab-arrangement implementation

`callback-clerk/src/domain/messages.ts:8`: *"export interface CommentOnPageMessage"* is the only current action message shape. `callback-clerk/src/ui/actions-panel.tsx:104`: *"const handleComment = useCallback"* begins the only current capture action in the panel. The new transfer domain, storage, and executor are new code.

An older tab-sync experiment was removed because the box did not consume it. The current refresh record describes the retired route at `callback-box/docs/implemented-plans/refresh-clerk.md:49`: *"`POST /api/clerk/tabs` stores a tab snapshot in `.callback-box/clerk-tabs.json`."* This plan does not revive continuous inventory. It uses one explicit, user-initiated snapshot and a purpose-built card.

This choice follows the narrow-scope preference and principle 4.

## Prior art (external)

- The [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) can create, modify, and rearrange tabs. It says that a tab ID is unique only within a browser session. The extension must therefore persist transfer records across service-worker suspension, but invalidate them at browser restart.
- The [Chrome Tabs API `move` and `remove` methods](https://developer.chrome.com/docs/extensions/reference/api/tabs) operate on existing numeric tab IDs. They provide the right identity-preserving primitives. There is no multi-operation transaction API in the documented surface.
- The [Chrome Windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) can create a window around an existing tab with `windows.create({ tabId })`. The executor can create a proposed window without opening a replacement URL.
- The [Chrome Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) requires a separate `tabGroups` permission and adds another mutable browser object. The first version rejects selected scopes that contain grouped tabs. A follow-up issue covers local group support.
- The [extension service-worker lifecycle guide](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) warns that global variables are lost when the worker shuts down and recommends persistent storage. Transfer and undo records therefore live in `chrome.storage.local`, not process globals.
- The [Chrome Sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions) can restore recently closed tabs or windows, but only from the bounded recently-closed list. It does not promise restoration of the same live tab ID. Undo for explicit closes must be labeled best-effort and identity-losing.
- No documented Chrome API can lock the tab strip while an extension performs several calls. The plan treats a concurrent browser edit after preflight as a detectable partial-failure case, not as an impossible state.

These findings follow principles 3, 4, and 9.

## Tracks / scope

### Track 1 — Shared transfer and proposal model

**What.** Define one generated wire contract and one card schema for an explicit tab transfer. The contract carries transfer-local UUIDs. It never exposes Chrome numeric tab or window IDs to the box.

**Why this needs to change.** The current Clerk contract contains commentary only. A free-form list of URLs cannot preserve tab identity and cannot safely express closure.

**Direction.** Add the following discriminated shapes to the Clerk contract source and generated extension snapshot:

```ts
type TabTransferScope =
  | { kind: "window"; sourceWindow: WindowUuid }
  | { kind: "all-normal-windows" };

interface CapturedTab {
  id: TabUuid;
  title: string;
  url: string;
  window: WindowUuid;
  index: number;
  pinned: boolean;
}

interface TabArrangementProposal {
  windows: Array<{
    id: WindowUuid;
    tabs: TabUuid[];
  }>;
  close: TabUuid[];
}
```

The card frontmatter contains `status`, `transfer-id`, `scope`, `captured-at`, `source`, and `proposal`. The body is an optional agent-written rationale for the proposed arrangement. Card `status` is only `draft | ready`; Apply and Undo outcomes stay in the extension's local transfer record. Existing source window UUIDs may appear in the proposal. New proposal windows use fresh UUIDs generated by the agent. UUID syntax does not grant authority; the extension accepts only source tab UUIDs from its own local transfer record.

`superRefine` rejects duplicate or unknown tab UUIDs. It also rejects a proposal that omits a source UUID. Every source tab must appear exactly once in a proposed window or in `close`. It rejects duplicate window UUIDs and pinned tabs placed after unpinned tabs in a window. Titles, active state, focus, audible state, and favicon are display metadata or intentionally excluded from the safety fingerprint.

The agent instructions say that `source` is immutable. The agent edits `proposal`, `status`, and the rationale. It must use `close` for every requested closure. It sets `status: ready` only after the proposal validates.

**Vocabulary lock-ins.** The feature noun is **tab arrangement**. The captured immutable input is the **source snapshot**. The editable desired state is the **proposal**. A **transfer ID** binds one box card to one extension record. A **tab UUID** binds one source tab to one live Chrome tab. **Close** always means an explicit entry in `proposal.close`.

**First implementation chunk.** Add the shared Zod contract, generated Clerk types, card schema, schema tests, and knowledge-audit cases. Do not add Chrome mutations in this chunk.

This track follows principles 1, 2, 3, and 8.

### Track 2 — Explicit Clerk capture and idempotent box intake

**What.** Add two extension actions: **Share this window** and **Share all windows**. They create the local identity map and send the public snapshot to the active box. After success, Clerk shows a separate **Open organizer** action.

**Why this needs to change.** Clerk currently captures only the active page for commentary. The agent needs the complete selected layout, while the extension must retain the private Chrome IDs that make later identity-preserving mutation possible.

**Direction.** The background queries only `type: "normal"` windows and rejects incognito windows. **Share this window** is disabled when the popup's current window is not normal or is incognito. **Share all windows** includes every non-incognito normal window and no popup, app, devtools, or incognito window. If any selected tab is in a Chrome tab group, Share stops with a clear **Tab groups are not supported yet** message. The first version does not request the `tabGroups` permission.

At send time, Clerk creates UUIDs for the transfer, each source window, and each tab. It stores this private record in `chrome.storage.local`:

```ts
interface LocalTabTransfer {
  transferId: TransferId;
  boxUrl: string;
  createdAt: string;
  browserSessionId: string;
  scope: TabTransferScope;
  source: CapturedSafetySnapshot;
  tabIdByUuid: Record<TabUuid, number>;
  windowIdByUuid: Record<WindowUuid, number>;
  state:
    | "sending"
    | "ready"
    | "applying"
    | "applied"
    | "stale"
    | "failed"
    | "outcome-unknown"
    | "undone";
  lastApply?: LocalApplyRecord;
}
```

The public tRPC input excludes Chrome numeric IDs and includes the source snapshot plus an initial identity proposal. The `clerk.tabArrangement` mutation validates the generated contract, writes a deterministic card path under `box/inbox/` keyed by `transfer-id`, commits it, and returns a fresh-chat URL with the card in the companion viewer. It does not send an automatic user message. The card is visible to the user while they tell the agent what they want.

Intake is idempotent on `(box, transfer-id)`. A retry with the same snapshot returns the existing card and open URL. A retry with different content returns a tRPC conflict. Use a deterministic filename plus `withCardLock` around read-or-create. Commit only after the card is durable. No chat delivery state is required because no chat session exists until the returned URL opens.

If the mutation fails before the extension receives success, Clerk keeps the `sending` record and shows Retry or Discard. It never silently deletes the only tab-ID map. On success it marks the record `ready` and shows the returned card plus an **Open organizer** button. It does not open a window automatically.

When the user clicks **Open organizer**, Clerk calls `chrome.windows.create({ type: "popup", url: returnedUrl })`. The executor excludes every non-normal window, including this popup, from capture and stale comparison. This prevents the control surface from invalidating its own transfer. The extension does not reuse or navigate a normal box tab for this flow. If the user closes the organizer window, the Clerk popup lists the pending transfer and can reopen its returned URL in another popup without changing the normal-window scope.

**First implementation chunk.** Add pure snapshot construction and storage tests in Clerk. Then add the authenticated tRPC mutation, idempotent card-write doctests, generated contract update, and popup actions.

This track follows principles 3, 4, 5, 8, and 10.

### Track 3 — Specialized arrangement viewer and guarded relay

**What.** Add a type-specific card viewer. It shows the source and proposal by window. It exposes Apply only when the proposal validates and the extension reports that it still owns the matching transfer.

**Why this needs to change.** Generic YAML is not a safe confirmation UI. The user must see which tabs move and which explicit tabs close before asking Clerk to mutate Chrome.

**Direction.** Register `TabArrangementView` at a higher priority than the generic card renderer. The view displays:

- Source windows and tabs.
- Proposed windows, tab order, and pinned tabs.
- A separate red **Close N tabs** section. No hidden or implied deletion is allowed.
- Validation errors with the exact UUID/title involved.
- Relay availability and stale state.
- Applying state and a typed terminal result.
- Undo after a successful apply, with a warning when the proposal closed tabs.

Generalize the screenshot relay vocabulary into a shared box relay. Add `tab-arrangement-status-request`, `tab-arrangement-apply-request`, and `tab-arrangement-undo-request`, each with a correlation ID. The content script checks current page source and origin, parses the message, and forwards it. The background re-queries the live sender tab, verifies that its current URL is under the same enabled `boxUrl`, then verifies that the local transfer record belongs to that exact `boxUrl`.

Keep the existing screenshot messages compatible. Factor only the common request/response correlation, parsing, forwarding, and authorization shell. Do not build a persistent channel or a general command framework before a third use exists. This small shared shell is the reusable box-to-Clerk infrastructure from this experiment.

The page sends only `transferId` and the validated proposal. The background ignores any browser IDs from the page because none are in the contract. It resolves authority from its local record. Every response is a discriminated result such as `available`, `unavailable`, `stale`, `invalid-proposal`, `applying`, `applied`, `outcome-unknown`, `partial-failure`, or `undone`.

Apply is not a streaming protocol. The viewer waits on the existing one-response relay and shows a spinner. Before mutation, the background stores a minimal execution record with the before-image and target. A later `tab-arrangement-status-request` can report the last known state. There is no live progress stream and no automatic resume engine.

Apply and Undo results stay in Clerk's local transfer record. The box does not rewrite or commit the card after browser execution. Reopening the viewer asks Clerk for the current local status. If Clerk is unavailable or its local record is gone, the card remains a readable proposal and Apply stays disabled.

**First implementation chunk.** Add the viewer in read-only mode with contract parsing and deterministic source/proposal diff rendering. Then extend the existing relay guards and add one-shot status probing. Apply remains disabled until Track 4 lands.

This track follows principles 1, 3, 4, 5, and 8.

### Track 4 — Closed-world apply executor

**What.** Compile a valid proposal into operations on the original Chrome tab IDs. Reject stale browser state before the first mutation. Execute reversible operations first and explicit closes last.

**Why this needs to change.** Chrome has no transaction API. A naive sequence can move tabs and then fail, or can accidentally interpret a new tab as unwanted. The executor needs a formal safety boundary and an explicit failure strategy.

**Direction.** Split the executor into three layers:

1. `readLiveSafetySnapshot(chromeApi, transfer)` queries the selected scope.
2. `compareSafetySnapshots(source, live)` returns either an exact match or a structured list of stale reasons.
3. `compileTabOperations(source, proposal)` returns a typed operation program that references only known tab UUIDs.

The safety fingerprint includes exact membership in the selected scope, committed URL or current `pendingUrl`, window membership, tab order, pinned state, and the requirement that every selected tab remains ungrouped. It ignores title, active/highlighted/focused state, audible/muted state, loading status, and favicon. For an all-windows transfer, the set of non-incognito normal windows must also match. For a one-window transfer, that source window must exist and its tab membership must match. Tabs in other normal windows are outside that one-window scope.

If any captured tab is missing or changed, or any unknown tab or window appears inside the selected scope, Apply returns `stale` before calling any mutating Chrome API. The UI lists the differences and offers **Share again**. It does not offer a force option.

The operation compiler enforces these safety properties even after card validation:

- It can reference only a tab UUID in the local source record.
- It emits `tabs.remove` only for UUIDs in `proposal.close`.
- It never closes a window directly.
- It never creates or reloads a URL.
- It preserves each non-closed tab's live Chrome tab ID.
- It creates a new window by moving a known existing tab with `windows.create({ tabId })`.
- It preserves pinning, applies window placement and order, then verifies the complete desired layout.
- It closes explicitly named tabs only after the reversible layout verifies.

Before execution, the background captures a second private before-image and subscribes to relevant tab/window events. If an operation fails or a relevant concurrent event occurs, it stops. Before explicit closes, it attempts to restore the before-image using only known tabs and reports `partial-failure` if restoration does not verify. It never touches an unknown tab during rollback. After explicit closes begin, rollback is best-effort because the original live tab instance may no longer exist.

Before the first Chrome mutation, the background writes a minimal execution record to `chrome.storage.local`. It contains the before-image, target layout, and `state: "applying"`. On success or a caught failure, the background replaces that state with the typed result and the Undo data.

If the worker stops and leaves `state: "applying"`, the next status request compares live Chrome with the stored before-image and target. An exact target match becomes `applied`. An exact before-image match becomes `failed` with no effective change. Any other layout becomes `outcome-unknown`. Clerk does not resume operations or guess at rollback after worker loss. The viewer tells the user to inspect Chrome and share again. This is less machinery and makes the experimental limitation explicit.

This design gives a strong promise for the user's stated stale case: an unknown tab present at preflight produces zero mutations, and no unknown tab is ever a removal target. It does not claim impossible transaction semantics for a browser edit that races after preflight.

**First implementation chunk.** Write table-driven tests for exact comparison and operation compilation, including an unknown tab, missing tab, navigation, pin/order drift, a newly grouped tab, duplicate proposal UUID, omitted UUID, and explicit close. Then implement the injected Chrome API shell and apply state machine.

This track follows principles 1, 3, 4, 5, 9, and 10.

### Track 5 — Bounded undo

**What.** Keep one undo record for the latest successful apply of a transfer. Restore window placement, ordering, and pinning when the post-apply browser state still matches.

**Why this needs to change.** A large rearrangement can be valid but still feel wrong. The user asked for a practical way back.

**Direction.** The extension stores the private pre-apply snapshot, compiled inverse operations, post-apply fingerprint, and any Chrome session IDs it can correlate for explicit closes. Undo runs the same closed-world preflight against the post-apply fingerprint. If the relevant scope changed after Apply, Undo makes no mutation and reports stale.

Undo of surviving tabs preserves their live identities. Undo of closed tabs uses `chrome.sessions.restore` only when the extension can identify the matching recent session. The UI states that this is best-effort: Chrome may have evicted the session, and a restored tab has a new live tab ID. If any explicit close cannot be restored, Undo reports partial success and does not claim that the original state was recovered.

Only the latest apply for a transfer is undoable. A later successful apply replaces the record. Browser restart or extension update invalidates pending transfer and undo records because Chrome tab IDs are browser-session scoped. Service-worker suspension does not invalidate them because the records are in `chrome.storage.local`.

**First implementation chunk.** Add pure inverse-program and undo-preflight tests. Then add the undo executor and viewer state. Test close restoration behind an injected Sessions API; verify the real behavior manually in Chrome.

This track follows principles 4, 5, 9, and 10.

## Subplans (when a sub-question needs its own design step)

No subplan is required before implementation. The transfer vocabulary, validation invariants, relay authority, operation ordering, explicit worker-loss outcome, and Undo limit are fixed in this plan. Do not add automatic apply recovery during implementation. If real use later justifies it, design it as a separate follow-up.

This gate follows principles 7, 8, and 9.

## Failure modes (the load-bearing section)

There is no accepted critical gap. The lack of a Chrome transaction is a documented platform limit. The executor handles it with zero-mutation stale preflight, explicit close targeting, reversible-first ordering, verification, and a visible partial-failure result.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Current-window capture starts from an incognito or non-normal window | Planned Clerk domain test and manual Chrome check | Disable the action and reject in the background | Clear UI error |
| All-windows capture accidentally includes incognito, popup, app, or devtools windows | Planned snapshot-construction test | Filter to non-incognito `normal` windows at the Chrome boundary | Clear invariant failure in dev/test; no excluded data sent |
| Selected scope contains a grouped tab | Planned snapshot-construction test | Reject Share before sending and link the limitation to the follow-up | Clear unsupported message |
| MV3 service worker stops after local storage but before the mutation completes | Planned storage transition test | Keep `sending`; show Retry or Discard on next popup open | Clear pending state |
| Intake mutation is retried after an ambiguous response | Planned tRPC doctest | Idempotency by box and transfer ID; same payload returns existing result; mismatch is a tRPC conflict | Clear conflict or resumed success |
| Opening the organizer UI changes the shared tab set | Planned window-filter and open-target tests | Open it in a Chrome `popup` window and exclude all non-normal windows | Clear invariant test; normal scope stays unchanged |
| User closes the organizer window before Apply | Planned pending-transfer UI test | Keep the transfer record and reopen the returned URL in a new popup | Clear Resume action |
| Agent duplicates, omits, or invents a tab UUID | Planned schema and renderer parser tests | `superRefine` and extension compiler both reject | Clear validation detail; Apply disabled |
| Agent edits immutable source data | Planned schema and extension-comparison tests | Extension uses its private source record as authority and returns invalid/stale | Clear error; no mutation |
| Card is moved while its viewer remains open | Planned missing-card viewer test | Viewer reports that the card moved or disappeared; transfer remains resumable from Clerk | Clear; no browser mutation |
| A different enabled box page sends the transfer ID | Planned relay-auth test | Background compares the current sender box URL with the local record's exact box URL | Clear unauthorized/unavailable result |
| Browser restarted since capture | Planned session-invalidation test | Startup epoch invalidates tab-ID-based records | Clear expired state and Share again action |
| Unknown tab exists in the selected scope at Apply | Planned comparator test | Exact closed-world preflight returns stale before mutation | Clear diff; zero mutation calls asserted |
| Captured tab navigated, moved, pinned, newly grouped, or disappeared | Planned comparator table | Exact preflight returns stale before mutation | Clear diff; zero mutation calls asserted |
| User creates or moves a tab after preflight but during Apply | Planned fake-Chrome event test | Stop, attempt reversible rollback, never remove unknown IDs | Clear partial-failure detail |
| MV3 service worker stops during Apply | Planned execution-record tests and manual extension reload | Compare live state with stored before/target on the next status request | Clear applied, failed, or outcome-unknown result |
| Worker-loss comparison matches neither before nor target | Planned indeterminate-layout test | Do not resume or mutate; tell the user to inspect Chrome and Share again | Clear outcome-unknown detail |
| Chrome rejects a move because the user is dragging a tab | Planned executor test | Bounded retry for the documented transient error, then rollback | Clear applying state, then failure |
| Reversible layout verifies incorrectly | Planned fake-Chrome mismatch test | Stop before explicit closes and rollback | Clear partial-failure detail |
| Explicit close succeeds and a later close fails | Planned executor test | Stop and report exactly which known tabs closed; retain undo data | Clear partial failure; never claim atomicity |
| Undo is requested after unrelated browser edits | Planned undo comparator test | Post-apply closed-world preflight returns stale before mutation | Clear; zero undo mutation calls |
| Chrome cannot restore an explicitly closed tab | Planned Sessions API failure test and manual check | Restore surviving layout; report the specific close as not restored | Clear partial undo |
| Extension is missing or disabled on the viewer page | Planned status-probe timeout test | Viewer remains read-only and explains how to enable Clerk | Clear unavailable state |

The table follows principles 3, 4, 5, and 10.

## Agent-flow / user-flow edge cases

- **ADDRESSED — Wrong tag / wrong field.** This plan adds no chat tag. The card schema accepts one closed field vocabulary, and the viewer shows validation errors on the card. See Tracks 1 and 3. This follows principles 1 and 3.
- **ADDRESSED — Stale ref.** The intake response identifies the exact card. File-change refresh handles agent edits. Apply authority and local status use transfer ID, not the card path. See Tracks 2 and 3. This follows principles 4 and 5.
- **ADDRESSED — Two agents touching the same card.** Card validation remains deterministic. The box never writes execution results back into the agent-edited card, so Apply cannot overwrite a concurrent proposal edit. See Track 3. This follows principles 3 and 9.
- **ADDRESSED — Hand-edit drift.** Card parsing and `superRefine` fail closed. The specialized viewer displays the lint errors and disables Apply. See Tracks 1 and 3. This follows principles 3 and 4.
- **ADDRESSED — Fabricated free-form value.** Window labels are descriptive only. No free-form value grants browser authority. Every operation derives from source tab UUIDs in the private extension record. See Tracks 1 and 4. This follows principles 1 and 3.
- **ADDRESSED — Validation error UX.** Cross-field errors name the duplicate, missing, or unknown UUID and, when source metadata is available, its tab title. The viewer groups errors above the disabled Apply button. See Track 3. This follows principles 4 and 5.
- **ADDRESSED — Partial migration / transition state.** The new card type and relay messages are additive. Older Clerk builds show the card through the generic renderer and never receive the new relay request. New viewers probe capability before enabling Apply. See Rollout shape. This follows principles 4 and 8.
- **ADDRESSED — User has opened a new tab since sharing.** Exact scope comparison returns stale and Share again. Omission never becomes deletion. See Track 4. This follows principles 3 and 4.
- **ADDRESSED — Proposal includes closes.** The viewer separates closes visually, Chrome executes them last, and Undo warns that restored tabs are not the same live instances. See Tracks 3–5. This follows principle 4.

## NOT in scope

- **Local or shared Chrome tab groups.** The first version rejects grouped tabs. Local group support is tracked in [Support local Chrome tab groups in Clerk tab arrangements](../../../issues/features/2026-08-04-clerk-tab-arrangement-groups.md). Live collaborative group semantics remain separate and undesigned.
- **A box-to-extension push channel.** Apply and Undo are explicit clicks in a box card viewer. The existing authenticated page relay is sufficient.
- **Reusing a normal box tab as the organizer surface.** It would make an all-windows snapshot stale by construction. The organizer uses an excluded popup window.
- **Custom URL schemes or deep links.** The box viewer already runs on an enabled box page and can use the relay.
- **Background tab inventory or continuous sync.** The removed tab-sync experiment sent data without a consumer. This design captures only after an explicit user action.
- **Force apply.** A stale transfer must be shared again. There is no override that weakens closed-world safety.
- **Creating replacement tabs from URLs.** Apply moves the original tab instances. Only best-effort Undo may restore an explicitly closed URL through Chrome Sessions, and the UI labels the identity loss.
- **Editing tab URLs, navigation history, active tab, focus, mute state, or discarded state.** These are outside arrangement semantics.
- **Closing arbitrary windows.** The executor moves known tabs and lets Chrome close an empty source window as a consequence. It never calls `windows.remove`.
- **Incognito.** Capture, comparison, Apply, and Undo exclude incognito windows and tabs.
- **Firefox, Safari, mobile browsers, and the iOS app.** The executor uses Chrome extension APIs and has no useful iOS equivalent.
- **Reusable saved layouts.** A tab-arrangement card is a proposal for one transfer, not a template that can open a future workspace.
- **Guaranteed undo of explicit closes.** Chrome Sessions is bounded and creates a new live tab. The plan promises only best-effort restoration with visible partial results.

These bounds follow the narrow-scope preference and principles 4 and 8.

## Open design questions

No open question blocks the first implementation chunk.

- **Card retention after Apply.** Lean: keep the card as a searchable=false operational record until the user or agent files/deletes it. Do not auto-delete it because it records the source, proposal, and rationale. Revisit after real use.
- **Transfer-record expiry before browser restart.** Lean: keep records for 30 days in the same browser session and add explicit Discard. Expiry is housekeeping, not an authorization boundary; the exact preflight remains mandatory.
- **Whether applied cards should support a second revision/apply cycle.** Lean: allow a new proposal only after the user shares again. One transfer has at most one successful Apply. This keeps Undo and authority unambiguous.

These questions follow principles 4, 8, and 9. Their current leans are implementation decisions for this plan unless the boxholder changes them before implementation.

## Knowledge audits

This plan introduces agent-facing vocabulary and a new operational card. Add and run these audits in `callback-box/src/dev/knowledge-audits.yaml`:

- `tab-arrangement-source-is-immutable`: the agent knows not to edit `source`.
- `tab-arrangement-complete-partition`: the agent places every source UUID exactly once in a proposed window or explicit close list.
- `tab-arrangement-close-is-explicit`: the agent knows that omission is invalid and never means close.
- `tab-arrangement-ready-gate`: the agent sets `status: ready` only after producing a complete valid proposal and summarizes closures for the user.

Run `pnpm knowledge-audit run --box ~/src/box-worktrees/tab-organizer-clerk/test1 --filter tab-arrangement` during implementation. Record the run status in the YAML comments before the plan is complete. The schema instructions are loaded agent context, so written-but-unrun audits are not sufficient.

This requirement follows engineering principles 10, 11, and 12.

## Implementation order

1. Add failing contract, card-schema, and knowledge-audit tests. Then implement Track 1 and regenerate the Clerk contract snapshot.
2. Add failing Clerk snapshot/storage tests and tRPC mutation doctests. Then implement the explicit popup actions and idempotent intake in Track 2.
3. Add the read-only specialized viewer and relay capability probe from Track 3. Verify generic fallback with an older/missing extension.
4. Add failing comparator and compiler tables. Then implement the guarded Apply state machine from Track 4 behind the viewer button.
5. Exercise the full Apply flow and the explicit worker-loss outcome in the worktree box.
6. Add failing inverse/undo tests. Then implement bounded Undo from Track 5.
7. Run focused unit tests, doctests, knowledge audits, full package checks, and the manual MV3 matrix. Update contract and card-schema documentation. Cross-model review the completed implementation before `/finish`.

Each numbered item is one commit or a small set of cohesive commits. None is a shipping boundary. The feature ships only when all items pass the completion checks.

This order follows principles 8 and 10.

## Rollout shape

### Test posture

- **Contract and schema doctests first.** Test valid identity proposals, moves, new windows, explicit closes, and every partition violation.
- **Clerk pure domain tests first.** Test window filtering, UUID mapping, storage transitions, browser-session invalidation, exact snapshot comparison, operation compilation, rollback programs, and undo preflight without `chrome.*` globals.
- **tRPC mutation doctests.** Test authentication, idempotent retry, payload conflict, concurrent read-or-create, and the companion chat/card response URL.
- **Frontend component tests.** Test source/proposal rendering, the visually separate close list, disabled Apply for invalid/unavailable/stale state, typed relay results, and the explicit outcome-unknown state.
- **Injected Chrome-shell tests.** Use a fake API to assert zero mutation calls on every stale case, grouped-tab rejection, close-last ordering, no unknown-ID mutation, event-race rollback, worker-loss classification, and partial result detail.
- **Manual MV3 verification.** Build Clerk, load it unpacked, enable the worktree box, and test current window, all windows, grouped-tab rejection, the explicit Open organizer step, new windows, explicit closes, unknown-tab stale abort, navigation stale abort, restart invalidation, Apply, worker-loss messaging, and Undo. Confirm incognito never appears. Confirm a non-box page and a different enabled box cannot invoke the transfer.
- **Package gates.** Run Clerk test/typecheck/lint/build and the focused callback-box doctests/typecheck/lint. Run the full callback-box test tier required by `callback-box/docs/testing.md` for changed backend and frontend surfaces.

### Knowledge-audit rollout

All four audits in the Knowledge audits section land and run before completion. A failure blocks completion until either the instructions or the audit is corrected and rerun.

### Data and contract rollout

This is an additive card type and additive relay vocabulary. No existing box card migration is required. Regenerate and commit the Clerk contract snapshot from the box source of truth in the same implementation commit that changes the contract.

Deploy callback-box before distributing or rebuilding the new Clerk version. During the short transition, a new box understands the old extension, and an old extension renders the new card generically with Apply unavailable. Do not advertise the feature until both sides are present.

### Completion checks

The plan is complete only when:

- The two explicit share actions create one valid card without opening a new window automatically; **Open organizer** opens the fresh companion chat in an excluded popup window.
- The agent can revise the proposal and the viewer refreshes.
- Apply preserves every non-closed tab's Chrome tab ID.
- An unknown, missing, navigated, moved, pinned, newly grouped, or reordered tab at preflight causes zero Chrome mutation calls.
- Only explicitly listed known UUIDs can reach `tabs.remove`.
- A mid-apply failure produces verified rollback or a visible partial-failure report.
- Undo restores surviving tabs when the post-apply snapshot is unchanged and accurately reports closed-tab limitations.
- All planned automated checks, knowledge audits, and the manual MV3 matrix pass.
- A cross-model review has no unresolved correctness or safety finding.

This rollout follows principles 3, 4, 8, 10, 11, and 12.

## Review

The implementation reviewer must check these properties directly:

- **Authority.** Only the background service worker uses Chrome IDs. Sender authorization is rechecked against the live box page and the transfer's exact box URL.
- **Identity.** No apply code creates or reloads a URL. Non-closed tabs keep their Chrome tab IDs.
- **Closed-world safety.** Exact stale preflight occurs before every mutation. Unknown tabs never become removal targets. Omission is rejected.
- **Ordering.** Reversible moves occur before explicit closes. Verification gates the close phase.
- **Honest failure.** Partial application, rollback failure, worker-loss uncertainty, and closed-tab Undo limits are distinct visible outcomes.
- **Idempotency.** Ambiguous intake retry cannot create a second card.
- **Concurrency.** Agent edits use schema validation. Browser execution never writes back into the proposal card.
- **Transition.** Missing/older Clerk leaves the card readable and Apply unavailable.
- **Scope.** There is no live collaboration, background sync, custom URL scheme, force apply, or incognito path.

These checks trace to principles 1, 3, 4, 5, 8, 9, and 10.
