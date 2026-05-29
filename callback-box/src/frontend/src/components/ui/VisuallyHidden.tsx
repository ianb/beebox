/**
 * Render content that's available to screen readers and the accessibility
 * tree but hidden visually. Use for page-level headings on layouts where
 * the visible heading lives inside a component that can collapse or move
 * off-screen at certain viewports.
 */

import type { ElementType, ReactNode } from "react";

export interface VisuallyHiddenProps {
  children: ReactNode;
  /** Element to render. Default `"span"`. Use `"h1"` etc. when the hidden text is a heading. */
  as?: ElementType;
}

export function VisuallyHidden({ children, as: Tag = "span" }: VisuallyHiddenProps) {
  return <Tag className="sr-only">{children}</Tag>;
}
