/**
 * Activity log showing recent git commits.
 */

import { trpc } from "../lib/trpc";

interface ActivityLogProps {
  refreshKey: number;
}

export function ActivityLog({ refreshKey: _refreshKey }: ActivityLogProps) {
  const { data, isLoading, error } = trpc.status.activity.useQuery({ count: 20 });

  const entries = data?.entries ?? [];

  if (isLoading) {
    return <div className="p-4 text-warm-600">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error.message}</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-warm-600 text-center py-8">No activity yet</div>
    );
  }

  return (
    <div className="divide-y">
      {entries.map((entry) => (
        <div key={entry.hash} className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="font-medium text-warm-900">{entry.subject}</div>
            <div className="text-sm text-warm-500">
              {new Date(entry.date).toLocaleString()}
            </div>
          </div>
          <div className="text-xs text-warm-500 font-mono mt-1">
            {entry.hash.substring(0, 8)}
          </div>
          {entry.trailers && Object.keys(entry.trailers).length > 0 ? <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(entry.trailers).map(([key, value]) => (
                <span
                  key={key}
                  className="text-xs bg-warm-100 text-warm-700 px-2 py-0.5 rounded"
                >
                  {key}: {value}
                </span>
              ))}
            </div> : null}
        </div>
      ))}
    </div>
  );
}
