/**
 * The web box screen's page state (docs/plans/box-screen.md, track 2), as pure
 * functions so each row face and the reload path are doctested without a
 * browser.
 *
 * A new thought is kept in browser storage as `unsent` — its id and text —
 * from Send until `quickChat.submit` answers. The stored record is written
 * before the request starts (`submitUnsent`), so a tab that dies mid-request
 * still has the id. A reload restores it and submits again with the same id,
 * so a lost answer never becomes a second message. The
 * key is the box screen's own; the chat composer's draft is never read or
 * written here, so neither draft can replace the other.
 *
 * Rows come from `quickChat.home`, overridden by the answers this page has
 * received since (`answered`): an answer is the record's newest state as far
 * as this page knows.
 */

import { z } from "zod";
import { errorMessage } from "@shared/error-guards";
import type { RouterOutput } from "../../lib/trpc/client";

export type QuickChatView = RouterOutput["quickChat"]["submit"];
type QuickChatChoice = NonNullable<QuickChatView["choices"]>[number];

const unsentSchema = z.object({ id: z.string().uuid(), message: z.string().min(1) });
type Unsent = z.infer<typeof unsentSchema>;
const storedSchema = z.object({ draft: z.string(), unsent: unsentSchema.nullable() });
export type StoredBoxScreen = z.infer<typeof storedSchema>;

export interface BoxScreenState {
  /** The text in the input. */
  draft: string;
  /** Sent and not yet answered by `submit`. */
  unsent: Unsent | null;
  submitting: boolean;
  submitError: string | null;
  /** Views from submit, choose, and discard answers, newest first. */
  answered: QuickChatView[];
  /** Record ids with a choose, retry, or discard in flight. */
  busy: string[];
  rowErrors: Record<string, string>;
}

export type BoxScreenAction =
  | { type: "edit"; text: string }
  | { type: "submit-started"; unsent: Unsent }
  | { type: "submit-answered"; view: QuickChatView }
  | { type: "submit-failed"; error: string }
  | { type: "row-started"; id: string }
  | { type: "row-answered"; view: QuickChatView }
  | { type: "row-failed"; id: string; error: string };

/** The storage key: one per box instance (`storageScopeFor`), apart from the composer's `bbx-input-emission`. */
export function boxScreenStorageKey(input: { boxSlug: string; scope: string }): string {
  return `bbx-box-screen:${input.scope === "" ? input.boxSlug : input.scope}`;
}

/** Read what a previous visit stored. Storage is untrusted: a malformed value is reported and dropped. */
export function parseStoredBoxScreen(raw: string | null): StoredBoxScreen {
  const empty = { draft: "", unsent: null };
  if (raw === null) return empty;
  try {
    return storedSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("[box-screen] could not restore the new-thought draft", error);
    return empty;
  }
}

export function storedBoxScreen(state: BoxScreenState): StoredBoxScreen {
  return { draft: state.draft, unsent: state.unsent };
}

/** The page as a reload finds it: an unsent thought is back in the input, waiting to be submitted again. */
export function restoreBoxScreen(stored: StoredBoxScreen): BoxScreenState {
  return {
    draft: stored.unsent === null ? stored.draft : stored.unsent.message,
    unsent: stored.unsent,
    submitting: false,
    submitError: null,
    answered: [],
    busy: [],
    rowErrors: {},
  };
}

/**
 * What Send submits. The same text as the unsent thought keeps its id, so the
 * server answers a repeat with the record it already has; edited text is a new
 * thought with `freshId`.
 */
export function submission(state: BoxScreenState, freshId: string): Unsent | null {
  const message = state.draft.trim();
  if (message === "" || state.submitting) return null;
  if (state.unsent !== null && state.unsent.message === message) return state.unsent;
  return { id: freshId, message };
}

/** The unsent thought a restored page submits on its own, before anyone presses Send. */
export function pendingRetry(state: BoxScreenState): Unsent | null {
  return state.submitting || state.submitError !== null ? null : state.unsent;
}

/** What a submit touches outside the reducer. */
export interface SubmitEffects {
  /** Writes the stored record synchronously. */
  store: (stored: StoredBoxScreen) => void;
  request: (unsent: Unsent) => Promise<QuickChatView>;
  dispatch: (action: BoxScreenAction) => void;
}

/**
 * Submit one thought. The `{id, message}` record is in storage before the
 * request starts: a page that closes after the server has the thought and
 * before the answer arrives retries with the same id on reload, never a new
 * one. The stored draft is the message, as `restoreBoxScreen` reads it back.
 */
