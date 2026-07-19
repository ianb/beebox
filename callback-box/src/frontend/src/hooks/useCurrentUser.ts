/**
 * Hook to fetch the current authenticated user from /auth/me.
 * Returns null if auth is disabled or the user is not logged in.
 */

import { useState, useEffect } from "react";
import { withBase } from "../api";

export interface CurrentUser {
  email: string;
  name: string;
  picture?: string;
  isOwner: boolean;
}

export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    fetch(withBase("/auth/me"))
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data: { email?: string; name?: string; picture?: string; isOwner?: boolean; open?: boolean } | null) => {
        // Open mode answers `{ open: true }` (no user). Only build a CurrentUser
        // from a real signed-in identity; the open-mode banner is Track G's job.
        if (data && data.email) {
          setUser({ email: data.email, name: data.name ?? data.email, picture: data.picture, isOwner: data.isOwner ?? false });
        }
      })
      .catch(() => {
        // Auth not enabled or network error — leave as null
      });
  }, []);

  return user;
}
