import { isRecord } from "@shared/is-record";
import { parseViewUrl, serializeViewUrl } from "../../../lib/view-url";
import { parseSidecarState } from "../sidecar-tabs-storage";
import { type SidecarState, type SidecarTab } from "../sidecar-tabs";
import {
  createEmptyWorkspaceState,
  normalizeWorkspaceState,
  type MobileView,
  type Pane,
  type WorkspaceLayout,
  type WorkspaceState,
} from "./workspace-state";

const KEY_PREFIX = "bbx:workspace-panes:v2";

export type WorkspaceStorageNoticeCode =
  | "invalid-v2"
  | "repaired-v2"
  | "invalid-legacy"
  | "storage-unavailable";

export interface WorkspaceStorageNotice {
  code: WorkspaceStorageNoticeCode;
  message: string;
}

export type WorkspaceRestoreSource = "v2" | "legacy" | "empty";

export interface WorkspaceRestoreResult {
  state: WorkspaceState;
  source: WorkspaceRestoreSource;
  notices: WorkspaceStorageNotice[];
}

/** Same-origin development worktrees must not share conversation state. */
export function conversationStorageScope(apiBase: string): string {
  return apiBase.replace(/^\//, "").replace(/\/api\/?$/, "");
}

export function workspaceStorageKey({
  apiBase,
  logicalConversationId,
}: {
  apiBase: string;
  logicalConversationId: string;
}): string {
  return `${KEY_PREFIX}:${conversationStorageScope(apiBase)}:${logicalConversationId}`;
}

function storedTab(tab: SidecarTab): object {
  return {
    url: serializeViewUrl(tab.target),
    label: tab.label,
    pinned: tab.pinned,
    lastActiveAt: tab.lastActiveAt,
  };
}

export function serializeWorkspaceState(state: WorkspaceState): string {
  return JSON.stringify({
    ...state,
    tabs: Object.fromEntries(Object.entries(state.tabs).map(([path, tab]) => [path, storedTab(tab)])),
  });
}

function parseTab(value: unknown): SidecarTab | null {
  if (!isRecord(value)) return null;
  const { url, label, pinned, lastActiveAt } = value;
  if (typeof url !== "string" || typeof label !== "string" || label === "" || typeof pinned !== "boolean") return null;
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt)) return null;
  const target = parseViewUrl(url);
  return target.path === "" ? null : { target, label, pinned, lastActiveAt };
}

function parsePane(value: unknown): Pane | null {
  if (!isRecord(value) || !Array.isArray(value["paths"]) || !value["paths"].every((path) => typeof path === "string")) return null;
  const activePath = value["activePath"];
  const display = value["display"];
  if (activePath !== null && typeof activePath !== "string") return null;
  if (display !== "cards" && display !== "chat") return null;
  return { paths: value["paths"], activePath, display };
}

function parseLayout(value: unknown): WorkspaceLayout | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "split") return { kind: "split" };
  if (value["kind"] === "focus" && (value["pane"] === "left" || value["pane"] === "right")) {
    return { kind: "focus", pane: value["pane"] };
  }
  return null;
}

function parseMobileView(value: unknown): MobileView | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "chat" && (value["returnPath"] === null || typeof value["returnPath"] === "string")) {
    return { kind: "chat", returnPath: value["returnPath"] };
  }
  if (value["kind"] === "card" && typeof value["path"] === "string") return { kind: "card", path: value["path"] };
  return null;
}

function parseLastInteraction(value: unknown): WorkspaceState["lastInteraction"] | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "chat") return { kind: "chat" };
  if (value["kind"] === "card" && typeof value["path"] === "string") return { kind: "card", path: value["path"] };
  return null;
}

function parseV2(value: unknown): WorkspaceState | null {
  if (!isRecord(value) || value["version"] !== 2 || !isRecord(value["tabs"]) || !isRecord(value["panes"])) return null;
  const tabs: Record<string, SidecarTab> = {};
  for (const [path, rawTab] of Object.entries(value["tabs"])) {
    const tab = parseTab(rawTab);
    if (tab === null || tab.target.path !== path) return null;
    tabs[path] = tab;
  }
  const left = parsePane(value["panes"]["left"]);
  const right = parsePane(value["panes"]["right"]);
  const layout = parseLayout(value["layout"]);
  const mobileView = parseMobileView(value["mobileView"]);
  const lastInteraction = parseLastInteraction(value["lastInteraction"]);
  const lastCardPane = value["lastCardPane"];
  const chatAnchor = value["chatAnchor"];
  if (left === null || right === null || layout === null || mobileView === null || lastInteraction === null) return null;
  if ((lastCardPane !== "left" && lastCardPane !== "right") || (chatAnchor !== "left" && chatAnchor !== "right")) return null;
  return {
    version: 2,
    tabs,
    panes: { left, right },
    layout,
    lastCardPane,
    chatAnchor,
    mobileView,
    lastInteraction,
  };
}

