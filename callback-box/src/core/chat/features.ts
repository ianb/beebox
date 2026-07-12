/**
 * Chat feature flags — the control plane shared by user UI, agent
 * (`<chat-app>` deltas), and landmark seeding.
 *
 * Each feature is a named slot with a closed set of allowed values. The
 * server is the source of truth: callers update via `ChatSession.setFeature`,
 * the snapshot serializer composes the `<chat-app>` tag prepended to each
 * user message, and the delta parser pulls mutations out of agent output.
 *
 * Values are strings (not just on/off) so non-boolean features like
 * `model="opus"` slot in by adding a registry entry, no shape change.
 */

export type FeatureValue = string;
export type FeatureMap = Record<string, FeatureValue>;

export interface FeatureDescriptor {
  /** Stable identifier — appears as both attribute name in <chat-app> and key in storage. */
  readonly name: string;
  /** Closed set of legal values. */
  readonly allowedValues: readonly FeatureValue[];
  /** Default value when no override is in effect. */
  readonly default: FeatureValue;
  /** Hint for the settings UI — toggle for binary on/off, select for enums. */
  readonly uiKind: "toggle" | "select";
  /** Short human-readable label for the settings UI. */
  readonly label: string;
}

const FEATURE_LIST: readonly FeatureDescriptor[] = [
  {
    name: "narration",
    allowedValues: ["on", "off"],
    default: "off",
    uiKind: "toggle",
    label: "Narration mode",
  },
  {
    name: "prose",
    allowedValues: ["on", "off"],
    default: "on",
    uiKind: "toggle",
    label: "Show agent prose",
  },
] as const;

const FEATURE_INDEX = new Map<string, FeatureDescriptor>(
  FEATURE_LIST.map((f) => [f.name, f]),
);

/** All registered features, in declaration order. */
export function listFeatures(): readonly FeatureDescriptor[] {
  return FEATURE_LIST;
}

/** Look up a descriptor by name, or null if unknown. */
export function getFeature(name: string): FeatureDescriptor | null {
  return FEATURE_INDEX.get(name) ?? null;
}

/** True if the name is a registered feature. */
export function isKnownFeature(name: string): boolean {
  return FEATURE_INDEX.has(name);
}

/** True if the value is legal for the named feature. Unknown feature → false. */
export function isValidValue(name: string, value: string): boolean {
  const f = FEATURE_INDEX.get(name);
  if (!f) return false;
  return f.allowedValues.includes(value);
}

/** Map of all features in their default state. */
export function getDefaults(): FeatureMap {
  const out: FeatureMap = {};
  for (const f of FEATURE_LIST) out[f.name] = f.default;
  return out;
}

/**
 * Merge stored features over defaults. Unknown stored keys and illegal
 * stored values are dropped (with a warning) so the result is always a
 * sound state, even if the on-disk file is corrupted or written by an
 * older version that knew different features.
 */
