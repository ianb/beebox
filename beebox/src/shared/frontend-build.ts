/**
 * The frontend build identity: a short hex string naming one built frontend
 * bundle. The Vite build writes it into `dist/index.html` as
 * `<meta name="bbx-frontend-build" content="…">`
 * (`frontend/src/dev/build-identity-plugin`). The box server reads it from the
 * `index.html` it would serve (`webapp/trpc/routers/build.ts`), and a running page
 * reads it from its own document, so the two can be compared to find a tab
 * left open across a deploy that changed the frontend. A deploy that changes
 * only docs or the server rebuilds the same bundle and keeps the identity.
 * The Vite dev server's document has no such tag.
 */

export const FRONTEND_BUILD_META_NAME = "bbx-frontend-build";

const IDENTITY = /^[\da-f]{16}$/;
const META = new RegExp(`<meta name="${FRONTEND_BUILD_META_NAME}" content="([^"]*)"\\s*/?>`);

/** True for a well-formed identity (16 lowercase hex characters). */
export function isFrontendBuild(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

/** The identity in a built `index.html`, or null when it has none. */
export function frontendBuildFromHtml(html: string): string | null {
  const content = META.exec(html)?.[1];
  return isFrontendBuild(content) ? content : null;
}
