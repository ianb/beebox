---
title: "State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState"
status: implemented
workstream: unknown
issues: []
---
# State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState

Modeling the **HistoryPage** in both frameworks to compare developer experience, testability, and the "hand it a JSON blob" workflow.

## Current implementation (no state library)

The page has 4 pieces of state, inline data fetching, and URL synchronization:

```tsx
// Current: useState + useEffect + useCallback
function HistoryPage() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const loadCommits = useCallback(async (offset: number) => {
    setLoading(true);
    const result = await getHistory(PAGE_SIZE, offset);
    if (offset === 0) {
      setCommits(result.commits);
      // auto-select from URL or first
      const match = urlHash ? result.commits.find(c => c.hash.startsWith(urlHash)) : null;
      setSelectedCommit(match || result.commits[0] || null);
    } else {
      setCommits(prev => [...prev, ...result.commits]);
    }
    setHasMore(result.commits.length === PAGE_SIZE);
    setLoading(false);
  }, [urlHash]);

  useEffect(() => { loadCommits(0); }, [loadCommits]);
  // ... render
}
```

State is tangled with fetching, URL sync, and rendering. You can't render the page in a specific state without running the fetch logic.

---

## Zustand version

### Store definition

```tsx
import { create } from "zustand";

interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
}

interface HistoryState {
  // Data
  commits: HistoryCommit[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
}

interface HistoryActions {
  // Actions (not serialized — these are functions)
  select: (hash: string | null) => void;
  loadPage: (offset: number) => Promise<void>;
  loadMore: () => Promise<void>;
}

const PAGE_SIZE = 50;

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  // Initial state (serializable)
  commits: [],
  selectedHash: null,
  loading: true,
  hasMore: true,

  // Actions
  select: (hash) => set({ selectedHash: hash }),

  loadPage: async (offset) => {
    set({ loading: true });
    const result = await getHistory(PAGE_SIZE, offset);
    if (offset === 0) {
      set({
        commits: result.commits,
        hasMore: result.commits.length === PAGE_SIZE,
        loading: false,
      });
    } else {
      set((state) => ({
        commits: [...state.commits, ...result.commits],
        hasMore: result.commits.length === PAGE_SIZE,
        loading: false,
      }));
    }
  },

  loadMore: async () => {
    const { commits, loadPage } = get();
    await loadPage(commits.length);
  },
}));
```

### Component (pure rendering)

```tsx
function HistoryPage() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const { commits, selectedHash, loading, hasMore, select, loadPage } = useHistoryStore();
  const selectedCommit = commits.find(c => c.hash === selectedHash) || null;

  // Effects: initial load + URL sync
  useEffect(() => { loadPage(0); }, [loadPage]);
  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      const match = urlHash ? commits.find(c => c.hash.startsWith(urlHash)) : commits[0];
      if (match) select(match.hash);
    }
  }, [commits, urlHash, selectedHash, select]);

  const handleSelect = (commit: HistoryCommit) => {
    select(commit.hash);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  return (
    <div className="h-full flex">
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={!!selectedCommit}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedHash}
          onSelect={handleSelect}
          onLoadMore={() => useHistoryStore.getState().loadMore()}
          hasMore={hasMore}
          loading={loading}
        />
      </Sidebar>
      {/* ... detail panel same as before */}
    </div>
  );
}
```

### Testing

```tsx
test("renders commits from state blob", () => {
  // Set state directly — no fetch, no server
  useHistoryStore.setState({
    commits: [
      { hash: "abc123", date: "2026-03-01", subject: "Fix bug" },
      { hash: "def456", date: "2026-03-01", subject: "Add feature" },
    ],
    selectedHash: "abc123",
    loading: false,
    hasMore: false,
  }, true);  // `true` = replace entire state

  render(<HistoryPage />);
  expect(screen.getByText("Fix bug")).toBeInTheDocument();
  expect(screen.getByText("2 loaded")).toBeInTheDocument();
});

test("loading state shows spinner", () => {
  useHistoryStore.setState({
    commits: [],
    selectedHash: null,
    loading: true,
    hasMore: true,
  }, true);

  render(<HistoryPage />);
  expect(screen.getByText("Loading...")).toBeInTheDocument();
});
```

### State catalog (development)

