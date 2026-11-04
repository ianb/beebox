/**
 * Claude Code authentication section: shows current status and provides
 * login/logout/refresh actions via the claudeAuthMachine.
 */

import { useState } from "react";
import { useMachine } from "@xstate/react";
import { claudeAuthMachine } from "../../machines/claudeAuthMachine.js";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { ExternalLink } from "../ui/ExternalLink";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { AdminSectionCard } from "./AdminSectionCard";
import { useRefreshAgentReadinessOnLogin } from "../../hooks/useAgentReadiness";

const DESCRIPTION =
  "Claude Code runs background agents (scheduler, reactor). Authenticate with your Anthropic account to enable these features.";

export function ClaudeCodeSection() {
  const [snapshot, send] = useMachine(claudeAuthMachine);
  const [code, setCode] = useState("");
  const { status, error, authUrl } = snapshot.context;
  useRefreshAgentReadinessOnLogin(status?.loggedIn === true);
  const isSubmittingCode = snapshot.matches("submittingCode");
  const isLoading = snapshot.matches("loading");
  const isStarting = snapshot.matches("starting");
  const isPolling = snapshot.matches("polling") || snapshot.matches("submittingCode");
  const isLoggingOut = snapshot.matches("loggingOut");
  const isIdle = snapshot.matches("idle");

  if (isLoading) {
    return (
      <AdminSectionCard id="claude-code" description={DESCRIPTION} busy>
        <Text size="sm" tone="muted">Checking status…</Text>
      </AdminSectionCard>
    );
  }

  return (
    <AdminSectionCard id="claude-code" description={DESCRIPTION}>
      {status?.loggedIn ? (
        <Row gap="sm">
          <Badge tone="success">Authenticated</Badge>
          {status.email ? <Text size="sm" tone="muted">as {status.email}</Text> : null}
        </Row>
      ) : (
        <Stack gap="sm">
          <Row><Badge tone="neutral">Not authenticated</Badge></Row>
          {status?.error ? <ErrorText>{status.error}</ErrorText> : null}
        </Stack>
      )}

      {authUrl && isPolling ? (
        <Card background="info">
          <Stack gap="sm">
            <Text as="p" size="sm">Complete authentication in a new tab:</Text>
            <div><ExternalLink id="bbx-admin-claude-login-link" href={authUrl}>Open Anthropic Login</ExternalLink></div>
            <Text as="p" size="xs" tone="muted">After signing in, Anthropic shows a code. Paste it here:</Text>
            <form
              className="flex gap-2"
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
          </Stack>
        </Card>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Row gap="sm" wrap>
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
      </Row>
    </AdminSectionCard>
  );
}
