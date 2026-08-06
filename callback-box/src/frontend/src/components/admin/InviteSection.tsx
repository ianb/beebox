import { useState, type FormEvent } from "react";
import { withBase } from "../../api";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { CheckboxField, TextField } from "../ui/fields";

export function InviteSection() {
  const [openInvite, setOpenInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const createInvite = trpc.admin.createInvite.useMutation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!openInvite && !trimmedEmail.includes("@")) {
      setEmailError("Enter an email address or choose an open invite.");
      document.querySelector<HTMLInputElement>("#invite-email")?.focus();
      return;
    }
    setEmailError(undefined);
    setInviteUrl(null);
    try {
      const result = await createInvite.mutateAsync(openInvite ? {} : { email: trimmedEmail });
      setInviteUrl(`${window.location.origin}${withBase(result.invitePath)}`);
      setExpiresAt(result.expiresAt);
    } catch (_error) {
      // The mutation exposes its error state below the action.
    }
  };

  const copy = async () => {
    if (inviteUrl) await navigator.clipboard.writeText(inviteUrl);
  };

  return (
    <Card as="section" aria-label="Invite a user" shadow>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="md">
          <Stack gap="xs">
            <Text as="h2" size="lg" weight="semibold">Create invite link</Text>
            <Text size="sm" tone="muted">
              The link creates one member account for this box and expires after 15 minutes.
            </Text>
          </Stack>
          <CheckboxField
            label="Let invitee enter email"
            checked={openInvite}
            onChange={(checked) => {
              setOpenInvite(checked);
              setEmailError(undefined);
            }}
            helper={openInvite ? "Anyone holding the link may choose an otherwise unclaimed email." : undefined}
          />
          <TextField
            id="invite-email"
            label="Invitee email"
            type="email"
            value={email}
            onChange={setEmail}
            onBlur={() => {
              if (!openInvite && email.length > 0 && !email.includes("@")) setEmailError("Enter a valid email address.");
            }}
            disabled={openInvite}
            required={!openInvite}
            error={emailError}
            autoComplete="email"
          />
          <Button type="submit" intent="primary" loading={createInvite.isPending} loadingLabel="Creating…">
            Create invite link
          </Button>
          {createInvite.error ? <Text size="sm" tone="danger">{createInvite.error.message}</Text> : null}
          {inviteUrl ? (
            <Card background="warm" border="subtle" padding="sm">
              <Stack gap="sm">
                <Text mono breakAll size="sm">{inviteUrl}</Text>
                <Text size="xs" tone="muted">
                  Expires {expiresAt === null ? "soon" : new Date(expiresAt).toLocaleTimeString()}
                </Text>
                <Button type="button" intent="secondary" onClick={copy} flash={{ label: "Copied" }}>
                  Copy link
                </Button>
              </Stack>
            </Card>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}