```tsx
// dev/state-fixtures/history.ts
export const historyStates = {
  empty: { commits: [], selectedHash: null, loading: false, hasMore: false },
  loading: { commits: [], selectedHash: null, loading: true, hasMore: true },
  fewCommits: {
    commits: [
      { hash: "abc123", date: "2026-03-01", subject: "Fix capture timeline assembly" },
      { hash: "def456", date: "2026-02-28", subject: "Add calendar sync" },
    ],
    selectedHash: "abc123",
    loading: false,
    hasMore: false,
  },
  manyCommits: {
    commits: Array.from({ length: 50 }, (_, i) => ({
      hash: `hash${i}`,
      date: "2026-03-01",
      subject: `Commit ${i}`,
    })),
    selectedHash: "hash0",
    loading: false,
    hasMore: true,
  },
};

// Usage in dev: useHistoryStore.setState(historyStates.manyCommits, true)
```

### Notes

- **State is a plain object** — `getState()` returns `{ commits, selectedHash, loading, hasMore }` (plus the action functions, which you ignore for serialization)
- **Actions are mixed into the store** — they live alongside state. Zustand doesn't enforce a separation. You'd need discipline (or a wrapper) to keep the serializable part clean.
- **No schema** — TypeScript interfaces define the shape, but nothing prevents you from putting non-serializable values in state at runtime
- **URL sync is still in the component** — Zustand doesn't have an opinion about routing. The `useEffect` that syncs URL → selectedHash stays in the component.
- **~3KB** added to bundle

---

## MobX-State-Tree version

### Model definition

```tsx
import { types, Instance, SnapshotIn, SnapshotOut, getSnapshot, applySnapshot } from "mobx-state-tree";

const CommitModel = types.model("Commit", {
  hash: types.string,
  date: types.string,
  subject: types.string,
  body: types.maybe(types.string),
  // trailers omitted for simplicity — would need types.map(types.union(types.string, types.array(types.string)))
});

const HistoryStore = types
  .model("HistoryStore", {
    commits: types.array(CommitModel),
    selectedHash: types.maybeNull(types.string),
    loading: types.optional(types.boolean, true),
    hasMore: types.optional(types.boolean, true),
  })
  .views((self) => ({
    get selectedCommit() {
      return self.selectedHash
        ? self.commits.find((c) => c.hash === self.selectedHash) || null
        : null;
    },
  }))
  .actions((self) => ({
    select(hash: string | null) {
      self.selectedHash = hash;
    },
    setCommits(commits: SnapshotIn<typeof CommitModel>[], append: boolean) {
      if (append) {
        self.commits.push(...commits);
      } else {
        self.commits.replace(commits);
      }
    },
    setLoading(v: boolean) { self.loading = v; },
    setHasMore(v: boolean) { self.hasMore = v; },
  }))
  .actions((self) => ({
    async loadPage(offset: number) {
      self.setLoading(true);
      const result = await getHistory(PAGE_SIZE, offset);
      self.setCommits(result.commits, offset > 0);
      self.setHasMore(result.commits.length === PAGE_SIZE);
      self.setLoading(false);
    },
    async loadMore() {
      await (self as any).loadPage(self.commits.length);
    },
  }));

// Create instance
const historyStore = HistoryStore.create({
  commits: [],
  selectedHash: null,
  loading: true,
  hasMore: true,
});
```

### Component (with observer)

```tsx
import { observer } from "mobx-react-lite";

const HistoryPage = observer(() => {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const store = historyStore; // or from React context

  useEffect(() => { store.loadPage(0); }, [store]);
  useEffect(() => {
    if (store.commits.length > 0 && !store.selectedHash) {
      const match = urlHash
        ? store.commits.find(c => c.hash.startsWith(urlHash))
        : store.commits[0];
      if (match) store.select(match.hash);
    }
  }, [store.commits.length, urlHash, store.selectedHash]);

  const handleSelect = (commit: Instance<typeof CommitModel>) => {
    store.select(commit.hash);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  return (
    <div className="h-full flex">
      <Sidebar title="Commits" subtitle={`${store.commits.length} loaded`} detailSelected={!!store.selectedCommit}>
        <CommitTimeline
          commits={store.commits}
          selectedHash={store.selectedHash}
          onSelect={handleSelect}
          onLoadMore={() => store.loadMore()}
          hasMore={store.hasMore}
          loading={store.loading}
        />
      </Sidebar>
      {/* ... detail panel */}
    </div>
  );
});
```

### Testing

