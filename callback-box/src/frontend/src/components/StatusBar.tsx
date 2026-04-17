/**
 * Status bar showing system state and connection status.
 */

import { trpc } from "../lib/trpc";
import { Button } from "./ui/Button";

interface StatusBarProps {
  connected: boolean;
  onRefresh: () => void;
}

export function StatusBar({ connected, onRefresh }: StatusBarProps) {
  const { data: status, isLoading, error, refetch } = trpc.status.status.useQuery();

  return (
    <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-warm-900">Callback Box</h1>

        {/* Connection indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-warm-600">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Counts */}
        {status ? <div className="flex items-center gap-4 text-sm">
            <span className="text-warm-700">
              <span className="font-medium">{status.counts.inbox}</span> inbox
            </span>
            <span className="text-warm-700">
              <span className="font-medium">{status.counts.pendingQuestions}</span> questions
            </span>
            {!status.git.clean && (
              <span className="text-yellow-600 font-medium">Uncommitted changes</span>
            )}
          </div> : null}

        {/* Refresh button */}
        <Button
          type="button"
          intent="secondary"
          size="sm"
          onClick={() => {
            refetch();
            onRefresh();
          }}
          loading={isLoading}
          loadingLabel="Loading…"
        >
          Refresh
        </Button>
      </div>

      {error ? <div className="absolute top-full left-0 right-0 bg-red-100 text-red-800 px-4 py-2 text-sm">
          Error: {error.message}
        </div> : null}
    </div>
  );
}