function invalidNotice(code: "invalid-v2" | "invalid-legacy", subject: string): WorkspaceStorageNotice {
  return { code, message: `The saved ${subject} could not be restored. Your current workspace is still usable.` };
}

export function parseWorkspaceState(raw: string | null): WorkspaceRestoreResult {
  if (raw === null || raw === "") return { state: createEmptyWorkspaceState(), source: "empty", notices: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    void error;
    return { state: createEmptyWorkspaceState(), source: "empty", notices: [invalidNotice("invalid-v2", "workspace")] };
  }
  const parsed = parseV2(value);
  if (parsed === null) {
    return { state: createEmptyWorkspaceState(), source: "empty", notices: [invalidNotice("invalid-v2", "workspace")] };
  }
  const state = normalizeWorkspaceState(parsed);
  const repaired = serializeWorkspaceState(state) !== serializeWorkspaceState(parsed);
  return {
    state,
    source: "v2",
    notices: repaired ? [{ code: "repaired-v2", message: "Some saved workspace entries were repaired while restoring." }] : [],
  };
}

function workspaceFromStrip(strip: SidecarState): WorkspaceState {
  const state = createEmptyWorkspaceState();
  const paths = strip.tabs.map((tab) => tab.target.path);
  return normalizeWorkspaceState({
    ...state,
    tabs: Object.fromEntries(strip.tabs.map((tab) => [tab.target.path, tab])),
    panes: {
      left: { paths, activePath: strip.activePath, display: paths.length > 0 ? "cards" : "chat" },
      right: { paths: [], activePath: null, display: "chat" },
    },
    lastCardPane: "left",
    chatAnchor: "right",
    mobileView: strip.activePath === null ? { kind: "chat", returnPath: null } : { kind: "card", path: strip.activePath },
    lastInteraction: strip.activePath === null ? { kind: "chat" } : { kind: "card", path: strip.activePath },
  });
}

/** Import is intentionally impossible until the caller proves the old key is local. */
export function importTrustedLegacyWorkspace(raw: string | null): WorkspaceRestoreResult {
  if (raw === null || raw === "") return { state: createEmptyWorkspaceState(), source: "empty", notices: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    void error;
    return { state: createEmptyWorkspaceState(), source: "empty", notices: [invalidNotice("invalid-legacy", "card tabs")] };
  }
  if (!isRecord(value) || value["v"] !== 1) {
    return { state: createEmptyWorkspaceState(), source: "empty", notices: [invalidNotice("invalid-legacy", "card tabs")] };
  }
  const strip = parseSidecarState(JSON.stringify(value));
  if (strip === null) {
    return { state: createEmptyWorkspaceState(), source: "empty", notices: [invalidNotice("invalid-legacy", "card tabs")] };
  }
  return { state: workspaceFromStrip(strip), source: "legacy", notices: [] };
}

export function restoreWorkspaceState({
  v2Raw,
  trustedLegacyRaw,
}: {
  v2Raw: string | null;
  trustedLegacyRaw?: string | null;
}): WorkspaceRestoreResult {
  const v2 = parseWorkspaceState(v2Raw);
  if (v2.source === "v2") return v2;
  const legacy = importTrustedLegacyWorkspace(trustedLegacyRaw ?? null);
  if (legacy.source === "legacy") return { ...legacy, notices: [...v2.notices, ...legacy.notices] };
  return { state: createEmptyWorkspaceState(), source: "empty", notices: [...v2.notices, ...legacy.notices] };
}

export function storageUnavailableNotice(error: unknown): WorkspaceStorageNotice {
  const detail = error instanceof Error && error.message !== "" ? ` (${error.message})` : "";
  return { code: "storage-unavailable", message: `Workspace persistence is unavailable${detail}. This workspace will remain usable until reload.` };
}
