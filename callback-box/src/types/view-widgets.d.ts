/**
 * Ambient types for the public `callback-box/view-widgets` specifier as seen
 * from backend code (`cb view test` dynamic-imports it). The real implementation
 * is the esbuild bundle at dist/view-widgets/index.js (built from
 * src/frontend/src/components/view-widgets/node-entry.tsx). External boxes
 * get this same surface in module form via src/exports/view-widgets.d.ts
 * (shipped as the bundle's sibling index.d.ts) — keep the two in sync.
 */
declare module "callback-box/view-widgets" {
  import type { ComponentType, ReactNode } from "react";

  export const CardLink: ComponentType<{ cardRef: string; view?: string; params?: Record<string, string>; children?: ReactNode }>;
  export const CardRef: ComponentType<{ cardRef: string; view?: string; params?: Record<string, string>; children?: ReactNode }>;
  /** Supplies the node view host so card widgets resolve their context in `cb view test`. */
  export const NodeViewHostProvider: ComponentType<{ children: ReactNode }>;
}
