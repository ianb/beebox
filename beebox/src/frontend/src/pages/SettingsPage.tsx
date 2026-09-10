import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
/**
 * Settings page with calendar and Drive configuration.
 */

import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { CalendarSection } from "../components/settings/CalendarSection";
import { CompanionPairingSection } from "../components/settings/CompanionPairingSection";
import { DriveSection } from "../components/settings/DriveSection";
import { ScanUploaderSection } from "../components/settings/ScanUploaderSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextLink } from "../components/ui/TextLink";
import { PasswordSection } from "../components/settings/PasswordSection";
import { BoxSystemThemePicker } from "../components/themes/SystemThemePicker";

export function SettingsPage() {
  const { boxSlug } = useParams({ strict: false });

  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <TextLink id="bbx-settings-back" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.dashboard}`)}>
          <Text size="sm">&larr; Back to Dashboard</Text>
        </TextLink>

        <Text as="h2" size="2xl" weight="bold">Settings</Text>

        <BoxSystemThemePicker boxKey={boxSlug ?? ""} />

        <CompanionPairingSection />

        <PasswordSection />

        <ScanUploaderSection />

        <CalendarSection />

        <DriveSection />
      </Stack>
    </Column>
  );
}
