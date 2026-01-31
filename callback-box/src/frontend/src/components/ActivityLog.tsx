/**
 * Activity log showing recent git commits.
 */

import { useEffect, useState } from "react";
import { getLog, type LogEntry } from "../api";

interface ActivityLogProps {
  refreshKey: number;
}

export function ActivityLog({ refreshKey }: ActivityLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLog = async () => {
      try {
        setLoading(true);
        const data = await getLog(20);
        setEntries(data.entries);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchLog();
  }, [refreshKey]);

  if (loading) {
    return <div className="p-4 text-gray-500">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">No activity yet</div>
    );
  }

  return (
    <div className="divide-y">
      {entries.map((entry) => (
        <div key={entry.hash} className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="font-medium text-gray-900">{entry.subject}</div>
            <div className="text-sm text-gray-400">
              {new Date(entry.date).toLocaleString()}
            </div>
          </div>
          <div className="text-xs text-gray-400 font-mono mt-1">
            {entry.hash.substring(0, 8)}
          </div>
          {entry.trailers && Object.keys(entry.trailers).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(entry.trailers).map(([key, value]) => (
                <span
                  key={key}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                >
                  {key}: {value}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
