/**
 * Settings page with calendar and Drive configuration.
 */

import { useParams } from "@tanstack/react-router";
import { CalendarSection } from "../components/settings/CalendarSection";
import { CompanionPairingSection } from "../components/settings/CompanionPairingSection";
import { DriveSection } from "../components/settings/DriveSection";
import { ScanUploaderSection } from "../components/settings/ScanUploaderSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { PasswordSection } from "../components/settings/PasswordSection";
import { BoxSystemThemePicker } from "../components/themes/SystemThemePicker";

export function SettingsPage() {
  const { boxSlug } = useParams({ strict: false });

  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
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
