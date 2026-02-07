import { useState } from "react";
import { redeemPairingCode } from "callback-dropbox/client";
import { saveCredentials, type StoredCredentials } from "../lib/storage";

const DEFAULT_WORKER_URL = "https://callback-dropbox.ianbicking.workers.dev";

interface PairingViewProps {
  onPaired: (credentials: StoredCredentials) => void;
}

export default function PairingView({ onPaired }: PairingViewProps) {
  const [code, setCode] = useState("");
  const [workerUrl, setWorkerUrl] = useState(DEFAULT_WORKER_URL);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await redeemPairingCode(workerUrl, code.trim());
      const creds: StoredCredentials = {
        workerUrl,
        apiKey: result.apiKey,
        channelKey: result.channelKey,
        channelId: result.channelId,
      };
      await saveCredentials(creds);
      // Tell background worker to start syncing
      chrome.runtime.sendMessage({ type: "paired" });
      onPaired(creds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-3">Callback Clerk</h1>
      <p className="text-sm text-gray-600 mb-4">
        Enter the pairing code from your callback-box agent.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          maxLength={6}
          className="w-full px-3 py-2 border rounded text-center text-2xl tracking-widest font-mono"
          autoFocus
        />
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-gray-400 mt-2 hover:text-gray-600"
        >
          {showAdvanced ? "Hide" : "Advanced"}
        </button>
        {showAdvanced && (
          <input
            type="url"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="Worker URL"
            className="w-full px-3 py-1.5 border rounded text-xs mt-1"
          />
        )}
        {error && (
          <p className="text-red-500 text-xs mt-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || code.trim().length < 6}
          className="w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {submitting ? "Pairing..." : "Pair"}
        </button>
      </form>
    </div>
  );
}
