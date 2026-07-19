/**
 * `/auth/setup` — first-run account creation. The setup token lives only in
 * the URL query string (`?token=...`), printed to the server console at
 * boot; it is never fetched, displayed, or linked-to from any page (see
 * docs/plans/local-password-auth.md Track C). Without a token in the URL,
 * this renders the same console/CLI pointer as a dead form would otherwise
 * need, rather than a form nobody can submit.
 *
 * The form itself lives in `SetupForm` (a separate component, not just for
 * "one job per component" — it also keeps this page's own JSX shallow
 * enough for `react/jsx-max-depth`, since the rule counts nesting per
 * component-render tree).
 */

import { useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Row } from "../../components/ui/Row";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/fields";
import { withBase } from "../../api";

function currentToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

interface SetupErrorResponse {
  error?: string;
  message?: string;
  retryAfterMs?: number;
}

function describeError(status: number, data: SetupErrorResponse): string {
  if (status === 429) {
    const seconds = Math.ceil((data.retryAfterMs ?? 0) / 1000);
    return `Too many attempts. Try again in ${seconds}s.`;
  }
  if (status === 403) {
    return "This setup link is invalid. Use the exact link printed to the server console, or run `cb auth create-user` on the host.";
  }
  if (status === 410) {
    return data.message ?? data.error ?? "This setup link is no longer usable.";
  }
  if (status === 409) {
    return data.error ?? "An account already exists — sign in instead.";
  }
  return data.error ?? "Setup failed.";
}

function NoTokenGuidance() {
  return (
    <Stack gap="md">
      <Text as="h1" size="2xl" weight="bold" tone="emphasis" center>
        First-run setup
      </Text>
      <Text as="p" tone="subtle">
        This page needs the one-time setup link printed to the server
        console when it first started (search the console output for{" "}
        <code>First-run setup:</code>). If the server has already been
        restarted or an account already exists, the link has expired.
      </Text>
      <Text as="p" tone="subtle">
        Alternatively, create the first account directly on the host with{" "}
        <code>cb auth create-user</code>.
      </Text>
    </Stack>
  );
}

function SetupForm({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const passwordsMatch = password === confirmPassword;
    if (!passwordsMatch) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(withBase("/auth/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, token }),
      });
      const succeeded = response.status === 204;
      if (succeeded) {
        window.location.href = withBase("/");
        return;
      }
      const data: SetupErrorResponse = await response.json().catch(() => ({}));
      setError(describeError(response.status, data));
    } catch (e2) {
      console.error("[setup] request failed:", e2);
      setError("Setup failed — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="md">
      <Text as="h1" size="2xl" weight="bold" tone="emphasis" center>
        Create your account
      </Text>
      <Text as="p" tone="subtle" size="sm">
        Without an account, this box is open to anyone who can reach this
        port — there is no sign-in wall. Creating a local account here keeps
        development self-contained, with no remote service required to
        protect it.
      </Text>

      <form onSubmit={(e) => void handleSubmit(e)}>
        <SetupFields
          name={name}
          onName={setName}
          email={email}
          onEmail={setEmail}
          password={password}
          onPassword={setPassword}
          confirmPassword={confirmPassword}
          onConfirmPassword={setConfirmPassword}
          error={error}
          submitting={submitting}
        />
      </form>
    </Stack>
  );
}

interface SetupFieldsProps {
  name: string;
  onName: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  confirmPassword: string;
  onConfirmPassword: (v: string) => void;
  error: string | null;
  submitting: boolean;
}

function SetupFields({
  name,
  onName,
  email,
  onEmail,
  password,
  onPassword,
  confirmPassword,
  onConfirmPassword,
  error,
  submitting,
}: SetupFieldsProps) {
  return (
    <Stack gap="md">
      <TextField label="Name" required value={name} onChange={onName} autoComplete="name" />
      <TextField label="Email" type="email" required value={email} onChange={onEmail} autoComplete="email" />
      <TextField
        label="Password"
        type="password"
        required
        minLength={8}
        value={password}
        onChange={onPassword}
        autoComplete="new-password"
      />
      <TextField
        label="Confirm password"
        type="password"
        required
        value={confirmPassword}
        onChange={onConfirmPassword}
        autoComplete="new-password"
      />
      {error !== null ? (
        <div role="alert">
          <Text as="p" tone="danger" size="sm">{error}</Text>
        </div>
      ) : null}
      <Button type="submit" intent="primary" fullWidth loading={submitting}>
        Create account
      </Button>
    </Stack>
  );
}

export function SetupPage() {
  const token = currentToken();

  return (
    <main>
      <Row justify="center" align="center" className="min-h-screen p-4">
        <Card padding="lg" shadow className="max-w-sm w-full">
          {token !== null ? <SetupForm token={token} /> : <NoTokenGuidance />}
        </Card>
      </Row>
    </main>
  );
}
