/**
 * The web box screen at `/<box>/box` (docs/plans/box-screen.md, track 2): the
 * screen for the box as a whole. Top to bottom: "Needs you", the sent rows,
 * "Pick up where you left off", "Shortcuts" (only when the box's `nav.card`
 * lists some), "Boxes" (only with more than one box), and the new-thought
 * input pinned at the bottom. The box-wide pages are in the avatar menu.
 *
 * The route renders without the conversation shell (`standalone` in the
 * router), so nothing here loads a chat. The page reads `quickChat.home`
 * and writes through `submit`, `choose`, and `discard`; the server stores and
 * delivers every thought, so the page never sends a chat message itself.
 *
 * When the person's own send or choose comes back, the page acts on the
 * reducer's `followUp`: it opens the chat the thought went to, or scrolls the
 * row into view when there is no chat to open.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { errorMessage } from "@shared/error-guards";
import { trpc, trpcClient } from "../../lib/trpc/client";
import { getApiBase } from "../../api-core";
import { href, toSearch } from "../../lib/routing";
import { storageScopeFor } from "../../lib/storage-scope";
import { useBoxes } from "../../hooks/useBoxes";
import { useBoxName } from "../../hooks/useBoxName";
import { isNativeShell } from "../../components/chat/native-post";
import { Stack } from "../../components/ui/Stack";
import { ErrorText } from "../../components/ui/ErrorText";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import { QuickChatList, type QuickChatRowActions } from "../../components/box-screen/QuickChatList";
import { BoxScreenSection, OtherBoxes, RecentChatList, ShortcutLinks } from "../../components/box-screen/BoxScreenSections";
import { NewThoughtInput } from "../../components/box-screen/NewThoughtInput";
import {
  boxScreenReducer, boxScreenRows, boxScreenStorageKey, parseStoredBoxScreen, pendingRetry, quickChatRowId, restoreBoxScreen,
  storedBoxScreen, submission, submitUnsent, unsentStatus,
  type BoxScreenAction, type BoxScreenFollowUp, type BoxScreenState, type QuickChatView, type StoredBoxScreen,
} from "./state";

export function BoxScreenPage() {
  const { boxSlug = "" } = useParams({ strict: false });
  return <BoxScreen key={boxSlug} boxSlug={boxSlug} />;
}

/** The page's storage key; null outside a browser (a server-side render has no storage and no location). */
function storageKey(boxSlug: string): string | null {
  return typeof window === "undefined" ? null : boxScreenStorageKey({ boxSlug, scope: storageScopeFor(getApiBase()) });
}

function readStored(key: string | null): BoxScreenState {
  return restoreBoxScreen(parseStoredBoxScreen(key === null ? null : localStorage.getItem(key)));
}

function writeStored(key: string | null, stored: StoredBoxScreen): void {
  if (key === null) return;
  try { localStorage.setItem(key, JSON.stringify(stored)); }
  catch (error) { console.warn("[box-screen] could not store the new-thought draft", error); }
}

/** Submit, choose, retry, and discard, each folding its answer into the page state. */
function useQuickChatActions(key: string | null, dispatch: (action: BoxScreenAction) => void) {
  const utils = trpc.useUtils();
  const submit = useCallback(async (unsent: { id: string; message: string }, origin: "send" | "reload") => {
    await submitUnsent({ unsent, origin }, {
      store: (stored) => writeStored(key, stored),
      // The web input is a plain text field, so every thought posts as typed.
      request: (input) => trpcClient.quickChat.submit.mutate({ ...input, origin: "typed" }),
      dispatch,
    });
    void utils.quickChat.home.invalidate();
  }, [key, dispatch, utils]);
  const rowAction = useCallback(async ({ view, request }: { view: QuickChatView; request: "choose" | "retry" | "discard" }, call: () => Promise<QuickChatView>) => {
    dispatch({ type: "row-started", id: view.id, request });
    try {
      dispatch({ type: "row-answered", view: await call() });
      void utils.quickChat.home.invalidate();
    } catch (error) {
      console.error("[box-screen] quick chat action failed", error);
      dispatch({ type: "row-failed", id: view.id, error: errorMessage(error) });
    }
  }, [dispatch, utils]);
  const rowActions: QuickChatRowActions = {
    onChoose: (view, candidateId) => rowAction({ view, request: "choose" }, () => trpcClient.quickChat.choose.mutate({ id: view.id, candidateId })),
    onRetry: (view) => rowAction({ view, request: "retry" }, () => trpcClient.quickChat.submit.mutate({ id: view.id, message: view.message })),
    onDiscard: (view) => rowAction({ view, request: "discard" }, () => trpcClient.quickChat.discard.mutate({ id: view.id })),
  };
  return { submit, rowActions };
}

