/**
 * Telegram bot connection for a box: shows configured status or setup
 * instructions for creating a bot and pasting the token.
 */

import { useState, useEffect, useCallback } from "react";
import { RequestError } from "../../lib/errors";
import {
  TelegramConnectedView,
  TelegramSetupView,
  type TelegramStatus,
} from "./TelegramSection-views";

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
      if (!resp.ok) {
        const message = `Status check failed: ${resp.status}`;
        throw new RequestError(message);
      }
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
        throw new RequestError(data.error || "Setup failed");
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
        throw new RequestError(data.error || "Disconnect failed");
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
        <TelegramConnectedView
          status={status}
          disconnecting={disconnecting}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <TelegramSetupView
          botToken={botToken}
          connecting={connecting}
          onBotTokenChange={setBotToken}
          onConnect={handleConnect}
        />
      )}

      {error ? (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}
    </div>
  );
}
