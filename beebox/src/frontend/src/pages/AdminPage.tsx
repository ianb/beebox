/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status, allowed-user list, Google services, and Telegram.
 */

import type { AdminArrivalState } from "../lib/admin-card-state";
import { ClaudeCodeSection } from "../components/admin/ClaudeCodeSection";
import { CodexSection } from "../components/admin/CodexSection";
import { AgentEngineSection } from "../components/admin/AgentEngineSection";
import { AllowedEmailsSection } from "../components/admin/AllowedEmailsSection";
import { GoogleServicesSection } from "../components/admin/GoogleServicesSection";
import { GmailFiltersSection } from "../components/admin/GmailFiltersSection";
import { TelegramSection } from "../components/admin/TelegramSection";
import { SecretsSection } from "../components/admin/SecretsSection";
import { NotificationsSection } from "../components/admin/NotificationsSection";
import { TailscaleSection } from "../components/admin/TailscaleSection";
import { BackupSection } from "../components/admin/BackupSection";
import { InviteSection } from "../components/admin/InviteSection";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";

export function AdminCardBody({ arrival, arrivalReceipt, onArrivalConsumed }: { arrival: AdminArrivalState; arrivalReceipt: string; onArrivalConsumed: () => void }) {
  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <Stack gap="lg">
          <ScopeHeading title="This box" description="Configuration and services whose behavior belongs to the current box." />
          <AgentEngineSection />
          <GmailFiltersSection />
          <TelegramSection />
          <BackupSection />
          <NotificationsSection />
          <ScopeHeading title="Host and shared access" description="Accounts, credentials, and network services available from this Bee Box host. Individual controls identify any box-specific setting." />
          <ClaudeCodeSection />
          <CodexSection />
          <AllowedEmailsSection />
          <InviteSection />
          <GoogleServicesSection arrival={arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={onArrivalConsumed} />
          <SecretsSection />
          <TailscaleSection />
        </Stack>
      </Stack>
    </Column>
  );
}

function ScopeHeading({ title, description }: { title: string; description: string }) {
  return <Stack gap="xs"><Text as="h2" size="xl" weight="bold">{title}</Text><Text as="p" tone="muted" size="sm">{description}</Text></Stack>;
}
