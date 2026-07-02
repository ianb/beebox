/**
 * Strip the trailing box-slug segment from a public URL to get the server base
 * (used to build webhook and OAuth-redirect URLs that live above the box scope).
 * Shared by the admin tRPC procedures (telegram + google setup).
 */
export function baseServerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  url.pathname = url.pathname.replace(/\/[^/]+\/?$/, "");
  return url.origin + url.pathname;
}
