/**
 * The app URL: where a person opens this deployment's app, without the box
 * slug. The box browser opens the box's own pages there, and the browser pass
 * is installed for it (docs/implemented-plans/agent-self-view.md, Track B).
 *
 * Only operator configuration counts: `BBX_PUBLIC_URL`/`PUBLIC_URL` (the
 * production front door), else `BBX_DEV_APP_URL` (the dev router's URL for a
 * worktree, set by `workstreams-app/src/router/core/worktree-start.ts`). Never
 * `_config/box.json#publicUrl`: the agent can edit that file, and the pass must
 * go only to an address the operator chose.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type AppUrl = { ok: true; base: URL } | { ok: false; reason: string };

/** Resolve from an environment (the engine passes `process.env`). */
export function resolveAppUrl(env: NodeJS.ProcessEnv): AppUrl {
  // The same order as `getPublicUrl` (`src/lib/public-url.ts`), then the dev router.
  const raw = (env.BBX_PUBLIC_URL || env.PUBLIC_URL || env.BBX_DEV_APP_URL || "").trim();
  if (raw === "") return { ok: false, reason: "this box has no public URL, so its browser cannot open the box's pages" };
  let base: URL;
  try {
    base = new URL(raw.replace(/\/+$/, ""));
  } catch (_e) {
    // A malformed operator value: say which, never guess another address.
    return { ok: false, reason: `the box's public URL is not a URL: ${raw}` };
  }
  // Plain http only on loopback: Chrome sends no fetch metadata to a plain-http
  // remote origin (W3C Fetch Metadata, section 3), so the pass's site check
  // could never admit a request there. Refuse before any pass is minted.
  const loopback = LOOPBACK_HOSTS.has(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) {
    return { ok: false, reason: `the box browser needs an https public URL (or http on localhost): ${raw}` };
  }
  return { ok: true, base };
}

/** The app's origin, or null when there is no app URL; what `passSiteOk` compares `Origin` with. */
export function appOrigin(env: NodeJS.ProcessEnv): string | null {
  const url = resolveAppUrl(env);
  return url.ok ? url.base.origin : null;
}

/** The path every app request lives under: `/` in production, `/<worktree>/` in dev. */
export function appBasePath(base: URL): string {
  return `${base.pathname.replace(/\/+$/, "")}/`;
}
