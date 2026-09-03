import { useMachine } from "@xstate/react";
import { codexAuthMachine, type CodexStatus } from "../../machines/codexAuthMachine.js";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ExternalLink } from "../ui/ExternalLink";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

function CodexStatusSummary({ loading, status }: { loading: boolean; status: CodexStatus | null }) {
  if (loading) return <Text size="sm" tone="muted">Checking status…</Text>;
  if (status?.kind === "logged-in") return <Row><Badge tone="success">Authenticated</Badge></Row>;
  if (status?.kind === "inconclusive") {
    return <Stack gap="sm"><Row><Badge tone="warning">Status unknown</Badge></Row><Text size="sm" tone="danger">{status.detail}</Text></Stack>;
  }
  return (
    <Stack gap="sm">
      <Row><Badge tone={status?.kind === "unavailable" ? "danger" : "neutral"}>Not authenticated</Badge></Row>
      {status !== null && "detail" in status && status.detail ? <Text size="sm" tone="danger">{status.detail}</Text> : null}
    </Stack>
  );
}

export function CodexSection() {
  const [snapshot, send] = useMachine(codexAuthMachine);
  const { status, error, verificationUrl, userCode } = snapshot.context;
  const loading = snapshot.matches("loading");
  const starting = snapshot.matches("starting");
  const polling = snapshot.matches("polling");
  const cancelling = snapshot.matches("cancelling");
  const loggingOut = snapshot.matches("loggingOut");
  const idle = snapshot.matches("idle");
  const loggedIn = status?.kind === "logged-in";
  const statusUnknown = status?.kind === "inconclusive";

  return (
    <Card shadow>
      <Stack gap="md">
        <Row gap="sm" align="center">
          <Text as="h2" size="lg" weight="semibold">Codex</Text>
          <Badge tone="neutral" size="sm">System-wide</Badge>
        </Row>
        <Text size="sm" tone="subtle">
          Codex runs chats and background agents for boxes configured to use OpenAI. Authentication is stored by Codex for the Bee Box service account.
        </Text>

        <CodexStatusSummary loading={loading} status={status} />

        {polling && verificationUrl && userCode ? (
          <Card background="info">
            <Stack gap="sm">
              <Text size="sm">Open the Codex sign-in page, then enter this one-time code:</Text>
              <Text size="xl" weight="bold" mono>{userCode}</Text>
              <ExternalLink id="bbx-admin-codex-login-link" href={verificationUrl}>Open Codex Login</ExternalLink>
              <Text size="xs" tone="muted">This page updates automatically after authentication completes.</Text>
            </Stack>
          </Card>
        ) : null}

        {error ? <Text size="sm" tone="danger">{error}</Text> : null}

        <Row gap="sm" wrap>
          {!loggedIn && !statusUnknown && !polling ? (
            <Button
              id="bbx-admin-codex-authenticate"
              intent="primary"
              onClick={() => { send({ type: "LOGIN" }); }}
              disabled={!idle}
              loading={starting}
              loadingLabel="Starting…"
            >
              Authenticate Codex
            </Button>
          ) : null}
          {polling ? (
            <Button
              id="bbx-admin-codex-cancel-login"
              intent="secondary"
              onClick={() => { send({ type: "CANCEL" }); }}
              loading={cancelling}
              loadingLabel="Cancelling…"
            >
              Cancel
            </Button>
          ) : null}
          {loggedIn || statusUnknown ? (
            <Button
              id="bbx-admin-codex-logout"
              intent="secondary"
              onClick={() => { send({ type: "LOGOUT" }); }}
              loading={loggingOut}
              loadingLabel="Logging out…"
            >
              Log Out
            </Button>
          ) : null}
          <Button
            id="bbx-admin-codex-refresh"
            intent="ghost"
            onClick={() => { send({ type: "REFRESH" }); }}
            disabled={!idle}
          >
            Refresh
          </Button>
        </Row>
      </Stack>
    </Card>
  );
}
