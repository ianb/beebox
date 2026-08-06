/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status, allowed-user list, Google services, and Telegram.
 */

import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { ClaudeCodeSection } from "../components/admin/ClaudeCodeSection";
import { AllowedEmailsSection } from "../components/admin/AllowedEmailsSection";
import { GoogleServicesSection } from "../components/admin/GoogleServicesSection";
import { GmailFiltersSection } from "../components/admin/GmailFiltersSection";
import { TelegramSection } from "../components/admin/TelegramSection";
import { NotificationsSection } from "../components/admin/NotificationsSection";
import { TailscaleSection } from "../components/admin/TailscaleSection";
import { InviteSection } from "../components/admin/InviteSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextLink } from "../components/ui/TextLink";

export function AdminPage() {
  const { boxSlug } = useParams({ strict: false });

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <TextLink to={href(`/${boxSlug}/dashboard`)}>
          <Text size="sm">&larr; Back</Text>
        </TextLink>

        <Text as="h1" size="2xl" weight="bold">Admin</Text>

        <Stack gap="lg">
          <ClaudeCodeSection />
          <AllowedEmailsSection />
          <InviteSection />
          <GoogleServicesSection />
          <GmailFiltersSection />
          <TelegramSection />
          <NotificationsSection />
          <TailscaleSection />
        </Stack>
      </Stack>
    </Column>
  );
}
