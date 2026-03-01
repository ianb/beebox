/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status and lets the owner authenticate/logout.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

interface ClaudeStatus {
  loggedIn?: boolean;
  email?: string;
  error?: string;
  raw?: string;
  // claude auth status may return various fields
  [key: string]: unknown;
}

interface LoginResult {
  authUrl?: string;
  status?: string;
  error?: string;
  output?: string;
}

function ClaudeCodeSection() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<"idle" | "starting" | "waiting" | "polling">("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/claude-status");
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data: ClaudeStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleLogin = async () => {
    setLoginState("starting");
    setAuthUrl(null);
    setError(null);

    try {
      const resp = await fetch("/api/admin/claude-login", { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(data.error || "Login failed");
      }
      const result: LoginResult = await resp.json();

      if (result.authUrl) {
        setAuthUrl(result.authUrl);
        setLoginState("polling");

        // Poll for completion
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await fetchStatus();
          if (s?.loggedIn) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setLoginState("idle");
            setAuthUrl(null);
          }
        }, 3000);

        // Stop polling after 3 minutes
        setTimeout(() => {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setLoginState("idle");
          }
        }, 180000);
      } else {
        setError(result.error || "No auth URL received");
        setLoginState("idle");
      }
    } catch (err) {
      setError((err as Error).message);
      setLoginState("idle");
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setError(null);

    try {
      const resp = await fetch("/api/admin/claude-logout", { method: "POST" });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Logout failed");
      }
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Claude Code</h2>
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Claude Code</h2>
      <p className="text-sm text-warm-700 mb-4">
        Claude Code runs background agents (scheduler, reactor). Authenticate with
        your Anthropic account to enable these features.
      </p>

      {/* Current status */}
      {status?.loggedIn ? (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm">
          <span className="font-medium text-green-800">Authenticated</span>
          {status.email ? (
            <span className="text-green-700 ml-2">as {status.email}</span>
          ) : null}
        </div>
      ) : (
        <div className="mb-4 p-3 bg-warm-50 border border-warm-300 rounded text-sm text-warm-700">
          Not authenticated
          {status?.error ? (
            <span className="text-warm-500 ml-2">({status.error})</span>
          ) : null}
        </div>
      )}

      {/* Auth URL display */}
      {authUrl && loginState === "polling" ? (
        <div className="mb-4 p-4 bg-iris-50 border border-iris-100 rounded">
          <p className="text-sm text-plum mb-2">
            Complete authentication in a new tab:
          </p>
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-iris-dark underline hover:text-plum break-all"
          >
            Open Anthropic Login
          </a>
          <p className="text-xs text-plum mt-2">
            Waiting for authentication to complete...
          </p>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex gap-3">
        {!status?.loggedIn ? (
          <button
            onClick={handleLogin}
            disabled={loginState !== "idle"}
            className="btn btn-primary"
          >
            {loginState === "starting"
              ? "Starting..."
              : loginState === "polling"
                ? "Waiting..."
                : "Authenticate Claude Code"}
          </button>
        ) : null}
        {status?.loggedIn ? (
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn bg-warm-200 text-warm-800 hover:bg-warm-300"
          >
            {loggingOut ? "Logging out..." : "Log Out"}
          </button>
        ) : null}
        <button
          onClick={() => {
            setLoading(true);
            fetchStatus().finally(() => setLoading(false));
          }}
          className="btn bg-warm-100 text-warm-700 hover:bg-warm-200"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

export function AdminPage() {
  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link to="/" className="text-plum hover:text-plum-dark text-sm">
            &larr; Back
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-warm-900 mb-6">Admin</h1>

        <ClaudeCodeSection />
      </div>
    </div>
  );
}
