import { Skeleton } from "../../../components/ui/Skeleton";

/** Reserve the browser's listing/detail layout while validating its location. */
export function BrowseSkeleton() {
  return <div role="status" aria-busy="true" aria-label="Loading Browse location" className="flex h-full min-h-48">
    <div className="w-64 shrink-0 border-r border-warm-200 p-4">
      {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="mb-4 h-5" />)}
    </div>
    <div className="flex-1 p-4"><Skeleton className="h-8" /></div>
  </div>;
}
