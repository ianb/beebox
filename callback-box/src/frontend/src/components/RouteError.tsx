/**
 * Root-route error component.
 *
 * TanStack Router unmounts the failing route and renders the nearest ancestor
 * `errorComponent`; with none set it warns ("The following error wasn't caught
 * by any route!") and leaves a blank page. Mounted on the root route, this
 * catches anything a child route didn't handle itself.
 *
 * The error text is shown rather than hidden behind a generic apology: this is
 * a personal system whose user is also the person who will debug it, and the
 * stack is what makes a report actionable. `console.error` puts the same detail
 * in the rolling client debug log (`components/DebugLog.tsx` patches console
 * and forwards errors to the box), so a crash the user hits on a phone is still
 * readable afterwards.
 */

import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "./ui/Button";
import { Pre } from "./ui/Pre";
import { Row } from "./ui/Row";
import { Stack } from "./ui/Stack";
import { Text } from "./ui/Text";

export function RouteError({ error, info, reset }: ErrorComponentProps) {
  useEffect(() => {
    // Router-caught errors don't reach window.onerror, so without this the
    // debug log has no record of a page that visibly broke.
    console.error("Route error:", error, info?.componentStack ?? "");
  }, [error, info]);

  return (
    <Stack gap="md" className="p-6 max-w-2xl mx-auto">
      <Text as="h1" size="lg" weight="semibold" tone="danger">
        This page hit an error
      </Text>
      <Text tone="subtle">
        The rest of the app is still running — try again, or reload if it keeps
        failing.
      </Text>
      <Pre size="sm" error boxed scroll="md">
        {/* A stack already opens with "Error: <message>", so printing both repeats it. */}
        {error.stack ?? error.message}
      </Pre>
      <Row gap="sm">
        <Button intent="primary" onClick={reset}>
          Try again
        </Button>
        <Button intent="secondary" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </Row>
    </Stack>
  );
}
