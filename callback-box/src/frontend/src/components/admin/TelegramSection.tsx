/**
 * Telegram bot connection for a box: shows configured status or setup
 * instructions for creating a bot and pasting the token.
 */

import { useState, useEffect, useCallback } from "react";
import { TextField } from "../ui/fields";
import { Button } from "../ui/Button";

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

export function TelegramSection({ apiBase }: { apiBase: string }) {
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

  // Mount-only fetch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
          <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
            <span className="font-medium text-success-dark">Connected</span>
            {status.botUsername ? (
              <span className="text-success-dark ml-2">as @{status.botUsername}</span>
            ) : null}
          </div>

          {status.botToken ? (
            <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-700">
              <span className="font-medium">Token:</span>{" "}
              <code className="bg-warm-200 px-1 rounded text-xs break-all select-all">{status.botToken}</code>
            </div>
          ) : null}

          {status.webhookUrl ? (
            <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-700">
              <span className="font-medium">Webhook:</span>{" "}
              <span className="break-all">{status.webhookUrl}</span>
            </div>
          ) : null}

          {status.error ? (
            <div className="mb-4 p-3 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
              {status.error}
            </div>
          ) : null}

          <div className="mb-4 p-3 bg-info-50 border border-info-100 rounded text-sm text-primary">
            <p className="font-medium mb-1">To use in a group:</p>
            <p>Add <strong>@{status.botUsername}</strong> to your Telegram group and send a message.</p>
          </div>

          <Button
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

      {error ? (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}
    </div>
  );
}
