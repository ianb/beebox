/**
 * Full-page box selection UI used by the top-level route:
 *
 *   - `<BoxRedirect>` — root `/` route. Redirects if one box exists, shows a
 *     login prompt if none + auth required, or lists boxes to pick from.
 */

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useBoxes } from "../hooks/useBoxes";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { StatusMessage } from "../components/ui/StatusMessage";
import {
  BoxActionsTile,
  SignInLink,
} from "../components/BoxSelectionTiles";

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <Row justify="center" align="center" className="min-h-screen p-4">
      {children}
    </Row>
  );
}

/**
 * Root page: if one box, redirect; if multiple, show links.
 */
export function BoxRedirect() {
  const navigate = useNavigate();
  // Shared with AppLayout/AppNav via react-query, and — importantly — `loaded`
  // flips on failure too, so a box server we can't reach shows the empty-state
  // page rather than "Loading..." forever.
  const { boxes, authRequired, loaded } = useBoxes();
  const loading = !loaded;

  useEffect(() => {
    const [onlyBox] = boxes;
    if (!loading && boxes.length === 1 && onlyBox !== undefined) {
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      void navigate({ to: "/$boxSlug", params: { boxSlug: onlyBox.slug }, replace: true });
    }
  }, [loading, boxes, navigate]);

  if (loading) {
    return <StatusMessage>Loading...</StatusMessage>;
  }

  if (boxes.length === 0 && authRequired) {
    return (
      <CenteredScreen>
        <Stack gap="none" align="center" className="max-w-sm w-full">
          <Text as="h1" size="2xl" weight="bold" tone="emphasis" center className="mb-4">
            Bee Box
          </Text>
          <Text as="p" tone="subtle" center className="mb-6">
            Sign in to access your boxes.
          </Text>
          <SignInLink returnTo={window.location.pathname} />
        </Stack>
      </CenteredScreen>
    );
  }

  if (boxes.length === 1) {
    return <StatusMessage>Redirecting...</StatusMessage>;
  }

  return (
    <CenteredScreen>
      <Stack gap="none" className="max-w-md w-full">
        <Text as="h1" size="2xl" weight="bold" tone="emphasis" center className="mb-6">
          Bee Box
        </Text>
        <Stack gap="md">
          {boxes.map((box) => (
            <BoxActionsTile key={box.slug} box={box} />
          ))}
        </Stack>
      </Stack>
    </CenteredScreen>
  );
}