```tsx
test("renders commits from snapshot", () => {
  // Create a store from a plain JSON snapshot — MST's core concept
  const store = HistoryStore.create({
    commits: [
      { hash: "abc123", date: "2026-03-01", subject: "Fix bug" },
      { hash: "def456", date: "2026-03-01", subject: "Add feature" },
    ],
    selectedHash: "abc123",
    loading: false,
    hasMore: false,
  });

  render(<HistoryPage store={store} />);
  expect(screen.getByText("Fix bug")).toBeInTheDocument();
});

test("snapshot round-trip", () => {
  const store = HistoryStore.create({
    commits: [{ hash: "abc", date: "2026-03-01", subject: "Test" }],
    selectedHash: "abc",
    loading: false,
    hasMore: false,
  });

  // Get snapshot — plain JSON, no functions, no types
  const snapshot = getSnapshot(store);
  // JSON round-trip works
  const json = JSON.parse(JSON.stringify(snapshot));
  // Recreate from JSON
  const restored = HistoryStore.create(json);
  expect(restored.selectedCommit?.subject).toBe("Test");
});

test("applySnapshot replaces state", () => {
  const store = HistoryStore.create({ commits: [], selectedHash: null, loading: true, hasMore: true });
  applySnapshot(store, {
    commits: [{ hash: "x", date: "2026-03-01", subject: "New" }],
    selectedHash: "x",
    loading: false,
    hasMore: false,
  });
  expect(store.selectedCommit?.subject).toBe("New");
});
```

### State catalog (development)

```tsx
// Same fixtures work — MST accepts plain JSON as snapshots
const store = HistoryStore.create(historyStates.manyCommits);
// Or swap state at runtime:
applySnapshot(store, historyStates.empty);
```

### Notes

- **Snapshots are a first-class concept** — `getSnapshot()` always returns a plain JSON-serializable object. The framework guarantees this, not developer discipline.
- **Typed models** — `types.model()` defines both the shape and the validation. You can't put non-serializable values in state; MST will throw.
- **Views are derived** — `selectedCommit` is a computed view, not stored state. It recomputes automatically when `selectedHash` or `commits` change.
- **Actions are separate from state** — clear boundary between data (snapshot) and behavior (actions). Actions don't appear in snapshots.
- **observer() wrapper** — components must be wrapped in `observer()` for MobX reactivity. This is a different mental model from React's immutable state / re-render cycle.
- **~30KB+** added to bundle (MobX + MST)
- **Requires MobX** — adds a proxy-based reactivity system alongside React's own

---

## Valtio version

### Store definition

```tsx
import { proxy, snapshot, subscribe } from "valtio";

interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
}

const PAGE_SIZE = 50;

// State is a mutable proxy — you write to it like a normal object
export const historyState = proxy({
  commits: [] as HistoryCommit[],
  selectedHash: null as string | null,
  loading: true,
  hasMore: true,
});

// Actions are plain functions that mutate the proxy
export function select(hash: string | null) {
  historyState.selectedHash = hash;
}

export async function loadPage(offset: number) {
  historyState.loading = true;
  const result = await getHistory(PAGE_SIZE, offset);
  if (offset === 0) {
    historyState.commits = result.commits;
  } else {
    historyState.commits.push(...result.commits);
  }
  historyState.hasMore = result.commits.length === PAGE_SIZE;
  historyState.loading = false;
}

export async function loadMore() {
  await loadPage(historyState.commits.length);
}
```

### Component (with useSnapshot)

```tsx
import { useSnapshot } from "valtio";

function HistoryPage() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const snap = useSnapshot(historyState);
  const selectedCommit = snap.commits.find(c => c.hash === snap.selectedHash) || null;

  useEffect(() => { loadPage(0); }, []);
  useEffect(() => {
    if (snap.commits.length > 0 && !snap.selectedHash) {
      const match = urlHash
        ? snap.commits.find(c => c.hash.startsWith(urlHash))
        : snap.commits[0];
      if (match) select(match.hash);
    }
  }, [snap.commits.length, urlHash, snap.selectedHash]);

  const handleSelect = (commit: HistoryCommit) => {
    select(commit.hash);
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  return (
    <div className="h-full flex">
      <Sidebar title="Commits" subtitle={`${snap.commits.length} loaded`} detailSelected={!!selectedCommit}>
        <CommitTimeline
          commits={snap.commits as HistoryCommit[]}  // useSnapshot returns readonly
          selectedHash={snap.selectedHash}
          onSelect={handleSelect}
          onLoadMore={loadMore}
          hasMore={snap.hasMore}
          loading={snap.loading}
        />
      </Sidebar>
      {/* ... detail panel */}
    </div>
  );
}
```

