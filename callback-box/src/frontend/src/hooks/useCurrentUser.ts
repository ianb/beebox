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
      .then((data: { email: string; name: string; picture?: string; isOwner: boolean } | null) => {
        if (data) {
          setUser({ email: data.email, name: data.name, picture: data.picture, isOwner: data.isOwner });
        }
      })
      .catch(() => {
        // Auth not enabled or network error — leave as null
      });
  }, []);

  return user;
}
