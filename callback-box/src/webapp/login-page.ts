/**
 * Server-rendered, fully self-contained login + first-run setup pages.
 *
 * These replace the React SPA for the pre-auth login surface. The whole point:
 * a logged-out user must get a WORKING login page with ZERO gated or external
 * resources. Behind the authenticating dev router, the SPA's Vite bundle
 * (`main.tsx`, `@vite/client`, all of `src/…`) loads from gated worktree
 * assets, the auth gate 401s them, the React app never boots, and login is
 * broken. So this page inlines its styles, uses a plain HTML `<form>` POST that
 * works with JS disabled, and references NO script, stylesheet, or asset URL.
 *
 * Base-prefix aware: behind a fronting proxy that strips `/<prefix>` (the dev
 * router in dev, the hub for its children) the form action, OAuth link, and
 * `returnTo` all carry the prefix (from the trusted `x-cb-base-prefix` header,
 * via `readBasePrefix`). With no prefix (prod, standalone) they are bare origin
 * paths — `/auth/login`, `/auth/google` — so prod login is served at root.
 *
 * CSP note: prod's policy is `script-src 'self'` (no inline script) but
 * `style-src 'unsafe-inline'`, so an inline `<style>` is allowed and an inline
 * `<script>` is not — hence a scriptless plain form.
 */

/** HTML-escape a value before interpolating it into markup or an attribute. */
export function escapeHtml(value: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/["&'<>]/g, (c) => map[c] ?? c);
}

/**
 * Sanitize an untrusted `returnTo` to a same-origin path, failing safe to
 * `<prefix>/`. Mirrors `base-prefix.ts`'s discipline: only a single leading
 * slash is accepted (`//host` and `/\host` are protocol-relative / backslash
 * escapes a browser may normalize to another origin), no scheme can lead a
 * slash-anchored value, and control characters (CR/LF header-injection) are
 * rejected. The value later lands both in a `Location` header (success
 * redirect) and an HTML attribute (hidden field), so both surfaces are covered.
 */
export function sanitizeReturnTo({ raw, prefix }: { raw: string | undefined; prefix: string }): string {
  const fallback = `${prefix}/`;
  if (raw === undefined || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.includes("\\")) return fallback;
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code < 0x20) return fallback;
  }
  return raw;
}

/** Shared page shell — one inline stylesheet, no external references. */
export function pageShell({ title, body }: { title: string; body: string }): string {
  return (
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    `<title>${escapeHtml(title)}</title>` +
    "<style>" +
    ":root{color-scheme:light dark}" +
    "*{box-sizing:border-box}" +
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
    "padding:1rem;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
    "background:#f4f5f7;color:#1a1a1a}" +
    ".card{width:100%;max-width:22rem;background:#fff;border-radius:12px;padding:2rem;" +
    "box-shadow:0 4px 24px rgba(0,0,0,.12)}" +
    "h1{margin:0 0 1.25rem;font-size:1.5rem;text-align:center}" +
    "label{display:block;font-size:.85rem;font-weight:600;margin:0 0 .35rem}" +
    ".field{margin-bottom:1rem}" +
    "input{width:100%;padding:.6rem .7rem;font-size:1rem;border:1px solid #ccc;" +
    "border-radius:8px;background:#fff;color:inherit}" +
    "input:focus{outline:2px solid #2563eb;border-color:#2563eb}" +
    "button{width:100%;padding:.65rem;font-size:1rem;font-weight:600;color:#fff;" +
    "background:#2563eb;border:0;border-radius:8px;cursor:pointer}" +
    "button:hover{background:#1d4ed8}" +
    ".error{margin:0 0 1rem;padding:.6rem .7rem;border-radius:8px;font-size:.9rem;" +
    "background:#fde8e8;color:#9b1c1c;border:1px solid #f5c2c2}" +
    ".success{margin:0 0 1rem;padding:.6rem .7rem;border-radius:8px;font-size:.9rem;" +
    "background:#e8f8ee;color:#176b3a;border:1px solid #b7e4c7}" +
    ".alt{margin:1rem 0 0;text-align:center}" +
    ".alt a{color:#2563eb;text-decoration:none;font-weight:600}" +
    ".alt a:hover{text-decoration:underline}" +
    ".divider{margin:1rem 0;text-align:center;font-size:.75rem;letter-spacing:.05em;" +
    "text-transform:uppercase;color:#888}" +
    ".hint{margin:1.25rem 0 0;font-size:.8rem;color:#666;text-align:center}" +
    ".hint code{background:#eee;padding:.1rem .3rem;border-radius:4px}" +
    "@media(prefers-color-scheme:dark){" +
    "body{background:#111;color:#eee}" +
    ".card{background:#1c1c1e;box-shadow:0 4px 24px rgba(0,0,0,.5)}" +
    "input{background:#2a2a2c;border-color:#444}" +
    ".error{background:#3b1414;color:#f5b5b5;border-color:#7a2626}" +
    ".success{background:#123522;color:#a7e8bd;border-color:#276b43}" +
    ".hint{color:#aaa}.hint code{background:#2a2a2c}.divider{color:#999}}" +
    "</style></head><body>" +
    `<div class="card">${body}</div>` +
    "</body></html>"
  );
}