### Testing

```tsx
import { snapshot } from "valtio";

test("renders commits from state", () => {
  // Mutate the proxy directly — simple assignment
  historyState.commits = [
    { hash: "abc123", date: "2026-03-01", subject: "Fix bug" },
    { hash: "def456", date: "2026-03-01", subject: "Add feature" },
  ];
  historyState.selectedHash = "abc123";
  historyState.loading = false;
  historyState.hasMore = false;

  render(<HistoryPage />);
  expect(screen.getByText("Fix bug")).toBeInTheDocument();
});

test("snapshot returns immutable plain object", () => {
  historyState.commits = [{ hash: "abc", date: "2026-03-01", subject: "Test" }];
  historyState.selectedHash = "abc";

  // snapshot() returns a frozen plain object — JSON-safe
  const snap = snapshot(historyState);
  const json = JSON.parse(JSON.stringify(snap));
  expect(json.commits[0].subject).toBe("Test");
});
```

### State catalog (development)

```tsx
// To load a fixture, just assign fields:
Object.assign(historyState, historyStates.manyCommits);
// Or more precisely:
historyState.commits = historyStates.manyCommits.commits;
historyState.selectedHash = historyStates.manyCommits.selectedHash;
historyState.loading = historyStates.manyCommits.loading;
historyState.hasMore = historyStates.manyCommits.hasMore;
```

### Notes

- **Mutable writes, immutable reads** — you write `state.loading = true` (feels like vanilla JS), but `useSnapshot()` returns a frozen, immutable view. Valtio uses JS Proxy under the hood to track which fields each component reads, so re-renders are automatic and granular.
- **Actions are just functions** — no special API. Any function that mutates the proxy triggers updates. Very low ceremony.
- **`snapshot()` gives you a plain object** — frozen and JSON-serializable. But there's no `applySnapshot()` equivalent — you have to assign fields individually or use `Object.assign`.
- **No "replace all state" primitive** — unlike Zustand's `setState(blob, true)` or MST's `applySnapshot()`, Valtio doesn't have a single call that replaces the entire proxy. You'd write a helper.
- **Readonly snapshots in components** — `useSnapshot()` returns deeply readonly types. When passing to child components that expect mutable types, you need type casts.
- **~3KB** added to bundle
- **Same author as Zustand** (Daishi Kato / pmndrs)

---

## XState version

XState models state as a **state machine** — explicit states with defined transitions between them, rather than a bag of data.

### Machine definition

```tsx
import { setup, assign, fromPromise } from "xstate";

interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
}

const PAGE_SIZE = 50;

const historyMachine = setup({
  types: {
    context: {} as {
      commits: HistoryCommit[];
      selectedHash: string | null;
      hasMore: boolean;
      error: string | null;
    },
    events: {} as
      | { type: "SELECT"; hash: string | null }
      | { type: "LOAD_MORE" }
      | { type: "RETRY" },
  },
  actors: {
    fetchPage: fromPromise(async ({ input }: { input: { offset: number } }) => {
      return await getHistory(PAGE_SIZE, input.offset);
    }),
  },
}).createMachine({
  id: "history",
  initial: "loading",
  context: {
    commits: [],
    selectedHash: null,
    hasMore: true,
    error: null,
  },
  on: {
    // SELECT works in any state
    SELECT: { actions: assign({ selectedHash: ({ event }) => event.hash }) },
  },
  states: {
    loading: {
      invoke: {
        src: "fetchPage",
        input: ({ context }) => ({ offset: context.commits.length }),
        onDone: {
          target: "idle",
          actions: assign({
            commits: ({ context, event }) =>
              context.commits.length === 0
                ? event.output.commits
                : [...context.commits, ...event.output.commits],
            hasMore: ({ event }) => event.output.commits.length === PAGE_SIZE,
            error: null,
          }),
        },
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
    },
    idle: {
      on: {
        LOAD_MORE: { target: "loading", guard: ({ context }) => context.hasMore },
      },
    },
    error: {
      on: {
        RETRY: "loading",
      },
    },
  },
});
```

### Component (with useMachine)

