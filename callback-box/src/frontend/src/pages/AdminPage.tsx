/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status, allowed-user list, Google services, and Telegram.
 */

import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { getApiBase } from "../api.js";
import { ClaudeCodeSection } from "../components/admin/ClaudeCodeSection";
import { AllowedEmailsSection } from "../components/admin/AllowedEmailsSection";
import { GoogleServicesSection } from "../components/admin/GoogleServicesSection";
import { GmailFiltersSection } from "../components/admin/GmailFiltersSection";
import { TelegramSection } from "../components/admin/TelegramSection";
import { NotificationsSection } from "../components/admin/NotificationsSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextLink } from "../components/ui/TextLink";

export function AdminPage() {
  const { boxSlug } = useParams({ strict: false });
  const apiBase = getApiBase();

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <TextLink to={href(`/${boxSlug}/`)}>
          <Text size="sm">&larr; Back</Text>
        </TextLink>

        <Text as="h1" size="2xl" weight="bold">Admin</Text>

        <Stack gap="lg">
          <ClaudeCodeSection />
          <AllowedEmailsSection apiBase={apiBase} />
          <GoogleServicesSection apiBase={apiBase} />
          <GmailFiltersSection />
          <TelegramSection apiBase={apiBase} />
          <NotificationsSection />
        </Stack>
      </Stack>
    </Column>
  );
}
