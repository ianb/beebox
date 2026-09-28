/**
 * Admin page — owner-only system management.
 * Five pill tabs: an overview of every section's state, then the four groups
 * in `components/admin/admin-sections.ts`. Every group panel stays mounted
 * and only the open one is shown, so a configured section keeps its state,
 * the arrival scroll to Google still lands, and the hang probe's per-section
 * breadcrumbs cover the whole page on every load.
 */

import { useEffect, type ReactNode } from "react";
import type { AdminArrivalState } from "../lib/admin-card-state";
import { ClaudeCodeSection } from "../components/admin/ClaudeCodeSection";
import { CodexSection } from "../components/admin/CodexSection";
import { AgentEngineSection } from "../components/admin/AgentEngineSection";
import { OpenRouterModelsSection } from "../components/admin/OpenRouterModelsSection/view";
import { AllowedEmailsSection } from "../components/admin/AllowedEmailsSection";
import { GoogleServicesSection } from "../components/admin/GoogleServicesSection/view";
import { GmailFiltersSection } from "../components/admin/GmailFiltersSection/view";
import { TelegramSection } from "../components/admin/TelegramSection/view";
import { SecretsSection } from "../components/admin/SecretsSection/view";
import { CloudflarePublishConnectionsSection } from "../components/admin/CloudflarePublishConnectionsSection/view";
import { NotificationsSection } from "../components/admin/NotificationsSection/view";
import { TailscaleSection } from "../components/admin/TailscaleSection";
import { BackupSection } from "../components/admin/BackupSection";
import { InviteSection } from "../components/admin/InviteSection";
import { AdminOverview } from "../components/admin/AdminOverview/view";
import { ADMIN_TAB_LABELS, ADMIN_TABS, DEFAULT_ADMIN_TAB, adminSectionElementId, adminTabForSection, type AdminSectionId, type AdminTab } from "../components/admin/sections";
import { Stack } from "../components/ui/Stack";
import { TabBar } from "../components/ui/TabBar";
import { AdminHangProbe, ProbeSection } from "../components/admin/AdminHangProbe";

export interface AdminCardBodyProps {
  arrival: AdminArrivalState;
  arrivalReceipt: string;
  onArrivalConsumed: () => void;
  /** The tab the URL names, or null for the default. */
  tab: AdminTab | null;
  /** The section the URL lands on (a notification's `admin:<section>` target), or null. */
  section: AdminSectionId | null;
  onTabChange: (tab: AdminTab) => void;
}

export function AdminCardBody({ arrival, arrivalReceipt, onArrivalConsumed, tab: requestedTab, section, onTabChange }: AdminCardBodyProps) {
  // A landing section opens its tab, and an OAuth return lands on Google's
  // tab, unless the URL names a tab.
  const sectionTab = section === null ? null : adminTabForSection(section);
  const arrivalTab = arrival.google !== undefined || arrival.reconnect !== undefined ? adminTabForSection("google-services") : null;
  const tab = requestedTab ?? sectionTab ?? arrivalTab ?? DEFAULT_ADMIN_TAB;
  const openSection = (id: AdminSectionId) => {
    onTabChange(adminTabForSection(id));
    scrollToSection(id);
  };
  useEffect(() => {
    if (section !== null) scrollToSection(section);
  }, [section]);
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
        <AdminPanel tab="secrets" open={tab}><SecretsPanel /></AdminPanel>
        <AdminPanel tab="host" open={tab}><HostPanel /></AdminPanel>
      </Stack>
    </Stack></AdminHangProbe>
  );
}

/** Every panel stays mounted, so the section is in the DOM once its tab is shown. */
function scrollToSection(id: AdminSectionId): void {
  requestAnimationFrame(() => document.getElementById(adminSectionElementId(id))?.scrollIntoView({ block: "start" }));
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
    <ProbeSection name="CloudflarePublishConnections"><CloudflarePublishConnectionsSection /></ProbeSection>
  </>;
}

function SecretsPanel() {
  return <ProbeSection name="Secrets"><SecretsSection /></ProbeSection>;
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
