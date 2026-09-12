/** Canonical instruments use ordinary card routes, with semantic cold-entry places. */
import { SYSTEM_CARD_PATHS, type SystemCardType } from "@shared/system-card-paths";
import { parseViewUrl, serializeViewUrl, viewStateSearchValue, type ViewTarget } from "./view-url";
import { normalizeBrowseTarget, parseBrowseState } from "./browse-card-state";
import { adminArrivalViewState } from "./admin-card-state";

const SYSTEM_CARD_PATH_SET: ReadonlySet<string> = new Set(Object.values(SYSTEM_CARD_PATHS));

/** Preserve a legacy `/card` entry exactly while adopting the workspace route. */
export function legacyCardRedirect<TState>(input: {
  boxSlug: string;
  cardPath: string;
  search: Record<string, unknown>;
  state: TState;
}) {
  return {
    to: `/${input.boxSlug}/views/${input.cardPath}`,
    search: input.search,
    state: input.state,
    replace: true as const,
  };
}

/** Preserve shell state while a legacy instrument URL adopts its canonical card target. */
export function legacySystemCardRedirect<TState>(input: {
  boxSlug: string;
  type: SystemCardType;
  search: Record<string, unknown>;
  state: TState;
}) {
  return {
    to: `/${input.boxSlug}/views/${SYSTEM_CARD_PATHS[input.type]}`,
    search: systemCardShellSearch(input.search),
    state: input.state,
    replace: true as const,
  };
}

export function legacyAdminRedirect<TState>(input: { boxSlug: string; search: Record<string, unknown>; state: TState }) {
  const viewState = adminArrivalViewState(input.search);
  return {
    to: `/${input.boxSlug}/views/${SYSTEM_CARD_PATHS.admin}`,
    search: { ...systemCardShellSearch(input.search), ...(viewState ? { viewState: viewStateSearchValue(viewState) } : {}) },
    state: input.state,
    replace: true as const,
  };
}

export function legacyCaptureRedirect<TState>(input: { boxSlug: string; search: Record<string, unknown>; state: TState }) {
  return {
    to: `/${input.boxSlug}/chat`,
    search: { ...systemCardShellSearch(input.search), capture: "1" as const },
    state: input.state,
    replace: true as const,
  };
}

/** Search written only by an explicit recent/new chat-about-card action. */
export function cardChatSearch(input: {
  mode: "recent" | "new";
  target: ViewTarget;
  contextDir: string;
  sessionId: string | null;
  nativeComposer?: "1";
}): Record<string, string> {
  const card = serializeViewUrl(input.target);
  if (input.mode === "recent" && input.sessionId) {
    return input.nativeComposer === undefined
      ? { session: input.sessionId, card }
      : { session: input.sessionId, card, nativeComposer: input.nativeComposer };
  }
  return input.nativeComposer === undefined
    ? { session: "new", contextDir: input.contextDir, card }
    : { session: "new", contextDir: input.contextDir, card, nativeComposer: input.nativeComposer };
}

export function workspaceRouteTarget(input: {
  pathname: string; splat?: string; searchStr: string; search: Record<string, unknown>;
}): ViewTarget | null {
  let target: ViewTarget;
  if (input.pathname.includes("/views/")) {
    // Shell providers live above the leaf match, so their useParams has no splat.
    const path = input.splat ?? decodeRouteCardPath(input.pathname.slice(input.pathname.indexOf("/views/") + "/views/".length));
    target = parseViewUrl(`${path}${input.searchStr}`);
    // These belong to the shell, never to a rendered instrument or its context.
    target = withoutShellParams(target);
  } else {
    const raw = typeof input.search.card === "string" ? input.search.card
      : typeof input.search.companion === "string" ? input.search.companion : null;
    if (!raw) return null;
    target = parseViewUrl(raw);
  }
  return normalizeBrowseTarget(target);
}

export function systemCardEntryContext(target: ViewTarget | null): { cardPath: string | null; browseDir: string | null } {
  if (!target) return { cardPath: null, browseDir: null };
  if (target.path === SYSTEM_CARD_PATHS.dashboard || target.path === SYSTEM_CARD_PATHS.settings) {
    return { cardPath: null, browseDir: "" };
  }
  if (target.path === SYSTEM_CARD_PATHS.browse) {
    const parsed = parseBrowseState({ viewState: target.viewState, params: target.params });
    // Invalid locations remain visible in Browse's error surface, not a guessed directory.
    return { cardPath: null, browseDir: parsed.ok ? parsed.state.directory : null };
  }
  if (SYSTEM_CARD_PATH_SET.has(target.path)) return { cardPath: null, browseDir: "" };
  return { cardPath: target.path, browseDir: null };
}

export function systemCardAttentionRef(target: ViewTarget): string {
  if (target.path === SYSTEM_CARD_PATHS.settings) return target.path;
  return serializeViewUrl(target);
}

/** Keep shell options outside the renderer's state and attention. */
export function systemCardShellSearch(search: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(["nativeComposer", "session", "contextDir", "capture", "engine", "model"].flatMap((key) => search[key] === undefined ? [] : [[key, search[key]]]));
}

/** Legacy Browse file parameters must not capture recipient or native-shell state. */
export function withoutShellParams(target: ViewTarget): ViewTarget {
  const params = { ...target.params };
  for (const key of ["nativeComposer", "capture", "session", "contextDir", "companion", "card", "engine", "model"]) delete params[key];
  return { ...target, params };
}

function decodeRouteCardPath(path: string): string {
  try { return decodeURIComponent(path); }
  catch (_error) { return path; } // Keep malformed URLs addressable as a visible missing-file error.
}

/** Consume a canonical target once; its renderer state belongs only inside card. */
export function workspaceProjectionSearch(input: {
  pathname: string;
  search: Record<string, unknown>;
  target: ViewTarget | null;
}): Record<string, unknown> {
  const search = input.pathname.includes("/views/") ? systemCardShellSearch(input.search) : { ...input.search };
  delete search.companion;
  if (input.target) search.card = serializeViewUrl(input.target);
  else delete search.card;
  return search;
}
