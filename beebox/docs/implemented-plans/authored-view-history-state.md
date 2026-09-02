---
title: "Browser-like history state for authored views"
status: implemented
workstream: view-live-update-state
issues: []
---
# Browser-like history state for authored views

When someone is navigating inside a rich box-authored view, they want a source-code update, reload, shared link, and browser Back/Forward to preserve the meaningful place they reached. The view must opt into that behavior. Bee Box will not attempt to preserve arbitrary React state.

**Issues addressed:** none. The package-path reload bug is already closed; this plan addresses the deliberately deferred continuity contract.

## Stated preferences this plan trades against

- The boxholder chose explicit adoption by authored views rather than automatic component-state preservation. This keeps incompatible updates recoverable and follows principle 6, which says defense should concentrate at real boundaries rather than model impossible guarantees ([`docs/engineering-principles.md:75-85`](../engineering-principles.md)).
- The boxholder allowed state to occupy a separate query variable so it can coexist with Bee Box UI state. This extends the existing rule that a selected file and renderer belong in the URL rather than local state: [`src/frontend/src/pages/browse/BrowsePage.tsx:179-181`](../../src/frontend/src/pages/browse/BrowsePage.tsx) says *"What's open in the detail panel IS what the URL points at"*, and [`BrowsePage.tsx:200-207`](../../src/frontend/src/pages/browse/BrowsePage.tsx) puts renderer choice there for sharing and Back/Forward.
- The API should rhyme with browser history. The public names are `viewHistory.state`, `viewHistory.pushState(next)`, and `viewHistory.replaceState(next)`. Bee Box still routes through TanStack Router; authored code never calls `window.history` directly.
- One typed, surface-aware capability follows principle 8: *"One way to do each thing"* ([`docs/engineering-principles.md:95-104`](../engineering-principles.md)). Boundary parsing and JSON validation follow principle 3 ([`engineering-principles.md:37-47`](../engineering-principles.md)).
- The maintainer is usually an agent, so the public types, generated documentation, examples, and knowledge audit carry the convention together rather than relying on this plan ([`engineering-principles.md:141-149`](../engineering-principles.md)).

## What already exists

