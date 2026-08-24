/**
 * Presentational sub-views for {@link TelegramSection}: the connected-state
 * panel and the not-yet-configured setup panel. Kept as pure, prop-driven
 * components so the parent can stay under the per-function line budget.
 */

import { TextField } from "../ui/fields";
import { Button } from "../ui/Button";

export interface TelegramStatus {
  configured: boolean;
  botUsername?: string;
  botFirstName?: string;
  webhookUrl?: string | null;
  publicUrl?: string;
  boxSlug?: string;
  error?: string;
}

export function TelegramConnectedView({
  status,
  disconnecting,
  onDisconnect,
}: {
  status: TelegramStatus;
  disconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <>
      <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
        <span className="font-medium text-success-dark">Connected</span>
        {status.botUsername ? (
          <span className="text-success-dark ml-2">as @{status.botUsername}</span>
        ) : null}
      </div>

      {/* The bot token is deliberately NOT shown or returned by the API — it
          lives in the machine secret store and terminates in the server
          process (docs/plans/secret-custody.md). The bot's @username above is
          the identifying detail this panel needs. */}
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
        id="cb-admin-telegram-disconnect"
        intent="secondary"
        onClick={onDisconnect}
        loading={disconnecting}
        loadingLabel="Disconnecting…"
      >
        Disconnect
      </Button>
    </>
  );
}

export function TelegramSetupView({
  botToken,
  connecting,
  onBotTokenChange,
  onConnect,
}: {
  botToken: string;
  connecting: boolean;
  onBotTokenChange: (value: string) => void;
  onConnect: () => void;
}) {
  return (
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
          id="cb-admin-telegram-bot-token"
          label="Bot token"
          hideLabel
          value={botToken}
          onChange={onBotTokenChange}
          onKeyDown={(e) => { if (e.key === "Enter") onConnect(); }}
          placeholder="Paste bot token here"
          className="flex-1"
        />
        <Button
          id="cb-admin-telegram-connect"
          intent="primary"
          onClick={onConnect}
          disabled={!botToken.trim()}
          loading={connecting}
          loadingLabel="Connecting…"
        >
          Connect
        </Button>
      </div>
    </>
  );
}
