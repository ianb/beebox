/**
 * Status bar showing system state and connection status.
 */

import { useEffect, useState } from "react";
import { getStatus, type StatusResponse } from "../api";

interface StatusBarProps {
  connected: boolean;
  onRefresh: () => void;
}

export function StatusBar({ connected, onRefresh }: StatusBarProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const data = await getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-900">Callback Box</h1>

        {/* Connection indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-500">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Counts */}
        {status && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">
              <span className="font-medium">{status.counts.inbox}</span> inbox
            </span>
            <span className="text-gray-600">
              <span className="font-medium">{status.counts.pendingQuestions}</span> questions
            </span>
            <span className="text-gray-600">
              <span className="font-medium">{status.counts.commands}</span> commands
            </span>
            {!status.git.clean && (
              <span className="text-yellow-600 font-medium">Uncommitted changes</span>
            )}
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={() => {
            fetchStatus();
            onRefresh();
          }}
          className="btn btn-secondary text-sm"
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="absolute top-full left-0 right-0 bg-red-100 text-red-800 px-4 py-2 text-sm">
          Error: {error}
        </div>
      )}
    </div>
  );
}
