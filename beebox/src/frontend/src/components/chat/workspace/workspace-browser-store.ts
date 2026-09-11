import { sidecarTabsKey } from "../sidecar-tabs-storage";
import { createEmptyWorkspaceState, reduceWorkspace, type WorkspaceAction, type WorkspaceState } from "./workspace-state";
import { restoreWorkspaceState, serializeWorkspaceState, storageUnavailableNotice, workspaceStorageKey } from "./workspace-storage";

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceStoreAdoption {
  from: string;
  to: string;
}

export interface WorkspaceBrowserStoreOptions {
  apiBase: string;
  boxSlug: string;
  storage: WorkspaceStorage | null;
}

function browserStorage(): WorkspaceStorage | null {
  try {
    if (!("sessionStorage" in globalThis)) return null;
    return globalThis.sessionStorage;
  } catch (error) {
    // The null storage path publishes a visible persistence notice while the
    // in-memory workspace remains usable.
    void error;
    return null;
  }
}

function trustsLegacyKey(apiBase: string, boxSlug: string): boolean {
  const scope = apiBase.replace(/^\//, "").replace(/\/api\/?$/, "");
  const [worktree] = scope.split("/");
  return !scope.includes("/") || (worktree !== undefined && worktree !== "" && boxSlug.includes(worktree));
}

/** Synchronous writes prevent an old conversation's debounce from winning assignment. */
export function createWorkspaceBrowserStore(
  apiBase: string,
  boxSlug: string,
) {
  return createWorkspaceBrowserStoreWithStorage({ apiBase, boxSlug, storage: browserStorage() });
}

export function createWorkspaceBrowserStoreWithStorage({
  apiBase,
  boxSlug,
  storage,
}: WorkspaceBrowserStoreOptions) {
  let state = createEmptyWorkspaceState();
  let identity = "";
  let adoption: WorkspaceStoreAdoption | null = null;
  let notice: string | null = storage === null ? storageUnavailableNotice("sessionStorage is unavailable").message : null;
  const listeners = new Set<() => void>();
  const memory = new Map<string, WorkspaceState>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function reportStorageFailure(error: unknown): void {
    notice = storageUnavailableNotice(error).message;
    // `useSyncExternalStore` compares snapshots by identity. A failed read may
    // leave the contents unchanged, but the new notice must still render.
    state = { ...state };
  }

  function save(): boolean {
    if (identity === "") return true;
    memory.set(identity, state);
    if (storage === null) {
      reportStorageFailure("sessionStorage is unavailable");
      return false;
    }
    try {
      storage.setItem(workspaceStorageKey({ apiBase, logicalConversationId: identity }), serializeWorkspaceState(state));
      return true;
    } catch (error) {
      reportStorageFailure(error);
      return false;
    }
  }

  function quarantine(key: string, raw: string): void {
    if (storage === null) return;
    try {
      storage.setItem(`${key}:unreadable`, raw);
    } catch (error) {
      reportStorageFailure(error);
    }
  }

  function select(nextIdentity: string): void {
    if (identity === nextIdentity || nextIdentity === "") return;
    save();
    adoption = null;
    identity = nextIdentity;
    const cached = memory.get(identity);
    state = cached ?? createEmptyWorkspaceState();
    if (cached !== undefined) {
      notify();
      return;
    }
    if (storage === null) {
      reportStorageFailure("sessionStorage is unavailable");
      notify();
      return;
    }
    try {
      const key = workspaceStorageKey({ apiBase, logicalConversationId: identity });
      const raw = storage.getItem(key);
      const trusted = trustsLegacyKey(apiBase, boxSlug);
      const legacy = trusted ? storage.getItem(sidecarTabsKey({ boxSlug, sessionInput: identity })) : null;
      const restored = restoreWorkspaceState({
        v2Raw: raw,
        trustedLegacyRaw: legacy,
      });
      state = restored.state;
      memory.set(identity, state);
      notice = restored.notices.map((item) => item.message).join(" ") || null;
      if (raw !== null && restored.notices.some((item) => item.code === "invalid-v2")) quarantine(key, raw);
    } catch (error) {
      reportStorageFailure(error);
    }
    notify();
  }

  return {
    get: (): WorkspaceState => state,
    getIdentity: (): string => identity,
    getAdoption: (): WorkspaceStoreAdoption | null => adoption,
    getNotice: (): string | null => notice,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select,
    adopt(nextIdentity: string): void {
      if (nextIdentity === "" || nextIdentity === identity) return;
      adoption = { from: identity, to: nextIdentity };
      identity = nextIdentity;
      memory.set(identity, state);
      save();
      notify();
    },
    clearAdoption(): void {
      if (adoption === null) return;
      adoption = null;
      notify();
    },
    dispatch(action: WorkspaceAction) {
      const result = reduceWorkspace(state, action);
      state = result.state;
      save();
      notify();
      return result;
    },
    replace(next: WorkspaceState): void {
      state = next;
      save();
      notify();
    },
  };
}
