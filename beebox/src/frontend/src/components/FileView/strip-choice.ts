/**
 * What draws a card in the conversation strip
 * (`docs/plans/conversation-strip.md`, Tracks B and C): a box view bound
 * for the strip wins; else the first built-in renderer that declares
 * `strip: true`; else nothing, and the strip shows a one-line notice.
 */

import type { FileRenderer } from "../../file-type-registry";

export type StripChoice<B> =
  | { kind: "view"; binding: B }
  | { kind: "builtin"; renderer: FileRenderer }
  | { kind: "none" };

/** `renderers` in priority order, as `getRenderers` returns them. */
export function stripRendererChoice<B>({ binding, renderers }: { binding: B | null; renderers: readonly FileRenderer[] }): StripChoice<B> {
  if (binding !== null) return { kind: "view", binding };
  const renderer = renderers.find((candidate) => candidate.strip === true);
  return renderer === undefined ? { kind: "none" } : { kind: "builtin", renderer };
}
