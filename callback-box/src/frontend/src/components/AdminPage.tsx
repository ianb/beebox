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

interface TelegramStatus {
  configured: boolean;
  botUsername?: string;
  botFirstName?: string;
  webhookUrl?: string | null;
  maskedToken?: string;
  publicUrl?: string;
  boxSlug?: string;
  error?: string;
}

function TelegramSection({ boxSlug }: { boxSlug: string }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`/api/admin/telegram-status?box=${boxSlug}`);
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data: TelegramStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [boxSlug]);

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleConnect = async () => {
    if (!botToken.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      const resp = await fetch(`/api/admin/telegram-setup?box=${boxSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Setup failed");
      }
      setBotToken("");
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);

    try {
      const resp = await fetch(`/api/admin/telegram-disconnect?box=${boxSlug}`, { method: "POST" });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Disconnect failed");
      }
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Telegram</h2>
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Telegram</h2>
      <p className="text-sm text-warm-700 mb-4">
        Connect a Telegram bot to receive and respond to messages in Telegram groups or private chats.
      </p>

      {status?.configured ? (
        <>
          {/* Connected status */}
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm">
            <span className="font-medium text-green-800">Connected</span>
            {status.botUsername ? (
              <span className="text-green-700 ml-2">as @{status.botUsername}</span>
            ) : null}
            {status.maskedToken ? (
              <span className="text-warm-500 ml-2">(token: {status.maskedToken})</span>
            ) : null}
          </div>

          {/* Webhook info */}
          {status.webhookUrl ? (
            <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-700">
              <span className="font-medium">Webhook:</span>{" "}
              <span className="break-all">{status.webhookUrl}</span>
            </div>
          ) : null}

          {status.error ? (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              {status.error}
            </div>
          ) : null}

          {/* Usage instructions */}
          <div className="mb-4 p-3 bg-iris-50 border border-iris-100 rounded text-sm text-plum">
            <p className="font-medium mb-1">To use in a group:</p>
            <p>Add <strong>@{status.botUsername}</strong> to your Telegram group and send a message.</p>
          </div>

          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="btn bg-warm-200 text-warm-800 hover:bg-warm-300"
          >
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        </>
      ) : (
        <>
          {/* Setup instructions */}
          <div className="mb-4 p-4 bg-warm-50 border border-warm-200 rounded text-sm text-warm-800">
            <p className="font-medium mb-2">Setup steps:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Open Telegram and message <strong>@BotFather</strong></li>
              <li>Send <code className="bg-warm-200 px-1 rounded">/newbot</code> and follow the prompts</li>
              <li>Copy the bot token (looks like <code className="bg-warm-200 px-1 rounded text-xs">123456:ABC-DEF...</code>)</li>
              <li>Paste it below</li>
            </ol>
          </div>

          {/* Token input */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
              placeholder="Paste bot token here"
              className="flex-1 rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
            />
            <button
              onClick={handleConnect}
              disabled={connecting || !botToken.trim()}
              className="btn btn-primary"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </>
      )}

      {/* Error */}
      {error ? (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function AllowedEmailsSection({ boxSlug }: { boxSlug: string }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const resp = await fetch(`/api/admin/box-config?box=${boxSlug}`);
      if (!resp.ok) throw new Error(`Failed to load config: ${resp.status}`);
      const data = await resp.json();
      setEmails(data.allowedEmails ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [boxSlug]);

  useEffect(() => {
    setLoading(true);
    fetchConfig().finally(() => setLoading(false));
  }, [fetchConfig]);

  const saveEmails = async (updated: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/box-config?box=${boxSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedEmails: updated }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Save failed");
      setEmails(data.allowedEmails ?? updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (emails.includes(email)) {
      setNewEmail("");
      return;
    }
    const updated = [...emails, email];
    setNewEmail("");
    saveEmails(updated);
  };

  const handleRemove = (email: string) => {
    saveEmails(emails.filter((e) => e !== email));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Allowed Users</h2>
        <p className="text-sm text-warm-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Allowed Users</h2>
      <p className="text-sm text-warm-700 mb-4">
        Email addresses that can access this box. Leave empty to allow all authenticated users.
      </p>

      {emails.length > 0 ? (
        <div className="mb-4 space-y-2">
          {emails.map((email) => (
            <div key={email} className="flex items-center gap-2 p-2 bg-warm-50 border border-warm-200 rounded text-sm">
              <span className="flex-1 text-warm-800">{email}</span>
              <button
                onClick={() => handleRemove(email)}
                disabled={saving}
                className="text-warm-500 hover:text-red-600 text-xs px-2"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-600">
          No restrictions — all authenticated users can access this box.
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="user@example.com"
          className="flex-1 rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !newEmail.trim().includes("@")}
          className="btn btn-primary"
        >
          {saving ? "Saving..." : "Add"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const [boxes, setBoxes] = useState<Array<{ slug: string }>>([]);
  const [selectedBox, setSelectedBox] = useState<string>("");

  useEffect(() => {
    fetch("/api/admin/boxes")
      .then((r) => r.json())
      .then((data) => {
        const boxList = data.boxes ?? [];
        setBoxes(boxList);
        if (boxList.length > 0) {
          setSelectedBox((prev) => prev || boxList[0].slug);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link to="/" className="text-plum hover:text-plum-dark text-sm">
            &larr; Back
          </Link>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-warm-900">Admin</h1>
          {boxes.length > 1 ? (
            <select
              value={selectedBox}
              onChange={(e) => setSelectedBox(e.target.value)}
              className="rounded-lg border border-warm-400 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gold"
            >
              {boxes.map((b) => (
                <option key={b.slug} value={b.slug}>{b.slug}</option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="space-y-6">
          <ClaudeCodeSection />
          {selectedBox ? (
            <>
              <AllowedEmailsSection key={`emails-${selectedBox}`} boxSlug={selectedBox} />
              <TelegramSection key={`telegram-${selectedBox}`} boxSlug={selectedBox} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