export function resolveFeatures(stored?: FeatureMap | null): FeatureMap {
  const out = getDefaults();
  if (!stored) return out;
  for (const [name, value] of Object.entries(stored)) {
    if (!isKnownFeature(name)) {
      console.warn(`[chat-features] Ignoring unknown stored feature: ${name}`);
      continue;
    }
    if (!isValidValue(name, value)) {
      console.warn(`[chat-features] Ignoring invalid value ${value} for ${name}`);
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Build the seed feature map for a brand-new session by layering the client's
 * pre-session choices (e.g. narration toggled on before the first message)
 * over any landmark defaults — the explicit client choice wins. Unknown
 * features and invalid values from either source are dropped. Returns a plain
 * map, possibly empty.
 */
export function mergeSeedFeatures(input: {
  landmark?: Record<string, string> | null | undefined;
  request?: Record<string, string> | null | undefined;
}): FeatureMap {
  const out: FeatureMap = {};
  for (const source of [input.landmark, input.request]) {
    if (!source) continue;
    for (const [name, value] of Object.entries(source)) {
      if (isKnownFeature(name) && isValidValue(name, value)) out[name] = value;
    }
  }
  return out;
}

/**
 * Attributes the system writes into the snapshot that the agent can
 * never set back via a delta tag. `local-time`/`channel`, plus
 * `open-card` (companion-pane state), ride on every message;
 * `last-activity`/`health` only on the first message of a new session
 * (see `session-context.ts`). Companion-pane activity rides as
 * `<card-activity>` child elements, not attributes (see `card-activity.ts`).
 */
const READ_ONLY_ATTRS = new Set([
  "local-time",
  "channel",
  "last-activity",
  "health",
  "open-card",
]);

/**
 * Serialize the system → agent snapshot: the optional read-only context
 * attributes plus all current feature states.
 *
 * Companion-pane activity, when present, rides as `<card-activity>` child
 * elements (so `<chat-app>` becomes a paired tag); otherwise it's
 * self-closing.
 *
 * Example output:
 *   <chat-app narration="on" prose="off"
 *     local-time="Wednesday 2026-05-13 14:23 (afternoon)" channel="web-desktop"/>
 */
export function composeChatAppSnapshot(input: {
  features: FeatureMap;
  localTime?: string;
  channel?: string;
  lastActivity?: string;
  health?: string;
  openCard?: string;
  /** Pre-rendered `<card-activity>` child elements (see `renderActivityChildren`). */
  activityChildren?: string;
}): string {
  const resolved = resolveFeatures(input.features);
  const attrs: string[] = [];
  for (const f of FEATURE_LIST) {
    const val = resolved[f.name];
    if (val === undefined) continue;
    attrs.push(`${f.name}="${escapeAttr(val)}"`);
  }
  const contextAttrs: Array<[string, string | undefined]> = [
    ["local-time", input.localTime],
    ["channel", input.channel],
    ["last-activity", input.lastActivity],
    ["health", input.health],
    ["open-card", input.openCard],
  ];
  for (const [name, value] of contextAttrs) {
    if (value !== undefined) attrs.push(`${name}="${escapeAttr(value)}"`);
  }
  const open = `<chat-app ${attrs.join(" ")}`;
  return input.activityChildren !== undefined && input.activityChildren !== ""
    ? `${open}>\n${input.activityChildren}\n</chat-app>`
    : `${open}/>`;
}

// `stripChatAppTags` now lives in `shared/chat-tags.ts` (extracted so the
// frontend chat renderers can import it without dragging this backend module
// into the client bundle). Re-exported here so this module's own callers —
// and the CLI/self-note importers of `features.stripChatAppTags` — are
// unaffected. `parseChatAppDeltas` below keeps its own variant: it captures
// attrs to extract feature deltas, a different job.
export { stripChatAppTags } from "../../shared/chat-tags.js";

export interface ChatAppDelta {
  feature: string;
  value: string;
}

/**
 * Parse `<chat-app …/>` tags out of agent output and return the deltas
 * plus the stripped content. The agent emits deltas as feature mutations;
 * each tag's attributes (excluding `time`, which is read-only) become a
 * delta. Unknown features and invalid values are dropped with a warning.
 *
 * The parsed tags are removed from the returned content so they don't
 * surface in chat history. Tags can be self-closing (`<chat-app .../>`)
 * or paired with a body (`<chat-app ...>...</chat-app>`); both are accepted.
 */
export function parseChatAppDeltas(content: string): {
  deltas: ChatAppDelta[];
  cleaned: string;
} {
  const deltas: ChatAppDelta[] = [];
  // Match both self-closing and paired forms (body, if any, ignored) — the
  // attrs capture mirrors CHAT_APP_TAG_SOURCE's shape.
  const re = /<chat-app\b([^>]*?)(?:\/\s*>|>[\S\s]*?<\/chat-app\s*>)/gi;
  const cleaned = content.replace(re, (_match, attrsRaw: string) => {
    const attrs = parseAttrs(attrsRaw);
    for (const [name, value] of attrs) {
      if (READ_ONLY_ATTRS.has(name)) continue; // system-written, ignored on input
      if (!isKnownFeature(name)) {
        console.warn(`[chat-features] Ignoring unknown feature in agent delta: ${name}`);
        continue;
      }
      if (!isValidValue(name, value)) {
        console.warn(`[chat-features] Ignoring invalid value ${value} for ${name} in agent delta`);
        continue;
      }
      deltas.push({ feature: name, value });
    }
    return "";
  });
  return { deltas, cleaned };
}

function parseAttrs(raw: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /([A-Z_a-z][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) continue;
    out.push([name, value]);
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
