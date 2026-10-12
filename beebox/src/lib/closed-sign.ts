/**
 * The paper sign shown while a page cannot be served: a tag on a string that
 * swings once on its pin and settles. One definition for every such page, so
 * they look and move the same: the hub's closed or not-open box page
 * (hub/server/box-unavailable.ts) and nginx's deploy page
 * (scripts/build-deploy-page.ts). Both are self-contained documents, so the
 * sign carries its own colors (light and dark) and its reduced-motion rule.
 */
import { escapeHtml } from "./escape-html.js";

export const CLOSED_SIGN_CSS = `
.bbx-sign { --sign-paper: #f5efe2; --sign-ink: #332e27; --sign-soft: #4f4439; --sign-edge: #d6c8af; --sign-string: #8a7a62;
  transform-origin: 50% 4px; text-align: center; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
@media (prefers-color-scheme: dark) { .bbx-sign { --sign-paper: #3a352d; --sign-ink: #f1e9da; --sign-soft: #cbbfa9; --sign-edge: #5a5143; --sign-string: #a8987e; } }
.bbx-sign.swing { animation: bbx-sign-swing 2600ms ease-out both; }
@keyframes bbx-sign-swing { from { transform: rotate(11deg); } 22% { transform: rotate(-7deg); } 44% { transform: rotate(4deg); } 66% { transform: rotate(-2deg); } 84% { transform: rotate(.6deg); } }
.bbx-sign-string { display: block; width: 120px; height: 40px; margin: 0 auto -2px; }
.bbx-sign-string path { fill: none; stroke: var(--sign-string); stroke-width: 1.2; }
.bbx-sign-string circle { fill: #8b3f2c; }
.bbx-sign-tag { width: 200px; margin: 0 auto; padding: 14px 12px 12px; background: var(--sign-paper); color: var(--sign-ink); border: 1px solid var(--sign-edge);
  border-radius: 6px; box-shadow: 0 1px 2px #0002, 0 6px 14px #0002; }
.bbx-sign-title { display: block; margin: 0; font-size: 26px; font-weight: 600; letter-spacing: .02em; line-height: 1.25; }
.bbx-sign-tag p { margin: 2px 0 0; color: var(--sign-soft); }
@media (prefers-reduced-motion: reduce) { .bbx-sign.swing { animation: none; } }
`;

/**
 * The sign's markup. `title` is the page's heading when nothing else is
 * (`h1`); a page with its own headline passes `strong`.
 */
export function closedSignHtml(params: { headline: string; subline: string; swing: boolean; title: "h1" | "strong" }): string {
  const { headline, subline, swing, title } = params;
  return `<div class="bbx-sign${swing ? " swing" : ""}">
  <svg class="bbx-sign-string" viewBox="0 0 120 40" aria-hidden="true"><path d="M10 40 L60 4 L110 40"/><circle cx="60" cy="4" r="3"/></svg>
  <div class="bbx-sign-tag"><${title} class="bbx-sign-title">${escapeHtml(headline)}</${title}><p>${escapeHtml(subline)}</p></div>
</div>`;
}