/** Carry out the reducer's follow-up once: open the chat, or bring the row into view. */
function useFollowUp({ boxSlug, followUp }: { boxSlug: string; followUp: BoxScreenFollowUp | null }, dispatch: (action: BoxScreenAction) => void) {
  const navigate = useNavigate();
  useEffect(() => {
    if (followUp === null) return;
    dispatch({ type: "follow-up-done" });
    if (followUp.kind === "open-chat") {
      void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch({ session: followUp.sessionId }) });
      return;
    }
    document.getElementById(quickChatRowId(followUp.id))?.scrollIntoView({ block: "nearest" });
  }, [boxSlug, followUp, dispatch, navigate]);
}

function BoxScreen({ boxSlug }: { boxSlug: string }) {
  const key = storageKey(boxSlug);
  const [state, dispatch] = useReducer(boxScreenReducer, key, readStored);
  const { submit, rowActions } = useQuickChatActions(key, dispatch);
  useFollowUp({ boxSlug, followUp: state.followUp }, dispatch);
  const home = trpc.quickChat.home.useQuery();
  const { boxes } = useBoxes();
  const { boxName } = useBoxName();

  // Keeps the draft in storage as it is typed. Send writes its record itself, before the request.
  useEffect(() => { writeStored(key, storedBoxScreen(state)); }, [key, state]);

  // A thought stored by an earlier visit goes out again, once, with its own id.
  const retried = useRef(false);
  useEffect(() => {
    if (retried.current) return;
    retried.current = true;
    const unsent = pendingRetry(state);
    if (unsent !== null) void submit(unsent, "reload");
  }, [state, submit]);

  const rows = boxScreenRows(home.data, state);
  const otherBoxes = boxes.filter((box) => box.slug !== boxSlug);
  const listProps = { boxSlug, busy: state.busy, errors: state.rowErrors, actions: rowActions };

  return (
    <Stack gap="none" className="h-full">
      <Stack gap="none" overflow="auto" focusable className="flex-1 min-h-0">
        <Stack gap="lg" className="w-full max-w-xl mx-auto px-4 py-5">
          <VisuallyHidden as="h1">{boxName}</VisuallyHidden>
          {rows.needsYou.length === 0 ? null : (
            <BoxScreenSection id="bbx-box-screen-needs-you" title="Needs you">
              <QuickChatList views={rows.needsYou} {...listProps} />
            </BoxScreenSection>
          )}
          {rows.sent.length === 0 ? null : (
            <QuickChatList views={rows.sent} label="Sent" {...listProps} />
          )}
          {home.error === null ? null : <ErrorText>Could not load this box: {home.error.message}</ErrorText>}
          <BoxScreenSection id="bbx-box-screen-recent" title="Pick up where you left off">
            {home.data === undefined ? <StatusMessage>Loading…</StatusMessage> : <RecentChatList chats={home.data.recentChats} boxSlug={boxSlug} />}
          </BoxScreenSection>
          {home.data === undefined || home.data.shortcuts.length === 0 ? null : (
            <BoxScreenSection id="bbx-box-screen-shortcuts" title="Shortcuts">
              <ShortcutLinks boxSlug={boxSlug} shortcuts={home.data.shortcuts} />
            </BoxScreenSection>
          )}
          {/* A native shell is paired to one box; its own box list switches boxes. */}
          {otherBoxes.length === 0 || isNativeShell() ? null : (
            <BoxScreenSection id="bbx-box-screen-boxes" title="Boxes">
              <OtherBoxes boxes={otherBoxes} />
            </BoxScreenSection>
          )}
        </Stack>
      </Stack>
      <NewThoughtInput
        draft={state.draft}
        onChange={(text) => dispatch({ type: "edit", text })}
        onSend={() => { const next = submission(state, crypto.randomUUID()); if (next !== null) void submit(next, "send"); }}
        sending={state.submitting}
        status={unsentStatus(state)}
      />
    </Stack>
  );
}
