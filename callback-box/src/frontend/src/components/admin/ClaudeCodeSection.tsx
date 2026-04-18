/**
 * Claude Code authentication section: shows current status and provides
 * login/logout/refresh actions via the claudeAuthMachine.
 */

import { useSSRMachine } from "../../hooks/useSSRMachine";
import { claudeAuthMachine } from "../../machines/claudeAuthMachine.js";
import { ExternalLink } from "../ui/ExternalLink";
import { Button } from "../ui/Button";

export function ClaudeCodeSection() {
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

      {status?.loggedIn ? (
        <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
          <span className="font-medium text-success-dark">Authenticated</span>
          {status.email ? (
            <span className="text-success-dark ml-2">as {status.email}</span>
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

      {authUrl && isPolling ? (
        <div className="mb-4 p-4 bg-info-50 border border-info-100 rounded">
          <p className="text-sm text-primary mb-2">
            Complete authentication in a new tab:
          </p>
          <ExternalLink href={authUrl}>Open Anthropic Login</ExternalLink>
          <p className="text-xs text-primary mt-2">
            Waiting for authentication to complete...
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}

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