```tsx
import { useMachine } from "@xstate/react";

function HistoryPage() {
  const { hash: urlHash } = useParams<{ hash?: string }>();
  const navigate = useNavigate();
  const [state, send] = useMachine(historyMachine);
  const { commits, selectedHash, hasMore } = state.context;
  const selectedCommit = commits.find(c => c.hash === selectedHash) || null;
  const loading = state.matches("loading");

  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      const match = urlHash
        ? commits.find(c => c.hash.startsWith(urlHash))
        : commits[0];
      if (match) send({ type: "SELECT", hash: match.hash });
    }
  }, [commits.length, urlHash, selectedHash, send]);

  const handleSelect = (commit: HistoryCommit) => {
    send({ type: "SELECT", hash: commit.hash });
    navigate(commit.hash.substring(0, 8), { replace: true });
  };

  return (
    <div className="h-full flex">
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={!!selectedCommit}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedHash}
          onSelect={handleSelect}
          onLoadMore={() => send({ type: "LOAD_MORE" })}
          hasMore={hasMore}
          loading={loading}
        />
      </Sidebar>
      {/* ... detail panel */}
      {state.matches("error") && (
        <div className="p-4 text-red-600">
          Error: {state.context.error}
          <button onClick={() => send({ type: "RETRY" })}>Retry</button>
        </div>
      )}
    </div>
  );
}
```

### Testing

```tsx
import { createActor } from "xstate";

test("machine starts in loading state", () => {
  const actor = createActor(historyMachine).start();
  expect(actor.getSnapshot().value).toBe("loading");
  actor.stop();
});

test("transitions to idle after fetch", async () => {
  // Mock getHistory to return immediately
  const actor = createActor(historyMachine).start();
  // Wait for invoke to complete...
  await waitFor(() => {
    expect(actor.getSnapshot().value).toBe("idle");
  });
  expect(actor.getSnapshot().context.commits.length).toBeGreaterThan(0);
  actor.stop();
});

test("restore from persisted snapshot", () => {
  const persisted = {
    value: "idle",
    context: {
      commits: [{ hash: "abc", date: "2026-03-01", subject: "Test" }],
      selectedHash: "abc",
      hasMore: false,
      error: null,
    },
  };

  const actor = createActor(historyMachine, { snapshot: persisted }).start();
  expect(actor.getSnapshot().value).toBe("idle");
  expect(actor.getSnapshot().context.commits[0].subject).toBe("Test");
  actor.stop();
});

test("LOAD_MORE guarded when hasMore is false", () => {
  const persisted = {
    value: "idle",
    context: { commits: [{ hash: "a", date: "d", subject: "s" }], selectedHash: null, hasMore: false, error: null },
  };
  const actor = createActor(historyMachine, { snapshot: persisted }).start();
  send({ type: "LOAD_MORE" });
  // Should stay in idle — guard prevents transition
  expect(actor.getSnapshot().value).toBe("idle");
  actor.stop();
});
```

### State catalog (development)

```tsx
// XState snapshots include both the state *value* (which node) and context (data)
const historySnapshots = {
  loading: {
    value: "loading",
    context: { commits: [], selectedHash: null, hasMore: true, error: null },
  },
  idle_few: {
    value: "idle",
    context: {
      commits: [
        { hash: "abc123", date: "2026-03-01", subject: "Fix bug" },
        { hash: "def456", date: "2026-02-28", subject: "Add feature" },
      ],
      selectedHash: "abc123",
      hasMore: false,
      error: null,
    },
  },
  error: {
    value: "error",
    context: { commits: [], selectedHash: null, hasMore: true, error: "Network timeout" },
  },
};
```

### Notes

