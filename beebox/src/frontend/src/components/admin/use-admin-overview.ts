/**
 * Every admin section's current state, for the overview tab. Each section's
 * status comes from its own queries, so a slow or failing one never holds up
 * the rest. The queries use the same tRPC keys as the sections, so the
 * overview and the open tab share one fetch.
 */

import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { errorMessage } from "@shared/error-guards";
import type { AdminSectionId } from "./admin-sections";
import { useIsLoopback } from "./TailscaleSection";
import {
  claudeEnabled, fromQuery, ready, summarizeAgentEngine, summarizeAllowedUsers, summarizeBackup, summarizeClaude,
  summarizeCloudflare, summarizeCodex, summarizeGmailFilters, summarizeGoogle, summarizeOpenRouter, summarizeSecrets,
  summarizeTailscale, summarizeTelegram, type AdminSectionStatus,
} from "./admin-overview-summaries";

export type { AdminSectionStatus } from "./admin-overview-summaries";

/**
 * This device's push state. Mirrors NotificationsSection's support check; it
 * reads the existing registration rather than waiting on `serviceWorker.ready`,
 * which never settles on a page with no service worker.
 */
function useNotificationStatus(): AdminSectionStatus {
  const [status, setStatus] = useState<AdminSectionStatus>({ state: "loading" });
  useEffect(() => {
    const hasPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!hasPush) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      setStatus(isIOS && !standalone ? ready("Add to Home Screen first", "neutral") : ready("Not supported in this browser", "neutral"));
      return;
    }
    if (Notification.permission === "denied") {
      setStatus(ready("Blocked in this browser", "warning"));
      return;
    }
    let live = true;
    navigator.serviceWorker.getRegistration()
      .then(async registration => registration === undefined ? null : registration.pushManager.getSubscription())
      .then(subscription => {
        if (live) setStatus(subscription !== null && Notification.permission === "granted" ? ready("On for this device", "success") : ready("Off for this device", "neutral"));
      })
      .catch((e: unknown) => {
        console.warn("[admin overview] could not read the push subscription:", e);
        if (live) setStatus({ state: "error", message: errorMessage(e) });
      });
    return () => { live = false; };
  }, []);
  return status;
}

export function useAdminOverview(): Record<AdminSectionId, AdminSectionStatus> {
  const config = trpc.admin.boxConfig.useQuery();
  const claudeOn = config.data !== undefined && claudeEnabled(config.data);
  // The OpenRouter section only exists (and only fetches) when Claude is enabled.
  const openrouter = trpc.admin.openrouterModels.useQuery(undefined, { enabled: claudeOn });
  const claude = trpc.admin.claudeStatus.useQuery();
  const codex = trpc.admin.codexStatus.useQuery();
  const google = trpc.admin.googleStatus.useQuery();
  const gmail = trpc.admin.gmailConfig.useQuery();
  const telegram = trpc.admin.telegramStatus.useQuery();
  const secrets = trpc.secrets.boxStatus.useQuery();
  const cloudflare = trpc.cloudflarePublishConnections.list.useQuery();
  // Same gate as the Tailscale section: the exposure question is about this host, asked from it.
  const loopback = useIsLoopback();
  const tailscale = trpc.admin.tailscaleBaseUrl.useQuery(undefined, { enabled: loopback });
  const backup = trpc.admin.backupStatus.useQuery();
  const notifications = useNotificationStatus();

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
    "telegram": fromQuery(telegram, summarizeTelegram),
    "secrets": fromQuery(secrets, summarizeSecrets),
    "cloudflare-publishing": fromQuery(cloudflare, summarizeCloudflare),
    "tailscale": loopback ? fromQuery(tailscale, summarizeTailscale) : ready("Managed on the host", "neutral"),
    "backup": fromQuery(backup, summarizeBackup),
    "notifications": notifications,
  };
}
