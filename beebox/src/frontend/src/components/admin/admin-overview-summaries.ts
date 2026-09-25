/**
 * One short phrase per admin section, derived from the same query results the
 * sections read. Pure functions from a procedure's output to a status, so the
 * overview's wording lives in one place and each section's status depends only
 * on its own queries.
 */

import type { RouterOutput } from "../../lib/trpc";
import { chatModelOptions, parseChatAgentEngine } from "@shared/chat-models.js";

export type AdminStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export type AdminSectionStatus =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; summary: string; tone: AdminStatusTone };

type Admin = RouterOutput["admin"];
export type BoxConfig = Admin["boxConfig"];

/** The subset of a react-query result the overview reads. */
export interface QueryLike<T> {
  data: T | undefined;
  error: { message: string } | null;
}

export function ready(summary: string, tone: AdminStatusTone): AdminSectionStatus {
  return { state: "ready", summary, tone };
}

/** Error first, then data; no data and no error is still loading. */
export function fromQuery<T>(query: QueryLike<T>, summarize: (data: T) => AdminSectionStatus): AdminSectionStatus {
  if (query.error !== null) return { state: "error", message: query.error.message };
  if (query.data === undefined) return { state: "loading" };
  return summarize(query.data);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const ENGINE_LABELS = { claude: "Claude Code", codex: "Codex" } as const;

export function summarizeAgentEngine(config: BoxConfig): AdminSectionStatus {
  const engine = ENGINE_LABELS[config.agentEngine];
  if (config.agentModel === null) return ready(`${engine}, harness default model`, "neutral");
  const parsed = parseChatAgentEngine(config.agentEngine);
  const option = parsed === null ? undefined : chatModelOptions(parsed, config.openrouterModels).find(o => o.model === config.agentModel);
  return ready(`${engine}, default model ${option?.label ?? config.agentModel}`, "neutral");
}

export function claudeEnabled(config: BoxConfig): boolean {
  return config.agentEngine === "claude" || config.engines.claude === true;
}

export function summarizeOpenRouter(list: Admin["openrouterModels"]): AdminSectionStatus {
  if (list.models.length === 0) return ready("None added", "neutral");
  const models = plural(list.models.length, "model");
  return list.keyGranted ? ready(models, "success") : ready(`${models}, no OpenRouter key`, "warning");
}

export function summarizeClaude(status: Admin["claudeStatus"]): AdminSectionStatus {
  // `probeInconclusive` is claude-cli.ts's AUTH_PROBE_INCONCLUSIVE: the probe gave no usable answer.
  if (status.probeInconclusive === true) {
    const detail = typeof status.error === "string" ? status.error : "no usable answer from `claude auth status`";
    return { state: "error", message: `Status unknown: ${detail}` };
  }
  if (status.loggedIn !== true) return ready("Not logged in", "warning");
  return ready(typeof status.email === "string" ? `Logged in as ${status.email}` : "Logged in", "success");
}

export function summarizeCodex(status: Admin["codexStatus"]): AdminSectionStatus {
  switch (status.kind) {
    case "logged-in": return ready("Logged in", "success");
    case "logged-out": return ready("Not logged in", "warning");
    case "unavailable": return ready("Not available on this host", "danger");
    case "inconclusive": return ready("Not checked: Codex did not answer", "warning");
  }
}

export function summarizeAllowedUsers(config: BoxConfig): AdminSectionStatus {
  if (config.localPasswordStatus !== "ready") return ready("Password store unavailable", "danger");
  const others = config.allowedUserDetails.filter(user => user.kind !== "owner-entry" && user.kind !== "local-owner");
  return others.length === 0 ? ready("Owner only", "neutral") : ready(`Owner and ${plural(others.length, "other user")}`, "info");
}

const GOOGLE_SERVICE_LABELS: Record<string, string> = { calendar: "Calendar", gmail: "Gmail", drive: "Drive" };

export function summarizeGoogle(status: Admin["googleStatus"]): AdminSectionStatus {
  if (!status.available) return ready("Not set up on this host", "neutral");
  if (status.needsReauthSince !== null) return ready("Needs re-authorization", "warning");
  if (!status.hasTokens) return ready("Not connected", "neutral");
  const services = Object.entries(status.enabledServices)
    .filter(([, on]) => on)
    .map(([name]) => GOOGLE_SERVICE_LABELS[name] ?? name);
  return services.length === 0 ? ready("Connected, no services on", "info") : ready(`Connected: ${services.join(", ")}`, "success");
}

export function summarizeGmailFilters({ config, gmail }: { config: BoxConfig; gmail: Admin["gmailConfig"] | undefined }): AdminSectionStatus {
  if (config.googleServices.gmail !== true) return ready("Off: Gmail not enabled", "neutral");
  if (gmail === undefined) return { state: "loading" };
  if (gmail.usesRules) return ready("Configured with rules", "success");
  if (gmail.query !== "" || gmail.labels.length > 0) return ready("Configured", "success");
  return ready("Not configured", "warning");
}

export function summarizeTelegram(status: Admin["telegramStatus"]): AdminSectionStatus {
  if (!status.configured) return ready("Not connected", "neutral");
  if ("error" in status) return ready(`Bot not answering: ${status.error}`, "danger");
  return "botUsername" in status ? ready(`Connected as @${status.botUsername}`, "success") : ready("Connected", "success");
}

export function summarizeSecrets(status: RouterOutput["secrets"]["boxStatus"]): AdminSectionStatus {
  if (status.granted.length === 0) return ready("No keys", "neutral");
  const keys = `${plural(status.granted.length, "key")} on this box`;
  const suspect = status.granted.filter(grant => grant.suspect).length;
  return suspect === 0 ? ready(keys, "success") : ready(`${keys}, ${suspect} failed verification`, "warning");
}

export function summarizeCloudflare(connections: RouterOutput["cloudflarePublishConnections"]["list"]): AdminSectionStatus {
  if (connections.length === 0) return ready("None", "neutral");
  const revoked = connections.filter(c => c.tokenStatus === "revoked").length;
  const label = plural(connections.length, "connection");
  return revoked === 0 ? ready(label, "success") : ready(`${label}, ${revoked} revoked`, "warning");
}

export function summarizeTailscale(result: Admin["tailscaleBaseUrl"]): AdminSectionStatus {
  return result.baseUrl === null ? ready("Set up on the host", "neutral") : ready(result.baseUrl.replace(/^https?:\/\//, ""), "success");
}

export function summarizeBackup(result: Admin["backupStatus"]): AdminSectionStatus {
  const repo = result.repo;
  if (repo === null) return ready("Not a git repository", "danger");
  if (repo.remote === null) return ready("No remote: only on this host", "danger");
  const issues: string[] = [];
  if (!repo.remote.offsite) issues.push("Remote on this machine");
  if (repo.upstream.state === "none") issues.push("No tracking branch");
  if (repo.upstream.state === "stale") issues.push("Upstream never fetched");
  if (repo.upstream.state === "tracked" && repo.upstream.ahead > 0) issues.push(plural(repo.upstream.ahead, "unpushed commit"));
  if (repo.assetRisk !== null) issues.push(`${plural(repo.assetRisk.fileCount, "file")} only here`);
  return issues.length === 0 ? ready("Pushed to remote", "success") : ready(issues.join(" · "), "warning");
}
