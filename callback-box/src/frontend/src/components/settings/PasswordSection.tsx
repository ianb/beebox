import { useState, type FormEvent } from "react";
import { withBase } from "../../api";
import { useCurrentUserQuery } from "../../hooks/useCurrentUser";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";

type FieldErrors = Partial<Record<"current" | "next" | "confirm", string>>;

export function PasswordSection() {
  const userQuery = useCurrentUserQuery();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (userQuery.isLoading) {
    return <Card as="section" aria-label="Password"><Text tone="muted">Loading account…</Text></Card>;
  }
  const user = userQuery.data;
  if (!user) {
    return (
      <Card as="section" aria-label="Password">
        <Text tone="muted">Sign in to manage a local password.</Text>
      </Card>
    );
  }
  if (!user.hasPassword) {
    return (
      <Card as="section" aria-label="Password" shadow>
        <Stack gap="xs">
          <Text as="h2" size="lg" weight="semibold">Password</Text>
          <Text size="sm" tone="muted">This account signs in with Google; no local password is set.</Text>
        </Stack>
      </Card>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!currentPassword) nextErrors.current = "Enter your current password.";
    if (newPassword.length < 8) nextErrors.next = "Use at least 8 characters.";
    if (newPassword !== confirmPassword) nextErrors.confirm = "Passwords do not match.";
    setErrors(nextErrors);
    const first = nextErrors.current ? "password-current" : nextErrors.next ? "password-new" : nextErrors.confirm ? "password-confirm" : null;
    if (first) {
      document.querySelector<HTMLInputElement>(`#${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(withBase("/auth/password"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      if (!response.ok) {
        setErrors({ current: response.status === 401 ? "Current password could not be verified." : "Password could not be changed." });
        document.querySelector<HTMLInputElement>("#password-current")?.focus();
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setErrors({});
      setMessage("Password changed. Other signed-in sessions have been revoked.");
    } catch (_error) {
      setErrors({ current: "Password could not be changed. Check the connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card as="section" aria-label="Change password" shadow>
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="md">
          <Stack gap="xs">
            <Text as="h2" size="lg" weight="semibold">Change password</Text>
            <Text size="sm" tone="muted">Confirm your current password before choosing a new one.</Text>
          </Stack>
          <TextField id="password-current" label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} error={errors.current} autoComplete="current-password" required />
          <TextField id="password-new" label="New password" type="password" value={newPassword} onChange={setNewPassword} error={errors.next} autoComplete="new-password" minLength={8} required />
          <TextField id="password-confirm" label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} error={errors.confirm} autoComplete="new-password" required />
          <Button type="submit" intent="primary" loading={submitting} loadingLabel="Changing…">Change password</Button>
          {message ? <div role="status"><Text size="sm" tone="strong">{message}</Text></div> : null}
        </Stack>
      </form>
    </Card>
  );
}
