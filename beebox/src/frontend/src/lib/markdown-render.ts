/**
 * The per-render values of one `Markdown` body, read by the components in its
 * Markdoc map (`Link`, `Img`, citations, quotes, todos, embeds).
 *
 * The components are declared once at module scope and read these values
 * here. A component made per render (a factory closing over `onNavigate`) is
 * a new React type each time, so React remounts it and everything inside it:
 * an embedded figure loses its state and the reader's place moves. A new value
 * here re-renders the components in place instead.
 */

import { createContext, useContext } from "react";
import type { OpenFromElementOptions } from "../components/LightboxProvider";
import type { NavigateHint, ViewTarget } from "./view-url";

export interface MarkdownRender {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** The document's own path; relative links, refs, and embeds resolve against it. */
  basePath: string | undefined;
  boxSlug: string | undefined;
  /**
   * Optional: jump to a quoted span in a sibling pane (e.g. the saved page
   * beside a commentary). Given the verbatim quote text; resolves true if it
   * found and scrolled to the span, false to fall back to navigation.
   */
  onJumpToQuote: ((quoteText: string) => Promise<boolean>) | undefined;
  /**
   * Opens a link to an image card in the lightbox (`useLightbox().openFromElement`).
   * False when nothing opened; the link then navigates as any other.
   */
  openImageLink: ((element: HTMLElement, options: OpenFromElementOptions) => boolean) | undefined;
  /** The card whose body this is, so a todo finds its plate state; null outside a card body. */
  cardPath: string | null;
}

export const MarkdownRenderContext = createContext<MarkdownRender | null>(null);

/** Thrown when a Markdown component renders outside `Markdown` (or a test's provider). */
class MarkdownRenderMissingError extends Error {
  constructor() {
    super("useMarkdownRender() called outside <Markdown>; a Markdown component needs the body's MarkdownRenderContext.");
    this.name = "MarkdownRenderMissingError";
  }
}

export function useMarkdownRender(): MarkdownRender {
  const value = useContext(MarkdownRenderContext);
  if (value === null) throw new MarkdownRenderMissingError();
  return value;
}
