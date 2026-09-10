/** Reserve the browser's listing/detail layout while validating its location. */
export function BrowseLoading() {
  return <div aria-busy="true" aria-label="Loading Browse location" className="flex h-full min-h-48">
    <div className="w-64 shrink-0 border-r border-warm-200 p-4">
      {[0, 1, 2, 3].map((row) => <div key={row} className="mb-4 h-5 rounded bg-warm-100" />)}
    </div>
    <div className="flex-1 p-4"><div className="h-8 rounded bg-warm-100" /></div>
  </div>;
}