- `ViewTarget` is the serializable address passed among surfaces. It currently separates the box path, reserved `?view=`, and remaining query parameters ([`src/frontend/src/lib/view-url.ts:16-23`](../../src/frontend/src/lib/view-url.ts)). Reuse it by adding one reserved `viewState` field; do not create a parallel address type.
- `parseViewUrl()` and `serializeViewUrl()` are the shared boundary for serialized view targets ([`view-url.ts:37-53`](../../src/frontend/src/lib/view-url.ts), [`view-url.ts:103-114`](../../src/frontend/src/lib/view-url.ts)). Browse and card routes separately read raw search through `useUrlView()` ([`src/frontend/src/hooks/useUrlView.ts:25-35`](../../src/frontend/src/hooks/useUrlView.ts)). Fold both paths through one `parseViewQuery()` implementation so direct links, route search, companion targets, and nested `card=` values agree.
- Full-page views recompute their target when the raw query string changes and pass its viewer and parameters into `FileView` ([`src/frontend/src/pages/ViewPage.tsx:18-43`](../../src/frontend/src/pages/ViewPage.tsx)). Card pages and Browse already own renderer-query replacement ([`src/frontend/src/pages/card/CardViewPage.tsx:24-45`](../../src/frontend/src/pages/card/CardViewPage.tsx), [`BrowsePage.tsx:188-207`](../../src/frontend/src/pages/browse/BrowsePage.tsx)). Reuse those owners for state history.
- Chat companion tabs already store a complete `ViewTarget`, update an existing path's target in place, and compare targets through `serializeViewUrl()` ([`src/frontend/src/components/chat/InteractiveChat-hooks.ts:21-47`](../../src/frontend/src/components/chat/InteractiveChat-hooks.ts)). The active target is already persisted inside the chat route's `?card=` query variable without clobbering sibling search state ([`src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:20-31`](../../src/frontend/src/components/chat/InteractiveChat-card-hooks.ts), [`InteractiveChat-card-hooks.ts:53-67`](../../src/frontend/src/components/chat/InteractiveChat-card-hooks.ts)). Extend that target rather than adding another top-level chat query parameter.
- Overlay state already owns a `ViewTarget` outside the route and renders it into `FileView` ([`src/frontend/src/components/ViewOverlay.tsx:27-35`](../../src/frontend/src/components/ViewOverlay.tsx), [`ViewOverlay.tsx:50-70`](../../src/frontend/src/components/ViewOverlay.tsx), [`ViewOverlay.tsx:128-135`](../../src/frontend/src/components/ViewOverlay.tsx)). It can replace its current target locally, but it does not own browser-history entries.
- The browser view host is the existing capability boundary for separately compiled authored code. Its comment says widgets consume host capabilities instead of importing Router or `FileView` ([`src/frontend/src/lib/view-host.tsx:2-16`](../../src/frontend/src/lib/view-host.tsx)). `makeOpenCard()` already turns a surface callback into a view-facing capability ([`view-host.tsx:108-135`](../../src/frontend/src/lib/view-host.tsx)). Put history beside that capability.
- Authored components currently receive flat `params` only ([`src/core/views/types.ts:53-62`](../../src/core/views/types.ts)); the live renderer holds the imported module outside the authored component ([`src/frontend/src/components/AgentViewRenderer.tsx:215-229`](../../src/frontend/src/components/AgentViewRenderer.tsx)) and replaces `mod.default` on source updates ([`AgentViewRenderer.tsx:233-245`](../../src/frontend/src/components/AgentViewRenderer.tsx)). State held by the stable host survives that replacement; hook state inside `mod.default` does not.
- Generated agent documentation has one authoritative component-props table ([`src/core/views/doc.ts:93-110`](../../src/core/views/doc.ts)), and the short `views` skill points agents there ([`src/core/box/skills-content.ts:453-466`](../../src/core/box/skills-content.ts)). Update both the generated reference source and its templates; do not hand-edit generated box files.

## Prior art (external)

