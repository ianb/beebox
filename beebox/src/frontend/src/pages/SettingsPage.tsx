/**
 * Settings page with calendar and Drive configuration.
 */

import { useParams } from "@tanstack/react-router";
import { CalendarSection } from "../components/settings/CalendarSection";
import { CompanionPairingSection } from "../components/settings/CompanionPairingSection";
import { DriveSection } from "../components/settings/DriveSection";
import { ScanUploaderSection } from "../components/settings/ScanUploaderSection";
import { Stack } from "../components/ui/Stack";
import { AdminHangProbe, ProbeSection } from "../components/admin/AdminHangProbe";
import { PasswordSection } from "../components/settings/PasswordSection";
import { BoxSystemThemePicker } from "../components/themes/SystemThemePicker";

export function SettingsPage() {
  const { boxSlug } = useParams({ strict: false });

  return (
    <AdminHangProbe page="settings"><Stack gap="none" overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <SettingsSections boxKey={boxSlug ?? ""} />
      </Stack>
    </Stack></AdminHangProbe>
  );
}

function SettingsSections({ boxKey }: { boxKey: string }) {
  return <>
        <ProbeSection name="BoxSystemThemePicker"><BoxSystemThemePicker boxKey={boxKey} /></ProbeSection>

        <ProbeSection name="CompanionPairingSection"><CompanionPairingSection /></ProbeSection>

        <ProbeSection name="PasswordSection"><PasswordSection /></ProbeSection>

        <ProbeSection name="ScanUploaderSection"><ScanUploaderSection /></ProbeSection>

        <ProbeSection name="CalendarSection"><CalendarSection /></ProbeSection>

        <ProbeSection name="DriveSection"><DriveSection /></ProbeSection>
  </>;
}
