/**
 * `/auth/login` — email + password sign-in, with an optional "Sign in with
 * Google" button when the server has Google configured (`GET /auth/methods`).
 * The page owns its own `<main>` landmark (components own their a11y
 * elements — see bbx-frontend conventions).
 */

import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Row } from "../../components/ui/Row";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { withBase } from "../../api";
import { GoogleSignInButton } from "./components/GoogleSignInButton";
import { LoginFields } from "./components/LoginFields";

interface AuthMethods {
  password: boolean;
  google: boolean;
  setupRequired: boolean;
}

function currentReturnTo(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("returnTo");
  return fromQuery ?? withBase("/");
}

async function postLogin(body: { email: string; password: string }): Promise<Response> {
  return fetch(withBase("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function LoginPage() {
  const returnTo = currentReturnTo();
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(withBase("/auth/methods"))
      .then((r) => r.json())
      .then((data: AuthMethods) => setMethods(data))
      .catch((e: unknown) => {
        console.error("[login] failed to load auth methods:", e);
        // Fail closed on the form's shape too: assume password-only rather
        // than rendering nothing.
        setMethods({ password: true, google: false, setupRequired: false });
      });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await postLogin({ email, password });
      if (response.status === 204) {
        window.location.href = returnTo;
        return;
      }
      const data: { error?: string; retryAfterMs?: number } = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const seconds = Math.ceil((data.retryAfterMs ?? 0) / 1000);
        setError(`Too many attempts. Try again in ${seconds}s.`);
        return;
      }
      if (response.status === 401) {
        setError("Invalid credentials.");
        return;
      }
      setError(data.error ?? "Sign-in failed.");
    } catch (e2) {
      console.error("[login] request failed:", e2);
      setError("Sign-in failed — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <Row justify="center" align="center" className="min-h-screen p-4">
        <Card padding="lg" shadow className="max-w-sm w-full">
          <Stack gap="md">
            <Text as="h1" size="2xl" weight="bold" tone="emphasis" center>
              Sign in
            </Text>

            {methods === null ? (
              <Text as="p" tone="subtle" center>Loading sign-in options…</Text>
            ) : (
              <>
                {methods.password ? (
                  <form onSubmit={(e) => void handleSubmit(e)}>
                    <LoginFields
                      email={email}
                      onEmail={setEmail}
                      password={password}
                      onPassword={setPassword}
                      error={error}
                      submitting={submitting}
                    />
                  </form>
                ) : null}

                {methods.google ? (
                  <>
                    {methods.password ? (
                      <Text size="xs" tone="muted" uppercase center>or</Text>
                    ) : null}
                    <GoogleSignInButton returnTo={returnTo} />
                  </>
                ) : null}

                {methods.setupRequired ? (
                  <Text as="p" tone="subtle" size="sm" center>
                    No account yet? Run the first-run setup (see the server
                    console for the link), or run <code>bbx auth create-user</code>.
                  </Text>
                ) : null}
              </>
            )}
          </Stack>
        </Card>
      </Row>
    </main>
  );
}
