/**
 * The admin page's vocabulary: its tabs, its sections, and which section
 * lives under which tab. A section's `title` here is the heading the section
 * renders and the accessible name of its landmark, and `bbx-admin-<id>` is
 * its DOM id, so "admin → Connections → Telegram" resolves the same way for
 * the boxholder, the box agent, and `bin/browse`.
 */

export const ADMIN_TABS = ["overview", "agents", "people", "connections", "host"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const DEFAULT_ADMIN_TAB: AdminTab = "overview";

export function isAdminTab(value: unknown): value is AdminTab {
  return typeof value === "string" && ADMIN_TABS.map(String).includes(value);
}

export type AdminSectionId =
  | "agent-engine"
  | "openrouter-models"
  | "claude-code"
  | "codex"
  | "allowed-users"
  | "invite"
  | "google-services"
  | "gmail-filters"
  | "telegram"
  | "secrets"
  | "cloudflare-publishing"
  | "tailscale"
  | "backup"
  | "notifications";

/** Where a section's settings live. Shown beside the section on the overview. */
export type AdminScope = "box" | "host" | "device" | "mixed";

export interface AdminSectionDef {
  /** The section's heading and landmark name. */
  title: string;
  /** One sentence for the overview: what the boxholder does there. */
  blurb: string;
  scope: AdminScope;
}

export const ADMIN_SECTIONS: Record<AdminSectionId, AdminSectionDef> = {
  "agent-engine": { title: "Agent engine and model", blurb: "Which harness runs new chats and procedures, and the default model.", scope: "box" },
  "openrouter-models": { title: "OpenRouter models", blurb: "Extra models billed through this box's OpenRouter key.", scope: "box" },
  "claude-code": { title: "Claude Code", blurb: "The Anthropic account that runs Claude Code agents.", scope: "host" },
  "codex": { title: "Codex", blurb: "The OpenAI account that runs Codex agents.", scope: "host" },
  "allowed-users": { title: "Allowed users", blurb: "Who can sign in to this box, and password resets for members.", scope: "box" },
  "invite": { title: "Invite link", blurb: "A one-time link that creates a member account.", scope: "box" },
  "google-services": { title: "Google services", blurb: "The Google sign-in this host uses, and which of Calendar, Gmail, and Drive this box may use.", scope: "mixed" },
  "gmail-filters": { title: "Gmail filters", blurb: "Which Gmail messages this box picks up and what it does with them.", scope: "box" },
  "telegram": { title: "Telegram", blurb: "The Telegram bot this box answers through.", scope: "box" },
  "secrets": { title: "Secrets", blurb: "API keys this box can use, and keys shared across boxes.", scope: "mixed" },
  "cloudflare-publishing": { title: "Cloudflare publishing", blurb: "Cloudflare tokens for publishing pages, and which boxes may use them.", scope: "mixed" },
  "tailscale": { title: "Tailscale", blurb: "Reaching this host from your other devices over Tailscale.", scope: "host" },
  "backup": { title: "Backup", blurb: "Whether this box's git history and media are backed up off this host.", scope: "box" },
  "notifications": { title: "Notifications", blurb: "Push notifications from this box on the device you are using now.", scope: "device" },
};

export interface AdminGroupDef {
  tab: Exclude<AdminTab, "overview">;
  label: string;
  /** One sentence for the overview: what the group is about. */
  description: string;
  sections: readonly AdminSectionId[];
}

export const ADMIN_GROUPS: readonly AdminGroupDef[] = [
  { tab: "agents", label: "Agents", description: "What runs the box's agents: the engine, its models, and the accounts behind them.", sections: ["agent-engine", "openrouter-models", "claude-code", "codex"] },
  { tab: "people", label: "People", description: "Who can sign in to this box.", sections: ["allowed-users", "invite"] },
  { tab: "connections", label: "Connections", description: "Outside services this box talks to, and the keys it uses.", sections: ["google-services", "gmail-filters", "telegram", "secrets", "cloudflare-publishing"] },
  { tab: "host", label: "Host", description: "The machine this box runs on and the device you are using.", sections: ["tailscale", "backup", "notifications"] },
];

export const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  overview: "Overview",
  agents: "Agents",
  people: "People",
  connections: "Connections",
  host: "Host",
};

export function adminSectionElementId(id: AdminSectionId): string {
  return `bbx-admin-${id}`;
}

export function adminSectionHeadingId(id: AdminSectionId): string {
  return `bbx-admin-${id}-heading`;
}

export function adminTabForSection(id: AdminSectionId): Exclude<AdminTab, "overview"> {
  const group = ADMIN_GROUPS.find(candidate => candidate.sections.includes(id));
  // Every section id is placed in exactly one group above; the fallback is
  // only for the type checker.
  return group?.tab ?? "host";
}

export const ADMIN_SCOPE_LABELS: Record<AdminScope, string> = {
  box: "This box",
  host: "Whole host",
  device: "This device",
  mixed: "Host and box",
};
