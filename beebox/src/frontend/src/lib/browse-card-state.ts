/** Browse is one instrument; directory and selected detail belong to its state. */
import { isRecord } from "@shared/is-record";
import { parseRef, resolveRefPath } from "@shared/ref-path";
import { validateViewState, type ViewState } from "@shared/view-state";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import type { ViewTarget } from "./view-url.js";

export interface BrowseState {
  directory: string;
  detail?: ViewTarget;
}
export type BrowseStateResult = { ok: true; state: BrowseState } | { ok: false; error: string };
export type BrowsePathKind = "directory" | "file" | "missing";
export type BrowseMissingKind = Exclude<BrowsePathKind, "missing">;

export class BrowseLocationError extends Error {
  constructor(path: string, missing: boolean) {
    super(`${missing ? "Browse location does not exist" : "Invalid Browse location"}: ${path}`);
    this.name = "BrowseLocationError";
  }
}

function canonicalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "" || value === "/") return "";
  const ref = parseRef(value);
  if (ref.query !== undefined || ref.fragment !== undefined || value.startsWith("//") || /^[a-z][\w+.-]*:/i.test(value)) return null;
  return resolveRefPath({ fromPath: undefined, ref: value, kind: "write-target" });
}

export function browseParent(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

function parseDetail(value: unknown): ViewTarget | null {
  if (!isRecord(value)) return null;
  const path = canonicalPath(value["path"]);
  const viewer = value["viewer"];
  const params = value["params"];
  const viewState = value["viewState"];
  if (!path || !(viewer === null || typeof viewer === "string") || !isRecord(params)
    || !Object.values(params).every((item) => typeof item === "string")
    || !(viewState === null || validateViewState(viewState))) return null;
  const strings: Record<string, string> = {};
  for (const [key, item] of Object.entries(params)) if (typeof item === "string") strings[key] = item;
  return { path, viewer, params: strings, viewState };
}

export function parseBrowseState(input: { viewState?: ViewState | null; params?: Record<string, string> }): BrowseStateResult {
  const raw = input.viewState;
  const directory = canonicalPath(raw ? raw["directory"] : input.params?.["dir"] ?? "");
  if (directory === null) return { ok: false, error: `Invalid Browse directory: ${String(raw?.["directory"] ?? input.params?.["dir"] ?? "")}` };
  if (raw?.["detail"] === undefined) return { ok: true, state: { directory } };
  const detail = parseDetail(raw["detail"]);
  if (!detail || browseParent(detail.path) !== directory) return { ok: false, error: "Invalid Browse detail: expected a file target inside the current directory." };
  return { ok: true, state: { directory, detail } };
}

export function browseStateToViewState(state: BrowseState): ViewState {
  return { directory: state.directory, ...(state.detail ? { detail: { ...state.detail } } : {}) };
}

export function browseCardTarget(state: BrowseState): ViewTarget {
  return { path: SYSTEM_CARD_PATHS.browse, viewer: null, params: {}, viewState: browseStateToViewState(state) };
}

/** Bare opens retain omission so the existing tab's state wins. */
export function normalizeBrowseTarget(target: ViewTarget): ViewTarget {
  if (target.path !== SYSTEM_CARD_PATHS.browse || (target.viewState === null && target.params["dir"] === undefined)) return target;
  const parsed = parseBrowseState(target);
  if (!parsed.ok) return target;
  const { dir: _seed, ...params } = target.params;
  return { ...target, params, viewState: browseStateToViewState(parsed.state) };
}

/** Legacy path classification uses filesystem results, including extensionless files and .attach directories. */
export async function legacyBrowseTarget(target: ViewTarget, {
  lookupKind,
  missingKind,
}: {
  lookupKind: (path: string) => Promise<BrowsePathKind>;
  missingKind: BrowseMissingKind;
}): Promise<ViewTarget> {
  const path = canonicalPath(target.path);
  if (path === null) throw new BrowseLocationError(target.path, false);
  const kind = path === "" ? "directory" : await lookupKind(path);
  if (kind === "missing" && missingKind === "directory") throw new BrowseLocationError(path, true);
  return browseCardTarget(kind === "directory" ? { directory: path } : { directory: browseParent(path), detail: { ...target, path } });
}
