/**
 * Public type surface of `callback-box/view-widgets`, in module form.
 * build-cli copies this to dist/view-widgets/index.d.ts (sibling of the
 * bundle) and the exports map names it via a `types` condition, so a box's
 * own `pnpm exec tsc` can typecheck `import { CardLink } from
 * "callback-box/view-widgets"` — the engine-internal twin of this surface is
 * the ambient declaration in src/types/view-widgets.d.ts (backend code sees
 * that one; keep the two in sync).
 */
import type { ComponentType, ReactNode } from "react";

export const CardLink: ComponentType<{
  cardRef: string;
  view?: string;
  params?: Record<string, string>;
  children?: ReactNode;
}>;
export const CardRef: ComponentType<{
  cardRef: string;
  view?: string;
  params?: Record<string, string>;
  children?: ReactNode;
}>;
/** Supplies the node view host so card widgets resolve their context in `cb view test`. */
export const NodeViewHostProvider: ComponentType<{ children: ReactNode }>;