- **Explicit states** — "loading", "idle", "error" are named states, not boolean flags. The machine literally cannot be in "loading" and "error" at the same time. This eliminates impossible states by design (e.g., `loading: true, error: "something"` can't happen).
- **Guards** — LOAD_MORE only fires when `hasMore` is true. The machine won't transition if the guard fails. No runtime checks needed in the component.
- **Error handling is a state** — not a separate `try/catch` or error flag. The machine transitions to "error" on fetch failure, and RETRY transitions back to "loading". Clear recovery path.
- **Persisted snapshots include the state value** — not just the data, but *which state* the machine is in. This is more precise than the other frameworks: you know both the data and the behavioral mode.
- **Testing is behavior-focused** — you test transitions ("what happens when LOAD_MORE is sent in idle state with hasMore=false?") not just data assertions.
- **More code for simple cases** — the machine definition is ~60 lines vs ~30 for Zustand. The ceremony pays off for complex flows (multi-step forms, auth flows, WebSocket lifecycle) but feels heavy for a list-with-pagination page.
- **~15KB** added to bundle (xstate + @xstate/react)
- **Different paradigm** — state machines think about *what states exist and what transitions are valid*, not *what data is stored*. Best for pages with complex flow logic (chat page, admin auth polling), less natural for data-heavy pages.

---

## Comparison

| Aspect | Zustand | MobX-State-Tree | Valtio | XState |
|---|---|---|---|---|
| **Bundle size** | ~3KB | ~30KB+ | ~3KB | ~15KB |
| **Serializable state** | By convention | By design (enforced) | By convention | By design (context is data) |
| **Snapshot API** | `getState()` / `setState(blob)` | `getSnapshot()` / `applySnapshot()` | `snapshot()` / manual assign | `getPersistedSnapshot()` / `{ snapshot }` |
| **Replace all state** | `setState(blob, true)` | `applySnapshot(store, blob)` | No built-in (manual assign) | `createActor(m, { snapshot })` |
| **Type safety** | TS interfaces (compile-time) | Runtime `types.model()` | TS interfaces (compile-time) | TS + runtime guards |
| **Actions vs state** | Mixed in one object | Explicitly separated | Separate functions | Events + machine definition |
| **Derived state** | Manual / selectors | Built-in `views` | `derive()` utility | Machine `context` + state value |
| **Reactivity** | React-native (hooks) | MobX proxies + `observer()` | Proxy + `useSnapshot()` | React-native (`useMachine`) |
| **Learning curve** | Minimal | Significant | Low | Significant (different paradigm) |
| **Component wrapping** | None (just a hook) | `observer()` everywhere | None (just a hook) | None (`useMachine` hook) |
| **Impossible states** | Not prevented | Not prevented | Not prevented | Prevented by design |
| **Error handling** | Manual try/catch | Manual try/catch | Manual try/catch | Error is a state (first-class) |
| **Ecosystem fit** | Hooks-native | Requires MobX | Hooks-native | Hooks-native |

## Key differences for the "JSON blob" use case

All four support the pattern of "hand it state, get UI." They differ in what they serialize and how they enforce it:

**Zustand** — `getState()` returns data + action functions mixed together. You'd strip functions for serialization. `setState(blob, true)` replaces all state. Nothing stops you from putting non-serializable values in state.

**MST** — `getSnapshot()` returns *only* data, guaranteed JSON-serializable. The framework enforces this at the type level. `applySnapshot()` cleanly replaces state. Strongest guarantees, but you define types twice (TS + MST).

**Valtio** — `snapshot()` returns a frozen immutable view. But there's no `applySnapshot` — you assign fields individually. The mutable-write API is the simplest of all four, but the "restore from blob" story is the weakest.

**XState** — Persisted snapshots include both the *state value* (which node: loading/idle/error) and the *context* (data). This is the most precise: you know both what data exists and what behavioral mode the app is in. But the machine definition is the most verbose, and it's a fundamentally different way of thinking.

## Which approach for which page?

Not every page needs the same tool. These could coexist:

| Page | Best fit | Why |
|---|---|---|
| **HistoryPage** | Zustand or Valtio | Simple data + pagination. No complex flow. |
| **DashboardPage** | Zustand | Multiple independent data sources, straightforward aggregation |
| **QuestionsPage** | Zustand or plain hooks | Simple enough that hooks might suffice |
| **ChatPage** | XState (for flow) + Zustand (for data) | Recording→transcribing→sending→playing has complex state transitions. Message list is just data. |
| **AdminPage** | XState | Auth polling flow (idle→starting→waiting→polling) maps perfectly to a state machine |
| **NewsPage** | Zustand | Data-heavy (brief list, current brief, feedback state) but straightforward flow |

## Assessment

**Zustand** is the pragmatic default. Minimal learning curve, hooks-native, good enough snapshot support. Needs discipline to keep state serializable, but TypeScript can enforce that at compile time.

**Valtio** writes the most natural-looking code (plain mutation), but its "restore from blob" story is weaker than Zustand's. Since the whole point of this exercise is the "hand it a JSON blob" workflow, that's a real gap.

**MST** has the strongest snapshot story by far, but introduces a second type system and a proxy-based reactivity model that doesn't match the existing codebase's React hooks style. The ~30KB cost is also significant for a mobile-targeted app.

**XState** is the right tool for specific pages with complex flow logic (ChatPage, AdminPage auth), but not for data-heavy pages. Could be used alongside a data store.

A practical approach: **Zustand as the primary store**, with XState considered for pages where state transitions matter more than data (chat, admin auth). This avoids the "one framework for everything" trap while keeping the JSON-blob workflow as the default.
