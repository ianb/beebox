/** Box access list and operator-issued password resets for existing members. */

import { type RouterOutput } from "../../lib/trpc";
import { useAllowedEmails, type ResetLink } from "../../hooks/useAllowedEmails";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAction } from "../ui/InlineAction";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";

type AllowedUserDetail = RouterOutput["admin"]["boxConfig"]["allowedUserDetails"][number];
type LocalPasswordStatus = RouterOutput["admin"]["boxConfig"]["localPasswordStatus"];

function AccountBadge({ kind, googleLoginConfigured }: {
  kind: AllowedUserDetail["kind"];
  googleLoginConfigured: boolean;
}) {
  if (kind === "local-member" || kind === "local-owner") {
    return <Badge tone="success">Local password account</Badge>;
  }
  if (kind === "owner-entry") return <Badge tone="neutral">Owner</Badge>;
  if (kind === "unknown") return <Badge tone="warning">Password status unavailable</Badge>;
  if (googleLoginConfigured) return <Badge tone="info">Google sign-in only</Badge>;
  return <Badge tone="info">Needs account setup</Badge>;
}

function LocalPasswordNotice({ status }: { status: LocalPasswordStatus }) {
  if (status === "ready") return null;
  if (status === "not-initialized") {
    return (
      <Card background="info" border="subtle" padding="sm">
        <Stack gap="xs">
          <Text size="sm">Local password accounts are not initialized for this owner.</Text>
          <Text as="div" size="sm" mono>cb auth create-user</Text>
        </Stack>
      </Card>
    );
  }
  const message = status === "owner-mismatch"
    ? "The signed-in owner does not match the server's local password owner. Invite links and password resets are unavailable."
    : "The local password store is unavailable. Password-account details and resets cannot be loaded.";
  return (
    <div role="alert">
      <Text as="p" size="sm" tone="danger">{message}</Text>
    </div>
  );
}

function AllowedUserRows(options: {
  emails: string[];
  details: Map<string, AllowedUserDetail>;
  googleLoginConfigured: boolean;
  resettingEmail: string | null;
  removingEmail: string | null;
  onReset: (email: string) => Promise<void>;
  onRemove: (email: string) => Promise<void>;
}) {
  if (options.emails.length === 0) {
    return (
      <Card background="warm" border="subtle" padding="sm">
        <Text size="sm" tone="muted">Owner-only — no additional users can access this box.</Text>
      </Card>
    );
  }
  return (
    <Stack gap="sm">
      {options.emails.map((email) => (
        <Card key={email} background="warm" border="subtle" padding="sm">
          <Row justify="between" wrap>
            <Stack gap="xs" className="min-w-0 flex-1">
              <Text size="sm" breakAll>{email}</Text>
              <div>
                <AccountBadge
                  kind={options.details.get(email)?.kind ?? "unknown"}
                  googleLoginConfigured={options.googleLoginConfigured}
                />
              </div>
            </Stack>
            <Row gap="md">
              {options.details.get(email)?.resetEligible === true ? (
                <InlineAction onClick={() => options.onReset(email)} disabled={options.resettingEmail === email}>
                  Reset password
                </InlineAction>
              ) : null}
              <InlineAction
                intent="danger"
                onClick={() => options.onRemove(email)}
                disabled={options.removingEmail === email}
              >
                Remove
              </InlineAction>
            </Row>
          </Row>
        </Card>
      ))}
    </Stack>
  );
}

function ResetLinkCard({ resetLink }: { resetLink: ResetLink }) {
  return (
    <Card background="warm" border="subtle" padding="sm">
      <Stack gap="sm">
        <Text size="sm" weight="medium">Password reset link for {resetLink.email}</Text>
        <Text mono breakAll size="sm">{resetLink.url}</Text>
        <Text size="xs" tone="muted">Expires {new Date(resetLink.expiresAt).toLocaleTimeString()}</Text>
        <Text size="xs" tone="muted">
          Single-use. Creating another link replaces this one. Send it only through a trusted channel.
        </Text>
        <Button
          type="button"
          intent="secondary"
          onClick={() => navigator.clipboard.writeText(resetLink.url)}
          flash={{ label: "Copied" }}
        >
          Copy reset link
        </Button>
      </Stack>
    </Card>
  );
}

function LoadingAllowedUsers() {
  return (
    <Card as="section" aria-label="Allowed users" shadow>
      <Text size="sm" tone="muted">Loading allowed users…</Text>
    </Card>
  );
}

export function AllowedEmailsSection() {
  const {
    configQuery,
    updateMutation,
    resetMutation,
    emails,
    newEmail,
    setNewEmail,
    checking,
    pendingExistingEmail,
    setPendingExistingEmail,
    localError,
    resetLink,
    resettingEmail,
    removingEmail,
    saveEmails,
    addEmail,
    createReset,
  } = useAllowedEmails();

  if (configQuery.isLoading) return <LoadingAllowedUsers />;

  const queryError = configQuery.error?.message ?? null;
  const mutationError = resetMutation.error?.message ?? updateMutation.error?.message ?? localError;
  const details = new Map(configQuery.data?.allowedUserDetails.map((user) => [user.email, user]));
  const visibleEmails = emails.filter((email) => email !== configQuery.data?.ownerEmail);

  return (
    <Card as="section" aria-label="Allowed users" shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <Text as="h2" size="lg" weight="semibold">Allowed Users</Text>
          <Text size="sm" tone="muted">
            Email addresses that can access this box. Leave empty to keep the box owner-only.
          </Text>
        </Stack>

        {configQuery.data?.ownerEmail ? (
          <Card background="warm" border="subtle" padding="sm">
            <Row justify="between" wrap>
              <Text size="sm" breakAll>{configQuery.data.ownerEmail}</Text>
              <Text size="xs" tone="muted">owner — always has access</Text>
            </Row>
          </Card>
        ) : null}

        {configQuery.data ? <LocalPasswordNotice status={configQuery.data.localPasswordStatus} /> : null}

        <AllowedUserRows
          emails={visibleEmails}
          details={details}
          googleLoginConfigured={configQuery.data?.googleLoginConfigured === true}
          resettingEmail={resettingEmail}
          removingEmail={removingEmail}
          onReset={createReset}
          onRemove={(email) => saveEmails(emails.filter((candidate) => candidate !== email), email)}
        />

        <Row gap="sm" align="start">
          <TextField
            label="Allowed email"
            hideLabel
            type="email"
            value={newEmail}
            onChange={(value) => {
              setNewEmail(value);
              setPendingExistingEmail(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addEmail();
              }
            }}
            placeholder="user@example.com"
            className="flex-1"
          />
          <Button
            intent="primary"
            onClick={() => void addEmail()}
            disabled={!newEmail.trim().includes("@")}
            loading={updateMutation.isPending || checking}
            loadingLabel={checking ? "Checking…" : "Saving…"}
          >
            Add
          </Button>
        </Row>

        {pendingExistingEmail ? (
          <Card background="info" border="subtle" padding="sm">
            <Text size="sm">
              A local password account already exists for {pendingExistingEmail}. Adding it grants that account
              access; click Add again to confirm.
            </Text>
          </Card>
        ) : null}

        {resetLink ? <ResetLinkCard resetLink={resetLink} /> : null}

        {queryError || mutationError ? <Text size="sm" tone="danger">{queryError ?? mutationError}</Text> : null}
      </Stack>
    </Card>
  );
}
