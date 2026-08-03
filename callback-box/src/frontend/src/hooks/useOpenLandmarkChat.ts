/**
 * Resume-or-start: open the chat associated with a landmark's directory.
 *
 * If the directory already has chats, navigate to the most recent one;
 * otherwise start a new session bound to it (the backend reads `contextDir`
 * off the first send and spawns the SDK with `cwd` there — the association is
 * persisted on session assignment). See docs/landmarks.md for the association
 * model.
 *
 * Extracted from `LandmarkSection`'s ChatButton so the app bar's `PlacePill`
 * switch menu and the Landmarks page run the exact same action
 * (docs/plans/top-nav-ia.md Track C1).
 */

import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";
import { trpc } from "../lib/trpc";

/**
 * Returns a stable `(dir) => Promise<void>` that opens the landmark's chat.
 * The promise never rejects: a lookup failure is logged (rule 5 — a
 * user-initiated action never silently no-ops) and the navigation is skipped.
 */
export function useOpenLandmarkChat(boxSlug: string): (dir: string) => Promise<void> {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  return useCallback(
    async (dir: string) => {
      try {
        const { sessionId } = await utils.chat.lastSessionForDirectory.fetch({ contextDir: dir });
        // navigate()'s promise only rejects on a superseded/redirected
        // navigation (not a user-facing failure) -- fire-and-forget.
        void navigate({
          to: href(`/${boxSlug}/chat`),
          search: sessionId
            ? toSearch({ session: sessionId })
            : toSearch({ session: "new", contextDir: dir }),
        });
      } catch (e) {
        // User-initiated action (policy rule 5): neither call site has a toast
        // affordance today, so log at error level as the interim signal.
        console.error(`[landmarks] failed to open chat for ${dir}:`, e);
      }
    },
    [boxSlug, navigate, utils],
  );
}
