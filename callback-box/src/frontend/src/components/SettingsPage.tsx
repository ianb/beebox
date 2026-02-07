/**
 * Settings page with dropbox pairing UI.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { getDropboxStatus, createPairing, type DropboxStatus, type PairResult } from "../api";

export function SettingsPage() {
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerUrl, setWorkerUrl] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getDropboxStatus()
      .then((s) => {
        setStatus(s);
        if (s.workerUrl) setWorkerUrl(s.workerUrl);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handlePair = async () => {
    if (!workerUrl.trim()) return;
    setError(null);
    setPairing(true);
    setPairResult(null);

    try {
      const result = await createPairing(workerUrl.trim());
      setPairResult(result);

      // Start countdown
      const expiresMs = new Date(result.expiresAt).getTime() - Date.now();
      setCountdown(Math.max(0, Math.round(expiresMs / 1000)));

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Refresh status
      const newStatus = await getDropboxStatus();
      setStatus(newStatus);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPairing(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm">
            &larr; Back to Dashboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        {/* Dropbox Pairing Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Browser Message Relay
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Connect a browser extension to send memos and context to your callback box
            via an encrypted relay.
          </p>

          {/* Current status */}
          {status?.paired ? (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm">
              <span className="font-medium text-green-800">Connected</span>
              <span className="text-green-700 ml-2">to {status.workerUrl}</span>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
              Not connected
            </div>
          )}

          {/* Worker URL input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Worker URL
            </label>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://callback-dropbox.your-account.workers.dev"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Pair button */}
          <button
            onClick={handlePair}
            disabled={pairing || !workerUrl.trim()}
            className="btn btn-primary"
          >
            {pairing
              ? "Creating..."
              : status?.paired
                ? "Generate New Pairing Code"
                : "Generate Pairing Code"}
          </button>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Pairing code display */}
          {pairResult && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
              <p className="text-sm text-blue-700 mb-2">
                Enter this code in your browser extension:
              </p>
              <div className="text-3xl font-mono font-bold text-blue-900 tracking-widest text-center py-2">
                {pairResult.code}
              </div>
              {countdown !== null && countdown > 0 ? (
                <p className="text-xs text-blue-600 text-center mt-2">
                  Expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                </p>
              ) : countdown === 0 ? (
                <p className="text-xs text-red-600 text-center mt-2">
                  Expired — generate a new code
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
