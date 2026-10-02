/**
 * Claude Code authentication section: shows current status and provides
 * login/logout/refresh actions via the claudeAuthMachine.
 */

import { useState } from "react";
import { useMachine } from "@xstate/react";
import { claudeAuthMachine } from "../../machines/claudeAuthMachine.js";
import { ExternalLink } from "../ui/ExternalLink";
import { Button } from "../ui/Button";
import { AdminSectionCard } from "./AdminSectionCard";

const DESCRIPTION =
  "Claude Code runs background agents (scheduler, reactor). Authenticate with your Anthropic account to enable these features.";

export function ClaudeCodeSection() {
  const [snapshot, send] = useMachine(claudeAuthMachine);
  const [code, setCode] = useState("");
  const { status, error, authUrl } = snapshot.context;
  const isSubmittingCode = snapshot.matches("submittingCode");
  const isLoading = snapshot.matches("loading");
  const isStarting = snapshot.matches("starting");
  const isPolling = snapshot.matches("polling") || snapshot.matches("submittingCode");
  const isLoggingOut = snapshot.matches("loggingOut");
  const isIdle = snapshot.matches("idle");

  if (isLoading) {
    return (
      <AdminSectionCard id="claude-code" description={DESCRIPTION} busy>
        <p className="text-sm text-warm-600">Checking status...</p>
      </AdminSectionCard>
    );
  }

  return (
    <AdminSectionCard id="claude-code" description={DESCRIPTION}>
      {status?.loggedIn ? (
        <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
          <span className="font-medium text-success-dark">Authenticated</span>
          {status.email ? (
            <>
              {" "}
              <span className="text-success-dark ml-2">as {status.email}</span>
            </>
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
          <ExternalLink id="bbx-admin-claude-login-link" href={authUrl}>Open Anthropic Login</ExternalLink>
          <p className="text-xs text-primary mt-2">
            After signing in, Anthropic shows a code. Paste it here:
          </p>
          <form
            className="flex gap-2 mt-2"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) { send({ type: "SUBMIT_CODE", code }); setCode(""); } }}
          >
            <input
              id="cb-admin-claude-login-code"
              className="flex-1 border border-warm-300 rounded px-2 py-1 text-sm font-mono"
              value={code}
              onChange={(e) => { setCode(e.target.value); }}
              placeholder="paste code"
              autoComplete="off"
              spellCheck={false}
              aria-label="Anthropic sign-in code"
            />
            <Button id="cb-admin-claude-submit-code" type="submit" disabled={!code.trim() || isSubmittingCode} loading={isSubmittingCode}>
              Submit code
            </Button>
          </form>
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
            id="bbx-admin-claude-authenticate"
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
            id="bbx-admin-claude-logout"
            intent="secondary"
            onClick={() => send({ type: "LOGOUT" })}
            loading={isLoggingOut}
            loadingLabel="Logging out…"
          >
            Log Out
          </Button>
        ) : null}
        <Button
          id="bbx-admin-claude-refresh"
          intent="ghost"
          onClick={() => send({ type: "REFRESH" })}
          disabled={isLoading}
        >
          Refresh
        </Button>
      </div>
    </AdminSectionCard>
  );
}
