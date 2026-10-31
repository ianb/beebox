/**
 * Every admin section's current state, for the overview tab. Each section's
 * status comes from its own queries, so a slow or failing one never holds up
 * the rest. The queries use the same tRPC keys as the sections, so the
 * overview and the open tab share one fetch.
 */

import { trpc } from "../../../lib/trpc/client";
import type { AdminSectionId } from "../sections";
import { useIsLoopback } from "../TailscaleSection";
import {
  claudeEnabled, fromQuery, ready, summarizeAgentEngine, summarizeAllowedUsers, summarizeBackup, summarizeClaude,
  summarizeCloudflare, summarizeCodex, summarizeEncryptedBackup, summarizeGmailFilters, summarizeGoogle, summarizeOpenRouter, summarizeSecrets,
  summarizeNotifications, summarizeTailscale, type AdminSectionStatus,
} from "./admin-overview-summaries";

export type { AdminSectionStatus } from "./admin-overview-summaries";

export function useAdminOverview(): Record<AdminSectionId, AdminSectionStatus> {
  const config = trpc.admin.boxConfig.useQuery();
  const claudeOn = config.data !== undefined && claudeEnabled(config.data);
  // The OpenRouter section only exists (and only fetches) when Claude is enabled.
  const openrouter = trpc.admin.openrouterModels.useQuery(undefined, { enabled: claudeOn });
  const claude = trpc.admin.claudeStatus.useQuery();
  const codex = trpc.admin.codexStatus.useQuery();
  const google = trpc.admin.googleStatus.useQuery();
  const gmail = trpc.admin.gmailConfig.useQuery();
  const secrets = trpc.secrets.boxStatus.useQuery();
  const cloudflare = trpc.cloudflarePublishConnections.list.useQuery();
  // Same gate as the Tailscale section: the exposure question is about this host, asked from it.
  const loopback = useIsLoopback();
  const tailscale = trpc.admin.tailscaleBaseUrl.useQuery(undefined, { enabled: loopback });
  const backup = trpc.admin.backupStatus.useQuery();
  const encryptedBackup = trpc.admin.encryptedBackupStatus.useQuery();
  const devices = trpc.pairing.devices.useQuery();
  const subscribers = trpc.push.subscriberCount.useQuery();

  return {
    "agent-engine": fromQuery(config, summarizeAgentEngine),
    "openrouter-models": fromQuery(config, data => claudeEnabled(data)
      ? fromQuery(openrouter, summarizeOpenRouter)
      : ready("Not available: Claude Code is off", "neutral")),
    "claude-code": fromQuery(claude, summarizeClaude),
    "codex": fromQuery(codex, summarizeCodex),
    "allowed-users": fromQuery(config, summarizeAllowedUsers),
    "invite": ready("Create a link", "neutral"),
    "google-services": fromQuery(google, summarizeGoogle),
    "gmail-filters": fromQuery(config, data => data.googleServices.gmail === true && gmail.error !== null
      ? { state: "error", message: gmail.error.message }
      : summarizeGmailFilters({ config: data, gmail: gmail.data })),
    "secrets": fromQuery(secrets, summarizeSecrets),
    "cloudflare-publishing": fromQuery(cloudflare, summarizeCloudflare),
    "tailscale": loopback ? fromQuery(tailscale, summarizeTailscale) : ready("Managed on the host", "neutral"),
    "backup": fromQuery(backup, summarizeBackup),
    "encrypted-backups": fromQuery(encryptedBackup, summarizeEncryptedBackup),
    "notifications": fromQuery(devices, data => fromQuery(subscribers, ({ count }) => summarizeNotifications({ devices: data.devices, browsers: count }))),
  };
}
