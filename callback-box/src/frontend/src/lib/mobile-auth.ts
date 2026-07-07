export const MOBILE_AUTH_TOKEN_STORAGE_KEY = "callbackbox.mobileAuthToken";

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

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