- The browser History API names the current value `history.state`; `pushState()` creates a history entry and `replaceState()` updates the current one. The proposed authored API deliberately keeps those semantics and drops the browser API's unused/title and URL arguments because the host owns the URL: [MDN `History.pushState()`](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState), [MDN `History.replaceState()`](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState), and [MDN `History.state`](https://developer.mozilla.org/en-US/docs/Web/API/History/state).
- TanStack Router treats search parameters as typed application state and supports navigation with replacement. Bee Box should continue using its router rather than mutating browser history behind it: [TanStack Router search-parameter guide](https://tanstack.com/router/latest/docs/framework/react/guide/search-params) and [navigation guide](https://tanstack.com/router/latest/docs/framework/react/guide/navigation).
- React ties state to a component's position and type; replacing the dynamically imported component type resets its local state. This confirms that preserving arbitrary hooks is not a supported hot-reload contract: [React, “Preserving and Resetting State”](https://react.dev/learn/preserving-and-resetting-state).

## Tracks / scope

### Track A — Give view URLs a separate state envelope

**What.** Reserve one query key, `viewState`, for a percent-encoded JSON object. Extend `ViewTarget` with `viewState: ViewState | null`, where `ViewState` is a JSON-safe object type. `params` continues to contain every non-reserved query parameter and never contains `viewState`.

**Why this needs to change.** Today `parseViewQuery()` treats every key except `view` as a renderer parameter ([`src/frontend/src/lib/view-url.ts:56-75`](../../src/frontend/src/lib/view-url.ts)). Mixing navigation state into `params` makes it collide with existing view-card configuration and with unrelated Bee Box query state.

**Direction.** Add these public shapes in the shared view types and frontend URL module:

```ts
type ViewStateValue = null | boolean | number | string | ViewStateValue[] | { [key: string]: ViewStateValue };
type ViewState = Record<string, ViewStateValue>;

interface ViewTarget {
  path: string;
  viewer: string | null;
  params: Record<string, string>;
  viewState: ViewState | null;
}
```

`serializeViewUrl()` emits no `viewState` key for `null` or `{}`. Otherwise it emits `viewState=${encodeURIComponent(JSON.stringify(state))}` after `view=` and before ordinary parameters. `parseViewUrl()` and `useUrlView()` share one query parser: it accepts any key order, JSON-parses `viewState`, validates that the result is a non-array object made only of JSON values, and returns `null` on invalid input after one contextual warning. The pure serializer rejects non-finite numbers and non-JSON/cyclic values with a named error instead of silently changing them; the interactive history API handles that error as described in Track B. Existing URLs remain valid and canonical. At TanStack Router boundaries, callers pass the state object rather than a pre-serialized JSON string; a contract test proves TanStack's search encoding round-trips to the same `ViewTarget` as `serializeViewUrl()`.

**Vocabulary lock-ins.** Query key: `viewState`. Types: `ViewState` and `ViewStateValue`. `ViewTarget.viewState` is always present and nullable. `params` excludes both `view` and `viewState`.

**First implementation chunk.** Add the types, pure parse/validation/serialization helpers, and exhaustive `view-url.doctest.md` cases before changing a renderer.

### Track B — Add browser-like history to the authored-view host

**What.** Add a `viewHistory` prop to `ViewProps` and the browser view host:

```ts
interface ViewHistory {
  readonly state: ViewState;
  readonly canPush: boolean;
  pushState(next: ViewState): "pushed" | "replaced" | "rejected";
  replaceState(next: ViewState): void;
}
```

The view must call it explicitly. Bee Box never snapshots hooks, DOM, uncontrolled inputs, scroll offsets, or arbitrary component objects.

**Why this needs to change.** `ViewProps` currently exposes only navigation to another box path plus read-only URL parameters ([`src/core/views/types.ts:53-56`](../../src/core/views/types.ts)). The stable `AgentViewRenderer` can receive state from its host and pass it to every replacement component without attempting React HMR internals.

**Direction.** First stabilize the bound authored renderer. `FileView` currently declares `Bound` inside a `useMemo` whose dependencies include `params` and `data` ([`src/frontend/src/components/FileView.tsx:358-375`](../../src/frontend/src/components/FileView.tsx)); a query update therefore creates a new component type and tears down `AgentViewRenderer`. Extract a stable bound-renderer component and pass changing `params`, `viewState`, and data as props. A view-history click must not show the loading state, re-import the module, or refetch cards merely because its URL state changed.

Then `FileView` receives the target state and a surface-owned `onViewStateChange(next, method)` callback. `AgentViewRenderer` creates one `ViewHistory` object whose `state` is the normalized object (`{}` when absent) and whose two methods call that callback with `"push"` or `"replace"`. A module reload changes only the inner component; the same stable host passes its state to the replacement.

Addressed surfaces implement both methods with their existing owner:

- Browse, `/card/`, and `/views/` update only `viewState`, preserve `view`, ordinary renderer params, path, and unrelated route search, and honor push versus replace through TanStack Router.
- The chat companion updates the active tab's `ViewTarget`; its existing `?card=` effect serializes that state with `replace: true` ([`src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:53-67`](../../src/frontend/src/components/chat/InteractiveChat-card-hooks.ts)). It is replace-only rather than rebuilding companion tabs around URL-first browser history.
- The global overlay replaces its locally owned target. It is replace-only because the overlay deliberately does not own the browser URL ([`src/frontend/src/components/ViewOverlay.tsx:11-18`](../../src/frontend/src/components/ViewOverlay.tsx)).
- Inline chat/card embeds keep state in their stable `FileView` shell. They are replace-only because several embeds can coexist and none owns the page URL.

`replaceState` is available on every stable host. On a replace-only surface, `pushState` performs the same replacement, warns once with the surface name, and returns `"replaced"`; on an address-owning surface it returns `"pushed"`. `canPush` lets authored UI avoid presenting misleading Back/Forward affordances. The uniform method shape works for unannotated authored components and avoids an event-handler exception that React error boundaries cannot catch.

Both methods validate and serialize before updating their owner. Invalid state leaves the current target unchanged and reports a contextual console error plus the existing view-host toast; `pushState` returns `"rejected"`. The methods do not throw out of an authored event handler, because React error boundaries do not catch those exceptions.

**Vocabulary lock-ins.** Prop: `viewHistory`. Fields/methods: `state`, `canPush`, `pushState`, and `replaceState`; `pushState` returns `"pushed" | "replaced" | "rejected"`. History method is the literal union `"push" | "replace"` internally. Authored views never call `window.history`, `useNavigate`, or read `location.search`.

**First implementation chunk.** Extract the stable bound renderer and add a regression proving a query/state prop change does not remount `AgentViewRenderer`. Then add the pure state-transition seam, implement one URL-backed surface, and prove a replaced authored module receives the same state before expanding to the remaining surfaces.

### Track C — Complete every mount surface and authoring contract

**What.** Wire Browse, card page, full view page, chat companion tabs, global overlay, chat inline embeds, peek mounts, and nested `CardRef`/figure embeds. Update shared types, the Node `bbx view test` host, generated reference docs, templates, and the `views` skill.

**Why this needs to change.** `FileView` is mounted from all of those surfaces, and its contract says the surrounding context decides navigation semantics ([`src/frontend/src/components/FileView.tsx:54-72`](../../src/frontend/src/components/FileView.tsx)). Leaving one implicit would make the same authored component behave differently without an inspectable capability.

**Direction.** Every mount passes an explicit surface capability. Node rendering supplies inert methods with `canPush: false`; because server rendering does not run event handlers, the methods only make the browser and Node prop shapes agree. Widen `ViewHost.renderInline` from a bare path to a complete `ViewTarget`: the current implementation discards viewer and query data before mounting the nested file ([`src/frontend/src/lib/view-host.tsx:54-60`](../../src/frontend/src/lib/view-host.tsx), [`src/frontend/src/components/AgentViewRenderer.tsx:153-161`](../../src/frontend/src/components/AgentViewRenderer.tsx)). Each `CardRef` target then receives its own viewer, params, and state rather than inheriting the parent's.

Update `src/core/views/doc.ts`, `src/core/box/templates.ts`, and the generated-doc fixtures with one site-like example:

```tsx
export default function Catalog({ viewHistory }) {
  const page = typeof viewHistory.state.page === "string"
    ? viewHistory.state.page
    : "home";
  const openGallery = () => {
    if (viewHistory.canPush) viewHistory.pushState({ page: "gallery" });
    else viewHistory.replaceState({ page: "gallery" });
  };
  return <button onClick={openGallery}>Gallery</button>;
}
```

The guidance says views validate their own semantic state. Unknown keys or obsolete values fall back to the view's default. A view may call `replaceState(normalized)` after a user action; it must not write history during render. A `version` member is allowed but not required and has no host semantics.

**Vocabulary lock-ins.** “View history” means explicit authored-view navigation state. “Renderer params” remain external configuration. “React state” remains transient component state. These terms must not be used interchangeably.

**First implementation chunk.** After Track B proves the seam, wire every mount and node host in one exhaustive compiler-guided pass, then update agent-facing material and its audit in the same commit.

## Could this be simpler?

The smallest version would pass a single `setViewState()` callback only on Browse and encode state among ordinary `params`. It would fix the immediate pottery-site case. It would also create a second navigation idiom, collide with view configuration, and silently fail when the same authored view appears on `/card/` or in the chat companion. The fuller plan buys one typed address and one explicit capability across every mount, following principle 8's requirement for one way to do each thing and principle 12's requirement that the type system guide future agents.

Automatic hook-state preservation would be more complex, not simpler. It would depend on component shape and hook order, could retain state incompatible with new source, and would contradict React's component-identity model. This plan stores only state the authored view deliberately makes JSON-safe and reconstructible.

## Subplans

None. The URL vocabulary and surface behavior are settled here; implementation can proceed in dependency order.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A URL contains malformed JSON or a non-object `viewState` | Track A doctest | Warn with URL/path context and expose `{}` | Clear in client diagnostics; view uses its default |
| Authored code passes a cyclic value, `undefined`, function, symbol, bigint, or non-finite number | Track A doctest and Track B history-method test | Keep the current state, report a console error plus toast, and return `"rejected"` from `pushState` | Clear diagnostic; no uncaught event-handler exception |
| State replacement drops `?view=`, renderer params, selected path, or unrelated chat search | Track B URL/route doctests | Merge through the surface's current `ViewTarget` and spread unrelated outer search | Test-visible; no silent merge fallback |
| `pushState` accidentally replaces, or `replaceState` creates Back-button spam | Track B browser test on Browse/card/full-page routes | Literal method reaches TanStack Router's `replace` option | Visible through Back/Forward behavior |
| A source update remounts the authored component with default state | Track B browser regression | State lives in the stable host/URL outside `mod.default` | Visible in the probe and locked by test |
| New code cannot interpret an old view state | Authored-view example and knowledge audit; semantic compatibility is view-specific | View validates, defaults, and may normalize with `replaceState` | View-defined; invalid state does not crash the host |
| Two inline embeds compete for one query key | Track C mount test | Inline state is local to each `FileView`; neither writes the page URL | Isolated by construction |
| Replace-only code calls `pushState` | Track C pure decision test and browser console check | Replace, warn once, return `"replaced"` | Clear diagnostic and return value |
| A nested `CardRef` loses its link state or inherits its parent's state | Track C target-codec test and browser probe | Carry a complete child `ViewTarget` | Test-visible |
| Node `bbx view test` omits the new required prop | Existing view typecheck and CLI doctests, extended in Track C | Node host supplies explicit non-push history | Compile/test failure |

No critical gaps remain in the planned codepaths. The actual `mn-pottery` box is private and was unavailable in this worktree, so final acceptance must use a public test-box probe with equivalent multi-page navigation and then a private manual check by the boxholder.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** The API is typed as `viewHistory`; `viewState` is reserved and removed from `params` in Track A. Generated docs distinguish all three terms.
- **Stale ref — ADDRESSED.** State never carries a card ref implicitly. Any ref stored inside authored state remains view-owned data and must use existing `CardLink`/`CardRef` conventions when acted upon.
- **Two agents touching the same card — ADDRESSED.** View history changes only browser/local UI state; it writes no card and introduces no shared-file race.
- **Hand-edit drift — ADDRESSED.** Query strings are an untrusted parsing boundary. Invalid JSON warns and becomes `{}`; semantically obsolete values are validated by authored code.
- **Fabricated free-form value — ADDRESSED.** The JSON object is explicitly untrusted. Examples narrow members before use and do not cast parsed state to a view-specific interface.
- **Validation error UX — ADDRESSED.** Host parse failures appear in client diagnostics without taking down the view; authored validation renders its own default. Replace-only `pushState` calls warn and report `"replaced"` rather than throwing from an event handler.
- **Partial migration / transition state — ADDRESSED.** Old URLs have no `viewState` and parse as `null`. Every `ViewTarget` constructor becomes a compiler error until it supplies the new field. No disk migration exists.

## NOT in scope

- Preserving arbitrary React hooks, DOM nodes, uncontrolled inputs, focus, selection, or element scroll. Those values are not an authored navigation contract.
- A generic snapshot/restore lifecycle or HMR protocol. Concrete URL-addressable state is sufficient for the approved direction.
- Host-managed semantic schemas or migrations for each view's state. The authored view owns interpretation; the host owns only JSON validity.
- Durable server or card storage. `viewState` is ephemeral/shareable browser state.
- Giving inline embeds control of the surrounding page URL. Multiple embeds make that ownership ambiguous.
- Hiding the state in `window.history.state`. TanStack Router and Bee Box already own browser history; the authored envelope remains visible in the URL.
- Special behavior for `.site.card`. The contract applies to every box-authored view.
- Private `mn-pottery` content in fixtures, docs, or commits.

## Open design questions

None blocking. The chosen contract uses a JSON object in `viewState`, browser-like method names, explicit `canPush`, URL-backed history on address-owning surfaces, and visible replace fallback elsewhere. Chat companion remains replace-only; rebuilding its tab model around URL-first Back/Forward is not required for this feature.

## Knowledge audits

Add one `knows_about` audit with `should_read: docs/generated/views.md`: ask a box agent how to preserve a rich authored view's current section across source reload and Back/Forward. A passing answer must choose `viewHistory.state` plus `pushState`/`replaceState`, explain `canPush`, distinguish it from renderer `params` and React `useState`, and avoid direct `window.history` access. This follows the existing view-authoring audit policy: the lightweight `views` skill directs the agent to the generated reference rather than putting the full API in always-loaded context ([`src/core/box/skills-content.ts:462-466`](../../src/core/box/skills-content.ts)). Run the audit against the test box and record its status comment before landing.

## What will hold this after it ships

- Extend `test/frontend/lib/view-url.doctest.md` for absent, valid, malformed, reordered, and round-tripped `viewState`, plus preservation of ordinary params.
- Add a pure history-update decision helper with doctests for push versus replace and preservation of the enclosing target. This makes the cross-surface contract testable without mocking Router, following principle 10 ([`docs/engineering-principles.md:116-125`](../engineering-principles.md)).
- Use pure target/history decision tests for inline isolation, overlay replacement, nested target preservation, and the chat companion's nested `card=` serialization. Existing static-render component doctests cannot exercise interactive router history.
- Add one deterministic browser probe/view fixture: navigate to an inner page, edit the authored module, observe the new module while the inner page remains; then exercise Back/Forward. This is the red-capable regression for the original experience.
- Extend `bbx view test` and view-typecheck doctests so the browser and Node `ViewProps` cannot drift.
- Run `pnpm test:changed`, `pnpm lint:changed`, the named knowledge audit, and `bin/smoke`. Use a labeled `ask: fyi` exhibit for the multi-state browser evidence.

## Implementation order

1. **URL and type contract.** Add `ViewState`, validation, `ViewTarget.viewState`, codec behavior, and pure doctests.
2. **Stable host seam.** Add `viewHistory`, `FileView`'s stable state owner, and one URL-backed page/Browse implementation. Prove module replacement retains the state.
3. **Surface completion.** Wire card page, full view page, Browse, replace-only chat companion persistence, overlay replacement, inline isolation, peeks, nested embeds, and Node host behavior.
4. **Agent contract.** Update generated docs, templates, examples, view-typecheck coverage, and the knowledge audit; regenerate derived files.
5. **End-to-end verification.** Run focused and changed tests, the audit, smoke, and the browser continuity/Back/Forward probe. Keep the private manual check outside public artifacts.

These are commit boundaries, not ship boundaries. The feature lands only after every chunk is complete and the boxholder asks to finish it.

## Rollout shape

Tests lead each chunk. Track A starts with the codec doctest. Track B starts with the host transition test and browser probe that fails when state remains inside `mod.default`. Track C adds each mount to an explicit surface table and does not finish until every `FileView` call site is classified.

There is no disk or data migration. Existing links remain valid; new links add one optional query key. Deployment is an ordinary main-branch frontend/backend build. Done means the focused codec/history tests pass, `test:changed` and lint pass, the knowledge audit reports `knows_about` after reading the generated reference, smoke passes, and the browser probe demonstrates new code plus retained view state and correct Back/Forward behavior on address-owning surfaces.
