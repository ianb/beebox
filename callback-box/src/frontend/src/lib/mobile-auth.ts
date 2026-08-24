const MOBILE_AUTH_TOKEN_STORAGE_KEY = "callbackbox.mobileAuthToken";

export function getMobileAuthToken(): string | null {
  try {
    return window.localStorage.getItem(MOBILE_AUTH_TOKEN_STORAGE_KEY);
  } catch (_e) {
    return null;
  }
}

export function mobileAuthHeaders(): Record<string, string> {
  const token = getMobileAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function withMobileAuth(init?: RequestInit): RequestInit {
  const auth = mobileAuthHeaders();
  if (!auth.Authorization) return init ?? {};
  return {
    ...init,
    headers: {
      ...auth,
      ...headersToRecord(init?.headers),
    },
  };
}

export function isMobileAuthenticated(): boolean {
  return getMobileAuthToken() !== null;
}

/**
 * Exchange the device token for a fresh `cb_mobile` cookie.
 *
 * Needed because the cookie is short-lived while the page may not be: a
 * WebKit-initiated reload (back/forward, content-process crash) re-issues the
 * bare URL with no Authorization header, so a lapsed cookie leaves the app
 * 401ing with no way back. The native shell still holds the durable token in
 * localStorage, so the page can re-establish the session itself.
 *
 * Returns whether a session was established. Never throws — callers use it to
 * decide whether retrying is worthwhile, and a network failure there is
 * indistinguishable from "no session" for that purpose.
 */
export async function refreshMobileSession(apiBase: string): Promise<boolean> {
  const auth = mobileAuthHeaders();
  if (!auth.Authorization) return false;
  try {
    const response = await fetch(`${apiBase}/pairing/session`, { method: "POST", headers: auth });
    if (!response.ok) {
      console.error(`[mobile-auth] session refresh failed: ${response.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mobile-auth] session refresh request failed:", e);
    return false;
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
