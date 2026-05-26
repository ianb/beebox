/**
 * Settings page with calendar configuration and sharing tips.
 */

import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { CalendarSection } from "../components/settings/CalendarSection";
import { DriveSection } from "../components/settings/DriveSection";
import { ShareShortcutSection } from "../components/settings/ShareShortcutSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextLink } from "../components/ui/TextLink";

export function SettingsPage() {
  const { boxSlug } = useParams({ strict: false });

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <TextLink to={href(`/${boxSlug}/`)}>
          <Text size="sm">&larr; Back to Dashboard</Text>
        </TextLink>

        <Text as="h1" size="2xl" weight="bold">Settings</Text>

        <CalendarSection />

        <DriveSection />

        <ShareShortcutSection />
      </Stack>
    </Column>
  );
}
