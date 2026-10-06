/**
 * The web box screen at `/<box>/box` (docs/plans/box-screen.md, track 2): the
 * screen for the box as a whole. Top to bottom: "Needs you", the sent rows,
 * "Pick up where you left off", "In this box", "Boxes" (only with more than
 * one box), and the new-thought input pinned at the bottom.
 *
 * The route renders without the conversation shell (`standalone` in the
 * router), so nothing here loads a chat. The page reads `quickChat.home`
 * and writes through `submit`, `choose`, and `discard`; the server stores and
 * delivers every thought, so the page never sends a chat message itself.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { errorMessage } from "@shared/error-guards";
import { trpc, trpcClient } from "../../lib/trpc/client";
import { getApiBase } from "../../api-core";
import { storageScopeFor } from "../../lib/storage-scope";
import { useBoxes } from "../../hooks/useBoxes";
import { useBoxName } from "../../hooks/useBoxName";
import { isNativeShell } from "../../components/chat/native-post";
import { Stack } from "../../components/ui/Stack";
import { ErrorText } from "../../components/ui/ErrorText";
import { StatusMessage } from "../../components/ui/StatusMessage";
import { VisuallyHidden } from "../../components/ui/VisuallyHidden";
import { QuickChatList, type QuickChatRowActions } from "../../components/box-screen/QuickChatList";
import { BoxPageLinks, BoxScreenSection, OtherBoxes, RecentChatList } from "../../components/box-screen/BoxScreenSections";
import { NewThoughtInput } from "../../components/box-screen/NewThoughtInput";
import {
  boxScreenReducer, boxScreenRows, boxScreenStorageKey, parseStoredBoxScreen, pendingRetry, restoreBoxScreen,
  storedBoxScreen, submission, submitUnsent, unsentStatus,
  type BoxScreenAction, type BoxScreenState, type QuickChatView, type StoredBoxScreen,
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
  const submit = useCallback(async (unsent: { id: string; message: string }) => {
    await submitUnsent(unsent, {
      store: (stored) => writeStored(key, stored),
      request: (input) => trpcClient.quickChat.submit.mutate(input),
      dispatch,
    });
    void utils.quickChat.home.invalidate();
  }, [key, dispatch, utils]);
  const rowAction = useCallback(async (view: QuickChatView, request: () => Promise<QuickChatView>) => {
    dispatch({ type: "row-started", id: view.id });
    try {
      dispatch({ type: "row-answered", view: await request() });
      void utils.quickChat.home.invalidate();
    } catch (error) {
      console.error("[box-screen] quick chat action failed", error);
      dispatch({ type: "row-failed", id: view.id, error: errorMessage(error) });
    }
  }, [dispatch, utils]);
  const rowActions: QuickChatRowActions = {
    onChoose: (view, candidateId) => rowAction(view, () => trpcClient.quickChat.choose.mutate({ id: view.id, candidateId })),
    onRetry: (view) => rowAction(view, () => trpcClient.quickChat.submit.mutate({ id: view.id, message: view.message })),
    onDiscard: (view) => rowAction(view, () => trpcClient.quickChat.discard.mutate({ id: view.id })),
  };
  return { submit, rowActions };
}

function BoxScreen({ boxSlug }: { boxSlug: string }) {
  const key = storageKey(boxSlug);
  const [state, dispatch] = useReducer(boxScreenReducer, key, readStored);
  const { submit, rowActions } = useQuickChatActions(key, dispatch);
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
    if (unsent !== null) void submit(unsent);
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
          <BoxScreenSection id="bbx-box-screen-in-this-box" title="In this box">
            <BoxPageLinks boxSlug={boxSlug} shortcuts={home.data?.shortcuts ?? []} />
          </BoxScreenSection>
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
        onSend={() => { const next = submission(state, crypto.randomUUID()); if (next !== null) void submit(next); }}
        sending={state.submitting}
        status={unsentStatus(state)}
      />
    </Stack>
  );
}
