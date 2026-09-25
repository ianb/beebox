/**
 * Admin page — owner-only system management.
 * Five pill tabs: an overview of every section's state, then the four groups
 * in `components/admin/admin-sections.ts`. Every group panel stays mounted
 * and only the open one is shown, so a configured section keeps its state,
 * the arrival scroll to Google still lands, and the hang probe's per-section
 * breadcrumbs cover the whole page on every load.
 */

import type { ReactNode } from "react";
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
import { AdminOverview } from "../components/admin/AdminOverview";
import { ADMIN_TAB_LABELS, ADMIN_TABS, DEFAULT_ADMIN_TAB, adminTabForSection, type AdminSectionId, type AdminTab } from "../components/admin/admin-sections";
import { Stack } from "../components/ui/Stack";
import { TabBar } from "../components/ui/TabBar";
import { AdminHangProbe, ProbeSection } from "../components/admin/AdminHangProbe";

export interface AdminCardBodyProps {
  arrival: AdminArrivalState;
  arrivalReceipt: string;
  onArrivalConsumed: () => void;
  /** The tab the URL names, or null for the default. */
  tab: AdminTab | null;
  onTabChange: (tab: AdminTab) => void;
}

export function AdminCardBody({ arrival, arrivalReceipt, onArrivalConsumed, tab: requestedTab, onTabChange }: AdminCardBodyProps) {
  // An OAuth return lands on Google's tab unless the URL says otherwise.
  const arrivalTab = arrival.google !== undefined || arrival.reconnect !== undefined ? adminTabForSection("google-services") : null;
  const tab = requestedTab ?? arrivalTab ?? DEFAULT_ADMIN_TAB;
  const openSection = (id: AdminSectionId) => {
    onTabChange(adminTabForSection(id));
    // The panel is already mounted, so the section is in the DOM once it is shown.
    requestAnimationFrame(() => document.getElementById(`bbx-admin-${id}`)?.scrollIntoView({ block: "start" }));
  };
  return (
    <AdminHangProbe page="admin"><Stack gap="none" overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4 w-full">
        <TabBar
          variant="pills"
          label="Admin sections"
          idPrefix="bbx-admin-tab"
          controlsPrefix="bbx-admin-panel"
          value={tab}
          onChange={onTabChange}
          tabs={ADMIN_TABS.map(value => ({ value, label: ADMIN_TAB_LABELS[value] }))}
        />
        <AdminPanel tab="overview" open={tab}><AdminOverview onOpenSection={openSection} /></AdminPanel>
        <AdminPanel tab="agents" open={tab}><AgentsPanel /></AdminPanel>
        <AdminPanel tab="people" open={tab}><PeoplePanel /></AdminPanel>
        <AdminPanel tab="connections" open={tab}><ConnectionsPanel arrival={arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={onArrivalConsumed} /></AdminPanel>
        <AdminPanel tab="host" open={tab}><HostPanel /></AdminPanel>
      </Stack>
    </Stack></AdminHangProbe>
  );
}

function AgentsPanel() {
  return <>
    <ProbeSection name="AgentEngine"><AgentEngineSection /></ProbeSection>
    <ProbeSection name="OpenRouterModels"><OpenRouterModelsSection /></ProbeSection>
    <ProbeSection name="ClaudeCode"><ClaudeCodeSection /></ProbeSection>
    <ProbeSection name="Codex"><CodexSection /></ProbeSection>
  </>;
}

function PeoplePanel() {
  return <>
    <ProbeSection name="AllowedEmails"><AllowedEmailsSection /></ProbeSection>
    <ProbeSection name="Invite"><InviteSection /></ProbeSection>
  </>;
}

function ConnectionsPanel({ arrival, arrivalReceipt, onArrivalConsumed }: Pick<AdminCardBodyProps, "arrival" | "arrivalReceipt" | "onArrivalConsumed">) {
  return <>
    <ProbeSection name="GoogleServices"><GoogleServicesSection arrival={arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={onArrivalConsumed} /></ProbeSection>
    <ProbeSection name="GmailFilters"><GmailFiltersSection /></ProbeSection>
    <ProbeSection name="Telegram"><TelegramSection /></ProbeSection>
    <ProbeSection name="Secrets"><SecretsSection /></ProbeSection>
    <ProbeSection name="CloudflarePublishConnections"><CloudflarePublishConnectionsSection /></ProbeSection>
  </>;
}

function HostPanel() {
  return <>
    <ProbeSection name="Tailscale"><TailscaleSection /></ProbeSection>
    <ProbeSection name="Backup"><BackupSection /></ProbeSection>
    <ProbeSection name="Notifications"><NotificationsSection /></ProbeSection>
  </>;
}

/** One tab's content. Rendered always; hidden unless it is the open tab. */
function AdminPanel({ tab, open, children }: { tab: AdminTab; open: AdminTab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`bbx-admin-panel-${tab}`} aria-labelledby={`bbx-admin-tab-${tab}`} hidden={tab !== open}>
      <Stack gap="lg">{children}</Stack>
    </div>
  );
}
