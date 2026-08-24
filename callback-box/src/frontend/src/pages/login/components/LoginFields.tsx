/**
 * The email/password fields for LoginPage's form, split out so the page's
 * own JSX tree stays under `react/jsx-max-depth` (the rule counts nesting
 * per component-render tree, so a fresh component boundary resets it).
 */

import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/fields";

interface LoginFieldsProps {
  email: string;
  onEmail: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  error: string | null;
  submitting: boolean;
}

export function LoginFields({ email, onEmail, password, onPassword, error, submitting }: LoginFieldsProps) {
  return (
    <Stack gap="md">
      <TextField id="cb-login-email" label="Email" type="email" autoComplete="email" required value={email} onChange={onEmail} />
      <TextField
        id="cb-login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={onPassword}
      />
      {error !== null ? (
        <div role="alert">
          <Text as="p" tone="danger" size="sm">{error}</Text>
        </div>
      ) : null}
      <Button id="cb-login-submit" type="submit" intent="primary" fullWidth loading={submitting}>
        Sign in
      </Button>
    </Stack>
  );
}
