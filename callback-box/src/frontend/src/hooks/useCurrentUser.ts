/**
 * Hooks for the current auth status, backed by a single `/auth/me` fetch.
 *
 * `/auth/me` answers one of three ways: a signed-in user, `{ open: true }`
 * when the server is running with open access (auth wall disabled — only
 * possible for a test-constructed server; a production box is always auth-on),
 * or a 401 (not signed in, auth required). The `open` case is handled here so a
 * signed-out user isn't misread as signed-in; `useCurrentUser` exposes just the
 * signed-in user.
 */

import { useState, useEffect } from "react";
import { withBase } from "../api";

export interface CurrentUser {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
}

interface AuthMeResponse {
  email?: string;
  name?: string;
  picture?: string;
  isOwner?: boolean;
  open?: boolean;
}

/** The signed-in user, or `null` when signed out (including open mode). */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    fetch(withBase("/auth/me"))
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data: AuthMeResponse | null) => {
        // `{ open: true }` (open-access server) and a 401 both mean "no
        // signed-in user" — leave `user` null. Only a real user populates it.
        if (data?.open) return;
        if (data?.email) {
          setUser({
            email: data.email,
            name: data.name ?? data.email,
            picture: data.picture,
            isOwner: data.isOwner ?? false,
          });
        }
      })
      .catch(() => {
        // Auth not enabled or network error — leave as signed-out.
      });
  }, []);

  return user;
}
