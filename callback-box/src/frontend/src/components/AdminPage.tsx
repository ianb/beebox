/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status and lets the owner authenticate/logout.
 */

import { useState, useEffect, useCallback } from "react";
import { useSSRMachine } from "../hooks/useSSRMachine";
import { Link, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { getApiBase } from "../api.js";
import { claudeAuthMachine } from "../machines/claudeAuthMachine.js";
import { ExternalLink } from "./ui/ExternalLink";
import { CheckboxField, TextField } from "./ui/fields";
import { Button } from "./ui/Button";

function ClaudeCodeSection() {
  const [snapshot, send] = useSSRMachine(claudeAuthMachine);
  const { status, error, authUrl } = snapshot.context;
  const isLoading = snapshot.matches("loading");
  const isStarting = snapshot.matches("starting");
  const isPolling = snapshot.matches("polling");
  const isLoggingOut = snapshot.matches("loggingOut");
  const isIdle = snapshot.matches("idle");

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-warm-800">Claude Code</h2>
          <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">System-wide</span>
        </div>
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-warm-800">Claude Code</h2>
        <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">System-wide</span>
      </div>
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
      {authUrl && isPolling ? (
        <div className="mb-4 p-4 bg-iris-50 border border-iris-100 rounded">
          <p className="text-sm text-plum mb-2">
            Complete authentication in a new tab:
          </p>
          <ExternalLink href={authUrl}>Open Anthropic Login</ExternalLink>
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
          <Button
            type="button"
            intent="primary"
            onClick={() => send({ type: "LOGIN" })}
            disabled={!isIdle}
            loading={isStarting || isPolling}
            loadingLabel={isPolling ? "Waiting…" : "Starting…"}
          >
            Authenticate Claude Code
          </Button>
        ) : null}
        {status?.loggedIn ? (
          <Button
            type="button"
            intent="secondary"
            onClick={() => send({ type: "LOGOUT" })}
            loading={isLoggingOut}
            loadingLabel="Logging out…"
          >
            Log Out
          </Button>
        ) : null}
        <Button
          type="button"
          intent="ghost"
          onClick={() => send({ type: "REFRESH" })}
          disabled={isLoading}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}

interface TelegramStatus {
  configured: boolean;
  botUsername?: string;
  botFirstName?: string;
  webhookUrl?: string | null;
  botToken?: string;
  publicUrl?: string;
  boxSlug?: string;
  error?: string;
}

function TelegramSection({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/admin/telegram-status`);
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data: TelegramStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [apiBase]);

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleConnect = async () => {
    if (!botToken.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      const resp = await fetch(`${apiBase}/admin/telegram-setup`, {
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
      const resp = await fetch(`${apiBase}/admin/telegram-disconnect`, { method: "POST" });
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
          </div>

          {/* Bot token (copyable for moving between boxes) */}
          {status.botToken ? (
            <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-700">
              <span className="font-medium">Token:</span>{" "}
              <code className="bg-warm-200 px-1 rounded text-xs break-all select-all">{status.botToken}</code>
            </div>
          ) : null}

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

          <Button
            type="button"
            intent="secondary"
            onClick={handleDisconnect}
            loading={disconnecting}
            loadingLabel="Disconnecting…"
          >
            Disconnect
          </Button>
        </>
      ) : (
        <>
          {/* Setup instructions */}
          <div className="mb-4 p-4 bg-warm-50 border border-warm-200 rounded text-sm text-warm-800">
            <p className="font-medium mb-2">Setup steps:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Open Telegram and message <strong>@BotFather</strong></li>
              <li>Send <code className="bg-warm-200 px-1 rounded">/newbot</code> and follow the prompts</li>
              <li>
                Disable privacy mode so the bot can see all group messages: send{" "}
                <code className="bg-warm-200 px-1 rounded">/setprivacy</code> to @BotFather,
                select your bot, and choose <strong>Disable</strong>
              </li>
              <li>Copy the bot token (looks like <code className="bg-warm-200 px-1 rounded text-xs">123456:ABC-DEF...</code>)</li>
              <li>Paste it below</li>
            </ol>
          </div>

          {/* Token input */}
          <div className="flex gap-2 mb-2 items-start">
            <TextField
              label="Bot token"
              hideLabel
              value={botToken}
              onChange={setBotToken}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
              placeholder="Paste bot token here"
              className="flex-1"
            />
            <Button
              type="button"
              intent="primary"
              onClick={handleConnect}
              disabled={!botToken.trim()}
              loading={connecting}
              loadingLabel="Connecting…"
            >
              Connect
            </Button>
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

function AllowedEmailsSection({ apiBase }: { apiBase: string }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/admin/box-config`);
      if (!resp.ok) throw new Error(`Failed to load config: ${resp.status}`);
      const data = await resp.json();
      setEmails(data.allowedEmails ?? []);
      setOwnerEmail(data.ownerEmail ?? null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiBase]);

  useEffect(() => {
    setLoading(true);
    fetchConfig().finally(() => setLoading(false));
  }, [fetchConfig]);

  const saveEmails = async (updated: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${apiBase}/admin/box-config`, {
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

      {ownerEmail ? (
        <div className="mb-4 p-2 bg-warm-50 border border-warm-200 rounded text-sm flex items-center gap-2">
          <span className="flex-1 text-warm-800">{ownerEmail}</span>
          <span className="text-xs text-warm-500">owner — always has access</span>
        </div>
      ) : null}

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

      <div className="flex gap-2 items-start">
        <TextField
          label="Allowed email"
          hideLabel
          type="email"
          value={newEmail}
          onChange={setNewEmail}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="user@example.com"
          className="flex-1"
        />
        <Button
          type="button"
          intent="primary"
          onClick={handleAdd}
          disabled={!newEmail.trim().includes("@")}
          loading={saving}
          loadingLabel="Saving…"
        >
          Add
        </Button>
      </div>

      {error ? (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

interface GoogleStatus {
  available: boolean;
  hasTokens: boolean;
  scopes: string[];
  enabledServices: Record<string, boolean>;
}

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  gmail: "Gmail",
  drive: "Drive",
};

function GoogleServicesSection({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingServices, setSavingServices] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/admin/google-status`);
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data: GoogleStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [apiBase]);

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  // Handle redirect back from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get("google");
    if (googleParam === "connected") {
      setSuccessMessage("Google services connected successfully.");
      window.history.replaceState(null, "", window.location.pathname);
      fetchStatus();
    } else if (googleParam === "error") {
      const message = params.get("message") || "Authorization failed";
      setError(message);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuthorize = async () => {
    setConnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resp = await fetch(`${apiBase}/admin/google-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Setup failed");
      }
      window.location.href = data.authUrl;
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resp = await fetch(`${apiBase}/admin/google-disconnect`, { method: "POST" });
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

  const handleServiceToggle = async (service: string, enabled: boolean) => {
    if (!status) return;
    setSavingServices(true);
    setError(null);

    const updated = { ...status.enabledServices, [service]: enabled };
    try {
      const resp = await fetch(`${apiBase}/admin/box-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleServices: updated }),
      });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save service settings");
      }
      setStatus({ ...status, enabledServices: updated });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingServices(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Google Services</h2>
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  // Don't show section if Google OAuth isn't configured on the server
  if (status && !status.available) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-warm-800">Google Services</h2>
        <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">Server-wide</span>
      </div>
      <p className="text-sm text-warm-700 mb-4">
        Google account connection is shared across all boxes. Enable specific services per box below.
      </p>

      {successMessage ? (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
          {successMessage}
        </div>
      ) : null}

      {status && status.hasTokens ? (
        <>
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm">
            <span className="font-medium text-green-800">Connected</span>
          </div>

          <div className="mb-4">
            <h3 className="text-sm font-medium text-warm-700 mb-2">Enabled for this box:</h3>
            <div className="space-y-2">
              {Object.entries(GOOGLE_SERVICE_LABELS).map(([key, label]) => (
                <CheckboxField
                  key={key}
                  label={label}
                  checked={status.enabledServices[key] === true}
                  disabled={savingServices}
                  onChange={(checked) => handleServiceToggle(key, checked)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              intent="secondary"
              onClick={handleAuthorize}
              loading={connecting}
              loadingLabel="Redirecting…"
            >
              Re-authorize
            </Button>
            <Button
              type="button"
              intent="secondary"
              onClick={handleDisconnect}
              loading={disconnecting}
              loadingLabel="Disconnecting…"
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          intent="primary"
          onClick={handleAuthorize}
          loading={connecting}
          loadingLabel="Redirecting…"
        >
          Connect Google Account
        </Button>
      )}

      {error ? (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const { boxSlug } = useParams({ strict: false });
  const apiBase = getApiBase();

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link to={href(`/${boxSlug}/`)} className="text-plum hover:text-plum-dark text-sm">
            &larr; Back
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-warm-900 mb-6">Admin</h1>

        <div className="space-y-6">
          <ClaudeCodeSection />
          <AllowedEmailsSection apiBase={apiBase} />
          <GoogleServicesSection apiBase={apiBase} />
          <TelegramSection apiBase={apiBase} />
        </div>
      </div>
    </div>
  );
}
