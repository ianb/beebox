/**
 * Full-page box selection UIs used by top-level routes:
 *
 *   - `<BoxRedirect>` — root `/` route. Redirects if one box exists, shows a
 *     login prompt if none + auth required, or lists boxes to pick from.
 *   - `<ShareRedirect>` — root `/share?...` route. Same behavior, but each
 *     box link preserves the share query params so the target page receives
 *     them.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { fetchBoxes } from "../lib/boxes";
import { Column } from "../components/ui/Column";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import {
  BoxActionsTile,
  BoxShareTile,
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
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setAuthRequired(result.authRequired ?? false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: "/$boxSlug", params: { boxSlug: boxes[0]!.slug }, replace: true });
    }
  }, [loading, boxes, navigate]);

  if (loading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  if (boxes.length === 0 && authRequired) {
    return (
      <CenteredScreen>
        <Column align="center" className="max-w-sm w-full">
          <Text as="h1" size="2xl" weight="bold" tone="emphasis" center className="mb-4">
            Callback Box
          </Text>
          <Text as="p" tone="subtle" center className="mb-6">
            Sign in to access your boxes.
          </Text>
          <SignInLink returnTo={window.location.pathname} />
        </Column>
      </CenteredScreen>
    );
  }

  if (boxes.length === 1) {
    return <Text as="div" tone="subtle" className="p-8">Redirecting...</Text>;
  }

  return (
    <CenteredScreen>
      <Column className="max-w-md w-full">
        <Text as="h1" size="2xl" weight="bold" tone="emphasis" center className="mb-6">
          Callback Box
        </Text>
        <Stack gap="md">
          {boxes.map((box) => (
            <BoxActionsTile key={box.slug} box={box} />
          ))}
        </Stack>
      </Column>
    </CenteredScreen>
  );
}

/**
 * Redirect /share?params to /:boxSlug/share?params.
 * Picks the first available box (or shows selector if multiple).
 */
export function ShareRedirect() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setLoading(false);
    });
  }, []);

  const search = window.location.search;

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: href(`/${boxes[0]!.slug}/share${search}`), replace: true });
    }
  }, [loading, boxes, navigate, search]);

  if (loading) {
    return (
      <CenteredScreen>
        <Text tone="subtle">Loading...</Text>
      </CenteredScreen>
    );
  }

  if (boxes.length === 1) {
    return (
      <CenteredScreen>
        <Text tone="subtle">Redirecting...</Text>
      </CenteredScreen>
    );
  }

  if (boxes.length > 1) {
    return (
      <CenteredScreen>
        <Column className="max-w-md w-full">
          <Text as="h1" size="xl" weight="bold" tone="emphasis" center className="mb-4">
            Save to which box?
          </Text>
          <Stack gap="md">
            {boxes.map((box) => (
              <BoxShareTile key={box.slug} box={box} search={search} />
            ))}
          </Stack>
        </Column>
      </CenteredScreen>
    );
  }

  return <Text as="div" tone="subtle" className="p-8">No boxes available.</Text>;
}