export async function submitUnsent(unsent: Unsent, effects: SubmitEffects): Promise<void> {
  effects.store({ draft: unsent.message, unsent });
  effects.dispatch({ type: "submit-started", unsent });
  try {
    effects.dispatch({ type: "submit-answered", view: await effects.request(unsent) });
  } catch (error) {
    console.error("[box-screen] quickChat.submit failed", error);
    effects.dispatch({ type: "submit-failed", error: errorMessage(error) });
  }
}

function upsert(answered: QuickChatView[], view: QuickChatView): QuickChatView[] {
  return [view, ...answered.filter((old) => old.id !== view.id)];
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

export function boxScreenReducer(state: BoxScreenState, action: BoxScreenAction): BoxScreenState {
  switch (action.type) {
    case "edit":
      return { ...state, draft: action.text };
    case "submit-started":
      return { ...state, unsent: action.unsent, submitting: true, submitError: null };
    case "submit-answered":
      return {
        ...state,
        unsent: null,
        submitting: false,
        submitError: null,
        draft: state.draft.trim() === action.view.message ? "" : state.draft,
        answered: upsert(state.answered, action.view),
      };
    case "submit-failed":
      return { ...state, submitting: false, submitError: action.error };
    case "row-started":
      return { ...state, busy: [...state.busy, action.id], rowErrors: withoutKey(state.rowErrors, action.id) };
    case "row-answered":
      return { ...state, busy: state.busy.filter((id) => id !== action.view.id), answered: upsert(state.answered, action.view) };
    case "row-failed":
      return { ...state, busy: state.busy.filter((id) => id !== action.id), rowErrors: { ...state.rowErrors, [action.id]: action.error } };
  }
}

/**
 * The rows to show: "Needs you" (stored, not sent) and sent. The page's own
 * answers replace `home`'s copy of a record. The unsent thought is left out
 * even when `home` already lists it: its status line under the input covers
 * it until `submit` answers.
 */
export function boxScreenRows(
  home: { open: QuickChatView[]; recentlySent: QuickChatView[] } | undefined,
  state: BoxScreenState,
): { needsYou: QuickChatView[]; sent: QuickChatView[] } {
  const answeredIds = new Set(state.answered.map((view) => view.id));
  const fromHome = home === undefined ? [] : [...home.open, ...home.recentlySent].filter((view) => !answeredIds.has(view.id));
  const views = [...state.answered, ...fromHome].filter((view) => view.id !== state.unsent?.id);
  return {
    needsYou: views.filter((view) => view.state === "needs-choice" || view.state === "sending"),
    sent: views.filter((view) => view.state === "sent"),
  };
}

const REASON_TEXT = {
  uncertain: "Not sure where this goes",
  "routing-unavailable": "Could not sort this",
  "destination-gone": "That chat is gone",
} as const satisfies Record<NonNullable<QuickChatView["reason"]>, string>;

/** Where a row's chat link goes: the chat itself, or the chat list when the chat has no id yet. */
type ChatLink = { kind: "chat"; sessionId: string } | { kind: "all-chats" };

/** How one record reads on the box screen, and which actions it offers. */
export type RowFace =
  | { kind: "sent"; title: string; link: ChatLink }
  | { kind: "needs-choice"; title: string; choices: QuickChatChoice[] }
  /** Retry and Discard. */
  | { kind: "not-delivered"; title: string; detail: string | null }
  /** Past the delivery window: Open chat and Discard, never Retry. */
  | { kind: "expired"; title: string; link: ChatLink }
  | { kind: "discarded" };

function chatLink(view: QuickChatView): ChatLink {
  const sessionId = view.destination?.sessionId;
  return sessionId === undefined ? { kind: "all-chats" } : { kind: "chat", sessionId };
}

export function rowFace(view: QuickChatView): RowFace {
  const label = view.destination?.label;
  switch (view.state) {
    case "sent":
      return { kind: "sent", title: label === undefined ? "Sent" : `${view.queued === true ? "Queued in" : "Sent to"} ${label}`, link: chatLink(view) };
    case "needs-choice":
      return { kind: "needs-choice", title: view.reason === undefined ? REASON_TEXT.uncertain : REASON_TEXT[view.reason], choices: view.choices ?? [] };
    case "sending":
      if (view.expired === true) return { kind: "expired", title: view.lastError ?? "This may already be delivered. Open the chat to check.", link: chatLink(view) };
      return { kind: "not-delivered", title: "Not delivered", detail: view.lastError ?? null };
    case "discarded":
      return { kind: "discarded" };
  }
}

/** The line under the input while a thought is unsent. */
export function unsentStatus(state: BoxScreenState): string | null {
  if (state.unsent === null) return null;
  if (state.submitting) return "Sending…";
  if (state.submitError !== null) return `Not sent: ${state.submitError}`;
  return "Waiting to send";
}
