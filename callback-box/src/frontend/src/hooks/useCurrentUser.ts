/**
 * Hooks for the current auth status, backed by a single `/auth/me` fetch.
 *
 * `/auth/me` answers one of three ways: a signed-in user, `{ open: true }`
 * when the server is running in the `CB_ALLOW_UNAUTHENTICATED` opt-out, or
 * a 401 (not signed in, auth required). `useAuthStatus` is the shared fetch;
 * `useCurrentUser` and `useOpenMode` are thin, backward-compatible views onto
 * it for callers that only need one half.
 */

import { useState, useEffect } from "react";
import { withBase } from "../api";

export interface CurrentUser {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
}

interface AuthStatus {
  user: CurrentUser | null;
  open: boolean;
}

interface AuthMeResponse {
  email?: string;
  name?: string;
  picture?: string;
  isOwner?: boolean;
  open?: boolean;
}

function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ user: null, open: false });

  useEffect(() => {
    fetch(withBase("/auth/me"))
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data: AuthMeResponse | null) => {
        if (data?.open) {
          setStatus({ user: null, open: true });
          return;
        }
        if (data?.email) {
          setStatus({
            user: { email: data.email, name: data.name ?? data.email, picture: data.picture, isOwner: data.isOwner ?? false },
            open: false,
          });
        }
      })
      .catch(() => {
        // Auth not enabled or network error — leave as signed-out/non-open.
      });
  }, []);

  return status;
}

/** The signed-in user, or `null` when signed out (including open mode). */
export function useCurrentUser(): CurrentUser | null {
  return useAuthStatus().user;
}

/** Whether the server is running with authentication disabled
 *  (`CB_ALLOW_UNAUTHENTICATED`). Drives the persistent open-mode banner. */
export function useOpenMode(): boolean {
  return useAuthStatus().open;
}
