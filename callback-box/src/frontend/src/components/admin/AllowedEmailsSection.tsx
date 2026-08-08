/** Box access list and operator-issued password resets for existing members. */

import { useEffect, useState } from "react";
import { withBase } from "../../api";
import { trpc, trpcClient } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAction } from "../ui/InlineAction";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";
import { errorMessage } from "@shared/error-guards";

interface ResetLink {
  email: string;
  url: string;
  expiresAt: number;
}

function AllowedUserRows(options: {
  emails: string[];
  eligible: Set<string>;
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
            <Text size="sm" breakAll className="min-w-0 flex-1">{email}</Text>
            <Row gap="md">
              {options.eligible.has(email) ? (
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
  const configQuery = trpc.admin.boxConfig.useQuery();
  const updateMutation = trpc.admin.updateBoxConfig.useMutation();
  const resetMutation = trpc.admin.createPasswordReset.useMutation();
  const utils = trpc.useUtils();
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [pendingExistingEmail, setPendingExistingEmail] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<ResetLink | null>(null);
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (configQuery.data) setEmails(configQuery.data.allowedEmails);
  }, [configQuery.data]);

  const saveEmails = async (updated: string[], removedEmail?: string) => {
    setLocalError(null);
    setRemovingEmail(removedEmail ?? null);
    try {
      const data = await updateMutation.mutateAsync({ allowedEmails: updated });
      setEmails(data.allowedEmails);
      setResetLink(null);
      await utils.admin.boxConfig.invalidate();
    } catch (_error) {
      // Mutation error is rendered below.
    } finally {
      setRemovingEmail(null);
    }
  };

  const addEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) return;
    if (emails.includes(email)) {
      setNewEmail("");
      return;
    }
    if (pendingExistingEmail !== email) {
      setChecking(true);
      setLocalError(null);
      try {
        const status = await trpcClient.admin.localAccountStatus.query({ email });
        if (status.exists) {
          setPendingExistingEmail(email);
          return;
        }
      } catch (error) {
        setLocalError(errorMessage(error));
        return;
      } finally {
        setChecking(false);
      }
    }
    setNewEmail("");
    setPendingExistingEmail(null);
    await saveEmails([...emails, email]);
  };

  const createReset = async (email: string) => {
    setResetLink(null);
    setLocalError(null);
    updateMutation.reset();
    resetMutation.reset();
    setResettingEmail(email);
    try {
      const result = await resetMutation.mutateAsync({ email });
      setResetLink({
        email,
        url: `${window.location.origin}${withBase(result.resetPath)}`,
        expiresAt: result.expiresAt,
      });
    } catch (_error) {
      await utils.admin.boxConfig.invalidate();
    } finally {
      setResettingEmail(null);
    }
  };

  if (configQuery.isLoading) return <LoadingAllowedUsers />;

  const queryError = configQuery.error?.message ?? null;
  const mutationError = resetMutation.error?.message ?? updateMutation.error?.message ?? localError;
  const eligible = new Set(configQuery.data?.passwordResetEligibleEmails);

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

        <AllowedUserRows
          emails={emails}
          eligible={eligible}
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
