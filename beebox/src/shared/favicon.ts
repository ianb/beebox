/**
 * An emoji as a favicon.
 *
 * A landmark's `symbol` is usually an emoji, and a browser tab wants an image.
 * Rather than rasterize anything, the emoji is wrapped in an SVG the browser
 * draws with its own emoji font and handed over as a self-contained `data:`
 * URI — no file to store, no path to resolve, nothing to keep in sync with a
 * card someone just edited.
 *
 * The trade-off is honest: the glyph renders in whatever emoji font the
 * viewer's OS has, at 16 physical pixels. This is a box saying which box it
 * is, not a designed mark. A box that wants a designed mark uses an image
 * symbol (`symbol: { src }`) instead.
 *
 * Shared because both ends need it and they must agree: the box server stamps
 * it into the served document (`webapp/index-html.ts`) so the first paint is
 * already right, and the client re-derives it as you move between landmarks
 * (`frontend/src/components/DocumentIcon.tsx`).
 */

/** Escape text for XML character data / a double-quoted attribute. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * An `href` for `<link rel="icon">` that renders `emoji`.
 *
 * The viewBox is square and the glyph is centred with a baseline that suits a
 * full-height emoji; `font-size` slightly under the box leaves room for the
 * taller glyphs to avoid clipping.
 */
export function emojiFaviconUri(emoji: string): string {
  const svg =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\">" +
    `<text x="16" y="25" font-size="26" text-anchor="middle">${escapeXml(emoji)}</text>` +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
