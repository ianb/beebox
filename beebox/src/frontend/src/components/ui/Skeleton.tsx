import { cn } from "../../lib/cn";

export interface SkeletonProps {
  /** Size and layout (`h-5 w-48`, `flex-1`). The bar has no intrinsic size. */
  className: string;
}

/**
 * One placeholder bar for content still loading. Decorative: the container
 * that shows skeletons carries `aria-busy` and a label, and a screen reader
 * hears that, not the bars.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("bg-warm-100 rounded animate-pulse", className)} />;
}
