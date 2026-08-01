/**
 * Hooks for the current auth status, backed by a single `/auth/me` fetch.
 *
 * `/auth/me` answers one of three ways: a signed-in user, `{ open: true }`
 * when the server is running with open access (auth wall disabled — only
 * possible for a test-constructed server; a production box is always auth-on),
 * or a 401 (not signed in, auth required). The `open` case is handled here so a
 * signed-out user isn't misread as signed-in; `useCurrentUser` exposes just the
 * signed-in user.
 *
 * It runs as a react-query query so the several call sites (`AppNav`,
 * `InteractiveChat`, …) share one request per page load instead of each
 * firing its own `fetch` on mount.
 */

import { useQuery } from "@tanstack/react-query";
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

/**
 * "Not signed in" is a normal answer here, not a failure: a 401 and
 * `{ open: true }` both resolve to `null`. A transport failure is logged and
 * also resolves to null — the app's signed-out rendering is the right
 * degradation, and rejecting would only make every consumer handle it.
 */
async function fetchCurrentUser(): Promise<CurrentUser | null> {
  let data: AuthMeResponse | null;
  try {
    const resp = await fetch(withBase("/auth/me"));
    if (!resp.ok) return null;
    data = await resp.json();
  } catch (e) {
    console.warn("[auth] /auth/me request failed; rendering as signed out", e);
    return null;
  }
  // `{ open: true }` (open-access server) and a 401 both mean "no signed-in
  // user". Only a real user populates the hook.
  if (!data || data.open || !data.email) return null;
  return {
    email: data.email,
    name: data.name ?? data.email,
    picture: data.picture,
    isOwner: data.isOwner ?? false,
  };
}

/** The signed-in user, or `null` when signed out (including open mode). */
export function useCurrentUser(): CurrentUser | null {
  const query = useQuery({ queryKey: ["auth", "me"], queryFn: fetchCurrentUser });
  return query.data ?? null;
}
