/**
 * Admin page — owner-only system management.
 * Shows Claude Code auth status, allowed-user list, Google services, and Telegram.
 */

import type { AdminArrivalState } from "../lib/admin-card-state";
import { ClaudeCodeSection } from "../components/admin/ClaudeCodeSection";
import { CodexSection } from "../components/admin/CodexSection";
import { AgentEngineSection } from "../components/admin/AgentEngineSection";
import { OpenRouterModelsSection } from "../components/admin/OpenRouterModelsSection";
import { AllowedEmailsSection } from "../components/admin/AllowedEmailsSection";
import { GoogleServicesSection } from "../components/admin/GoogleServicesSection";
import { GmailFiltersSection } from "../components/admin/GmailFiltersSection";
import { TelegramSection } from "../components/admin/TelegramSection";
import { SecretsSection } from "../components/admin/SecretsSection";
import { CloudflarePublishConnectionsSection } from "../components/admin/CloudflarePublishConnectionsSection";
import { NotificationsSection } from "../components/admin/NotificationsSection";
import { TailscaleSection } from "../components/admin/TailscaleSection";
import { BackupSection } from "../components/admin/BackupSection";
import { InviteSection } from "../components/admin/InviteSection";
import { Stack } from "../components/ui/Stack";
import { AdminHangProbe, ProbeSection } from "../components/admin/AdminHangProbe";
import { Text } from "../components/ui/Text";
import { Hint } from "../components/ui/Hint";

export function AdminCardBody({ arrival, arrivalReceipt, onArrivalConsumed }: { arrival: AdminArrivalState; arrivalReceipt: string; onArrivalConsumed: () => void }) {
  return (
    <AdminHangProbe page="admin"><Stack gap="none" overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <AdminSections arrival={arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={onArrivalConsumed} />
      </Stack>
    </Stack></AdminHangProbe>
  );
}

function ScopeHeading({ title, description }: { title: string; description: string }) {
  return <Stack gap="xs"><Text as="h2" size="xl" weight="bold">{title}</Text><Hint>{description}</Hint></Stack>;
}

function AdminSections({ arrival, arrivalReceipt, onArrivalConsumed }: { arrival: AdminArrivalState; arrivalReceipt: string; onArrivalConsumed: () => void }) {
  return (
        <Stack gap="lg">
          <ScopeHeading title="This box" description="Configuration and services whose behavior belongs to the current box." />
          <ProbeSection name="AgentEngine"><AgentEngineSection /></ProbeSection>
          <ProbeSection name="OpenRouterModels"><OpenRouterModelsSection /></ProbeSection>
          <ProbeSection name="GmailFilters"><GmailFiltersSection /></ProbeSection>
          <ProbeSection name="Telegram"><TelegramSection /></ProbeSection>
          <ProbeSection name="Backup"><BackupSection /></ProbeSection>
          <ProbeSection name="Notifications"><NotificationsSection /></ProbeSection>
          <ScopeHeading title="Host and shared access" description="Accounts, credentials, and network services available from this Bee Box host. Individual controls identify any box-specific setting." />
          <ProbeSection name="ClaudeCode"><ClaudeCodeSection /></ProbeSection>
          <ProbeSection name="Codex"><CodexSection /></ProbeSection>
          <ProbeSection name="AllowedEmails"><AllowedEmailsSection /></ProbeSection>
          <ProbeSection name="Invite"><InviteSection /></ProbeSection>
          <ProbeSection name="GoogleServices"><GoogleServicesSection arrival={arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={onArrivalConsumed} /></ProbeSection>
          <ProbeSection name="Secrets"><SecretsSection /></ProbeSection>
          <ProbeSection name="CloudflarePublishConnections"><CloudflarePublishConnectionsSection /></ProbeSection>
          <ProbeSection name="Tailscale"><TailscaleSection /></ProbeSection>
        </Stack>
  );
}
