/**
 * Strip the trailing box-slug segment from a public URL to get the server base
 * (used to build webhook and OAuth-redirect URLs that live above the box scope).
 * Shared by the admin tRPC procedures (telegram + google setup).
 */
export function baseServerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  // Build the base path as a plain string, NOT by assigning back to
  // url.pathname: setting it to "" renormalizes to "/", and a root deployment
  // has no slug segment for the regex to strip — both left a trailing slash, so
  // callers doing `${baseServerUrl(...)}/auth/...` produced `host//auth/...`
  // and broke Google OAuth with a redirect_uri mismatch. Strip any trailing
  // slash so the result is always concatenation-safe.
  const basePath = url.pathname.replace(/\/[^/]+\/?$/, "");
  return (url.origin + basePath).replace(/\/+$/, "");
}