function errorBanner(message: string | null): string {
  if (message === null) return "";
  return `<div class="error" role="alert">${escapeHtml(message)}</div>`;
}

export interface LoginPageState {
  prefix: string;
  returnTo: string;
  error: boolean;
  googleConfigured: boolean;
  setupRequired: boolean;
  passwordReset: boolean;
}

/** Render the bare login page. `returnTo` is pre-sanitized by the caller. */
export function renderLoginPage(state: LoginPageState): string {
  const { prefix, returnTo, error, googleConfigured, setupRequired, passwordReset } = state;
  const returnToAttr = escapeHtml(returnTo);
  const google = googleConfigured
    ? "<div class=\"divider\">or</div>" +
      `<p class="alt"><a href="${escapeHtml(`${prefix}/auth/google?returnTo=${encodeURIComponent(returnTo)}`)}">` +
      "Sign in with Google</a></p>"
    : "";
  const hint = setupRequired
    ? "<p class=\"hint\">No account yet? Run the first-run setup (see the server console for the link), " +
      "or run <code>cb auth create-user</code> on the host.</p>"
    : "";
  const body =
    "<h1>Sign in</h1>" +
    (passwordReset ? '<div class="success" role="status">Password reset. Sign in with your new password.</div>' : "") +
    errorBanner(error ? "Incorrect email or password." : null) +
    `<form method="POST" action="${escapeHtml(`${prefix}/auth/login`)}">` +
    `<input type="hidden" name="returnTo" value="${returnToAttr}">` +
    "<div class=\"field\"><label for=\"email\">Email</label>" +
    "<input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\" required autofocus></div>" +
    "<div class=\"field\"><label for=\"password\">Password</label>" +
    "<input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required></div>" +
    "<button type=\"submit\">Sign in</button>" +
    "</form>" +
    google +
    hint;
  return pageShell({ title: "Callback Box — Sign in", body });
}

/** The setup errors the bare page can surface, mapped from the `?error=` query. */
export type SetupErrorKind = "token" | "exists" | "mismatch" | "generic";

function setupErrorMessage(kind: SetupErrorKind | null): string | null {
  if (kind === null) return null;
  switch (kind) {
    case "token":
      return "This setup link is invalid or has expired. Use the exact link printed to the server console, or run `cb auth create-user` on the host.";
    case "exists":
      return "An account already exists — sign in instead.";
    case "mismatch":
      return "Passwords don't match.";
    case "generic":
      return "Setup failed. Please try again.";
  }
}

export interface SetupPageState {
  prefix: string;
  token: string | null;
  error: SetupErrorKind | null;
}

/**
 * Render the bare first-run setup page. With no token in the URL the form is
 * useless (the token is printed only to the server console — never served), so
 * render the same console/CLI pointer the SPA showed instead of a dead form.
 */
export function renderSetupPage(state: SetupPageState): string {
  const { prefix, error } = state;
  if (state.token === null) {
    const body =
      "<h1>First-run setup</h1>" +
      "<p class=\"hint\">This page needs the one-time setup link printed to the server console when it " +
      "first started (search the output for <code>First-run setup:</code>). If the server has been " +
      "restarted or an account already exists, the link has expired.</p>" +
      "<p class=\"hint\">Alternatively, create the first account directly on the host with " +
      "<code>cb auth create-user</code>.</p>";
    return pageShell({ title: "Callback Box — Setup", body });
  }
  const body =
    "<h1>Create your account</h1>" +
    errorBanner(setupErrorMessage(error)) +
    `<form method="POST" action="${escapeHtml(`${prefix}/auth/setup`)}">` +
    `<input type="hidden" name="token" value="${escapeHtml(state.token)}">` +
    "<div class=\"field\"><label for=\"name\">Name</label>" +
    "<input id=\"name\" name=\"name\" type=\"text\" autocomplete=\"name\" required autofocus></div>" +
    "<div class=\"field\"><label for=\"email\">Email</label>" +
    "<input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\" required></div>" +
    "<div class=\"field\"><label for=\"password\">Password</label>" +
    "<input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" required></div>" +
    "<div class=\"field\"><label for=\"confirm\">Confirm password</label>" +
    "<input id=\"confirm\" name=\"confirmPassword\" type=\"password\" autocomplete=\"new-password\" required></div>" +
    "<button type=\"submit\">Create account</button>" +
    "</form>";
  return pageShell({ title: "Callback Box — Setup", body });
}
